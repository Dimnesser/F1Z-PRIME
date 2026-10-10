from decimal import Decimal

from sqlalchemy import select

from app.db import session_factory
from app.models import Order, PremiumNumber, Product, User
from tests.conftest import init_data_for


async def test_health(client):
    r = await client.get("/api/health")
    assert r.json() == {"status": "ok"}


async def test_seeded_countries_with_prices(client):
    r = await client.get("/api/countries")
    assert r.status_code == 200
    data = {c["code"]: c for c in r.json()}
    assert len(data) == 8
    assert data["CL"]["price"] == 60 and data["UA"]["price"] == 225 and data["US"]["dial_code"] == "+1"
    assert data["ID"]["flag"] == "🇮🇩" and data["BR"]["stock"] > 0


async def test_product_card(client):
    countries = (await client.get("/api/countries")).json()
    pid = countries[0]["product_id"]
    r = await client.get(f"/api/products/{pid}")
    assert r.status_code == 200
    assert r.json()["country"]["code"] == "CL"
    assert (await client.get("/api/products/99999")).status_code == 404


async def test_premium_numbers_masked(client):
    r = await client.get("/api/premium-numbers")
    items = r.json()
    assert items and all("number" not in i for i in items)
    assert any(i["display_mask"] == "+1 *** 7777 ***" for i in items)


async def test_auth_required_without_dev_mode(client):
    assert (await client.get("/api/me")).status_code == 401
    bad = {"Authorization": "tma " + init_data_for().replace("buyer", "hacker")}
    assert (await client.get("/api/me", headers=bad)).status_code == 401


async def test_me_creates_user(client, user_headers):
    r = await client.get("/api/me", headers=user_headers)
    assert r.status_code == 200
    assert r.json()["telegram_id"] == 5550001 and r.json()["balance"] == 0


async def test_dev_mode_user(client, monkeypatch):
    monkeypatch.setenv("DEV_MODE", "true")
    from app.config import get_settings

    get_settings.cache_clear()
    r = await client.get("/api/me")
    assert r.status_code == 200 and r.json()["username"] == "dev_tester"


async def test_admin_is_protected(client):
    assert (await client.get("/api/admin/dashboard")).status_code == 401
    assert (await client.get("/api/admin/users", headers={"Authorization": "Bearer nope"})).status_code == 401
    r = await client.post("/api/admin/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


async def test_admin_price_change_visible_in_miniapp(client, admin_headers):
    countries = (await client.get("/api/countries")).json()
    pid = next(c["product_id"] for c in countries if c["code"] == "US")
    r = await client.patch(f"/api/admin/products/{pid}", json={"price": "99.50"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["price"] == 99.5
    us = next(c for c in (await client.get("/api/countries")).json() if c["code"] == "US")
    assert us["price"] == 99.5
    assert (await client.get(f"/api/products/{pid}")).json()["price"] == 99.5
    # audit log
    actions = (await client.get("/api/admin/actions", headers=admin_headers)).json()
    assert actions[0]["entity"] == "product" and actions[0]["entity_id"] == pid


async def test_admin_product_crud(client, admin_headers):
    r = await client.post(
        "/api/admin/products",
        json={"title": "Подарочный код", "category": "digital", "price": "150", "stock": 3},
        headers=admin_headers,
    )
    assert r.status_code == 201
    pid = r.json()["id"]
    r = await client.patch(f"/api/admin/products/{pid}", json={"stock": 7, "status": "hidden"}, headers=admin_headers)
    assert r.json()["stock"] == 7 and r.json()["status"] == "hidden"
    assert (await client.get(f"/api/products/{pid}")).status_code == 404  # hidden
    r = await client.post("/api/admin/products", json={"title": "x", "price": "-1"}, headers=admin_headers)
    assert r.status_code == 422
    r = await client.delete(f"/api/admin/products/{pid}", headers=admin_headers)
    assert r.json() == {"deleted": True}


async def test_admin_users_list(client, admin_headers, user_headers):
    await client.get("/api/me", headers=user_headers)
    r = await client.get("/api/admin/users?search=buyer", headers=admin_headers)
    assert r.json()["total"] == 1
    assert r.json()["items"][0]["telegram_id"] == 5550001


async def _product_id(client, code="CL") -> int:
    return next(c["product_id"] for c in (await client.get("/api/countries")).json() if c["code"] == code)


async def test_order_created_and_persisted_idempotently(client, user_headers):
    pid = await _product_id(client)
    before = (await client.get(f"/api/products/{pid}")).json()["stock"]
    body = {"product_id": pid, "quantity": 2, "idempotency_key": "order-key-0001"}
    r1 = await client.post("/api/orders", json=body, headers=user_headers)
    r2 = await client.post("/api/orders", json=body, headers=user_headers)
    assert r1.status_code == 201 and r1.json()["id"] == r2.json()["id"]
    assert r1.json()["total"] == 120 and r1.json()["status"] == "pending"
    assert (await client.get(f"/api/products/{pid}")).json()["stock"] == before - 2
    async with session_factory()() as s:
        assert len((await s.scalars(select(Order))).unique().all()) == 1
    orders = (await client.get("/api/orders", headers=user_headers)).json()
    assert len(orders) == 1


async def test_client_cannot_set_price(client, user_headers):
    pid = await _product_id(client)
    body = {"product_id": pid, "idempotency_key": "price-hack-01", "price": 1, "total": 1, "user_id": 1}
    r = await client.post("/api/orders", json=body, headers=user_headers)
    assert r.json()["total"] == 60


async def test_out_of_stock(client, user_headers, admin_headers):
    pid = await _product_id(client)
    await client.patch(f"/api/admin/products/{pid}", json={"stock": 1}, headers=admin_headers)
    r = await client.post("/api/orders", json={"product_id": pid, "quantity": 2, "idempotency_key": "stock-001"},
                          headers=user_headers)
    assert r.status_code == 409


async def test_pending_order_limit(client, user_headers):
    pid = await _product_id(client)
    for i in range(5):
        r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": f"limit-{i:04}"},
                              headers=user_headers)
        assert r.status_code == 201
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "limit-9999"}, headers=user_headers)
    assert r.status_code == 429


async def test_balance_payment(client, user_headers, admin_headers):
    pid = await _product_id(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "bal-00001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.status_code == 402  # no money, no fake success
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    r = await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "100", "reason": "бонус"},
                          headers=admin_headers)
    assert r.json()["balance"] == 100
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.status_code == 200 and r.json()["order"]["status"] == "paid"
    me = (await client.get("/api/me", headers=user_headers)).json()
    assert me["balance"] == 40 and me["orders_count"] == 1 and me["total_spent"] == 60
    # second payment attempt must fail — no double charge
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.status_code == 409
    txs = (await client.get("/api/me/transactions", headers=user_headers)).json()
    assert [t["type"] for t in txs] == ["purchase", "admin_adjust"]


async def test_test_payments_disabled_outside_dev(client, user_headers):
    pid = await _product_id(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "test-0001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "test"}, headers=user_headers)
    assert r.status_code == 403


async def test_manual_payment_flow(client, user_headers, admin_headers, telegram_calls):
    pid = await _product_id(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "man-00001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "manual"}, headers=user_headers)
    pay = r.json()["payment"]
    assert pay["status"] == "pending" and r.json()["instructions"]
    r = await client.post(f"/api/payments/{pay['id']}/submit", json={"comment": "оплатил с карты *1234"},
                          headers=user_headers)
    assert r.json()["status"] == "awaiting_confirmation"
    # user cannot cancel while payment is being reviewed
    assert (await client.post(f"/api/orders/{order['id']}/cancel", headers=user_headers)).status_code == 409
    r = await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    r = await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=admin_headers)
    assert r.status_code == 409  # no double processing
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["status"] == "paid" and detail["payments"][0]["status"] == "confirmed"
    assert any(m == "sendMessage" for m, _ in telegram_calls)


async def test_stars_payment_idempotent(client, user_headers):
    from app.services import payments

    pid = await _product_id(client, "US")
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "star-00001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "stars"}, headers=user_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["invoice_link"].startswith("https://t.me/$invoice_")
    stars = data["payment"]["stars_amount"]
    assert stars == 89  # ceil(75 / 0.85)
    async with session_factory()() as s:
        from app.models import Payment

        p = await s.get(Payment, data["payment"]["id"])
        payload = p.payload
        assert await payments.validate_precheckout(s, payload, stars, "XTR", 5550001) is None
        assert await payments.validate_precheckout(s, payload, stars - 1, "XTR", 5550001) is not None
        assert await payments.validate_precheckout(s, payload, stars, "XTR", 1234) is not None
    for _ in range(2):  # Telegram may deliver the update twice
        async with session_factory()() as s:
            await payments.process_stars_payment(s, payload, "charge-abc", stars, "XTR", 5550001)
            await s.commit()
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["status"] == "paid"
    me = (await client.get("/api/me", headers=user_headers)).json()
    assert me["orders_count"] == 1 and me["total_spent"] == 75


async def test_cancel_releases_stock(client, user_headers):
    pid = await _product_id(client)
    stock = (await client.get(f"/api/products/{pid}")).json()["stock"]
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "cancel-001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/cancel", headers=user_headers)
    assert r.json()["status"] == "cancelled"
    assert (await client.get(f"/api/products/{pid}")).json()["stock"] == stock


async def test_order_status_transitions(client, user_headers, admin_headers):
    pid = await _product_id(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "trans-0001"},
                               headers=user_headers)).json()
    r = await client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "completed"},
                          headers=admin_headers)
    assert r.status_code == 409  # pending -> completed is forbidden (no payment)
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "60", "reason": "test"}, headers=admin_headers)
    await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    r = await client.post(f"/api/admin/orders/{order['id']}/status",
                          json={"status": "completed", "delivery_data": "CODE-123"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["delivery_data"] == "CODE-123"
    r = await client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "refunded"}, headers=admin_headers)
    assert r.json()["status"] == "refunded"
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 60


async def test_premium_number_purchase_reveals_number(client, user_headers, admin_headers):
    item = next(i for i in (await client.get("/api/premium-numbers")).json() if i["display_mask"] == "+1 *** 7777 ***")
    order = (await client.post("/api/orders", json={"premium_number_id": item["id"], "idempotency_key": "prem-0001"},
                               headers=user_headers)).json()
    assert order["total"] == 299
    # reserved -> not listed anymore, can't be bought twice
    assert item["id"] not in [i["id"] for i in (await client.get("/api/premium-numbers")).json()]
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "300", "reason": "test"}, headers=admin_headers)
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.json()["order"]["status"] == "completed"
    assert "+14157777012" in r.json()["order"]["delivery_data"]
    async with session_factory()() as s:
        assert (await s.get(PremiumNumber, item["id"])).status.value == "sold"


async def test_admin_premium_mask(client, admin_headers):
    countries = (await client.get("/api/admin/countries", headers=admin_headers)).json()
    us = next(c for c in countries if c["code"] == "US")
    r = await client.post("/api/admin/premium-numbers",
                          json={"country_id": us["id"], "number": "+1 212 888 8888", "price": "999"},
                          headers=admin_headers)
    assert r.status_code == 201 and r.json()["display_mask"].count("8") >= 4
    r = await client.patch(f"/api/admin/premium-numbers/{r.json()['id']}", json={"display_mask": "+1 *** 888 8***"},
                           headers=admin_headers)
    assert r.json()["display_mask"] == "+1 *** 888 8***"


async def test_admin_countries_crud(client, admin_headers):
    r = await client.post("/api/admin/countries",
                          json={"code": "de", "name": "Германия", "flag": "🇩🇪", "dial_code": "+49"}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["code"] == "DE"
    cid = r.json()["id"]
    r = await client.patch(f"/api/admin/countries/{cid}", json={"name": "ФРГ"}, headers=admin_headers)
    assert r.json()["name"] == "ФРГ"
    assert (await client.delete(f"/api/admin/countries/{cid}", headers=admin_headers)).status_code == 200


async def test_support_ticket(client, user_headers, admin_headers):
    r = await client.post("/api/support/tickets", json={"subject": "Вопрос", "text": "Когда выдача?"},
                          headers=user_headers)
    assert r.status_code == 201
    tid = r.json()["id"]
    r = await client.post(f"/api/admin/support/tickets/{tid}/reply", json={"text": "В течение часа"},
                          headers=admin_headers)
    assert r.json()["status"] == "answered"
    r = await client.get(f"/api/support/tickets/{tid}", headers=user_headers)
    assert [m["is_admin"] for m in r.json()["messages"]] == [False, True]


async def test_dashboard(client, admin_headers, user_headers):
    await client.get("/api/me", headers=user_headers)
    r = await client.get("/api/admin/dashboard", headers=admin_headers)
    d = r.json()
    assert d["users"] == 1 and d["stock"] > 0 and d["premium_available"] == 6


async def test_expire_orders():
    from datetime import timedelta

    from app.services.common import utcnow
    from app.services.orders import expire_stale_orders, create_order

    async with session_factory()() as s:
        user = User(telegram_id=1, first_name="x")
        s.add(user)
        await s.flush()
        product = (await s.scalars(select(Product))).first()
        stock = product.stock
        order, _ = await create_order(s, user, idempotency_key="expire-001", product_id=product.id)
        order.expires_at = utcnow() - timedelta(minutes=1)
        await s.commit()
    async with session_factory()() as s:
        assert await expire_stale_orders(s) == 1
        await s.commit()
    async with session_factory()() as s:
        assert (await s.get(Product, product.id, populate_existing=True)).stock == stock
        assert (await s.get(Order, order.id)).status.value == "expired"
    assert Decimal("1") == 1


async def test_client_error_report_is_logged(client, caplog):
    import logging

    with caplog.at_level(logging.WARNING, logger="f1z.client"):
        r = await client.post("/api/client-errors", json={"message": "boom", "stack": "a\nb", "path": "/catalog", "kind": "react"})
    assert r.status_code == 204
    assert any("boom" in rec.getMessage() and "/catalog" in rec.getMessage() for rec in caplog.records)
    r = await client.post("/api/client-errors", json={"message": "x" * 5000})
    assert r.status_code == 422  # size limited


def test_bot_token_never_logged():
    import logging

    from app.main import setup_logging
    from app.services.telegram import redact
    from tests.conftest import BOT_TOKEN

    setup_logging()
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
    assert BOT_TOKEN not in redact(f"POST https://api.telegram.org/bot{BOT_TOKEN}/sendMessage failed")

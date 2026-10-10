"""Admin panel v2: roles, analytics, bulk/import, order history, finance, settings, automation."""
from __future__ import annotations

from tests.conftest import init_data_for


async def _login(client, username: str, password: str) -> dict[str, str]:
    r = await client.post("/api/admin/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _product(client, admin_headers) -> dict:
    return (await client.get("/api/admin/products?status=active", headers=admin_headers)).json()[0]


async def _paid_order(client, user_headers, admin_headers, key: str = "panel-0001") -> dict:
    pid = (await _product(client, admin_headers))["id"]
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "1000", "reason": "test"}, headers=admin_headers)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": key}, headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.status_code == 200, r.text
    return order


async def test_me_has_owner_role(client, admin_headers):
    r = await client.get("/api/admin/me", headers=admin_headers)
    assert r.json()["role"] == "owner"


async def test_roles_and_accounts(client, admin_headers):
    r = await client.post("/api/admin/accounts", json={"username": "helper", "password": "helper-pass-123", "role": "support"},
                          headers=admin_headers)
    assert r.status_code == 201, r.text
    acc_id = r.json()["id"]
    # duplicate / env owner login are rejected
    assert (await client.post("/api/admin/accounts", json={"username": "admin", "password": "x" * 12},
                              headers=admin_headers)).status_code == 409
    support = await _login(client, "helper", "helper-pass-123")
    assert (await client.get("/api/admin/me", headers=support)).json()["role"] == "support"
    # support: tickets and read-only views, no catalog/finance changes
    assert (await client.get("/api/admin/support/tickets", headers=support)).status_code == 200
    assert (await client.get("/api/admin/users", headers=support)).status_code == 200
    pid = (await _product(client, admin_headers))["id"]
    assert (await client.patch(f"/api/admin/products/{pid}", json={"price": "1"}, headers=support)).status_code == 403
    assert (await client.get("/api/admin/payments", headers=support)).status_code == 403
    assert (await client.get("/api/admin/accounts", headers=support)).status_code == 403
    assert (await client.put("/api/admin/settings", json={"values": {"shop_name": "X"}}, headers=support)).status_code == 403
    # promotion applies immediately; deactivation revokes the session
    await client.patch(f"/api/admin/accounts/{acc_id}", json={"role": "admin"}, headers=admin_headers)
    assert (await client.patch(f"/api/admin/products/{pid}", json={"stock": 3, "stock_reason": "пересчёт"}, headers=support)).status_code == 200
    assert (await client.get("/api/admin/accounts", headers=support)).status_code == 403  # owner only
    await client.patch(f"/api/admin/accounts/{acc_id}", json={"is_active": False}, headers=admin_headers)
    assert (await client.get("/api/admin/me", headers=support)).status_code == 401
    r = await client.post("/api/admin/login", json={"username": "helper", "password": "helper-pass-123"})
    assert r.status_code == 401


async def test_dashboard_analytics(client, admin_headers, user_headers):
    await _paid_order(client, user_headers, admin_headers)
    d = (await client.get("/api/admin/dashboard?days=7", headers=admin_headers)).json()
    assert d["paid_orders"] == 1 and d["revenue"] > 0 and d["revenue_today"] == d["revenue"]
    assert len(d["sales"]) == 7 and d["sales"][-1]["orders"] == 1
    assert len(d["new_users"]) == 7 and d["new_users"][-1]["users"] == 1
    assert d["categories"][0]["slug"] == "numbers"
    assert len(d["recent_orders"]) == 1
    assert {"pending_orders", "failed_payments", "open_tickets", "low_stock"} <= d.keys()


async def test_users_filters_detail_export(client, admin_headers, user_headers):
    await _paid_order(client, user_headers, admin_headers)
    r = await client.get("/api/admin/users?has_orders=true&sort=spent", headers=admin_headers)
    assert r.json()["total"] == 1
    uid = r.json()["items"][0]["id"]
    detail = (await client.get(f"/api/admin/users/{uid}", headers=admin_headers)).json()
    assert len(detail["orders"]) == 1 and len(detail["payments"]) == 1
    adjust = [t for t in detail["transactions"] if t["type"] == "admin_adjust"][0]
    assert "admin" in adjust["description"]  # the journal records who changed the balance
    r = await client.get("/api/admin/users/export.csv", headers=admin_headers)
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "5550001" in r.text
    r = await client.patch(f"/api/admin/users/{uid}", json={"is_blocked": True}, headers=admin_headers)
    assert r.json()["is_blocked"] is True
    assert (await client.get("/api/me", headers=user_headers)).status_code == 403


async def test_bulk_prices_and_status(client, admin_headers):
    products = (await client.get("/api/admin/products", headers=admin_headers)).json()
    ids = [p["id"] for p in products[:2]]
    before = {p["id"]: p["price"] for p in products[:2]}
    r = await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "price_percent", "value": "10"},
                          headers=admin_headers)
    assert r.json()["updated"] == 2
    after = {p["id"]: p["price"] for p in (await client.get("/api/admin/products", headers=admin_headers)).json()}
    for pid in ids:
        assert abs(after[pid] - round(before[pid] * 1.1, 2)) < 0.01
    # all-or-nothing validation
    r = await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "price_delta", "value": "-100000"},
                          headers=admin_headers)
    assert r.status_code == 422
    r = await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "status", "value": "hidden"},
                          headers=admin_headers)
    assert r.status_code == 200
    visible = {p["id"] for p in (await client.get("/api/products")).json()}
    assert not visible & set(ids)


async def test_products_csv_roundtrip(client, admin_headers):
    r = await client.get("/api/admin/products/export.csv", headers=admin_headers)
    assert r.status_code == 200 and r.text.startswith("﻿id;title")
    csv_text = "title;price;stock;category;country_code\nНовый товар;12,50;4;digital;\nБитый;abc;1;digital;\n"
    r = await client.post("/api/admin/products/import", json={"csv": csv_text}, headers=admin_headers)
    body = r.json()
    assert body["applied"] is False and body["errors"][0]["row"] == 3  # nothing saved when a row is invalid
    csv_text = "title;price;stock;category;country_code\nНовый товар;12,50;4;digital;US\n"
    r = await client.post("/api/admin/products/import", json={"csv": csv_text, "dry_run": True}, headers=admin_headers)
    assert r.json() == {"created": 1, "updated": 0, "errors": [], "applied": False}
    r = await client.post("/api/admin/products/import", json={"csv": csv_text}, headers=admin_headers)
    assert r.json()["applied"] is True
    created = [p for p in (await client.get("/api/admin/products?search=Новый", headers=admin_headers)).json()]
    assert created[0]["price"] == 12.5 and created[0]["country"]["code"] == "US"
    pid = created[0]["id"]
    r = await client.post("/api/admin/products/import", json={"csv": f"id,title,price\n{pid},Обновлён,15\n"},
                          headers=admin_headers)
    assert r.json()["updated"] == 1


async def test_categories(client, admin_headers):
    r = await client.post("/api/admin/categories", json={"slug": "gift_cards", "title": "Подарочные карты", "icon": "gift"},
                          headers=admin_headers)
    assert r.status_code == 201
    assert (await client.post("/api/admin/categories", json={"slug": "premium", "title": "x"}, headers=admin_headers)).status_code == 422
    r = await client.post("/api/admin/products", json={"title": "Карта", "price": "100", "category": "unknown"},
                          headers=admin_headers)
    assert r.status_code == 422
    r = await client.post("/api/admin/products", json={"title": "Карта", "price": "100", "category": "gift_cards", "stock": 2},
                          headers=admin_headers)
    assert r.status_code == 201
    cats = {c["slug"]: c for c in (await client.get("/api/categories")).json()}
    assert cats["gift_cards"]["title"] == "Подарочные карты"
    cid = [c for c in (await client.get("/api/admin/categories", headers=admin_headers)).json() if c["slug"] == "gift_cards"][0]["id"]
    assert (await client.delete(f"/api/admin/categories/{cid}", headers=admin_headers)).status_code == 409
    await client.patch(f"/api/admin/categories/{cid}", json={"is_active": False}, headers=admin_headers)
    assert "gift_cards" not in {c["slug"] for c in (await client.get("/api/categories")).json()}


async def test_order_detail_history_and_filters(client, admin_headers, user_headers):
    order = await _paid_order(client, user_headers, admin_headers)
    r = await client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "completed", "delivery_data": "OK"},
                          headers=admin_headers)
    assert r.status_code == 200
    d = (await client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers)).json()
    statuses = [e["to_status"] for e in d["events"]]
    assert [x for i, x in enumerate(statuses) if i == 0 or statuses[i - 1] != x] == ["pending", "paid", "processing", "completed"]
    assert d["events"][-1]["actor"] == "admin:admin"
    assert d["allowed"] == ["refunded"] and len(d["payments"]) == 1
    r = (await client.get("/api/admin/orders?status=completed&method=balance", headers=admin_headers)).json()
    assert r["total"] == 1 and r["counts"]["completed"] == 1
    assert (await client.get("/api/admin/orders?status=bogus", headers=admin_headers)).status_code == 422
    r = await client.get("/api/admin/orders/export.csv", headers=admin_headers)
    assert f"\n{order['id']};" in r.text


async def test_awaiting_payment_filter_and_confirm_rules(client, admin_headers, user_headers):
    pid = (await _product(client, admin_headers))["id"]
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "await-0001"}, headers=user_headers)).json()
    pay = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "manual"}, headers=user_headers)).json()["payment"]
    # not submitted by the buyer yet -> cannot be confirmed manually
    r = await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=admin_headers)
    assert r.status_code == 409
    await client.post(f"/api/payments/{pay['id']}/submit", json={"comment": "card"}, headers=user_headers)
    r = (await client.get("/api/admin/orders?status=awaiting_payment", headers=admin_headers)).json()
    assert r["total"] == 1 and r["items"][0]["in_review"] is True
    r = await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=admin_headers)
    assert r.status_code == 200


async def test_finance_summary_and_reports(client, admin_headers, user_headers):
    order = await _paid_order(client, user_headers, admin_headers)
    r = await client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "refunded"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    await _paid_order(client, user_headers, admin_headers, key="panel-0002")
    f = (await client.get("/api/admin/finance/summary", headers=admin_headers)).json()
    assert f["paid_orders"] == 1  # refunded order is not revenue
    assert f["refunds_count"] == 1 and f["refunds"] > 0
    assert f["by_method"][0]["method"] == "balance"
    assert len(f["daily"]) == 30
    tx = (await client.get("/api/admin/finance/transactions?type=refund", headers=admin_headers)).json()
    assert tx["total"] == 1
    for path in ("/api/admin/finance/report.csv", "/api/admin/finance/transactions/export.csv",
                 "/api/admin/payments/export.csv"):
        r = await client.get(path, headers=admin_headers)
        assert r.status_code == 200 and "text/csv" in r.headers["content-type"], path


async def test_settings_validation_and_public_config(client, admin_headers):
    r = await client.put("/api/admin/settings", json={"values": {"maintenance_mode": "maybe"}}, headers=admin_headers)
    assert r.status_code == 422
    r = await client.put("/api/admin/settings", json={"values": {"support_url": "javascript:alert(1)"}}, headers=admin_headers)
    assert r.status_code == 422
    r = await client.put("/api/admin/settings", json={"values": {"min_topup": "900", "max_topup": "100"}}, headers=admin_headers)
    assert r.status_code == 422
    r = await client.put(
        "/api/admin/settings",
        json={"values": {"shop_name": "F1Z TEST", "shop_description": "Описание", "channel_url": "https://t.me/f1z"}},
        headers=admin_headers,
    )
    assert r.status_code == 200
    cfg = (await client.get("/api/config")).json()["settings"]
    assert cfg["shop_name"] == "F1Z TEST" and cfg["channel_url"] == "https://t.me/f1z"
    assert "notify_orders" not in cfg and "auto_backup" not in cfg  # private settings stay private


async def test_maintenance_blocks_purchases(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"maintenance_mode": "true"}}, headers=admin_headers)
    pid = (await _product(client, admin_headers))["id"]
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "maint-0001"}, headers=user_headers)
    assert r.status_code == 503 and r.json()["code"] == "maintenance"
    r = await client.post("/api/balance/topup", json={"amount": "100", "method": "manual"}, headers=user_headers)
    assert r.status_code == 503
    assert (await client.get("/api/products")).status_code == 200  # browsing still works
    await client.put("/api/admin/settings", json={"values": {"maintenance_mode": "false"}}, headers=admin_headers)
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "maint-0002"}, headers=user_headers)
    assert r.status_code == 201


async def test_auto_complete_digital(client, admin_headers, user_headers):
    r = await client.post("/api/admin/products", json={"title": "Ваучер", "price": "10", "stock": 5, "category": "digital",
                                                        "delivery_note": "Код в личном кабинете",
                                                        "fulfillment_mode": "auto"}, headers=admin_headers)
    pid = r.json()["id"]
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "50", "reason": "test"}, headers=admin_headers)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "auto-0001"}, headers=user_headers)).json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert r.json()["order"]["status"] == "completed"
    assert r.json()["order"]["delivery_data"] == "Код в личном кабинете"


async def test_notification_toggle_and_outbox(client, admin_headers, user_headers, telegram_calls, monkeypatch):
    await client.put("/api/admin/settings", json={"values": {"notify_tickets": "false"}}, headers=admin_headers)
    telegram_calls.clear()
    await client.post("/api/support/tickets", json={"subject": "Вопрос", "text": "Помогите"}, headers=user_headers)
    assert not any(p.get("chat_id") == 999 for _, p in telegram_calls)

    from app.services import telegram

    async def broken(method, payload, timeout=10.0):
        raise telegram.TelegramError("Bad Gateway")

    monkeypatch.setattr(telegram, "call", broken)
    tid = (await client.get("/api/admin/support/tickets", headers=admin_headers)).json()[0]["id"]
    await client.post(f"/api/admin/support/tickets/{tid}/reply", json={"text": "Ответ"}, headers=admin_headers)
    status = (await client.get("/api/admin/system/status", headers=admin_headers)).json()
    assert status["notifications"]["pending"] == 1

    async def ok(method, payload, timeout=10.0):
        return True

    monkeypatch.setattr(telegram, "call", ok)
    r = await client.post("/api/admin/system/notifications/retry", headers=admin_headers)
    assert r.json()["sent"] == 1


async def test_support_assign_and_list_preview(client, admin_headers, user_headers):
    await client.post("/api/support/tickets", json={"subject": "Заказ", "text": "Где мой заказ?"}, headers=user_headers)
    tickets = (await client.get("/api/admin/support/tickets?assigned=none", headers=admin_headers)).json()
    assert tickets[0]["last_message"]["text"] == "Где мой заказ?" and tickets[0]["messages_count"] == 1
    tid = tickets[0]["id"]
    r = await client.post(f"/api/admin/support/tickets/{tid}/assign", json={"assigned_to": "nobody"}, headers=admin_headers)
    assert r.status_code == 422
    r = await client.post(f"/api/admin/support/tickets/{tid}/assign", json={"assigned_to": "admin"}, headers=admin_headers)
    assert r.json()["assigned_to"] == "admin"
    assert len((await client.get("/api/admin/support/tickets?assigned=me", headers=admin_headers)).json()) == 1
    ops = (await client.get("/api/admin/operators", headers=admin_headers)).json()
    assert ops[0] == {"username": "admin", "role": "owner"}


async def test_backups(client, admin_headers, tmp_path, monkeypatch):
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    r = await client.post("/api/admin/system/backups", headers=admin_headers)
    assert r.status_code == 200
    name = r.json()["name"]
    assert [b["name"] for b in (await client.get("/api/admin/system/backups", headers=admin_headers)).json()] == [name]
    r = await client.get(f"/api/admin/system/backups/{name}", headers=admin_headers)
    assert r.status_code == 200 and r.content[:2] == b"\x1f\x8b"  # gzip
    assert (await client.get("/api/admin/system/backups/..%2Fetc%2Fpasswd", headers=admin_headers)).status_code == 404


async def test_client_errors_reach_monitor(client, admin_headers):
    await client.post("/api/client-errors", json={"message": "boom", "path": "/catalog"})
    errors = (await client.get("/api/admin/system/errors", headers=admin_headers)).json()
    assert errors[0]["message"] == "boom" and errors[0]["source"] == "client"


async def test_csv_formula_injection_is_neutralised(client, admin_headers):
    other = {"Authorization": f"tma {init_data_for(7770001, username='evil')}"}
    await client.get("/api/me", headers=other)
    # first_name comes from Telegram; simulate a malicious one directly in the DB
    from sqlalchemy import update

    from app.db import session_factory
    from app.models import User

    async with session_factory()() as s:
        await s.execute(update(User).where(User.telegram_id == 7770001).values(first_name="=HYPERLINK(\"x\")"))
        await s.commit()
    r = await client.get("/api/admin/users/export.csv", headers=admin_headers)
    assert "'=HYPERLINK" in r.text

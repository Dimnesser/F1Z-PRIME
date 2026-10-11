"""Order automation: inventory units, fulfillment worker, retries, notifications, refunds, incidents.

All Telegram calls are faked (conftest.telegram_calls); no real payments or refunds are made.
"""
from __future__ import annotations

import asyncio
from datetime import timedelta

from sqlalchemy import select, update

from app.db import session_factory
from app.models import AdminAction, Incident, InventoryItem, Job, Order, Payment
from app.services import jobs, payments
from app.services.common import utcnow
from app.worker import run_jobs, run_periodic


async def _key_product(client, admin_headers, units: list[str], price: str = "40", mode: str = "auto") -> int:
    r = await client.post("/api/admin/products", json={
        "title": "Ключ активации", "category": "digital", "price": price, "stock": 0,
        "fulfillment_mode": mode, "uses_inventory": True,
    }, headers=admin_headers)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    if units:
        r = await client.post(f"/api/admin/products/{pid}/inventory", json={"units": "\n".join(units)}, headers=admin_headers)
        assert r.status_code == 200, r.text
    return pid


async def _fund(client, admin_headers, user_headers, amount: str = "500") -> None:
    me = (await client.get("/api/me", headers=user_headers)).json()
    r = await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": amount, "reason": "тест"}, headers=admin_headers)
    assert r.status_code == 200


async def _buy(client, user_headers, pid: int, key: str, qty: int = 1, method: str = "balance") -> dict:
    r = await client.post("/api/orders", json={"product_id": pid, "quantity": qty, "idempotency_key": key}, headers=user_headers)
    assert r.status_code == 201, r.text
    order = r.json()
    r = await client.post(f"/api/orders/{order['id']}/pay", json={"method": method}, headers=user_headers)
    assert r.status_code == 200, r.text
    return r.json()


# 1. auto delivery of an encrypted unit, visible to the buyer only after delivery
async def test_auto_delivery_of_inventory_unit(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["AAAA-1111-SECRET", "BBBB-2222-SECRET"])
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    await _fund(client, admin_headers, user_headers)
    res = await _buy(client, user_headers, pid, "keybuy-0001")
    assert res["order"]["status"] == "completed" and res["order"]["stage"] == "delivered"
    detail = (await client.get(f"/api/orders/{res['order']['id']}", headers=user_headers)).json()
    assert detail["delivered_items"] == ["AAAA-1111-SECRET"]
    # staff see only a masked label
    admin_detail = (await client.get(f"/api/admin/orders/{res['order']['id']}", headers=admin_headers)).json()
    assert admin_detail["units"][0]["label"] != "AAAA-1111-SECRET"
    assert "SECRET" not in str(admin_detail)
    inv = (await client.get(f"/api/admin/products/{pid}/inventory", headers=admin_headers)).json()
    assert inv["counts"]["sold"] == 1 and inv["counts"]["available"] == 1 and inv["stock"] == 1


# 2. secrets are stored encrypted and never revealed before payment
async def test_units_encrypted_and_hidden_before_payment(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["PLAIN-VALUE-XYZ"])
    async with session_factory()() as s:
        item = await s.scalar(select(InventoryItem).where(InventoryItem.product_id == pid))
        assert "PLAIN-VALUE-XYZ" not in item.secret_enc and item.secret_enc.startswith("v1:")
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "hidden-0001"},
                               headers=user_headers)).json()
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["delivered_items"] == [] and detail["stage"] == "pending_payment"
    # the audit log of the import has counts only
    async with session_factory()() as s:
        logs = (await s.scalars(select(AdminAction).where(AdminAction.action == "inventory_import"))).all()
        assert logs and all("PLAIN-VALUE" not in str(a.details) for a in logs)


# 3. duplicate units are skipped on import
async def test_duplicate_units_skipped(client, admin_headers):
    pid = await _key_product(client, admin_headers, ["K-1", "K-2"])
    r = await client.post(f"/api/admin/products/{pid}/inventory", json={"units": "K-2\nK-3\nK-3\n\n"}, headers=admin_headers)
    assert r.json()["added"] == 1 and r.json()["duplicates"] == 1 and r.json()["stock"] == 3


# 4. the last unit cannot be sold twice under concurrency
async def test_last_unit_concurrent_orders(client, admin_headers):
    from tests.conftest import init_data_for

    pid = await _key_product(client, admin_headers, ["ONLY-ONE"])
    h1 = {"Authorization": f"tma {init_data_for(7001, 'a')}"}
    h2 = {"Authorization": f"tma {init_data_for(7002, 'b')}"}
    r1, r2 = await asyncio.gather(
        client.post("/api/orders", json={"product_id": pid, "idempotency_key": "race-00001"}, headers=h1),
        client.post("/api/orders", json={"product_id": pid, "idempotency_key": "race-00002"}, headers=h2),
    )
    assert sorted([r1.status_code, r2.status_code]) == [201, 409]


# 5. expired reservation returns the unit to stock
async def test_reservation_expiry_releases_unit(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["EXP-1"])
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "expire-0001"},
                               headers=user_headers)).json()
    async with session_factory()() as s:
        await s.execute(update(Order).where(Order.id == order["id"]).values(expires_at=utcnow() - timedelta(minutes=1)))
        await s.commit()
    await run_periodic(force=True)
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["status"] == "expired"
    inv = (await client.get(f"/api/admin/products/{pid}/inventory", headers=admin_headers)).json()
    assert inv["counts"]["available"] == 1 and inv["stock"] == 1


# 6. "I paid" never marks an order paid by itself
async def test_i_paid_button_does_not_mark_paid(client, user_headers):
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "ipaid-0001"}, headers=user_headers)).json()
    pay = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "manual"}, headers=user_headers)).json()["payment"]
    await client.post(f"/api/payments/{pay['id']}/submit", json={"comment": "оплатил"}, headers=user_headers)
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["status"] == "pending" and detail["stage"] == "payment_review"


# 7. repeated payment events never deliver twice
async def test_duplicate_stars_event_single_delivery(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["S-1", "S-2", "S-3"])
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true", "stars_enabled": "true"}},
                     headers=admin_headers)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "stars-dup-01"},
                               headers=user_headers)).json()
    data = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "stars"}, headers=user_headers)).json()
    async with session_factory()() as s:
        p = await s.get(Payment, data["payment"]["id"])
        payload, stars = p.payload, p.stars_amount
    for _ in range(3):
        async with session_factory()() as s:
            await payments.process_stars_payment(s, payload, "charge-dup", stars, "XTR", 5550001)
            await s.commit()
    for _ in range(2):
        await run_jobs()
    async with session_factory()() as s:
        sold = (await s.scalars(select(InventoryItem).where(InventoryItem.status == "sold"))).all()
        assert len(sold) == 1
        o = await s.get(Order, order["id"])
        assert o.status.value == "completed"


# 8. Stars amount mismatch is not confirmed and opens a critical incident
async def test_stars_mismatch_incident(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"stars_enabled": "true"}}, headers=admin_headers)
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "mismatch-01"}, headers=user_headers)).json()
    data = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "stars"}, headers=user_headers)).json()
    async with session_factory()() as s:
        p = await s.get(Payment, data["payment"]["id"])
        await payments.process_stars_payment(s, p.payload, "charge-bad", p.stars_amount - 1, "XTR", 5550001)
        await s.commit()
    async with session_factory()() as s:
        inc = await s.scalar(select(Incident).where(Incident.kind == "stars_mismatch"))
        assert inc is not None and inc.severity == "critical"
        assert (await s.get(Order, order["id"])).status.value == "pending"


# 9. manual mode → operator queue; completion by an operator
async def test_manual_mode_operator_queue(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["M-1"], mode="manual")
    await _fund(client, admin_headers, user_headers)
    res = await _buy(client, user_headers, pid, "manual-0001")
    assert res["order"]["stage"] == "manual_review"
    r = await client.post(f"/api/admin/orders/{res['order']['id']}/status", json={"status": "completed"}, headers=admin_headers)
    assert r.status_code == 200
    detail = (await client.get(f"/api/orders/{res['order']['id']}", headers=user_headers)).json()
    assert detail["delivered_items"] == ["M-1"]


# 10. review mode holds the order
async def test_review_mode(client, admin_headers, user_headers):
    pid = await _key_product(client, admin_headers, ["R-1"], mode="review")
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    await _fund(client, admin_headers, user_headers)
    res = await _buy(client, user_headers, pid, "review-0001")
    assert res["order"]["fulfillment_status"] == "review" and res["order"]["status"] == "processing"


# 11. failure → retries with backoff → dead letter → failed + incident; admin retry delivers
async def test_fulfillment_failure_dead_letter_and_retry(client, admin_headers, user_headers, monkeypatch):
    from app.services import inventory
    from app.services.common import ServiceError

    pid = await _key_product(client, admin_headers, ["UNIT-1"], price="10")
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    real_sell = inventory.sell_units

    async def broken(*a, **kw):  # e.g. decryption key misconfigured / storage error
        raise ServiceError("Склад недоступен", 503)

    monkeypatch.setattr(inventory, "sell_units", broken)
    await _fund(client, admin_headers, user_headers)
    res = await _buy(client, user_headers, pid, "fail-00001")
    oid = res["order"]["id"]
    assert res["order"]["status"] == "paid"  # fast path failed, job remains
    for _ in range(8):
        async with session_factory()() as s:
            await s.execute(update(Job).where(Job.dedupe_key == f"fulfill:{oid}", Job.status == "pending").values(run_at=utcnow()))
            await s.commit()
        await run_jobs()
    async with session_factory()() as s:
        job = await s.scalar(select(Job).where(Job.dedupe_key == f"fulfill:{oid}"))
        assert job.status == "dead" and job.attempts == job.max_attempts
        o = await s.get(Order, oid)
        assert o.fulfillment_status == "failed" and o.status.value == "processing"
        assert await s.scalar(select(Incident).where(Incident.kind == "fulfillment_failed", Incident.order_id == oid))
    # the cause is fixed, admin presses «Повторить»
    monkeypatch.setattr(inventory, "sell_units", real_sell)
    r = await client.post(f"/api/admin/orders/{oid}/fulfillment/retry", headers=admin_headers)
    assert r.json()["fulfillment_status"] == "delivered"
    async with session_factory()() as s:
        inc = await s.scalar(select(Incident).where(Incident.kind == "fulfillment_failed", Incident.order_id == oid))
        assert inc.status == "resolved"


# 12. worker restart: a job stuck in "running" goes back to the queue
async def test_stale_running_job_recovered(client):
    async with session_factory()() as s:
        await jobs.enqueue(s, "tg_message", {"chat_id": 1, "text": "x"}, dedupe_key="stale-1")
        await s.commit()
        await s.execute(update(Job).where(Job.dedupe_key == "stale-1").values(status="running", locked_at=utcnow() - timedelta(minutes=10)))
        await s.commit()
        assert await jobs.recover_stale(s) == 1
        await s.commit()
    await run_jobs()
    async with session_factory()() as s:
        assert (await s.scalar(select(Job).where(Job.dedupe_key == "stale-1"))).status == "done"


# 13. notifications are deduplicated per (order, event)
async def test_notification_dedupe(client, admin_headers, user_headers, telegram_calls):
    pid = await _key_product(client, admin_headers, ["N-1"])
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    await _fund(client, admin_headers, user_headers)
    res = await _buy(client, user_headers, pid, "dedupe-0001")
    from app.services import fulfillment

    await fulfillment.run_now(res["order"]["id"])  # second delivery attempt is a no-op
    await run_jobs()
    await run_jobs()
    delivered = [p for m, p in telegram_calls if m == "sendMessage" and p.get("chat_id") == 5550001 and "выполнен" in p["text"]]
    assert len(delivered) == 1
    assert "N-1" not in str(telegram_calls)  # secrets never go into messages


# 14. Telegram API failure is retried, not lost
async def test_notification_retry_on_network_error(client, monkeypatch):
    from app.services import telegram

    calls = {"n": 0}

    async def flaky(method, payload, timeout=10.0):
        calls["n"] += 1
        if calls["n"] == 1:
            raise telegram.TelegramError("network down")
        return True

    monkeypatch.setattr(telegram, "call", flaky)
    async with session_factory()() as s:
        await jobs.enqueue(s, "tg_message", {"chat_id": 1, "text": "hi"}, dedupe_key="flaky-1")
        await s.commit()
    await run_jobs()
    async with session_factory()() as s:
        job = await s.scalar(select(Job).where(Job.dedupe_key == "flaky-1"))
        assert job.status == "pending" and job.attempts == 1 and job.run_at > utcnow()
        await s.execute(update(Job).where(Job.id == job.id).values(run_at=utcnow()))
        await s.commit()
    await run_jobs()
    async with session_factory()() as s:
        assert (await s.scalar(select(Job).where(Job.dedupe_key == "flaky-1"))).status == "done"


# 15. refund to balance once; a second refund is rejected
async def test_refund_balance_no_double(client, admin_headers, user_headers):
    await _fund(client, admin_headers, user_headers, "100")
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    res = await _buy(client, user_headers, pid, "refund-0001")
    oid = res["order"]["id"]
    r = await client.post(f"/api/admin/orders/{oid}/refund", json={"method": "balance", "reason": "клиент передумал"},
                          headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "succeeded", r.text
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 100
    r = await client.post(f"/api/admin/orders/{oid}/refund", json={"method": "balance", "reason": "ещё раз"}, headers=admin_headers)
    assert r.status_code == 409
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 100


# 16. Stars refund goes through refundStarPayment; ALREADY_REFUNDED counts as success, nothing doubles
async def test_stars_refund_via_api(client, admin_headers, user_headers, telegram_calls):
    await client.put("/api/admin/settings", json={"values": {"stars_enabled": "true"}}, headers=admin_headers)
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "starsref-01"}, headers=user_headers)).json()
    data = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "stars"}, headers=user_headers)).json()
    async with session_factory()() as s:
        p = await s.get(Payment, data["payment"]["id"])
        await payments.process_stars_payment(s, p.payload, "charge-ref", p.stars_amount, "XTR", 5550001)
        await s.commit()
    r = await client.post(f"/api/admin/orders/{order['id']}/refund", json={"method": "stars", "reason": "возврат"},
                          headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] in ("requested", "processing"), r.text
    await run_jobs()
    refund_calls = [p for m, p in telegram_calls if m == "refundStarPayment"]
    assert len(refund_calls) == 1 and refund_calls[0]["telegram_payment_charge_id"] == "charge-ref"
    detail = (await client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers)).json()
    assert detail["refunds"][0]["status"] == "succeeded" and detail["order"]["status"] == "refunded"
    # the buyer's balance is not credited in addition to the Stars refund
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 0


# 17. manual refund is not marked successful until an operator confirms the transfer
async def test_manual_refund_needs_confirmation(client, admin_headers, user_headers):
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "manref-001"}, headers=user_headers)).json()
    pay = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "manual"}, headers=user_headers)).json()["payment"]
    await client.post(f"/api/payments/{pay['id']}/submit", json={"comment": "карта"}, headers=user_headers)
    assert (await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=admin_headers)).status_code == 200
    r = await client.post(f"/api/admin/orders/{order['id']}/refund", json={"method": "manual", "reason": "брак"}, headers=admin_headers)
    assert r.json()["status"] == "manual_pending", r.text
    detail = (await client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers)).json()
    assert detail["order"]["status"] != "refunded"
    r = await client.post(f"/api/admin/refunds/{r.json()['refund_id']}/confirm-manual", json={"note": "перевод #77"},
                          headers=admin_headers)
    assert r.json()["status"] == "succeeded"
    detail = (await client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers)).json()
    assert detail["order"]["status"] == "refunded"


# 18. payment arriving after the order was closed goes to the balance and is flagged
async def test_late_payment_to_balance(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"stars_enabled": "true"}}, headers=admin_headers)
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "late-00001"}, headers=user_headers)).json()
    data = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "stars"}, headers=user_headers)).json()
    async with session_factory()() as s:
        await s.execute(update(Order).where(Order.id == order["id"]).values(expires_at=utcnow() - timedelta(minutes=1)))
        await s.commit()
    await run_periodic(force=True)
    async with session_factory()() as s:
        p = await s.get(Payment, data["payment"]["id"])
        await payments.process_stars_payment(s, p.payload, "charge-late", p.stars_amount, "XTR", 5550001)
        await s.commit()
        assert await s.scalar(select(Incident).where(Incident.kind == "late_payment"))
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 60


# 19. one-tap support ticket linked to the order, reused for repeated taps
async def test_order_support_ticket(client, admin_headers, user_headers):
    await _fund(client, admin_headers, user_headers)
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    res = await _buy(client, user_headers, pid, "support-001")
    oid = res["order"]["id"]
    r = await client.post(f"/api/orders/{oid}/support", json={"category": "not_received"}, headers=user_headers)
    assert r.status_code == 201 and r.json()["order_id"] == oid and r.json()["priority"] == "high"
    r2 = await client.post(f"/api/orders/{oid}/support", json={"category": "question", "text": "когда?"}, headers=user_headers)
    assert r2.json()["id"] == r.json()["id"] and len(r2.json()["messages"]) == 2
    detail = (await client.get(f"/api/orders/{oid}", headers=user_headers)).json()
    assert detail["support_ticket_id"] == r.json()["id"]
    # another user cannot open a ticket on this order
    from tests.conftest import init_data_for

    other = {"Authorization": f"tma {init_data_for(7777, 'x')}"}
    assert (await client.post(f"/api/orders/{oid}/support", json={"category": "question"}, headers=other)).status_code == 404


# 20. automation center: overview, timeline, job retry, dead jobs counted
async def test_automation_center_and_timeline(client, admin_headers, user_headers):
    await _fund(client, admin_headers, user_headers)
    pid = next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)
    res = await _buy(client, user_headers, pid, "center-0001")
    await run_jobs()
    ov = (await client.get("/api/admin/automation/overview", headers=admin_headers))
    assert ov.status_code == 200, ov.text
    assert "dead_jobs" in ov.json() and "tasks" in ov.json()
    detail = (await client.get(f"/api/admin/orders/{res['order']['id']}", headers=admin_headers)).json()
    kinds = {t["kind"] for t in detail["timeline"]}
    assert {"status", "payment"} <= kinds and detail["stage"] == "manual_review"
    async with session_factory()() as s:
        await jobs.enqueue(s, "tg_message", {"chat_id": 1, "text": "x"}, dedupe_key="dead-1", max_attempts=1)
        await s.commit()
    from app.services import telegram

    async def boom(method, payload, timeout=10.0):
        raise telegram.TelegramError("down")

    orig = telegram.call
    telegram.call = boom
    try:
        await run_jobs()
    finally:
        telegram.call = orig
    jl = (await client.get("/api/admin/automation/jobs?status=dead", headers=admin_headers)).json()
    items = jl
    dead = next(j for j in items if j["dedupe_key"] == "dead-1")
    r = await client.post(f"/api/admin/automation/jobs/{dead['id']}/retry", headers=admin_headers)
    assert r.status_code == 200
    await run_jobs()
    async with session_factory()() as s:
        assert (await s.scalar(select(Job).where(Job.dedupe_key == "dead-1"))).status == "done"

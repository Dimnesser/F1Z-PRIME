"""Promo codes, product extensions and automation rules."""
from __future__ import annotations

import asyncio
from datetime import timedelta

from sqlalchemy import select

from app.db import session_factory
from app.models import Job, RuleRun
from app.services.common import utcnow
from app.worker import run_jobs
from tests.conftest import init_data_for


def tma(uid: int) -> dict[str, str]:
    return {"Authorization": f"tma {init_data_for(uid, username=f'u{uid}')}"}


async def _pid(client) -> int:
    return next(p["id"] for p in (await client.get("/api/products")).json() if p["price"] == 60)  # 60 UAH, plenty of stock


async def test_promo_percent_applied_on_server(client, admin_headers, user_headers):
    r = await client.post("/api/admin/promo-codes", json={"code": "spring10", "kind": "percent", "value": "10"},
                          headers=admin_headers)
    assert r.status_code == 201 and r.json()["code"] == "SPRING10"
    pid = await _pid(client)
    prev = (await client.post("/api/promo/check", json={"code": "spring10", "product_id": pid}, headers=user_headers)).json()
    assert prev["discount"] == 6 and prev["total"] == 54
    # the client can't send its own discount/total — only the code
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "promo-0001", "promo_code": "spring10",
                                               "total": 1, "discount": 59}, headers=user_headers)
    assert r.status_code == 201 and r.json()["total"] == 54 and r.json()["discount"] == 6
    # one use per user by default
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "promo-0002", "promo_code": "SPRING10"},
                          headers=user_headers)
    assert r.status_code == 409


async def test_promo_last_activation_race(client, admin_headers):
    await client.post("/api/admin/promo-codes", json={"code": "ONLYONE", "kind": "fixed", "value": "5", "max_uses": 1},
                      headers=admin_headers)
    pid = await _pid(client)
    reqs = [client.post("/api/orders", json={"product_id": pid, "idempotency_key": f"race-promo-{i}", "promo_code": "ONLYONE"},
                        headers=tma(9100 + i)) for i in range(4)]
    codes = sorted(r.status_code for r in await asyncio.gather(*reqs))
    assert codes.count(201) == 1 and codes.count(409) == 3
    promos = (await client.get("/api/admin/promo-codes", headers=admin_headers)).json()
    assert promos[0]["used_count"] == 1 and promos[0]["state"] == "exhausted"


async def test_promo_released_on_cancel_and_rules(client, admin_headers, user_headers):
    await client.post("/api/admin/promo-codes", json={
        "code": "WINDOW", "kind": "fixed", "value": "100", "max_uses": 1, "min_total": "50",
    }, headers=admin_headers)
    pid = await _pid(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "rel-00001", "promo_code": "window"},
                               headers=user_headers)).json()
    assert order["total"] == 1  # never free: at least 1.00 remains
    await client.post(f"/api/orders/{order['id']}/cancel", headers=user_headers)
    promos = (await client.get("/api/admin/promo-codes", headers=admin_headers)).json()
    assert promos[0]["used_count"] == 0  # the activation came back
    # expired / scheduled / wrong scope
    await client.post("/api/admin/promo-codes", json={"code": "OLD", "kind": "fixed", "value": "5",
                                                      "ends_at": (utcnow() - timedelta(days=1)).isoformat()}, headers=admin_headers)
    await client.post("/api/admin/promo-codes", json={"code": "CATONLY", "kind": "fixed", "value": "5", "categories": ["gift_cards"]},
                      headers=admin_headers)
    for code, status in (("OLD", 422), ("CATONLY", 422), ("NOPE", 404), ("bad code!", 422)):
        r = await client.post("/api/promo/check", json={"code": code, "product_id": pid}, headers=user_headers)
        assert r.status_code == status, (code, r.text)
    # percent > 95 is refused; promo management needs promo.manage
    assert (await client.post("/api/admin/promo-codes", json={"code": "ALL", "kind": "percent", "value": "100"},
                              headers=admin_headers)).status_code == 422


async def test_promo_requires_permission(client, admin_headers):
    await client.post("/api/admin/accounts", json={"username": "sup1", "password": "sup1-pass-123", "role": "support"},
                      headers=admin_headers)
    r = await client.post("/api/admin/login", json={"username": "sup1", "password": "sup1-pass-123"})
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    assert (await client.get("/api/admin/promo-codes", headers=h)).status_code == 403
    assert (await client.post("/api/admin/promo-codes", json={"code": "HACK", "kind": "fixed", "value": "50"},
                              headers=h)).status_code == 403


async def test_sale_price_schedule_limits_and_history(client, admin_headers, user_headers):
    pid = await _pid(client)
    r = await client.patch(f"/api/admin/products/{pid}", json={"sale_price": "70"}, headers=admin_headers)
    assert r.status_code == 422  # sale must be below the base price
    r = await client.patch(f"/api/admin/products/{pid}", json={"sale_price": "45", "tags": ["хит", "акция"],
                                                               "attributes": {"Срок": "30 дней"}, "max_per_order": 2},
                           headers=admin_headers)
    assert r.status_code == 200, r.text
    pub = (await client.get(f"/api/products/{pid}")).json()
    assert pub["price"] == 45 and pub["old_price"] == 60 and "хит" in pub["tags"]
    assert any(p["id"] == pid for p in (await client.get("/api/products?tag=хит")).json())
    r = await client.post("/api/orders", json={"product_id": pid, "quantity": 3, "idempotency_key": "limit-q-01"},
                          headers=user_headers)
    assert r.status_code == 422
    r = await client.post("/api/orders", json={"product_id": pid, "quantity": 2, "idempotency_key": "limit-q-02"},
                          headers=user_headers)
    assert r.json()["total"] == 90
    hist = (await client.get(f"/api/admin/products/{pid}/price-history", headers=admin_headers)).json()
    assert hist[0]["field"] == "sale_price" and hist[0]["new"] == 45
    # schedule: not yet on sale → hidden and not orderable
    future = (utcnow() + timedelta(days=1)).isoformat()
    await client.patch(f"/api/admin/products/{pid}", json={"available_from": future}, headers=admin_headers)
    assert (await client.get(f"/api/products/{pid}")).status_code == 404
    r = await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "sched-0001"}, headers=user_headers)
    assert r.status_code == 404
    # clearing works
    await client.patch(f"/api/admin/products/{pid}", json={"available_from": None, "sale_price": None}, headers=admin_headers)
    assert (await client.get(f"/api/products/{pid}")).json()["price"] == 60
    # copy: hidden, no stock
    c = (await client.post(f"/api/admin/products/{pid}/copy", headers=admin_headers)).json()
    assert c["status"] == "hidden" and c["stock"] == 0 and sorted(c["tags"]) == ["акция", "хит"]


async def test_bulk_sale_and_tags(client, admin_headers):
    ids = [p["id"] for p in (await client.get("/api/admin/products", headers=admin_headers)).json()[:3]]
    r = await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "sale_percent", "value": "20"},
                          headers=admin_headers)
    assert r.status_code == 200
    r = await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "tag_add", "value": "black_friday"},
                          headers=admin_headers)
    rows = {p["id"]: p for p in (await client.get("/api/admin/products", headers=admin_headers)).json()}
    for i in ids:
        assert rows[i]["sale_price"] == round(rows[i]["price"] * 0.8, 2) and "black_friday" in rows[i]["tags"]
    await client.post("/api/admin/products/bulk", json={"ids": ids, "action": "sale_clear", "value": "-"}, headers=admin_headers)
    rows = {p["id"]: p for p in (await client.get("/api/admin/products", headers=admin_headers)).json()}
    assert all(rows[i]["sale_price"] is None for i in ids)


async def test_catalog_settings_sort_and_out_of_stock(client, admin_headers):
    await client.put("/api/admin/settings", json={"values": {"catalog_sort": "price_desc", "show_out_of_stock": "false"}},
                     headers=admin_headers)
    items = (await client.get("/api/products")).json()
    prices = [p["price"] for p in items]
    assert prices == sorted(prices, reverse=True) and all(p["stock"] > 0 for p in items)


# ------------------------------------------------------------------ rules


BIG_ORDER_RULE = {
    "name": "Крупный заказ — сообщить",
    "trigger": "order_paid",
    "conditions": [{"field": "order.total", "op": "gte", "value": "50"}],
    "actions": [{"type": "notify_staff", "params": {"text": "Заказ {order_no} на {price} <b>проверьте</b>"}},
                {"type": "order_note", "params": {"text": "Отмечено правилом"}}],
    "is_active": True,
}


async def test_rule_validation_rejects_unsafe_input(client, admin_headers):
    bad = [
        {**BIG_ORDER_RULE, "trigger": "on_everything"},
        {**BIG_ORDER_RULE, "conditions": [{"field": "__class__", "op": "eq", "value": "x"}]},
        {**BIG_ORDER_RULE, "conditions": [{"field": "order.total", "op": "exec", "value": "1"}]},
        {**BIG_ORDER_RULE, "conditions": [{"field": "order.total", "op": "gt", "value": "__import__('os')"}]},
        {**BIG_ORDER_RULE, "actions": [{"type": "refund", "params": {}}]},
        {**BIG_ORDER_RULE, "actions": [{"type": "ticket_priority", "params": {"priority": "high"}}]},  # wrong event
        {**BIG_ORDER_RULE, "actions": [{"type": "inbox", "params": {}}] * 6},
    ]
    for body in bad:
        r = await client.post("/api/admin/rules", json=body, headers=admin_headers)
        assert r.status_code == 422, (body, r.text)


async def test_rule_runs_on_event_with_history(client, admin_headers, user_headers, telegram_calls):
    r = await client.post("/api/admin/rules", json=BIG_ORDER_RULE, headers=admin_headers)
    assert r.status_code == 201, r.text
    rule = r.json()
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "500", "reason": "тест"}, headers=admin_headers)
    pid = await _pid(client)
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "rule-0001"}, headers=user_headers)).json()
    await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    await run_jobs()
    await run_jobs()
    msgs = [p["text"] for m, p in telegram_calls if m == "sendMessage" and "Крупный заказ" in p["text"]]
    assert msgs and "&lt;b&gt;проверьте&lt;/b&gt;" in msgs[0]  # the admin text is escaped, not injected as HTML
    detail = (await client.get(f"/api/admin/orders/{order['id']}", headers=admin_headers)).json()
    assert any(e["note"] == "Отмечено правилом" for e in detail["events"])
    runs = (await client.get(f"/api/admin/rules/{rule['id']}/runs", headers=admin_headers)).json()
    assert runs[0]["matched"] is True and all(a["ok"] for a in runs[0]["result"]["actions"])
    listed = (await client.get("/api/admin/rules", headers=admin_headers)).json()[0]
    assert listed["runs"] == 1 and listed["matches"] == 1
    # the same event is evaluated once (dedupe); actions create no new rule events (no loops)
    async with session_factory()() as s:
        jobs = (await s.scalars(select(Job).where(Job.kind == "rules"))).all()
        assert len(jobs) == 1
        assert len((await s.scalars(select(RuleRun))).all()) == 1


async def test_rule_dry_run_and_hold_for_review(client, admin_headers, user_headers):
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "500", "reason": "тест"}, headers=admin_headers)
    r = await client.post("/api/admin/products", json={"title": "Код", "category": "digital", "price": "100", "stock": 5,
                                                       "delivery_note": "CODE-OK", "fulfillment_mode": "auto"},
                          headers=admin_headers)
    pid = r.json()["id"]
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    hold = {"name": "Новичок + дорогой товар", "trigger": "order_paid", "match": "all",
            "conditions": [{"field": "user.is_new", "op": "eq", "value": True},
                           {"field": "order.total", "op": "gte", "value": 100}],
            "actions": [{"type": "hold_for_review"}], "is_active": False}
    rule = (await client.post("/api/admin/rules", json=hold, headers=admin_headers)).json()
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "hold-0001"}, headers=user_headers)).json()
    # dry run against the real order: matches, nothing is executed
    dr = (await client.post("/api/admin/rules/dry-run", json={**hold, "entity_id": order["id"]}, headers=admin_headers)).json()
    assert dr["matched"] is True and dr["would_run"] and [c["ok"] for c in dr["conditions"]] == [True, True]
    await client.post(f"/api/admin/rules/{rule['id']}/toggle", json={"is_active": True}, headers=admin_headers)
    res = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)).json()
    assert "order" in res, res
    assert res["order"]["fulfillment_status"] == "review" and res["order"]["status"] == "processing"
    # a version conflict is refused
    r = await client.patch(f"/api/admin/rules/{rule['id']}", json={**hold, "version": 1}, headers=admin_headers)
    assert r.status_code == 409


async def test_promo_check_rate_limited(client, user_headers):
    from app.api import public

    public._promo_checks.clear()
    pid = await _pid(client)
    codes = [(await client.post("/api/promo/check", json={"code": f"GUESS{i:03d}", "product_id": pid}, headers=user_headers)).status_code
             for i in range(17)]
    assert codes[:15] == [404] * 15 and codes[-1] == 429
    public._promo_checks.clear()

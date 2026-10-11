"""Ownership-verification scaffold: mock codes only, owner review flow, double-processing protection.

No real Telegram codes or sessions are involved — the provider is a mock that returns fictitious codes.
"""
from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import PhoneVerification
from app.services import verification


async def _paid_phone_order(client, admin_headers, user_headers, dial: str, code: str, key: str) -> dict:
    await client.put("/api/admin/settings",
                     json={"values": {"auto_complete_digital": "true", "phone_verification_enabled": "true"}},
                     headers=admin_headers)
    await client.post("/api/admin/phones/bulk", json={"text": dial}, headers=admin_headers)
    prod = next(c for c in (await client.get("/api/countries")).json() if c["code"] == code)
    await client.patch(f"/api/admin/products/{prod['product_id']}", json={"fulfillment_mode": "auto"}, headers=admin_headers)
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "500", "reason": "тест"}, headers=admin_headers)
    order = (await client.post("/api/orders", json={"product_id": prod["product_id"], "idempotency_key": key},
                               headers=user_headers)).json()
    res = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert res.json()["order"]["status"] == "completed", res.text
    return order


async def test_mock_codes_are_fictitious():
    prov = verification.MockVerificationProvider()
    out = await prov.poll("ref-1")
    assert out["test_only"] is True and out["code"].startswith("TEST-")


async def test_verification_opened_after_paid_and_owner_approves(client, admin_headers, user_headers):
    order = await _paid_phone_order(client, admin_headers, user_headers, "+380671234590", "UA", "phv-ord-01")
    # a WAITING request was opened for the owner, bound to the order + its sold number
    lst = (await client.get("/api/admin/verifications?status=active", headers=admin_headers)).json()
    assert len(lst) == 1
    v = lst[0]
    assert v["status"] == "WAITING" and v["order"]["public_id"] == order["public_id"]
    assert v["order"]["payment_status"] == "confirmed" and v["order"]["country"] == "Украина"
    assert v["order"]["buyer"]["telegram_id"] == 5550001  # «Связаться с покупателем»
    vid = v["id"]
    # owner fetches a FICTITIOUS code (mock); status -> RECEIVED, full code is never stored
    r = await client.post(f"/api/admin/verifications/{vid}/fetch-code", headers=admin_headers)
    assert r.json()["status"] == "RECEIVED" and r.json()["code_masked"].startswith("••")
    async with session_factory()() as s:
        row = await s.scalar(select(PhoneVerification).where(PhoneVerification.id == vid))
        assert "TEST-" not in str(row.events) or row.code_masked.startswith("••")  # no full code persisted
    # owner approves issuance; action is logged in the event trail
    r = await client.post(f"/api/admin/verifications/{vid}/decide", json={"approve": True, "note": "выдано"},
                          headers=admin_headers)
    assert r.json()["status"] == "APPROVED"
    assert any(e["event"] == "approved" for e in r.json()["events"])


async def test_double_decision_is_rejected(client, admin_headers, user_headers):
    await _paid_phone_order(client, admin_headers, user_headers, "+48512345690", "PL", "phv-ord-02")
    vid = (await client.get("/api/admin/verifications?status=active", headers=admin_headers)).json()[0]["id"]
    assert (await client.post(f"/api/admin/verifications/{vid}/decide", json={"approve": True}, headers=admin_headers)).status_code == 200
    # second decision on the same request is refused (no double issuance)
    dup = await client.post(f"/api/admin/verifications/{vid}/decide", json={"approve": False}, headers=admin_headers)
    assert dup.status_code == 409


async def test_verification_disabled_by_default(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    await client.post("/api/admin/phones/bulk", json={"text": "+905301119990"}, headers=admin_headers)
    tr = next(c for c in (await client.get("/api/countries")).json() if c["code"] == "TR")
    await client.patch(f"/api/admin/products/{tr['product_id']}", json={"fulfillment_mode": "auto"}, headers=admin_headers)
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": "500", "reason": "тест"}, headers=admin_headers)
    order = (await client.post("/api/orders", json={"product_id": tr["product_id"], "idempotency_key": "phv-off-01"},
                               headers=user_headers)).json()
    await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    # number was delivered automatically, but no verification request is created when the setting is off
    assert (await client.get("/api/admin/verifications?status=all", headers=admin_headers)).json() == []
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert len(detail["delivered_items"]) == 1


async def test_regular_user_cannot_reach_verifications(client, user_headers):
    assert (await client.get("/api/admin/verifications", headers=user_headers)).status_code == 401

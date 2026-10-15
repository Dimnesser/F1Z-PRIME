"""Manual .session uploads: accounts 2015–2019 (auto delivery) and premium numbers; never phone stock."""
from __future__ import annotations

from urllib.parse import quote

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import session_factory
from app.models import InventoryItem, Job, ManualSession, Order, PremiumNumber, Product
from app.services import session_registry, telegram
from tests.test_admin_panel import _paid_order

PHONES: dict[str, str] = {}


@pytest.fixture
def sessions(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "sessions_dir", str(tmp_path))
    monkeypatch.setattr(session_registry, "normalize_session", lambda *a, **k: None)

    async def verify_identity(filename):
        return {"phone_e164": PHONES[filename], "country_name": "Украина"}, "key"

    monkeypatch.setattr(session_registry, "verify_identity", verify_identity)
    sent: list[tuple] = []

    async def send_document(*a, **k):
        sent.append(("document", a, k))

    async def call(method, payload, **k):
        sent.append((method, payload))
        return {}

    monkeypatch.setattr(telegram, "send_document", send_document)
    monkeypatch.setattr(telegram, "call", call)
    return tmp_path, sent


async def _upload(client, headers, path, name, phone, two_fa=""):
    PHONES[name] = phone
    extra = {"Content-Type": "application/octet-stream"}
    if two_fa:
        extra["X-Account-2FA"] = quote(two_fa)
    return await client.post(f"/api/admin{path}?format=telethon&filename={name}", content=b"SQLite format 3\x00demo",
                             headers={**headers, **extra})


async def test_account_upload_goes_to_accounts_product_not_phone_stock(client, admin_headers, sessions):
    directory, _ = sessions
    r = await _upload(client, admin_headers, "/manual-sessions/accounts", "acc1.session", "+380501112233", "pa ss")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["two_fa"] is True and body["stock"] == 1 and "2233" not in body["phone"]
    async with session_factory()() as db:
        product = await db.get(Product, body["product_id"])
        assert product.category == "accounts" and product.uses_inventory and product.fulfillment_mode == "auto"
        assert product.attributes["delivery_kind"] == "telegram_account"
        units = (await db.scalars(select(InventoryItem).where(InventoryItem.product_id == product.id))).all()
        assert len(units) == 1
        row = await db.scalar(select(ManualSession).where(ManualSession.filename == "acc1.session"))
        assert row.purpose == "account"
    assert (directory / "acc1.session").exists()
    await session_registry.sync_stock()
    async with session_factory()() as db:
        jobs = (await db.scalars(select(Job).where(Job.kind == "session_verify_stock"))).all()
    assert not [j for j in jobs if j.payload.get("filename") == "acc1.session"]
    # the same account again is refused and its new file removed
    r = await _upload(client, admin_headers, "/manual-sessions/accounts", "acc2.session", "+380501112233")
    assert r.status_code == 409
    assert not (directory / "acc2.session").exists()


async def test_premium_session_bound_to_number_and_delivered(client, user_headers, admin_headers, sessions):
    directory, sent = sessions
    r = await client.post("/api/admin/premium-numbers", json={
        "country_id": None, "number": "+380677777777", "display_mask": None, "tier": "premium",
        "title": "PREMIUM NUMBER", "description": "", "price": "100", "status": "available"}, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    number_id = r.json()["id"]
    async with session_factory()() as db:
        number = (await db.get(PremiumNumber, number_id)).number
    bad = await _upload(client, admin_headers, f"/premium-numbers/{number_id}/session", "p0.session", "+380671111111")
    assert bad.status_code == 422
    assert not (directory / "p0.session").exists()
    ok = await _upload(client, admin_headers, f"/premium-numbers/{number_id}/session", "p1.session", number, "s3cret")
    assert ok.status_code == 201, ok.text
    listed = (await client.get("/api/admin/premium-sessions", headers=admin_headers)).json()
    assert [s["filename"] for s in listed if s["premium_number_id"] == number_id] == ["p1.session"]

    order = await _paid_order(client, user_headers, admin_headers, key="manual-premium-1")
    async with session_factory()() as db:
        row = await db.get(Order, order["id"])
        row.premium_number_id = number_id
        await db.commit()
    state = (await client.get(f"/api/admin/orders/{order['id']}/premium-account", headers=admin_headers)).json()
    assert state["available"] and state["can_send"] and state["two_fa"]
    sent.clear()  # drop order notifications; keep only the delivery calls
    r = await client.post(f"/api/admin/orders/{order['id']}/premium-account", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert sent[0][0] == "document"
    message = next(p for m, *rest in sent if m == "sendMessage" for p in rest)
    assert "s3cret" in message["text"] and message["protect_content"] is True
    async with session_factory()() as db:
        assert (await db.get(Order, order["id"])).status.value == "completed"
    r = await client.delete(f"/api/admin/premium-numbers/{number_id}/session", headers=admin_headers)
    assert r.status_code == 409


async def test_two_fa_rejects_control_characters(client, admin_headers, sessions):
    r = await _upload(client, admin_headers, "/manual-sessions/accounts", "acc3.session", "+380502223344", "a\nb")
    assert r.status_code == 422

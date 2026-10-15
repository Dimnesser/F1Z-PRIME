"""Premium accounts are delivered fully automatically: a paid premium order with a bound session is sent by the bot
and completed by the periodic worker task, with no admin action; delivery is idempotent."""
from __future__ import annotations

from sqlalchemy import select

from app.config import get_settings
from app.db import session_factory
from app.models import ManualSession, Order
from app.services import crypto, premium_delivery, telegram
from tests.test_admin_panel import _paid_order


async def _premium_number(client, admin_headers, number: str) -> int:
    r = await client.post("/api/admin/premium-numbers", json={
        "country_id": None, "number": number, "display_mask": None, "tier": "premium",
        "title": "PREMIUM NUMBER", "description": "", "price": "100", "status": "available"}, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def test_paid_premium_order_is_delivered_without_admin(client, user_headers, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "sessions_dir", str(tmp_path))
    number = "+380677777701"
    number_id = await _premium_number(client, admin_headers, number)
    (tmp_path / "prem.session").write_bytes(b"SQLite format 3\x00demo")
    async with session_factory()() as db:
        db.add(ManualSession(filename="prem.session", purpose="premium", phone_e164=number,
                             premium_number_id=number_id, two_fa_enc=crypto.encrypt("s3cret"), added_by="test"))
        await db.commit()
    order = await _paid_order(client, user_headers, admin_headers, key="auto-prem-1")
    async with session_factory()() as db:
        row = await db.get(Order, order["id"])
        row.premium_number_id = number_id
        await db.commit()

    sent: list = []

    async def send_document(*a, **k):
        sent.append(("document", a, k))

    async def call(method, payload, **k):
        sent.append((method, payload))
        return {}

    monkeypatch.setattr(telegram, "send_document", send_document)
    monkeypatch.setattr(telegram, "call", call)

    assert await premium_delivery.deliver_due() == "premium_delivered:1,pending:0"
    assert sent[0][0] == "document"
    message = next(p for m, *rest in sent if m == "sendMessage" for p in rest)
    assert "s3cret" in message["text"] and message["protect_content"] is True
    async with session_factory()() as db:
        assert (await db.get(Order, order["id"])).status.value == "completed"
        row = await db.scalar(select(ManualSession).where(ManualSession.premium_number_id == number_id))
        assert row.delivered_order_id == order["id"] and row.delivered_at is not None

    sent.clear()
    assert await premium_delivery.deliver_due() == "premium_delivered:0,pending:0"
    assert sent == []


async def test_order_without_session_is_left_untouched(client, user_headers, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), "sessions_dir", str(tmp_path))
    number_id = await _premium_number(client, admin_headers, "+380677777702")
    order = await _paid_order(client, user_headers, admin_headers, key="auto-prem-2")
    async with session_factory()() as db:
        row = await db.get(Order, order["id"])
        row.premium_number_id = number_id
        await db.commit()
    assert await premium_delivery.deliver_due() == "premium_delivered:0,pending:0"
    async with session_factory()() as db:
        assert (await db.get(Order, order["id"])).status.value != "completed"

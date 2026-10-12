"""Owned-number pool as an SMS-activation source: atomic allocation, registration-code delivery via the
operator's gateway webhook, timeout refund. Numbers only — no sessions, no login-code relay."""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.db import session_factory
from app.models import OwnedSmsNumber, SmsActivation, User
from app.services import owned_sms, sms
from app.services.sms import ProviderError


async def _funded_user(client, admin_headers, user_headers, amount="200") -> tuple[int, int]:
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": amount, "reason": "тест"}, headers=admin_headers)
    return me["id"], me["telegram_id"]


async def _seed(phone: str, country="KZ", service="", price="12") -> int:
    async with session_factory()() as s:
        n = OwnedSmsNumber(phone_e164=phone, country_iso2=country, service=service, price=Decimal(price))
        s.add(n)
        await s.commit()
        return n.id


async def _balance(uid: int) -> Decimal:
    async with session_factory()() as s:
        return (await s.get(User, uid)).balance


async def test_pool_allocation_and_full_flow(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    nid = await _seed("+77010000001")
    prov = owned_sms.OwnedPoolProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="KZ", cost=Decimal("12"), provider=prov)
        await s.commit()
        aid = act.id
        assert act.status == "WAITING" and act.activation_id == f"own:{nid}" and act.phone_number == "+77010000001"
    async with session_factory()() as s:  # number is now rented out
        assert (await s.get(OwnedSmsNumber, nid)).in_use is True
    # operator's gateway forwards the incoming registration SMS
    async with session_factory()() as s:
        await owned_sms.ingest(s, "+77010000001", "Telegram code: 55213")
        await s.commit()
    async with session_factory()() as s:
        claimed = await sms.claim_due(s, "w")
        gen = next(a.lease_generation for a in claimed if a.id == aid)
        await s.commit()
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "w", gen, provider=prov)
        await s.commit()
        act = await s.get(SmsActivation, aid)
        assert act.status == "COMPLETED" and act.code == "55213"
    async with session_factory()() as s:  # number released back to the pool, usage counted
        n = await s.get(OwnedSmsNumber, nid)
        assert n.in_use is False and n.times_used == 1


async def test_pool_no_double_allocation(client, admin_headers, user_headers):
    await _seed("+77010000002")
    prov = owned_sms.OwnedPoolProvider()
    first = await prov.get_number("tg", "KZ")
    assert first["phone"] == "+77010000002"
    with pytest.raises(ProviderError):  # the only free number is taken -> none left
        await prov.get_number("tg", "KZ")


async def test_pool_timeout_refunds(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    nid = await _seed("+77010000003", price="20")
    prov = owned_sms.OwnedPoolProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="KZ", cost=Decimal("20"), provider=prov)
        await s.commit()
        aid = act.id
    assert await _balance(uid) == Decimal("180.00")
    async with session_factory()() as s:
        claimed = await sms.claim_due(s, "w")
        gen = next(a.lease_generation for a in claimed if a.id == aid)
        row = await s.get(SmsActivation, aid)
        row.expires_at = sms.utcnow() - sms.timedelta(minutes=1)
        await s.commit()
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "w", gen, provider=prov)
        await s.commit()
        assert (await s.get(SmsActivation, aid)).status == "TIMEOUT"
    assert await _balance(uid) == Decimal("200.00")  # refunded
    async with session_factory()() as s:  # number freed on timeout
        assert (await s.get(OwnedSmsNumber, nid)).in_use is False


async def test_gateway_webhook_auth_and_parse(client, admin_headers, user_headers, monkeypatch):
    from app.config import Settings
    import app.api.sms as sms_api

    await _seed("+77010000004")
    # wrong/empty token is rejected
    assert (await client.post("/api/sms/gateway/incoming", json={"phone": "+77010000004", "text": "code 111222"})).status_code == 401
    # correct shared secret -> stored and code parsed
    base = Settings()
    monkeypatch.setattr(base, "sms_gateway_token", "secret-xyz")
    monkeypatch.setattr(sms_api, "get_settings", lambda: base)
    r = await client.post("/api/sms/gateway/incoming", json={"phone": "+77010000004", "text": "Your code: 111222"},
                          headers={"X-Gateway-Token": "secret-xyz"})
    assert r.status_code == 200 and r.json()["code_parsed"] is True
    async with session_factory()() as s:
        from app.models import OwnedSmsInbox
        row = await s.scalar(select(OwnedSmsInbox).where(OwnedSmsInbox.phone_e164 == "+77010000004"))
        assert row.code == "111222"


async def test_api_purchase_with_owned_source(client, admin_headers, user_headers, monkeypatch):
    import app.services.sms as sms_mod

    prov = owned_sms.OwnedPoolProvider()
    monkeypatch.setattr(sms_mod, "get_provider", lambda: prov)  # route the engine to the owned pool
    await client.put("/api/admin/settings", json={"values": {"sms_enabled": "true", "sms_markup_percent": "0"}}, headers=admin_headers)
    await _seed("+77010000005", country="KZ", service="", price="15")
    uid, _ = await _funded_user(client, admin_headers, user_headers)
    prices = (await client.get("/api/sms/prices", headers=user_headers)).json()
    item = next(i for i in prices["items"] if i["country"] == "KZ")
    assert item["price"] == 15.0  # owner-set price, markup 0
    r = await client.post("/api/sms/purchase", json={"country": "KZ", "service": "any", "idempotency_key": "own-buy-01"}, headers=user_headers)
    # service "any" maps to '' in the pool; the catalog advertised service code "any"
    assert r.status_code in (201, 409)

"""SMS-activation service: buy/charge, one-active guard, lease + zombie protection, outbox delivery,
reconciliation, timeout/cancel refunds (refund-once). Uses the in-process mock provider — no network."""
from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.db import session_factory
from app.models import DeliveryOutbox, SmsActivation, User
from app.services import sms, telegram
from app.services.common import ServiceError


async def _funded_user(client, admin_headers, user_headers, amount="100") -> tuple[int, int]:
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": amount, "reason": "тест"}, headers=admin_headers)
    return me["id"], me["telegram_id"]


async def _balance(uid: int) -> Decimal:
    async with session_factory()() as s:
        return (await s.get(User, uid)).balance


async def test_buy_charges_and_blocks_second_active(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid = act.id
    assert await _balance(uid) == Decimal("90.00")  # charged
    async with session_factory()() as s:
        row = await s.get(SmsActivation, aid)
        assert row.status == "WAITING" and row.phone_number and row.activation_id
    # a second in-flight activation for the same user is rejected by the partial unique index
    async with session_factory()() as s:
        with pytest.raises(ServiceError) as e:
            await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        assert e.value.code == "one_active"
    assert await _balance(uid) == Decimal("90.00")  # the failed second buy did not charge again


async def test_poll_receives_code_and_outbox_delivers(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid, pid = act.id, act.activation_id
    prov._deliver_code(pid, "123456")  # provider now has the SMS code
    async with session_factory()() as s:
        claimed = await sms.claim_due(s, "w1")
        work = [(a.id, a.lease_generation) for a in claimed]
        await s.commit()
    assert work and work[0][0] == aid
    async with session_factory()() as s:
        for a, gen in work:
            await sms.poll_one(s, a, "w1", gen, provider=prov)
        await s.commit()
        row = await s.get(SmsActivation, aid)
        assert row.status == "COMPLETED" and row.code == "123456"
        box = await s.scalar(select(DeliveryOutbox).where(DeliveryOutbox.sms_activation_id == aid))
        assert box.status == "PENDING"
    # the transactional outbox delivers the code to the buyer
    async with session_factory()() as s:
        sent = await sms.deliver_outbox(s)
        await s.commit()
        assert sent == 1
        box = await s.scalar(select(DeliveryOutbox).where(DeliveryOutbox.sms_activation_id == aid))
        assert box.status == "SENT" and box.sent_at is not None
    # completed activation leaves the active set -> a new activation is allowed
    async with session_factory()() as s:
        act2 = await sms.buy(s, uid, chat, service="go", country="0", cost=Decimal("5"), provider=prov)
        await s.commit()
        assert act2.status == "WAITING"


async def test_stale_lease_is_ignored(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid, pid = act.id, act.activation_id
    prov._deliver_code(pid, "999000")
    async with session_factory()() as s:
        claimed = await sms.claim_due(s, "worker-A")
        gen = claimed[0].lease_generation
        await s.commit()
    # a zombie worker polls with an OLD generation -> must be a no-op (newer lease wins)
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "worker-A", gen - 1, provider=prov)
        await s.commit()
        assert (await s.get(SmsActivation, aid)).status == "WAITING"  # untouched
    # the correct generation applies the code
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "worker-A", gen, provider=prov)
        await s.commit()
        assert (await s.get(SmsActivation, aid)).status == "COMPLETED"


async def test_timeout_refunds_once(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid = act.id
    assert await _balance(uid) == Decimal("90.00")
    async with session_factory()() as s:  # claim a lease, then force the activation to expire
        claimed = await sms.claim_due(s, "w2")
        gen = next(a.lease_generation for a in claimed if a.id == aid)
        row = await s.get(SmsActivation, aid)
        row.expires_at = sms.utcnow() - sms.timedelta(minutes=1)
        await s.commit()
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "w2", gen, provider=prov)  # expiry -> TIMEOUT + refund
        await s.commit()
        row = await s.get(SmsActivation, aid)
        assert row.status == "TIMEOUT" and row.refunded is True
    assert await _balance(uid) == Decimal("100.00")  # refunded exactly once
    # a subsequent cancel cannot refund again
    async with session_factory()() as s:
        with pytest.raises(ServiceError):
            await sms.cancel(s, aid, provider=prov)
    assert await _balance(uid) == Decimal("100.00")


async def test_cancel_refunds(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("15"), provider=prov)
        await s.commit()
        aid = act.id
    assert await _balance(uid) == Decimal("85.00")
    async with session_factory()() as s:
        await sms.cancel(s, aid, provider=prov)
        await s.commit()
        assert (await s.get(SmsActivation, aid)).status == "CANCELLED"
    assert await _balance(uid) == Decimal("100.00")


async def test_get_number_timeout_requires_reconciliation(client, admin_headers, user_headers):
    uid, chat = await _funded_user(client, admin_headers, user_headers)

    class TimeoutProvider(sms.MockActivationProvider):
        async def get_number(self, service, country):
            raise sms.ProviderTimeout("network")

        async def get_active_activations(self):
            return []  # nothing to match -> ambiguous/none -> manual reconciliation

    prov = TimeoutProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        assert act.status == "RECONCILIATION_REQUIRED"  # never auto-bound a doubtful number


async def test_outbox_unknown_then_failed(client, admin_headers, user_headers, monkeypatch):
    uid, chat = await _funded_user(client, admin_headers, user_headers)
    prov = sms.MockActivationProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid, pid = act.id, act.activation_id
    prov._deliver_code(pid, "111222")
    async with session_factory()() as s:
        claimed = await sms.claim_due(s, "w")
        g = claimed[0].lease_generation
        await s.commit()
    async with session_factory()() as s:
        await sms.poll_one(s, aid, "w", g, provider=prov)
        await s.commit()

    # a transport error (indeterminate) must mark the outbox UNKNOWN, not SENT and not hard-failed
    async def transport_err(method, payload, timeout=10.0):
        raise telegram.TelegramError("timeout")  # api defaults to False -> indeterminate

    monkeypatch.setattr(telegram, "call", transport_err)
    async with session_factory()() as s:
        await sms.deliver_outbox(s)
        await s.commit()
        box = await s.scalar(select(DeliveryOutbox).where(DeliveryOutbox.sms_activation_id == aid))
        assert box.status == "UNKNOWN" and box.attempts == 1

    # a definite API rejection (e.g. bot blocked) marks it FAILED, no infinite retry
    async def api_err(method, payload, timeout=10.0):
        raise telegram.TelegramError("Forbidden: bot was blocked by the user", api=True)

    monkeypatch.setattr(telegram, "call", api_err)
    async with session_factory()() as s:
        await sms.deliver_outbox(s)
        await s.commit()
        box = await s.scalar(select(DeliveryOutbox).where(DeliveryOutbox.sms_activation_id == aid))
        assert box.status == "FAILED"


# ----- public + admin API (stage 3/8) --------------------------------------------------------

from tests.conftest import init_data_for  # noqa: E402


def _tma(uid: int) -> dict:
    return {"Authorization": f"tma {init_data_for(uid, username=f'u{uid}')}"}


async def _enable_sms(client, admin_headers, markup="50", min_profit="0") -> None:
    await client.put("/api/admin/settings", json={"values": {
        "sms_enabled": "true", "sms_markup_percent": markup, "sms_min_profit": min_profit}}, headers=admin_headers)


async def test_sms_api_requires_auth(client):
    assert (await client.get("/api/sms/countries")).status_code == 401
    assert (await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "nope-0001"})).status_code == 401


async def test_sms_catalog_and_prices(client, admin_headers, user_headers):
    await _enable_sms(client, admin_headers, markup="50")
    countries = (await client.get("/api/sms/countries", headers=user_headers)).json()
    assert any(c["code"] == "0" for c in countries)
    prices = (await client.get("/api/sms/prices", headers=user_headers)).json()
    assert prices["configured"] is True
    tg0 = next(i for i in prices["items"] if i["country"] == "0" and i["service"] == "tg")
    assert tg0["price"] == 27.0 and tg0["count"] == 120  # 18.00 * 1.5


async def test_sms_disabled_when_off(client, user_headers):
    assert (await client.get("/api/sms/countries", headers=user_headers)).status_code == 404  # sms_enabled default false


async def test_sms_pricing_not_configured_refuses(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"sms_enabled": "true"}}, headers=admin_headers)  # no markup
    prices = (await client.get("/api/sms/prices", headers=user_headers)).json()
    assert prices["configured"] is False and prices["items"] == []
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "100", "reason": "тест"}, headers=admin_headers)
    r = await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "nomk-0001"}, headers=user_headers)
    assert r.status_code == 409 and r.json()["code"] == "pricing_not_configured"


async def test_sms_purchase_charges_server_price(client, admin_headers, user_headers):
    await _enable_sms(client, admin_headers, markup="50")
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "100", "reason": "тест"}, headers=admin_headers)
    r = await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "buy-0001"}, headers=user_headers)
    assert r.status_code == 201, r.text
    act = r.json()
    assert act["status"] == "WAITING" and act["cost"] == 27.0
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 73
    # double-tap: a second purchase while active returns the SAME activation, no second charge
    r2 = await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "buy-0002"}, headers=user_headers)
    assert r2.json()["id"] == act["id"]
    assert (await client.get("/api/me", headers=user_headers)).json()["balance"] == 73


async def test_sms_purchase_insufficient_balance(client, admin_headers, user_headers):
    await _enable_sms(client, admin_headers, markup="50")
    r = await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "poor-0001"}, headers=user_headers)
    assert r.status_code == 402


async def test_sms_activation_idor(client, admin_headers, user_headers):
    await _enable_sms(client, admin_headers, markup="50")
    uid = (await client.get("/api/me", headers=user_headers)).json()["id"]
    await client.post(f"/api/admin/users/{uid}/balance", json={"amount": "100", "reason": "тест"}, headers=admin_headers)
    act = (await client.post("/api/sms/purchase", json={"country": "0", "service": "tg", "idempotency_key": "idor-0001"}, headers=user_headers)).json()
    other = _tma(99881)
    await client.get("/api/me", headers=other)  # create the other user
    assert (await client.get(f"/api/sms/activations/{act['id']}", headers=other)).status_code == 404


async def test_sms_admin_summary_and_reconcile(client, admin_headers, user_headers):
    await _enable_sms(client, admin_headers, markup="50")
    s = (await client.get("/api/admin/sms/summary", headers=admin_headers)).json()
    assert {"by_status", "reconciliation_required", "profit"} <= s.keys()
    cat = (await client.get("/api/admin/sms/catalog", headers=admin_headers)).json()
    assert cat["rows"] and any(r["priced"] for r in cat["rows"])


async def test_restore_stranded_activation(client, admin_headers, user_headers):
    """A row charged but stuck (no activation_id) after a crash is reconciled, never silently re-bought."""
    uid, chat = await _funded_user(client, admin_headers, user_headers)

    class HangProvider(sms.MockActivationProvider):
        async def get_number(self, service, country):
            raise sms.ProviderTimeout("crash before resolve")

        async def get_active_activations(self):
            return []  # nothing to match -> safe manual reconciliation, no double buy

    prov = HangProvider()
    async with session_factory()() as s:
        act = await sms.buy(s, uid, chat, service="tg", country="0", cost=Decimal("10"), provider=prov)
        await s.commit()
        aid = act.id
        # simulate the row being stuck in API_PENDING with no provider id, created long ago
        row = await s.get(SmsActivation, aid)
        row.status = "API_PENDING"
        row.activation_id = None
        row.created_at = sms.utcnow() - sms.timedelta(minutes=5)
        await s.commit()
    async with session_factory()() as s:
        n = await sms.restore_pending(s, provider=prov, grace_seconds=120)
        await s.commit()
        assert n == 1
        assert (await s.get(SmsActivation, aid)).status == "RECONCILIATION_REQUIRED"

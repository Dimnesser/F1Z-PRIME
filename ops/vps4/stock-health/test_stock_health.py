"""Phone-code stock health: unsellable accounts are held and come back automatically when clean."""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.db import session_factory
from app.models import PhoneInventory, Product, SessionAccount
from app.services import handoff_telegram, phones, stock_health
from app.services.common import ServiceError

PHONE = "+380501112233"


def snapshot(*current: bool):
    return SimpleNamespace(authorizations=[SimpleNamespace(current=c) for c in current])


@pytest.fixture
async def stock(monkeypatch):
    stock_health._checked.clear()
    state = {"result": snapshot(True)}

    async def inspect(filename, phone):
        assert filename == PHONE[1:] + ".session" and phone == PHONE
        if isinstance(state["result"], Exception):
            raise state["result"]
        return state["result"]

    monkeypatch.setattr(handoff_telegram, "inspect", inspect)
    async with session_factory()() as db:
        product = await phones._product_for_country(db, "UA")
        product.attributes = {"delivery_kind": "phone_code"}
        product.uses_phone_inventory, product.fulfillment_mode = True, "auto"
        row = PhoneInventory(phone_e164=PHONE, country_iso2="UA", country_name="Украина", product_id=product.id,
                             status="AVAILABLE", note="Проверенная сессия Telegram")
        db.add(row)
        db.add(SessionAccount(filename=PHONE[1:] + ".session", phone_e164=PHONE, country_iso2="UA",
                              country_name="Украина", telegram_user_id=1, added_by="test"))
        await db.flush()
        await phones.sync_product_stock(db, product)
        await db.commit()
        ids = row.id, product.id
    yield state, ids
    stock_health._checked.clear()


async def _state(ids):
    async with session_factory()() as db:
        row = await db.get(PhoneInventory, ids[0])
        product = await db.get(Product, ids[1])
        return row.status, row.note, product.stock


async def test_clean_number_stays_on_sale(stock):
    state, ids = stock
    assert await stock_health.check_one(ids[0]) == "ok"
    assert await _state(ids) == ("AVAILABLE", "Проверенная сессия Telegram", 1)


async def test_other_devices_hold_then_auto_return(stock):
    state, ids = stock
    state["result"] = snapshot(True, False)
    assert await stock_health.check_one(ids[0]) == "held:other_devices"
    assert await _state(ids) == ("DISABLED", "hold:other_devices|Проверенная сессия Telegram", 0)
    state["result"] = snapshot(True)
    assert await stock_health.check_one(ids[0]) == "released"
    assert await _state(ids) == ("AVAILABLE", "Проверенная сессия Telegram", 1)


async def test_revoked_session_is_held_and_transient_errors_change_nothing(stock):
    state, ids = stock
    state["result"] = ServiceError("x", 502, "handoff_telegram_unavailable")
    assert await stock_health.check_one(ids[0]) == "unknown"
    assert (await _state(ids))[0] == "AVAILABLE"
    state["result"] = ServiceError("x", 409, "handoff_session_revoked")
    assert await stock_health.check_one(ids[0]) == "held:handoff_session_revoked"
    assert (await _state(ids))[0] == "DISABLED"
    state["result"] = ServiceError("x", 502, "handoff_telegram_unavailable")
    assert await stock_health.check_one(ids[0]) == "unknown"
    assert (await _state(ids))[0] == "DISABLED"


async def test_manually_disabled_number_is_never_touched(stock):
    state, ids = stock
    async with session_factory()() as db:
        row = await db.get(PhoneInventory, ids[0])
        row.status = "DISABLED"
        await db.commit()
    assert await stock_health.check_one(ids[0]) == "skip"
    assert (await _state(ids))[0] == "DISABLED"


async def test_periodic_check_picks_new_and_held_stock(stock):
    state, ids = stock
    state["result"] = snapshot(True, False)
    assert await stock_health.check() == "held:1"
    assert await stock_health.check() == "idle"  # held: rechecked after HELD_EVERY, not on every run
    stock_health._checked.clear()
    state["result"] = snapshot(True)
    assert await stock_health.check() == "released:1"


async def test_fail_sale_ignores_transient_errors():
    order = SimpleNamespace(status=None, phone_sent_at=None)
    exc = ServiceError("x", 502, "handoff_telegram_unavailable")
    assert await stock_health.fail_sale(None, order, [], None, exc) is False

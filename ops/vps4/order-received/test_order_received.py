"""Buyer confirms receipt («Получил номер — завершить заказ»): only after delivery, idempotent, unlocks the review form."""
from __future__ import annotations

from sqlalchemy import func, select

from app.db import session_factory
from app.models import OrderEvent
from tests.conftest import init_data_for
from tests.test_admin_panel import _paid_order
from tests.test_order_reviews import _completed


async def test_buyer_confirms_received_once(client, user_headers, admin_headers):
    oid = await _completed(client, user_headers, admin_headers, key="received-0001")
    detail = (await client.get(f"/api/orders/{oid}", headers=user_headers)).json()
    assert detail["review_allowed"] is True and detail["received"] is False
    for _ in range(2):
        r = await client.post(f"/api/orders/{oid}/received", headers=user_headers)
        assert r.status_code == 200, r.text
        assert r.json()["received"] is True
    assert (await client.get(f"/api/orders/{oid}", headers=user_headers)).json()["received"] is True
    async with session_factory()() as db:
        count = await db.scalar(select(func.count()).select_from(OrderEvent)
                                .where(OrderEvent.order_id == oid, OrderEvent.actor == "buyer:received"))
    assert count == 1


async def test_received_rules(client, user_headers, admin_headers):
    order = await _paid_order(client, user_headers, admin_headers, key="received-paid-1")
    r = await client.post(f"/api/orders/{order['id']}/received", headers=user_headers)
    assert r.status_code == 409  # not delivered yet
    oid = await _completed(client, user_headers, admin_headers, key="received-done-2")
    stranger = {"Authorization": f"tma {init_data_for(5550998, username='stranger2')}"}
    assert (await client.post(f"/api/orders/{oid}/received", headers=stranger)).status_code == 404

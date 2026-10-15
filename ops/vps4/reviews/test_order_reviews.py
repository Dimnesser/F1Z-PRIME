"""Buyer reviews: only for a received order, one per order (editable), visible to the buyer and staff."""
from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import Job, OrderReview
from tests.conftest import init_data_for
from tests.test_admin_panel import _paid_order


async def _completed(client, user_headers, admin_headers, key: str = "review-0001") -> int:
    order = await _paid_order(client, user_headers, admin_headers, key=key)
    r = await client.post(f"/api/admin/orders/{order['id']}/status", json={"status": "completed", "delivery_data": "OK"},
                          headers=admin_headers)
    assert r.status_code == 200, r.text
    return order["id"]


async def test_review_after_received_order(client, user_headers, admin_headers):
    oid = await _completed(client, user_headers, admin_headers)
    detail = (await client.get(f"/api/orders/{oid}", headers=user_headers)).json()
    assert detail["review_allowed"] is True and detail["review"] is None
    r = await client.post(f"/api/orders/{oid}/review", json={"rating": 5, "text": "  Всё пришло <b>быстро</b>  "},
                          headers=user_headers)
    assert r.status_code == 200, r.text
    assert r.json()["rating"] == 5 and r.json()["text"] == "Всё пришло <b>быстро</b>"
    detail = (await client.get(f"/api/orders/{oid}", headers=user_headers)).json()
    assert detail["review"]["rating"] == 5
    admin = (await client.get(f"/api/admin/orders/{oid}", headers=admin_headers)).json()
    assert admin["review"]["text"] == "Всё пришло <b>быстро</b>"
    async with session_factory()() as db:
        texts = [j.payload["text"] for j in (await db.scalars(select(Job).where(Job.kind == "tg_message"))).all()
                 if "отзыв" in j.payload.get("text", "")]
    assert all("&lt;b&gt;быстро&lt;/b&gt;" in t and "★★★★★" in t for t in texts)


async def test_review_is_editable_and_unique(client, user_headers, admin_headers):
    oid = await _completed(client, user_headers, admin_headers)
    await client.post(f"/api/orders/{oid}/review", json={"rating": 2}, headers=user_headers)
    r = await client.post(f"/api/orders/{oid}/review", json={"rating": 4, "text": "Разобрались"}, headers=user_headers)
    assert r.status_code == 200 and r.json()["rating"] == 4
    async with session_factory()() as db:
        rows = (await db.scalars(select(OrderReview).where(OrderReview.order_id == oid))).all()
    assert len(rows) == 1 and rows[0].text == "Разобрались"


async def test_review_rules(client, user_headers, admin_headers):
    order = await _paid_order(client, user_headers, admin_headers, key="review-paid-1")
    r = await client.post(f"/api/orders/{order['id']}/review", json={"rating": 5}, headers=user_headers)
    assert r.status_code == 409  # not received yet
    assert (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()["review_allowed"] is False
    oid = await _completed(client, user_headers, admin_headers, key="review-done-2")
    for bad in ({"rating": 0}, {"rating": 6}, {"rating": 5, "text": "x" * 1001}):
        assert (await client.post(f"/api/orders/{oid}/review", json=bad, headers=user_headers)).status_code == 422
    stranger = {"Authorization": f"tma {init_data_for(5550999, username='stranger')}"}
    assert (await client.post(f"/api/orders/{oid}/review", json={"rating": 5}, headers=stranger)).status_code == 404

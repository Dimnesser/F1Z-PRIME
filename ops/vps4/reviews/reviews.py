"""Buyer reviews of received orders: a 1-5 rating and an optional comment, one per order (editable).

Only the buyer of a completed order can leave a review. Staff who see sales get a Telegram message with it.
"""
from __future__ import annotations

import html

from sqlalchemy import select

from app.models import Order, OrderReview, OrderStatus
from app.services import jobs, notifications
from app.services.common import ServiceError, utcnow

MAX_TEXT = 1000


def eligible(order: Order) -> bool:
    return order.status == OrderStatus.completed


def as_dict(review: OrderReview | None) -> dict | None:
    if review is None:
        return None
    return {"rating": review.rating, "text": review.text,
            "created_at": review.created_at.isoformat(), "updated_at": review.updated_at.isoformat()}


async def for_order(session, order_id: int) -> dict | None:  # noqa: ANN001
    return as_dict(await session.scalar(select(OrderReview).where(OrderReview.order_id == order_id)))


async def submit(session, order: Order, rating: int, text: str) -> dict:  # noqa: ANN001
    """Create or update the review of a locked, completed order. Commit is the caller's job."""
    if not eligible(order):
        raise ServiceError("Отзыв можно оставить после получения заказа.", 409, "review_not_allowed")
    if not 1 <= rating <= 5:
        raise ServiceError("Оценка должна быть от 1 до 5.", 422, "review_rating")
    text = (text or "").strip()[:MAX_TEXT]
    now = utcnow()
    review = await session.scalar(select(OrderReview).where(OrderReview.order_id == order.id).with_for_update())
    edited = review is not None
    if review is None:
        review = OrderReview(order_id=order.id, user_id=order.user_id, product_id=order.product_id,
                             rating=rating, text=text, created_at=now, updated_at=now)
        session.add(review)
    else:
        review.rating, review.text, review.updated_at = rating, text, now
    await session.flush()
    product = html.escape(order.product.title) if order.product else "—"
    body = (f"{'✏️' if edited else '⭐'} <b>{'Отзыв изменён' if edited else 'Новый отзыв'} · "
            f"{html.escape(order.public_id or str(order.id))}</b>\n{product}\n"
            f"{'★' * rating}{'☆' * (5 - rating)} ({rating}/5)")
    if text:
        body += f"\n\n{html.escape(text)}"
    stamp = int(now.timestamp())
    for chat_id in await notifications.staff_recipients(session, "staff_new_sale"):
        await jobs.enqueue(session, "tg_message", {"chat_id": chat_id, "text": body},
                           dedupe_key=f"order_review:{review.id}:{stamp}:{chat_id}")
    return as_dict(review)

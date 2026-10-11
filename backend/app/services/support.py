"""Support tickets: categories, priorities and the one-tap ticket from an order card."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, OrderStatus, SupportMessage, SupportTicket, TicketStatus, User
from app.services import notifications
from app.services.common import ServiceError, utcnow

CATEGORIES = {
    "not_received": "Товар не получен",
    "not_working": "Товар не работает",
    "payment": "Проблема с оплатой",
    "refund": "Возврат средств",
    "question": "Вопрос по заказу",
    "general": "Другое",
}
PRIORITIES = ("low", "normal", "high", "urgent")

# text the customer gets prefilled when they tap a category on the order card
DEFAULT_TEXT = {
    "not_received": "Я оплатил заказ, но не получил товар.",
    "not_working": "Полученный товар не работает.",
    "payment": "Возникла проблема с оплатой заказа.",
    "refund": "Прошу рассмотреть возврат по заказу.",
    "question": "У меня вопрос по заказу.",
    "general": "Нужна помощь с заказом.",
}

MAX_OPEN = 5


def priority_for(order: Order | None, category: str) -> str:
    if order is None:
        return "normal"
    paid_not_delivered = order.status in (OrderStatus.paid, OrderStatus.processing)
    if category in ("not_received", "payment") and paid_not_delivered:
        return "high"
    if category == "refund" or order.fulfillment_status == "failed":
        return "high"
    return "normal"


async def _open_count(session: AsyncSession, user_id: int) -> int:
    rows = await session.scalars(
        select(SupportTicket.id).where(SupportTicket.user_id == user_id, SupportTicket.status != TicketStatus.closed)
    )
    return len(rows.all())


async def create_ticket(
    session: AsyncSession, user: User, subject: str, text: str, *, category: str = "general", order: Order | None = None
) -> SupportTicket:
    if category not in CATEGORIES:
        category = "general"
    if await _open_count(session, user.id) >= MAX_OPEN:
        raise ServiceError("У вас слишком много открытых обращений", 429, "too_many_tickets")
    ticket = SupportTicket(
        user_id=user.id, subject=subject.strip()[:160], category=category,
        priority=priority_for(order, category), order_id=order.id if order else None,
    )
    ticket.messages.append(SupportMessage(is_admin=False, text=text.strip()))
    session.add(ticket)
    await session.flush()
    order_part = f" · заказ {order.public_id or order.id}" if order else ""
    from app.services import rules

    await rules.fire(session, "ticket_created", ticket.id)
    await notifications.notify_staff(
        session, "staff_new_ticket",
        {"ticket_id": f"#{ticket.id}", "reason": f"{CATEGORIES[category]}{order_part}\n{text.strip()[:400]}"},
        dedupe=f"ticket:{ticket.id}",
    )
    return ticket


async def ticket_for_order(session: AsyncSession, user: User, order_id: int, category: str, text: str) -> SupportTicket:
    """One tap from the order card: reuses the open ticket for this order, otherwise creates a linked one."""
    order = await session.get(Order, order_id)
    if order is None or order.user_id != user.id:
        raise ServiceError("Заказ не найден", 404, "not_found")
    if category not in CATEGORIES:
        raise ServiceError("Неизвестная категория обращения", 422, "bad_category")
    body = text.strip() or DEFAULT_TEXT[category]
    existing = await session.scalar(
        select(SupportTicket).where(
            SupportTicket.user_id == user.id, SupportTicket.order_id == order.id, SupportTicket.status != TicketStatus.closed
        ).order_by(SupportTicket.id.desc()).limit(1)
    )
    if existing is not None:
        session.add(SupportMessage(ticket_id=existing.id, is_admin=False, text=f"[{CATEGORIES[category]}] {body}"))
        existing.status = TicketStatus.open
        existing.updated_at = utcnow()
        if priority_for(order, category) == "high" and existing.priority in ("low", "normal"):
            existing.priority = "high"
        return existing
    subject = f"{CATEGORIES[category]} — заказ {order.public_id or order.id}"
    return await create_ticket(session, user, subject, body, category=category, order=order)

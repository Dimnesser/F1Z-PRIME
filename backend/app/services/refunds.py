"""Refunds.

- balance: money goes back to the store balance — internal ledger, completes immediately;
- stars:   official Bot API refundStarPayment(user_id, telegram_payment_charge_id), executed by the worker;
           the order becomes "refunded" only after Telegram confirms;
- manual:  a bank transfer can't be reversed by the system — the refund waits until an operator returns the
           money outside and confirms it (never simulated).
A second refund of the same order is rejected (order row lock + existing refund check).
"""
from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, OrderStatus, Payment, PaymentMethod, PaymentStatus, Refund, User
from app.services import incidents, jobs, notifications, telegram
from app.services.common import ServiceError, lock, money, utcnow
from app.services.orders import _release_items, add_event, refund_to_balance

REFUNDABLE = (OrderStatus.paid, OrderStatus.processing, OrderStatus.completed)


async def _check(session: AsyncSession, order: Order) -> None:
    if order.status not in REFUNDABLE:
        raise ServiceError("Возврат возможен только по оплаченному заказу", 409, "bad_status")
    open_refund = await session.scalar(
        select(func.count(Refund.id)).where(
            Refund.order_id == order.id, Refund.status.in_(["succeeded", "processing", "manual_pending", "requested"])
        )
    )
    if open_refund:
        raise ServiceError("По заказу уже есть возврат", 409, "already_refunded")


async def order_payment(session: AsyncSession, order: Order) -> Payment | None:
    return await session.scalar(
        select(Payment).where(Payment.order_id == order.id, Payment.status == PaymentStatus.confirmed).order_by(Payment.id.desc())
    )


def available_methods(order: Order, payment: Payment | None) -> list[str]:
    methods = ["balance"]
    if payment is not None and payment.method == PaymentMethod.stars and payment.external_id:
        methods.append("stars")
    if payment is not None and payment.method == PaymentMethod.manual:
        methods.append("manual")
    return methods


async def start(session: AsyncSession, order_id: int, method: str, reason: str, actor: str) -> Refund | None:
    order = await lock(session, Order, order_id)
    if order is None:
        raise ServiceError("Заказ не найден", 404)
    await _check(session, order)
    payment = await order_payment(session, order)
    if method not in available_methods(order, payment):
        raise ServiceError("Этот способ возврата недоступен для заказа", 422)
    if method == "balance":
        old = order.status
        await refund_to_balance(session, order, actor=actor, reason=reason)
        order.status = OrderStatus.refunded
        add_event(session, order, OrderStatus.refunded, actor, old, note=f"Возврат на баланс: {reason}")
        return None
    refund = Refund(
        order_id=order.id, payment_id=payment.id if payment else None, amount=money(order.total), method=method,
        status="processing" if method == "stars" else "manual_pending", reason=reason[:500], requested_by=actor[:64],
        approved_by=actor[:64],
    )
    session.add(refund)
    await session.flush()
    add_event(session, order, order.status, actor, order.status,
              note=f"Возврат начат ({'Telegram Stars' if method == 'stars' else 'ручной перевод'}): {reason}")
    if method == "stars":
        await jobs.enqueue(session, "refund_stars", {"refund_id": refund.id}, dedupe_key=f"refund:{refund.id}", max_attempts=5)
    await notifications.notify_staff(
        session, "staff_refund_request", notifications.order_values(order, reason=reason), dedupe=f"refund:{refund.id}"
    )
    return refund


async def _complete(session: AsyncSession, refund: Refund, order: Order, actor: str, note: str) -> None:
    refund.status = "succeeded"
    refund.completed_at = utcnow()
    user = await lock(session, User, order.user_id)
    assert user is not None
    user.total_spent = max(money(0), money(user.total_spent) - money(refund.amount))
    if order.status != OrderStatus.completed:
        await _release_items(session, order, "refunded")
    old = order.status
    order.status = OrderStatus.refunded
    add_event(session, order, OrderStatus.refunded, actor, old, note=note)
    await notifications.notify_customer(session, order, "order_refunded", reason=note)


async def execute_stars(session: AsyncSession, refund_id: int) -> str:
    """Worker job. Safe to retry: an already-refunded charge is treated as success."""
    refund = await session.scalar(select(Refund).where(Refund.id == refund_id).with_for_update())
    if refund is None or refund.status != "processing":
        return "skip"
    order = await lock(session, Order, refund.order_id)
    payment = await session.get(Payment, refund.payment_id) if refund.payment_id else None
    if order is None or payment is None or not payment.external_id:
        refund.status, refund.error = "failed", "нет данных платежа Stars"
        return "failed"
    try:
        await telegram.call(
            "refundStarPayment",
            {"user_id": payment.user.telegram_id, "telegram_payment_charge_id": payment.external_id},
        )
    except telegram.TelegramError as exc:
        if exc.api and "ALREADY_REFUNDED" in str(exc).upper():
            pass  # an earlier attempt succeeded but we didn't record it
        elif exc.api:
            refund.status, refund.error = "failed", str(exc)[:500]
            await incidents.open_incident(
                session, "refund_failed", f"Telegram отклонил возврат по заказу {order.public_id}", severity="critical",
                order_id=order.id, payment_id=payment.id, details={"error": str(exc)[:300]}, dedupe_key=f"refund_failed:{refund.id}",
            )
            return "failed"
        else:
            raise  # network problem: the job retries with backoff
    refund.provider_ref = payment.external_id
    await _complete(session, refund, order, "telegram_stars", "Telegram Stars возвращены")
    return "succeeded"


async def confirm_manual(session: AsyncSession, refund_id: int, actor: str, note: str) -> Refund:
    """Operator confirms that the money for a manual transfer was returned outside the system."""
    refund = await session.scalar(select(Refund).where(Refund.id == refund_id).with_for_update())
    if refund is None:
        raise ServiceError("Возврат не найден", 404)
    if refund.status != "manual_pending":
        raise ServiceError("Возврат уже обработан", 409)
    order = await lock(session, Order, refund.order_id)
    assert order is not None
    refund.provider_ref = note[:255] or None
    await _complete(session, refund, order, actor, f"Деньги возвращены вручную: {note}" if note else "Деньги возвращены вручную")
    return refund


async def reject(session: AsyncSession, refund_id: int, actor: str, reason: str) -> Refund:
    refund = await session.scalar(select(Refund).where(Refund.id == refund_id).with_for_update())
    if refund is None:
        raise ServiceError("Возврат не найден", 404)
    if refund.status not in ("manual_pending", "requested", "failed"):
        raise ServiceError("Этот возврат нельзя отклонить", 409)
    refund.status, refund.error = "rejected", reason[:500]
    refund.completed_at = utcnow()
    return refund


def total_refunded(refunds: list[Refund]) -> Decimal:
    return sum((money(r.amount) for r in refunds if r.status == "succeeded"), money(0))

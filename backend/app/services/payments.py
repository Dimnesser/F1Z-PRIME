from __future__ import annotations

import logging
import math
import secrets
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    Order,
    OrderStatus,
    Payment,
    PaymentKind,
    PaymentMethod,
    PaymentStatus,
    TxType,
    User,
)
from app.services import settings as settings_service
from app.services import telegram
from app.services.common import ServiceError, change_balance, lock, money, utcnow
from app.services.orders import mark_paid

log = logging.getLogger("f1z.payments")


@dataclass(slots=True)
class PaymentStart:
    payment: Payment
    invoice_link: str | None = None
    instructions: str | None = None


def new_payload(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(18)}"


async def stars_for(session: AsyncSession, amount: Decimal) -> int:
    rate = await settings_service.get_decimal(session, "uah_per_star", "0.85")
    if rate <= 0:
        raise ServiceError("Оплата Stars временно недоступна", 503, "stars_disabled")
    return max(1, math.ceil(Decimal(amount) / rate))


async def _ensure_method_enabled(session: AsyncSession, method: PaymentMethod) -> None:
    s = get_settings()
    if method == PaymentMethod.test:
        if not s.dev_mode or s.is_production:
            raise ServiceError("Тестовые платежи доступны только в DEV_MODE", 403, "test_disabled")
    elif method == PaymentMethod.stars:
        if not await settings_service.get_bool(session, "stars_enabled"):
            raise ServiceError("Оплата Telegram Stars отключена", 400, "method_disabled")
        if not s.bot_token:
            raise ServiceError("Оплата Stars не настроена (нет BOT_TOKEN)", 503, "stars_not_configured")
    elif method == PaymentMethod.manual:
        if not await settings_service.get_bool(session, "manual_enabled"):
            raise ServiceError("Ручная оплата отключена", 400, "method_disabled")


async def _stars_invoice(
    session: AsyncSession, payment: Payment, title: str, description: str, stars: int | None = None
) -> str:
    # an order with its own Stars price is billed exactly that; otherwise (top-ups, older products) the rate is used
    payment.stars_amount = stars if stars else await stars_for(session, payment.amount)
    await session.flush()
    try:
        return await telegram.create_stars_invoice_link(title, description, payment.payload, payment.stars_amount)
    except telegram.TelegramError as exc:
        log.error("createInvoiceLink failed: %s", exc)
        raise ServiceError("Не удалось создать счёт Telegram Stars", 502, "telegram_error") from exc


async def start_order_payment(session: AsyncSession, user: User, order_id: int, method: PaymentMethod) -> PaymentStart:
    await settings_service.ensure_open(session)
    await _ensure_method_enabled(session, method)
    order = await lock(session, Order, order_id)
    if order is None or order.user_id != user.id:
        raise ServiceError("Заказ не найден", 404, "not_found")
    if order.status != OrderStatus.pending:
        raise ServiceError("Заказ уже оплачен или закрыт", 409, "bad_status")
    if order.expires_at and order.expires_at < utcnow():
        raise ServiceError("Время на оплату истекло", 409, "expired")

    if method == PaymentMethod.balance:
        locked_user = await lock(session, User, user.id)
        assert locked_user is not None
        payment = Payment(
            user_id=user.id,
            order_id=order.id,
            kind=PaymentKind.order,
            method=method,
            amount=order.total,
            payload=new_payload("bal"),
            status=PaymentStatus.confirmed,
            confirmed_by="system",
            confirmed_at=utcnow(),
        )
        session.add(payment)
        await session.flush()
        await change_balance(
            session,
            locked_user,
            -money(order.total),
            TxType.purchase,
            f"Оплата заказа #{order.id}",
            order_id=order.id,
            payment_id=payment.id,
        )
        await mark_paid(session, order, method.value)
        return PaymentStart(payment)

    if method == PaymentMethod.test:
        payment = Payment(
            user_id=user.id,
            order_id=order.id,
            kind=PaymentKind.order,
            method=method,
            amount=order.total,
            payload=new_payload("test"),
            status=PaymentStatus.confirmed,
            is_test=True,
            confirmed_by="DEV_MODE",
            confirmed_at=utcnow(),
            admin_comment="ТЕСТОВЫЙ ПЛАТЁЖ (DEV_MODE) — реальные деньги не поступали",
        )
        session.add(payment)
        await mark_paid(session, order, method.value)
        await session.flush()
        return PaymentStart(payment)

    if method == PaymentMethod.stars and order.product is not None and not order.product.stars_enabled:
        raise ServiceError("Для этого товара оплата Telegram Stars недоступна", 400, "stars_not_allowed")
    # stars / manual: reuse an open payment of the same method for this order
    existing = await session.scalar(
        select(Payment).where(
            Payment.order_id == order.id,
            Payment.method == method,
            Payment.status.in_([PaymentStatus.pending, PaymentStatus.awaiting_confirmation]),
        )
    )
    payment = existing or Payment(
        user_id=user.id,
        order_id=order.id,
        kind=PaymentKind.order,
        method=method,
        amount=order.total,
        payload=new_payload("ord"),
    )
    if existing is None:
        session.add(payment)
        await session.flush()
    if method == PaymentMethod.stars:
        link = await _stars_invoice(
            session, payment, f"Заказ {order.public_id or order.id}", order.item_title, stars=order.stars_total
        )
        return PaymentStart(payment, invoice_link=link)
    return PaymentStart(payment, instructions=await settings_service.get_value(session, "manual_payment_details"))


async def start_topup(session: AsyncSession, user: User, amount: Decimal, method: PaymentMethod) -> PaymentStart:
    if method == PaymentMethod.balance:
        raise ServiceError("Нельзя пополнить баланс с баланса")
    await settings_service.ensure_open(session)
    await _ensure_method_enabled(session, method)
    amount = money(amount)
    min_t = await settings_service.get_decimal(session, "min_topup", "50")
    max_t = await settings_service.get_decimal(session, "max_topup", "50000")
    if amount < min_t or amount > max_t:
        raise ServiceError(f"Сумма пополнения должна быть от {min_t} до {max_t} грн")
    payment = Payment(
        user_id=user.id,
        kind=PaymentKind.topup,
        method=method,
        amount=amount,
        payload=new_payload("top"),
    )
    session.add(payment)
    await session.flush()
    if method == PaymentMethod.test:
        payment.is_test = True
        payment.admin_comment = "ТЕСТОВОЕ ПОПОЛНЕНИЕ (DEV_MODE)"
        await confirm_payment(session, payment.id, actor="DEV_MODE")
        return PaymentStart(payment)
    if method == PaymentMethod.stars:
        link = await _stars_invoice(session, payment, "Пополнение баланса", f"Пополнение F1Z PRIME на {amount} грн")
        return PaymentStart(payment, invoice_link=link)
    return PaymentStart(payment, instructions=await settings_service.get_value(session, "manual_payment_details"))


async def submit_manual(session: AsyncSession, user: User, payment_id: int, comment: str) -> Payment:
    payment = await lock(session, Payment, payment_id)
    if payment is None or payment.user_id != user.id:
        raise ServiceError("Платёж не найден", 404, "not_found")
    if payment.method != PaymentMethod.manual:
        raise ServiceError("Это не ручной платёж")
    if payment.status == PaymentStatus.awaiting_confirmation:
        return payment
    if payment.status != PaymentStatus.pending:
        raise ServiceError("Платёж уже обработан", 409, "bad_status")
    payment.status = PaymentStatus.awaiting_confirmation
    payment.user_comment = comment[:500]
    return payment


async def confirm_payment(
    session: AsyncSession, payment_id: int, *, actor: str, external_id: str | None = None
) -> tuple[Payment, bool]:
    """Idempotent confirmation. Returns (payment, newly_confirmed)."""
    payment = await lock(session, Payment, payment_id)
    if payment is None:
        raise ServiceError("Платёж не найден", 404, "not_found")
    if payment.status == PaymentStatus.confirmed:
        return payment, False
    if payment.status not in (PaymentStatus.pending, PaymentStatus.awaiting_confirmation, PaymentStatus.cancelled):
        raise ServiceError("Платёж отклонён и не может быть подтверждён", 409, "bad_status")
    if payment.status == PaymentStatus.cancelled and external_id is None and payment.method != PaymentMethod.manual:
        raise ServiceError("Платёж отменён", 409, "bad_status")

    payment.status = PaymentStatus.confirmed
    payment.confirmed_by = actor[:64]
    payment.confirmed_at = utcnow()
    if external_id:
        payment.external_id = external_id
    user = await lock(session, User, payment.user_id)
    assert user is not None

    if payment.kind == PaymentKind.topup:
        await change_balance(
            session, user, payment.amount, TxType.topup, f"Пополнение баланса ({payment.method.value})",
            payment_id=payment.id,
        )
    else:
        order = await lock(session, Order, payment.order_id) if payment.order_id else None
        if order is not None and order.status == OrderStatus.pending:
            await mark_paid(session, order, payment.method.value, actor=actor)
        else:
            # Money arrived for an order that is no longer payable — keep it on the user's balance.
            await change_balance(
                session, user, payment.amount, TxType.refund,
                f"Зачисление: оплата заказа #{payment.order_id} поступила после его закрытия",
                order_id=payment.order_id, payment_id=payment.id,
            )
            from app.services import incidents

            await incidents.open_incident(
                session, "late_payment", f"Оплата закрытого заказа #{payment.order_id} зачислена на баланс",
                order_id=payment.order_id, payment_id=payment.id, dedupe_key=f"late_payment:{payment.id}",
            )
    await session.flush()
    log.info("payment %s confirmed by %s", payment.id, actor)
    return payment, True


async def reject_payment(session: AsyncSession, payment_id: int, *, actor: str, comment: str = "") -> Payment:
    payment = await lock(session, Payment, payment_id)
    if payment is None:
        raise ServiceError("Платёж не найден", 404, "not_found")
    if payment.status not in (PaymentStatus.pending, PaymentStatus.awaiting_confirmation):
        raise ServiceError("Платёж уже обработан", 409, "bad_status")
    payment.status = PaymentStatus.rejected
    payment.admin_comment = comment[:500] or None
    payment.confirmed_by = actor[:64]
    return payment


# ------------------------------------------------------------- Telegram Stars


async def validate_precheckout(
    session: AsyncSession, payload: str, total_amount: int, currency: str, telegram_id: int
) -> str | None:
    """Returns an error message or None if the checkout may proceed."""
    payment = await session.scalar(select(Payment).where(Payment.payload == payload))
    if payment is None or payment.method != PaymentMethod.stars:
        return "Счёт не найден"
    if payment.user.telegram_id != telegram_id:
        return "Счёт выставлен другому пользователю"
    if payment.status != PaymentStatus.pending:
        return "Счёт уже оплачен или отменён"
    if currency != "XTR" or total_amount != payment.stars_amount:
        return "Сумма счёта изменилась, создайте новый"
    if payment.kind == PaymentKind.order:
        order = payment.order
        if order is None or order.status != OrderStatus.pending:
            return "Заказ уже закрыт"
        if order.expires_at and order.expires_at < utcnow():
            return "Время на оплату заказа истекло"
    return None


async def process_stars_payment(
    session: AsyncSession, payload: str, charge_id: str, total_amount: int, currency: str, telegram_id: int
) -> tuple[Payment | None, bool]:
    """Handle `successful_payment`. Safe against repeated delivery of the same update."""
    already = await session.scalar(select(Payment).where(Payment.external_id == charge_id))
    if already is not None:
        return already, False
    payment = await session.scalar(select(Payment).where(Payment.payload == payload))
    if payment is None:
        log.error("stars payment with unknown payload %s charge %s", payload, charge_id)
        from app.services import incidents

        await incidents.open_incident(
            session, "stars_unknown", "Stars-платёж без счёта в базе", severity="critical",
            details={"charge_id": charge_id, "amount": total_amount, "telegram_id": telegram_id},
            dedupe_key=f"stars_unknown:{charge_id}",
        )
        return None, False
    if currency != "XTR" or total_amount != payment.stars_amount or payment.user.telegram_id != telegram_id:
        log.error("stars payment mismatch payload=%s charge=%s", payload, charge_id)
        payment.admin_comment = f"Несовпадение суммы/пользователя. charge_id={charge_id}, amount={total_amount}"
        from app.services import incidents

        await incidents.open_incident(
            session, "stars_mismatch", f"Stars-платёж #{payment.id}: не совпала сумма, валюта или покупатель",
            severity="critical", order_id=payment.order_id, payment_id=payment.id,
            details={"charge_id": charge_id, "amount": total_amount, "expected": payment.stars_amount, "currency": currency},
            dedupe_key=f"stars_mismatch:{charge_id}",
        )
        return payment, False
    return await confirm_payment(session, payment.id, actor="telegram_stars", external_id=charge_id)

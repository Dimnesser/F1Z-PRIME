from __future__ import annotations

import math
from decimal import Decimal

import logging
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import (
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
    PaymentStatus,
    PremiumNumber,
    PremiumStatus,
    Product,
    ProductStatus,
    TxType,
    User,
)
from app.security import TelegramUser
from app.services import inventory, jobs, notifications, promo, rules
from app.services import settings as settings_service
from app.services.common import ServiceError, change_balance, lock, money, utcnow

log = logging.getLogger("f1z.orders")

ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.pending: {OrderStatus.cancelled, OrderStatus.expired},  # -> paid only through a confirmed payment
    OrderStatus.paid: {OrderStatus.processing, OrderStatus.completed, OrderStatus.refunded},
    OrderStatus.processing: {OrderStatus.completed, OrderStatus.refunded},
    OrderStatus.completed: {OrderStatus.refunded},
    OrderStatus.cancelled: set(),
    OrderStatus.expired: set(),
    OrderStatus.refunded: set(),
}

STATUS_LABELS = {
    OrderStatus.pending: "Ожидает оплаты",
    OrderStatus.paid: "Оплачен",
    OrderStatus.processing: "В обработке",
    OrderStatus.completed: "Выполнен",
    OrderStatus.cancelled: "Отменён",
    OrderStatus.expired: "Истёк",
    OrderStatus.refunded: "Возврат",
}


STAGE_LABELS = {
    "pending_payment": "Ожидает оплаты",
    "payment_review": "Платёж на проверке",
    "paid": "Оплачен",
    "fulfillment_pending": "Ожидает выдачи",
    "processing": "В обработке",
    "delivered": "Выдан",
    "manual_review": "Ручная проверка",
    "failed": "Ошибка выдачи",
    "cancelled": "Отменён",
    "refunded": "Возврат",
}


def order_stage(order: Order, payment_review: bool = False) -> str:
    """Explicit lifecycle stage shown to customers and staff, derived from the stored order + fulfillment status."""
    st, fs = order.status, order.fulfillment_status
    if st == OrderStatus.pending:
        return "payment_review" if payment_review else "pending_payment"
    if st in (OrderStatus.cancelled, OrderStatus.expired):
        return "cancelled"
    if st == OrderStatus.refunded:
        return "refunded"
    if st == OrderStatus.completed or fs == "delivered":
        return "delivered"
    if fs == "failed":
        return "failed"
    if fs in ("manual", "review"):
        return "manual_review"
    if fs == "processing":
        return "processing"
    if fs == "pending":
        return "fulfillment_pending"
    return "paid" if st == OrderStatus.paid else "processing"


def add_event(
    session: AsyncSession, order: Order, to_status: OrderStatus, actor: str, from_status: OrderStatus | None = None,
    note: str | None = None,
) -> None:
    session.add(
        OrderEvent(
            order_id=order.id,
            from_status=from_status.value if from_status else None,
            to_status=to_status.value,
            actor=actor[:64],
            note=note,
        )
    )


async def upsert_user(session: AsyncSession, tg: TelegramUser) -> User:
    """Insert or update a Telegram user atomically (INSERT ... ON CONFLICT)."""
    values = {
        "telegram_id": tg.id,
        "username": tg.username,
        "first_name": tg.first_name,
        "last_name": tg.last_name,
        "language_code": tg.language_code,
        "photo_url": tg.photo_url,
        "last_seen_at": utcnow(),
    }
    update = {k: v for k, v in values.items() if k != "telegram_id" and (v is not None or k != "photo_url")}
    stmt = (
        pg_insert(User)
        .values(**values)
        .on_conflict_do_update(index_elements=[User.telegram_id], set_=update)
        .returning(User.id)
    )
    user_id = (await session.execute(stmt)).scalar_one()
    user = await session.get(User, user_id, populate_existing=True)
    assert user is not None
    return user


async def create_order(
    session: AsyncSession,
    user: User,
    *,
    idempotency_key: str,
    product_id: int | None = None,
    premium_number_id: int | None = None,
    quantity: int = 1,
    promo_code: str | None = None,
) -> tuple[Order, bool]:
    """Create an order with stock reservation. Returns (order, created).

    Price and availability are always taken from the database; the client only sends ids.
    """
    if (product_id is None) == (premium_number_id is None):
        raise ServiceError("Укажите товар")
    if not 1 <= quantity <= 10:
        raise ServiceError("Количество должно быть от 1 до 10")
    await settings_service.ensure_open(session)

    locked_user = await lock(session, User, user.id)  # serialises orders of one user
    assert locked_user is not None
    if locked_user.is_blocked:
        raise ServiceError("Аккаунт заблокирован", 403, "blocked")

    existing = await session.scalar(
        select(Order).where(Order.user_id == user.id, Order.idempotency_key == idempotency_key)
    )
    if existing is not None:
        return existing, False

    pending = await session.scalar(
        select(func.count(Order.id)).where(Order.user_id == user.id, Order.status == OrderStatus.pending)
    )
    if (pending or 0) >= get_settings().max_pending_orders:
        raise ServiceError("Слишком много неоплаченных заказов. Оплатите или отмените предыдущие.", 429, "too_many")

    expires = utcnow() + timedelta(minutes=get_settings().order_ttl_minutes)
    if product_id is not None:
        product = await lock(session, Product, product_id)
        now = utcnow()
        if product is None or product.status != ProductStatus.active or not product.on_sale_window(now):
            raise ServiceError("Товар недоступен", 404, "not_found")
        if product.max_per_order and quantity > product.max_per_order:
            raise ServiceError(f"Не более {product.max_per_order} шт. в одном заказе", 422, "max_per_order")
        if product.max_per_user:
            had = await session.scalar(
                select(func.coalesce(func.sum(Order.quantity), 0)).where(
                    Order.user_id == user.id, Order.product_id == product.id,
                    Order.status.not_in([OrderStatus.cancelled, OrderStatus.expired, OrderStatus.refunded]),
                )
            )
            if (had or 0) + quantity > product.max_per_user:
                raise ServiceError(f"Лимит: не более {product.max_per_user} шт. этого товара на покупателя", 429, "user_limit")
        if product.stock < quantity:
            raise ServiceError("Недостаточно товара в наличии", 409, "out_of_stock")
        product.stock -= quantity
        title = product.title
        unit_price = money(product.effective_price(now))  # price always from the database, never from the client
    else:
        if promo_code:
            raise ServiceError("Промокоды не действуют на красивые номера", 422, "promo_scope")
        number = await lock(session, PremiumNumber, premium_number_id)  # type: ignore[arg-type]
        if number is None or number.status != PremiumStatus.available:
            raise ServiceError("Номер уже забронирован или продан", 409, "unavailable")
        quantity = 1
        number.status = PremiumStatus.reserved
        title = f"{number.title} {number.display_mask}"
        unit_price = money(number.price)

    total = money(unit_price * quantity)
    min_total = await settings_service.get_decimal(session, "min_order_total", "0")
    max_total = await settings_service.get_decimal(session, "max_order_total", "0")
    if min_total > 0 and total < min_total:
        raise ServiceError(f"Минимальная сумма заказа — {min_total} грн", 422, "below_min")
    if max_total > 0 and total > max_total:
        raise ServiceError(f"Максимальная сумма заказа — {max_total} грн", 422, "above_max")
    per_day = int(await settings_service.get_value(session, "max_items_per_user_day") or 0)
    if per_day and product_id is not None:
        bought = await session.scalar(
            select(func.coalesce(func.sum(Order.quantity), 0)).where(
                Order.user_id == user.id, Order.product_id == product_id,
                Order.status.not_in([OrderStatus.cancelled, OrderStatus.expired, OrderStatus.refunded]),
                Order.created_at > utcnow() - timedelta(days=1),
            )
        )
        if (bought or 0) + quantity > per_day:
            raise ServiceError(f"Лимит: не более {per_day} шт. этого товара в сутки", 429, "user_limit")

    order = Order(
        user_id=user.id,
        product_id=product_id,
        premium_number_id=premium_number_id,
        item_title=title[:160],
        quantity=quantity,
        unit_price=unit_price,
        total=total,
        status=OrderStatus.pending,
        idempotency_key=idempotency_key,
        expires_at=expires,
    )
    session.add(order)
    await session.flush()
    order.public_id = f"F1Z-{order.id:06d}"
    add_event(session, order, OrderStatus.pending, f"user:{user.telegram_id}")
    if promo_code:
        discount = await promo.apply(session, locked_user, order, product, promo_code)
        add_event(session, order, OrderStatus.pending, "system", OrderStatus.pending,
                  note=f"Промокод {order.promo_code}: скидка {discount} грн")
    if product_id is not None:
        if product.uses_inventory:
            await inventory.reserve_units(session, product, order, quantity)
        inventory.record(session, product, -quantity, "reserved", order_id=order.id, note=f"резерв заказа {order.public_id}")
        add_event(session, order, OrderStatus.pending, "system", OrderStatus.pending, note="Товар зарезервирован")
    if product_id is not None:
        _fix_currency_totals(order, product)
    await rules.fire(session, "order_created", order.id)
    log.info("order %s created by user %s total=%s", order.id, user.telegram_id, order.total)
    return order, True


def _fix_currency_totals(order: Order, product: Product) -> None:
    """Stars / USD amounts come from the product's own prices (set by staff), never from an exchange rate.
    A promo discount reduces them in the same proportion as the UAH total."""
    subtotal = money(order.unit_price) * order.quantity
    share = (money(order.total) / subtotal) if subtotal > 0 else Decimal(1)
    if product.price_stars:
        order.stars_total = max(1, math.ceil(Decimal(product.price_stars * order.quantity) * share))
    if product.price_usd:
        order.usd_total = money(Decimal(product.price_usd) * order.quantity * share)


async def _release_items(session: AsyncSession, order: Order, reason: str = "released") -> None:
    if reason in ("expired", "cancelled"):
        await promo.release(session, order)
    if order.product_id:
        product = await lock(session, Product, order.product_id)
        if product is not None:
            if product.uses_inventory:
                released = await inventory.release_units(session, order)
                product.stock += released
                if released:
                    inventory.record(session, product, released, reason, order_id=order.id)
            else:
                product.stock += order.quantity
                inventory.record(session, product, order.quantity, reason, order_id=order.id)
    if order.premium_number_id:
        number = await lock(session, PremiumNumber, order.premium_number_id)
        if number is not None and number.status in (PremiumStatus.reserved, PremiumStatus.sold):
            number.status = PremiumStatus.available


async def mark_paid(session: AsyncSession, order: Order, method: str, actor: str = "payment") -> None:
    """Called only from payment confirmation, with `order` locked."""
    if order.status != OrderStatus.pending:
        raise ServiceError("Заказ не ожидает оплаты", 409, "bad_status")
    order.status = OrderStatus.paid
    order.payment_method = method
    order.paid_at = utcnow()
    add_event(session, order, OrderStatus.paid, actor, OrderStatus.pending, note=f"Оплата: {method}")
    user = await lock(session, User, order.user_id)
    assert user is not None
    user.total_spent = money(user.total_spent) + money(order.total)
    user.orders_count += 1
    if order.premium_number_id:
        number = await lock(session, PremiumNumber, order.premium_number_id)
        if number is not None:
            number.status = PremiumStatus.sold
            order.delivery_data = f"Ваш номер: {number.number}"
            order.status = OrderStatus.completed
            order.completed_at = order.delivered_at = utcnow()
            order.fulfillment_status = "delivered"
            add_event(session, order, OrderStatus.completed, "auto", OrderStatus.paid, note="Номер выдан автоматически")
    else:
        # delivery happens in the fulfillment job, created in the same transaction as the payment:
        # if the payment commits, the job exists; a crash afterwards just delays delivery, never loses it.
        order.fulfillment_status = "pending"
        await jobs.enqueue(session, "fulfill", {"order_id": order.id}, dedupe_key=f"fulfill:{order.id}")
    await notifications.notify_staff(
        session, "staff_new_sale", notifications.order_values(order), dedupe=f"sale:{order.id}"
    )
    await rules.fire(session, "order_paid", order.id)
    big = await settings_service.get_decimal(session, "big_order_threshold", "0")
    if big > 0 and money(order.total) >= big:
        await notifications.notify_staff(session, "staff_big_order", notifications.order_values(order), dedupe=f"big:{order.id}")


async def change_status(
    session: AsyncSession,
    order_id: int,
    new_status: OrderStatus,
    *,
    delivery_data: str | None = None,
    admin_note: str | None = None,
    actor: str = "system",
) -> Order:
    order = await lock(session, Order, order_id)
    if order is None:
        raise ServiceError("Заказ не найден", 404, "not_found")
    if new_status not in ALLOWED_TRANSITIONS[order.status]:
        raise ServiceError(
            f"Переход «{STATUS_LABELS[order.status]}» → «{STATUS_LABELS[new_status]}» запрещён", 409, "bad_transition"
        )
    old = order.status
    if new_status in (OrderStatus.cancelled, OrderStatus.expired):
        await _release_items(session, order, "expired" if new_status == OrderStatus.expired else "cancelled")
        await _cancel_open_payments(session, order.id)
        await rules.fire(session, "order_cancelled", order.id)
    elif new_status == OrderStatus.refunded:
        await refund_to_balance(session, order, actor=actor, reason=admin_note or "Возврат на баланс")
    elif new_status == OrderStatus.completed:
        order.completed_at = order.delivered_at = utcnow()
        await rules.fire(session, "order_delivered", order.id)
        order.fulfillment_status = "delivered"
        order.fulfillment_error = None
        if order.product_id:
            product = await lock(session, Product, order.product_id)
            if product is not None and product.uses_inventory:
                await inventory.sell_units(session, order, product)
    elif new_status == OrderStatus.processing and order.fulfillment_status in (None, "pending"):
        order.fulfillment_status = "manual"
    if delivery_data is not None:
        order.delivery_data = delivery_data
    if admin_note is not None:
        order.admin_note = admin_note
    order.status = new_status
    add_event(session, order, new_status, actor, old, note=admin_note or None)
    if new_status == OrderStatus.completed:
        from app.services import incidents

        await incidents.resolve_for_order(session, order.id, ["fulfillment_failed", "stuck_order"], actor)
        await notifications.notify_customer(session, order, "order_delivered")
    elif new_status == OrderStatus.expired:
        await notifications.notify_customer(session, order, "order_expired")
    elif new_status == OrderStatus.cancelled and not actor.startswith("user:"):
        await notifications.notify_customer(session, order, "order_cancelled", reason=admin_note or "Заказ отменён администратором")
    return order


async def refund_to_balance(session: AsyncSession, order: Order, *, actor: str, reason: str) -> None:
    """Full refund to the store balance (confirmed internally, so it completes immediately). Order row locked."""
    from app.models import Refund

    already = await session.scalar(
        select(func.count(Refund.id)).where(Refund.order_id == order.id, Refund.status.in_(["succeeded", "processing"]))
    )
    if already:
        raise ServiceError("По заказу уже выполнен или выполняется возврат", 409, "already_refunded")
    user = await lock(session, User, order.user_id)
    assert user is not None
    await change_balance(
        session, user, money(order.total), TxType.refund, f"Возврат по заказу #{order.id}", order_id=order.id
    )
    user.total_spent = max(money(0), money(user.total_spent) - money(order.total))
    if order.status != OrderStatus.completed:
        await _release_items(session, order, "refunded")
    session.add(Refund(order_id=order.id, amount=money(order.total), method="balance", status="succeeded",
                       reason=reason[:500], requested_by=actor[:64], approved_by=actor[:64], completed_at=utcnow()))
    await notifications.notify_customer(session, order, "order_refunded", reason="деньги зачислены на баланс магазина")


async def _cancel_open_payments(session: AsyncSession, order_id: int) -> None:
    payments = (
        await session.scalars(
            select(Payment).where(Payment.order_id == order_id, Payment.status == PaymentStatus.pending)
        )
    ).all()
    for p in payments:
        p.status = PaymentStatus.cancelled


async def cancel_by_user(session: AsyncSession, user: User, order_id: int) -> Order:
    order = await session.get(Order, order_id)
    if order is None or order.user_id != user.id:
        raise ServiceError("Заказ не найден", 404, "not_found")
    awaiting = await session.scalar(
        select(func.count(Payment.id)).where(
            Payment.order_id == order_id, Payment.status == PaymentStatus.awaiting_confirmation
        )
    )
    if awaiting:
        raise ServiceError("Платёж уже на проверке у администратора", 409, "payment_in_review")
    return await change_status(session, order_id, OrderStatus.cancelled, actor=f"user:{user.telegram_id}")


async def expire_stale_orders(session: AsyncSession) -> int:
    """Expire unpaid orders whose reservation time is over (skips ones with a payment under review)."""
    in_review = select(Payment.order_id).where(
        Payment.status == PaymentStatus.awaiting_confirmation, Payment.order_id.is_not(None)
    )
    ids = (
        await session.scalars(
            select(Order.id).where(
                Order.status == OrderStatus.pending, Order.expires_at < utcnow(), Order.id.not_in(in_review)
            )
        )
    ).all()
    count = 0
    for oid in ids:
        order = await lock(session, Order, oid)
        if order is not None and order.status == OrderStatus.pending:
            await change_status(session, oid, OrderStatus.expired, actor="auto:expiry")
            count += 1
    return count

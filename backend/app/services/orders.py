from __future__ import annotations

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
        if product is None or product.status != ProductStatus.active:
            raise ServiceError("Товар недоступен", 404, "not_found")
        if product.stock < quantity:
            raise ServiceError("Недостаточно товара в наличии", 409, "out_of_stock")
        product.stock -= quantity
        title = product.title
        unit_price = money(product.price)
    else:
        number = await lock(session, PremiumNumber, premium_number_id)  # type: ignore[arg-type]
        if number is None or number.status != PremiumStatus.available:
            raise ServiceError("Номер уже забронирован или продан", 409, "unavailable")
        quantity = 1
        number.status = PremiumStatus.reserved
        title = f"{number.title} {number.display_mask}"
        unit_price = money(number.price)

    order = Order(
        user_id=user.id,
        product_id=product_id,
        premium_number_id=premium_number_id,
        item_title=title[:160],
        quantity=quantity,
        unit_price=unit_price,
        total=money(unit_price * quantity),
        status=OrderStatus.pending,
        idempotency_key=idempotency_key,
        expires_at=expires,
    )
    session.add(order)
    await session.flush()
    add_event(session, order, OrderStatus.pending, f"user:{user.telegram_id}")
    log.info("order %s created by user %s total=%s", order.id, user.telegram_id, order.total)
    return order, True


async def _release_items(session: AsyncSession, order: Order) -> None:
    if order.product_id:
        product = await lock(session, Product, order.product_id)
        if product is not None:
            product.stock += order.quantity
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
            order.completed_at = utcnow()
            add_event(session, order, OrderStatus.completed, "auto", OrderStatus.paid, note="Номер выдан автоматически")
    elif order.product_id and await settings_service.get_bool(session, "auto_complete_digital"):
        product = await session.get(Product, order.product_id)
        if product is not None and product.category == "digital" and product.delivery_note.strip():
            order.delivery_data = product.delivery_note
            order.status = OrderStatus.completed
            order.completed_at = utcnow()
            add_event(session, order, OrderStatus.completed, "auto", OrderStatus.paid, note="Автозавершение цифрового товара")


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
        await _release_items(session, order)
        await _cancel_open_payments(session, order.id)
    elif new_status == OrderStatus.refunded:
        user = await lock(session, User, order.user_id)
        assert user is not None
        await change_balance(
            session, user, money(order.total), TxType.refund, f"Возврат по заказу #{order.id}", order_id=order.id
        )
        user.total_spent = max(money(0), money(user.total_spent) - money(order.total))
        if old != OrderStatus.completed:
            await _release_items(session, order)
    elif new_status == OrderStatus.completed:
        order.completed_at = utcnow()
    if delivery_data is not None:
        order.delivery_data = delivery_data
    if admin_note is not None:
        order.admin_note = admin_note
    order.status = new_status
    add_event(session, order, new_status, actor, old, note=admin_note or None)
    return order


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

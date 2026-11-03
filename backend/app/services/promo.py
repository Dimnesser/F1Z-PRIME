"""Promo codes: validated and applied only on the server.

Concurrency: the promo row is locked (SELECT ... FOR UPDATE) while an order applies it, so `max_uses` and the
per-user limit are exact even when many buyers use the last activation at the same moment. A cancelled or expired
order gives its activation back. The client only sends the code; the discount is always computed here.
"""
from __future__ import annotations

import re
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, Product, PromoCode, PromoRedemption, User
from app.services.common import ServiceError, money, utcnow

CODE_RE = re.compile(r"^[A-Z0-9_-]{3,32}$")
MIN_TOTAL_AFTER_DISCOUNT = Decimal("1.00")  # an order is never free through a promo code


def normalize(code: str) -> str:
    return (code or "").strip().upper()


def _discount(promo: PromoCode, subtotal: Decimal) -> Decimal:
    if promo.kind == "percent":
        d = (subtotal * money(promo.value) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    else:
        d = money(promo.value)
    if promo.max_discount is not None:
        d = min(d, money(promo.max_discount))
    return max(Decimal("0"), min(d, subtotal - MIN_TOTAL_AFTER_DISCOUNT))


async def _check(
    session: AsyncSession, promo: PromoCode | None, user: User, product: Product | None, subtotal: Decimal,
    now: datetime,
) -> Decimal:
    if promo is None or not promo.is_active:
        raise ServiceError("Промокод не найден или выключен", 404, "promo_not_found")
    if promo.starts_at and promo.starts_at > now:
        raise ServiceError("Промокод ещё не действует", 422, "promo_not_started")
    if promo.ends_at and promo.ends_at <= now:
        raise ServiceError("Срок действия промокода истёк", 422, "promo_expired")
    if promo.max_uses is not None and promo.used_count >= promo.max_uses:
        raise ServiceError("Промокод больше недоступен — активации закончились", 409, "promo_exhausted")
    if product is None:
        raise ServiceError("Промокод действует только на товары каталога", 422, "promo_scope")
    if promo.product_ids and product.id not in promo.product_ids:
        raise ServiceError("Промокод не действует на этот товар", 422, "promo_scope")
    if promo.categories and product.category not in promo.categories:
        raise ServiceError("Промокод не действует на эту категорию", 422, "promo_scope")
    if promo.min_total is not None and subtotal < money(promo.min_total):
        raise ServiceError(f"Промокод действует от {money(promo.min_total)} грн", 422, "promo_min_total")
    if promo.first_order_only and user.orders_count > 0:
        raise ServiceError("Промокод только для первого заказа", 422, "promo_first_order")
    used = await session.scalar(
        select(func.count(PromoRedemption.id)).where(PromoRedemption.promo_id == promo.id, PromoRedemption.user_id == user.id)
    ) or 0
    if used >= promo.max_uses_per_user:
        raise ServiceError("Вы уже использовали этот промокод", 409, "promo_used")
    discount = _discount(promo, subtotal)
    if discount <= 0:
        raise ServiceError("Промокод не даёт скидки для этой суммы", 422, "promo_zero")
    return discount


async def preview(session: AsyncSession, user: User, code: str, product: Product, subtotal: Decimal) -> dict:
    """Read-only check for the Mini App (shows the discount before ordering). Nothing is reserved."""
    code = normalize(code)
    if not CODE_RE.match(code):
        raise ServiceError("Неверный формат промокода", 422, "promo_format")
    promo = await session.scalar(select(PromoCode).where(PromoCode.code == code))
    discount = await _check(session, promo, user, product, subtotal, utcnow())
    return {"code": code, "discount": discount, "total": subtotal - discount}


async def apply(session: AsyncSession, user: User, order: Order, product: Product | None, code: str) -> Decimal:
    """Apply to a just-created order (same transaction). Locks the promo row; returns the discount."""
    code = normalize(code)
    if not CODE_RE.match(code):
        raise ServiceError("Неверный формат промокода", 422, "promo_format")
    promo = await session.scalar(select(PromoCode).where(PromoCode.code == code).with_for_update())
    discount = await _check(session, promo, user, product, money(order.total), utcnow())
    assert promo is not None
    promo.used_count += 1
    session.add(PromoRedemption(promo_id=promo.id, user_id=user.id, order_id=order.id, discount=discount))
    order.discount = discount
    order.promo_code = promo.code
    order.total = money(order.total) - discount
    return discount


async def release(session: AsyncSession, order: Order) -> None:
    """Give the activation back when an unpaid order is cancelled or expires."""
    if not order.promo_code:
        return
    res = await session.execute(
        delete(PromoRedemption).where(PromoRedemption.order_id == order.id).returning(PromoRedemption.promo_id)
    )
    promo_id = res.scalar_one_or_none()
    if promo_id is not None:
        await session.execute(
            update(PromoCode).where(PromoCode.id == promo_id, PromoCode.used_count > 0)
            .values(used_count=PromoCode.used_count - 1)
        )

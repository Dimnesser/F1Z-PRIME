"""Inventory: stock counters, encrypted deliverable units, reservations and stock history.

Concurrency: callers lock the product row (SELECT ... FOR UPDATE) before changing stock; units are taken with
FOR UPDATE SKIP LOCKED, so two orders can never reserve or receive the same unit.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InventoryItem, Order, Product, StockMovement
from app.services import crypto
from app.services.common import ServiceError, utcnow

MAX_UNITS_PER_IMPORT = 5000
MAX_SECRET_LEN = 2000


def record(
    session: AsyncSession, product: Product, delta: int, reason: str, *, actor: str = "system", note: str = "",
    order_id: int | None = None,
) -> None:
    session.add(
        StockMovement(
            product_id=product.id, delta=delta, stock_after=product.stock, reason=reason, note=note[:255],
            actor=actor[:64], order_id=order_id,
        )
    )


async def reserve_units(session: AsyncSession, product: Product, order: Order, qty: int) -> None:
    """Attach `qty` available units to the order (status reserved). Product row must be locked."""
    ids = (
        await session.scalars(
            select(InventoryItem.id)
            .where(InventoryItem.product_id == product.id, InventoryItem.status == "available")
            .order_by(InventoryItem.id)
            .limit(qty)
            .with_for_update(skip_locked=True)
        )
    ).all()
    if len(ids) < qty:
        raise ServiceError("Недостаточно товара в наличии", 409, "out_of_stock")
    for item in (await session.scalars(select(InventoryItem).where(InventoryItem.id.in_(ids)))).all():
        item.status, item.order_id, item.reserved_at = "reserved", order.id, utcnow()


async def release_units(session: AsyncSession, order: Order) -> int:
    items = (
        await session.scalars(
            select(InventoryItem)
            .where(InventoryItem.order_id == order.id, InventoryItem.status == "reserved")
            .with_for_update()
        )
    ).all()
    for item in items:
        item.status, item.order_id, item.reserved_at = "available", None, None
    return len(items)


async def sell_units(session: AsyncSession, order: Order, product: Product) -> list[InventoryItem]:
    """Mark the order's units as sold (idempotent: already-sold units are returned as they are)."""
    items = list(
        (
            await session.scalars(
                select(InventoryItem)
                .where(InventoryItem.order_id == order.id, InventoryItem.status.in_(["reserved", "sold"]))
                .order_by(InventoryItem.id)
                .with_for_update()
            )
        ).all()
    )
    missing = order.quantity - len(items)
    if missing > 0:
        # e.g. units imported after the order was created: take free ones now (product row is locked by caller)
        extra = (
            await session.scalars(
                select(InventoryItem)
                .where(InventoryItem.product_id == product.id, InventoryItem.status == "available")
                .order_by(InventoryItem.id)
                .limit(missing)
                .with_for_update(skip_locked=True)
            )
        ).all()
        if len(extra) < missing:
            raise ServiceError("Нет свободных единиц товара для выдачи", 409, "no_units")
        product.stock = max(0, product.stock - len(extra))
        record(session, product, -len(extra), "sold_extra", order_id=order.id, note="единицы взяты при выдаче")
        items += list(extra)
    now = utcnow()
    for item in items:
        if item.status != "sold":
            item.status, item.order_id, item.sold_at = "sold", order.id, now
    return items


def delivered_secrets(items: list[InventoryItem]) -> list[str]:
    return [crypto.decrypt(i.secret_enc) for i in items]


async def add_units(
    session: AsyncSession, product: Product, secrets: list[str], *, actor: str, batch: str | None = None
) -> dict:
    """Import units. Duplicates (same secret already stored for this product) are skipped. Product row locked."""
    cleaned: list[str] = []
    invalid = 0
    seen: set[str] = set()
    for raw in secrets:
        s = crypto.normalize(raw)
        if not s:
            continue
        if len(s) > MAX_SECRET_LEN:
            invalid += 1
            continue
        if s in seen:
            continue
        seen.add(s)
        cleaned.append(s)
    if len(cleaned) > MAX_UNITS_PER_IMPORT:
        raise ServiceError(f"За раз можно загрузить не более {MAX_UNITS_PER_IMPORT} единиц")
    added = 0
    for s in cleaned:
        res = await session.execute(
            pg_insert(InventoryItem)
            .values(product_id=product.id, secret_enc=crypto.encrypt(s), fingerprint=crypto.fingerprint(s),
                    label=crypto.mask(s), status="available", batch=batch)
            .on_conflict_do_nothing(constraint="uq_inventory_product_fingerprint")
            .returning(InventoryItem.id)
        )
        if res.scalar_one_or_none() is not None:
            added += 1
    if added:
        product.stock += added
        record(session, product, added, "import", actor=actor, note=f"загружено единиц: {added}")
    return {"added": added, "duplicates": len(cleaned) - added, "invalid": invalid}


async def counts(session: AsyncSession, product_ids: list[int]) -> dict[int, dict[str, int]]:
    rows = (
        await session.execute(
            select(InventoryItem.product_id, InventoryItem.status, func.count(InventoryItem.id))
            .where(InventoryItem.product_id.in_(product_ids))
            .group_by(InventoryItem.product_id, InventoryItem.status)
        )
    ).all()
    out: dict[int, dict[str, int]] = {}
    for pid, status, n in rows:
        out.setdefault(pid, {})[status] = n
    return out


async def available_count(session: AsyncSession, product_id: int) -> int:
    return await session.scalar(
        select(func.count(InventoryItem.id)).where(
            InventoryItem.product_id == product_id, InventoryItem.status == "available"
        )
    ) or 0


async def adjust_stock(session: AsyncSession, product: Product, new_stock: int, *, reason: str, actor: str) -> None:
    """Manual stock correction (requires a reason). Inventory-backed products are counted from units instead."""
    if product.uses_inventory:
        raise ServiceError("Остаток этого товара считается по загруженным единицам. Добавьте или спишите единицы.", 409)
    if not reason or len(reason.strip()) < 3:
        raise ServiceError("Укажите причину корректировки остатка", 422)
    if new_stock < 0:
        raise ServiceError("Остаток не может быть отрицательным", 422)
    delta = new_stock - product.stock
    if delta == 0:
        return
    product.stock = new_stock
    record(session, product, delta, "manual", actor=actor, note=reason.strip())


async def void_unit(session: AsyncSession, product: Product, item_id: int, *, actor: str) -> None:
    item = await session.scalar(
        select(InventoryItem).where(InventoryItem.id == item_id, InventoryItem.product_id == product.id).with_for_update()
    )
    if item is None:
        raise ServiceError("Единица не найдена", 404)
    if item.status != "available":
        raise ServiceError("Списать можно только свободную единицу", 409)
    item.status = "void"
    product.stock = max(0, product.stock - 1)
    record(session, product, -1, "void", actor=actor, note=f"списана единица #{item.id}")

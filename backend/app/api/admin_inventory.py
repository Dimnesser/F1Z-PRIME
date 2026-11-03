"""Admin: deliverable inventory units (encrypted keys/vouchers) and stock history.

Secrets are write-only for staff: the panel shows a masked label, never the decrypted value. The buyer sees
the value in the Mini App only after the order is delivered.
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.admin import csv_response
from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import InventoryItem, Product, StockMovement
from app.services import inventory
from app.services.common import ServiceError, lock, log_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

UNIT_STATUSES = ("available", "reserved", "sold", "void")


class UnitsIn(BaseModel):
    # one unit per line; blank lines are ignored, duplicates are skipped
    units: str = Field(min_length=1, max_length=2_000_000)
    batch: str | None = Field(default=None, max_length=64)


class StockAdjustIn(BaseModel):
    stock: int = Field(ge=0, le=1_000_000)
    reason: str = Field(min_length=3, max_length=200)


async def _product(session: SessionDep, product_id: int, *, for_update: bool = False) -> Product:
    product = await (lock(session, Product, product_id) if for_update else session.get(Product, product_id))
    if product is None:
        raise ServiceError("Товар не найден", 404, "not_found")
    return product


def _unit_out(i: InventoryItem) -> dict:
    return {
        "id": i.id, "label": i.label, "status": i.status, "order_id": i.order_id, "batch": i.batch,
        "created_at": i.created_at, "sold_at": i.sold_at,
    }


@router.get("/inventory/summary")
async def inventory_summary(_: P("products.view"), session: SessionDep) -> list[dict]:
    products = (
        await session.scalars(select(Product).where(Product.uses_inventory.is_(True)).order_by(Product.title))
    ).unique().all()
    counts = await inventory.counts(session, [p.id for p in products])
    return [
        {"product_id": p.id, "title": p.title, "stock": p.stock, "fulfillment_mode": p.fulfillment_mode,
         **{s: counts.get(p.id, {}).get(s, 0) for s in UNIT_STATUSES}}
        for p in products
    ]


@router.get("/products/{product_id}/inventory")
async def list_units(
    product_id: int, _: P("products.view"), session: SessionDep,
    status: str | None = Query(None, pattern="^(available|reserved|sold|void)$"),
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
) -> dict:
    product = await _product(session, product_id)
    stmt = select(InventoryItem).where(InventoryItem.product_id == product.id)
    if status:
        stmt = stmt.where(InventoryItem.status == status)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await session.scalars(stmt.order_by(InventoryItem.id.desc()).offset((page - 1) * size).limit(size))).all()
    counts = (await inventory.counts(session, [product.id])).get(product.id, {})
    return {
        "items": [_unit_out(i) for i in rows], "total": total,
        "counts": {s: counts.get(s, 0) for s in UNIT_STATUSES},
        "uses_inventory": product.uses_inventory, "stock": product.stock,
    }


@router.post("/products/{product_id}/inventory")
async def add_units(product_id: int, body: UnitsIn, admin: P("products.stock"), session: SessionDep) -> dict:
    product = await _product(session, product_id, for_update=True)
    if not product.uses_inventory:
        raise ServiceError("Включите у товара «Выдача из загруженных единиц», чтобы загружать ключи", 409)
    result = await inventory.add_units(
        session, product, body.units.splitlines(), actor=str(admin), batch=(body.batch or "").strip() or None
    )
    # only counts go to the audit log — never the secrets
    log_admin(session, str(admin), "inventory_import", "product", product.id, **result)
    await session.commit()
    return {**result, "stock": product.stock}


@router.post("/products/{product_id}/inventory/{item_id}/void")
async def void_unit(product_id: int, item_id: int, admin: P("products.stock"), session: SessionDep) -> dict:
    product = await _product(session, product_id, for_update=True)
    await inventory.void_unit(session, product, item_id, actor=str(admin))
    log_admin(session, str(admin), "inventory_void", "product", product.id, item_id=item_id)
    await session.commit()
    return {"ok": True, "stock": product.stock}


@router.post("/products/{product_id}/stock")
async def adjust_stock(product_id: int, body: StockAdjustIn, admin: P("products.stock"), session: SessionDep) -> dict:
    product = await _product(session, product_id, for_update=True)
    old = product.stock
    await inventory.adjust_stock(session, product, body.stock, reason=body.reason, actor=str(admin))
    log_admin(session, str(admin), "stock_adjust", "product", product.id, old=old, new=product.stock, reason=body.reason)
    await session.commit()
    return {"ok": True, "stock": product.stock}


@router.get("/products/{product_id}/stock-history")
async def stock_history(
    product_id: int, _: P("products.view"), session: SessionDep, limit: int = Query(100, ge=1, le=500)
) -> list[dict]:
    await _product(session, product_id)
    rows = (
        await session.scalars(
            select(StockMovement).where(StockMovement.product_id == product_id)
            .order_by(StockMovement.id.desc()).limit(limit)
        )
    ).all()
    return [
        {"id": m.id, "delta": m.delta, "stock_after": m.stock_after, "reason": m.reason, "note": m.note,
         "actor": m.actor, "order_id": m.order_id, "created_at": m.created_at}
        for m in rows
    ]


@router.get("/products/{product_id}/inventory/export.csv")
async def export_units(product_id: int, _: P("products.import"), session: SessionDep) -> Response:
    """Masked labels and statuses only (for reconciliation). Secrets are never exported."""
    product = await _product(session, product_id)
    rows = (
        await session.scalars(select(InventoryItem).where(InventoryItem.product_id == product.id).order_by(InventoryItem.id))
    ).all()
    return csv_response(
        f"inventory-{product.id}.csv", ["id", "label", "status", "order_id", "batch", "created_at"],
        [[i.id, i.label, i.status, i.order_id, i.batch, i.created_at] for i in rows],
    )

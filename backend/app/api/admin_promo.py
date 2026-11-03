"""Admin: promo codes (permission promo.manage). Validation and application happen in services/promo.py."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import Order, PromoCode, PromoRedemption, User
from app.services import promo as promo_service
from app.services.common import log_admin, utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])


class PromoIn(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    kind: Literal["percent", "fixed"]
    value: Decimal = Field(gt=0, le=1_000_000, decimal_places=2)
    min_total: Decimal | None = Field(default=None, gt=0, le=1_000_000)
    max_discount: Decimal | None = Field(default=None, gt=0, le=1_000_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1, le=1_000_000)
    max_uses_per_user: int = Field(default=1, ge=1, le=1000)
    product_ids: list[int] = Field(default_factory=list, max_length=200)
    categories: list[str] = Field(default_factory=list, max_length=50)
    first_order_only: bool = False
    is_active: bool = True
    note: str = Field(default="", max_length=255)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = promo_service.normalize(v)
        if not promo_service.CODE_RE.match(v):
            raise ValueError("код: 3–32 символа A–Z, 0–9, _ и -")
        return v


class PromoPatch(BaseModel):
    value: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=2)
    min_total: Decimal | None = Field(default=None, gt=0, le=1_000_000)
    max_discount: Decimal | None = Field(default=None, gt=0, le=1_000_000)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1, le=1_000_000)
    max_uses_per_user: int | None = Field(default=None, ge=1, le=1000)
    product_ids: list[int] | None = Field(default=None, max_length=200)
    categories: list[str] | None = Field(default=None, max_length=50)
    first_order_only: bool | None = None
    is_active: bool | None = None
    note: str | None = Field(default=None, max_length=255)


NULLABLE = {"min_total", "max_discount", "starts_at", "ends_at", "max_uses"}


def _validate(kind: str, value: Decimal, starts_at: datetime | None, ends_at: datetime | None) -> None:
    if kind == "percent" and value > 95:
        raise HTTPException(422, "Скидка в процентах — не более 95%")
    if starts_at and ends_at and starts_at >= ends_at:
        raise HTTPException(422, "Окончание действия должно быть позже начала")


def _num(v: Decimal | int | None) -> float | None:
    return None if v is None else float(v)


def _out(p: PromoCode, stats: dict | None = None) -> dict:
    now = utcnow()
    state = "active"
    if not p.is_active:
        state = "disabled"
    elif p.ends_at and p.ends_at <= now:
        state = "expired"
    elif p.starts_at and p.starts_at > now:
        state = "scheduled"
    elif p.max_uses is not None and p.used_count >= p.max_uses:
        state = "exhausted"
    return {
        "id": p.id, "code": p.code, "kind": p.kind, "value": _num(p.value), "min_total": _num(p.min_total),
        "max_discount": _num(p.max_discount), "starts_at": p.starts_at, "ends_at": p.ends_at, "max_uses": p.max_uses,
        "max_uses_per_user": p.max_uses_per_user, "used_count": p.used_count, "product_ids": p.product_ids or [],
        "categories": p.categories or [], "first_order_only": p.first_order_only, "is_active": p.is_active,
        "note": p.note, "created_by": p.created_by, "created_at": p.created_at, "state": state,
        "discount_total": _num((stats or {}).get("discount", 0)), "paid_orders": (stats or {}).get("paid", 0),
    }


async def _stats(session: SessionDep) -> dict[int, dict]:
    rows = (
        await session.execute(
            select(PromoRedemption.promo_id, func.coalesce(func.sum(PromoRedemption.discount), 0), func.count(Order.id))
            .join(Order, Order.id == PromoRedemption.order_id)
            .where(Order.paid_at.is_not(None))
            .group_by(PromoRedemption.promo_id)
        )
    ).all()
    return {pid: {"discount": d, "paid": n} for pid, d, n in rows}


@router.get("/promo-codes")
async def list_promo(_: P("promo.manage"), session: SessionDep) -> list[dict]:
    stats = await _stats(session)
    rows = (await session.scalars(select(PromoCode).order_by(PromoCode.id.desc()))).all()
    return [_out(p, stats.get(p.id)) for p in rows]


@router.post("/promo-codes", status_code=201)
async def create_promo(body: PromoIn, admin: P("promo.manage"), session: SessionDep) -> dict:
    _validate(body.kind, body.value, body.starts_at, body.ends_at)
    if await session.scalar(select(PromoCode.id).where(PromoCode.code == body.code)):
        raise HTTPException(409, "Такой промокод уже есть")
    promo = PromoCode(**body.model_dump(), created_by=str(admin))
    session.add(promo)
    await session.flush()
    log_admin(session, admin, "create", "promo", promo.id, **body.model_dump())
    await session.commit()
    return _out(promo)


@router.patch("/promo-codes/{promo_id}")
async def update_promo(promo_id: int, body: PromoPatch, admin: P("promo.manage"), session: SessionDep) -> dict:
    promo = await session.scalar(select(PromoCode).where(PromoCode.id == promo_id).with_for_update())
    if promo is None:
        raise HTTPException(404, "Промокод не найден")
    changes = body.model_dump(exclude_unset=True)
    _validate(promo.kind, changes.get("value") or promo.value, changes.get("starts_at", promo.starts_at),
              changes.get("ends_at", promo.ends_at))
    before = {k: getattr(promo, k) for k in changes}
    for k, v in changes.items():
        if v is None and k not in NULLABLE:
            continue
        setattr(promo, k, v)
    log_admin(session, admin, "update", "promo", promo.id, before=before, after=changes)
    await session.commit()
    return _out(promo)


@router.delete("/promo-codes/{promo_id}")
async def delete_promo(promo_id: int, admin: P("promo.manage"), session: SessionDep) -> dict:
    """A code that was already used is only disabled (orders keep their history)."""
    promo = await session.get(PromoCode, promo_id)
    if promo is None:
        raise HTTPException(404, "Промокод не найден")
    used = await session.scalar(select(func.count(PromoRedemption.id)).where(PromoRedemption.promo_id == promo_id))
    if used:
        promo.is_active = False
        log_admin(session, admin, "disable", "promo", promo_id, code=promo.code)
        await session.commit()
        return {"deleted": False, "disabled": True}
    await session.delete(promo)
    log_admin(session, admin, "delete", "promo", promo_id, code=promo.code)
    await session.commit()
    return {"deleted": True}


@router.get("/promo-codes/{promo_id}/redemptions")
async def promo_redemptions(
    promo_id: int, _: P("promo.manage"), session: SessionDep, limit: int = Query(100, ge=1, le=500)
) -> list[dict]:
    rows = (
        await session.execute(
            select(PromoRedemption, Order, User)
            .join(Order, Order.id == PromoRedemption.order_id)
            .join(User, User.id == PromoRedemption.user_id)
            .where(PromoRedemption.promo_id == promo_id)
            .order_by(PromoRedemption.id.desc())
            .limit(limit)
        )
    ).unique().all()
    return [
        {"order_id": o.id, "public_id": o.public_id, "status": o.status.value, "discount": _num(r.discount),
         "total": _num(o.total), "user": u.username or str(u.telegram_id), "created_at": r.created_at}
        for r, o, u in rows
    ]

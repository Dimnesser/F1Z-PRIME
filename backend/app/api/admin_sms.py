"""Admin: SMS-activations — monitoring, the RECONCILIATION_REQUIRED queue, manual resolve, catalog/profit.

Markups themselves are edited through the existing settings endpoint (keys sms_*). All manual money-moving
actions here go through sms.cancel → the shared ledger (refund-once) and are journaled.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import OwnedSmsNumber, SmsActivation
from app.services import sms
from app.services.common import lock, log_admin, money

router = APIRouter(prefix="/api/admin/sms", tags=["admin"])


@router.get("/activations")
async def list_activations(
    _: P("orders.view"), session: SessionDep,
    status: str | None = Query(None, max_length=32),
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
) -> dict:
    stmt = select(SmsActivation)
    if status == "active":
        stmt = stmt.where(SmsActivation.status.in_(sms.ACTIVE))
    elif status:
        stmt = stmt.where(SmsActivation.status == status)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await session.scalars(
        stmt.order_by(SmsActivation.id.desc()).offset((page - 1) * size).limit(size)
    )).all()
    return {"total": total, "items": [{**sms.out(a), "provider_cost": float(a.provider_cost),
                                       "chat_id": a.chat_id} for a in rows]}


@router.get("/summary")
async def summary(_: P("orders.view"), session: SessionDep) -> dict:
    by_status = dict((s, n) for s, n in (await session.execute(
        select(SmsActivation.status, func.count(SmsActivation.id)).group_by(SmsActivation.status)
    )).all())
    revenue, our_cost = (await session.execute(
        select(func.coalesce(func.sum(SmsActivation.cost), 0), func.coalesce(func.sum(SmsActivation.provider_cost), 0))
        .where(SmsActivation.status == "COMPLETED")
    )).one()
    refunded = await session.scalar(
        select(func.coalesce(func.sum(SmsActivation.cost), 0)).where(SmsActivation.refunded.is_(True))
    ) or 0
    return {
        "by_status": by_status,
        "reconciliation_required": by_status.get("RECONCILIATION_REQUIRED", 0),
        "active": sum(by_status.get(s, 0) for s in sms.ACTIVE),
        "completed": by_status.get("COMPLETED", 0),
        "revenue": float(revenue or 0), "provider_cost": float(our_cost or 0),
        "profit": float((revenue or 0) - (our_cost or 0)), "refunded": float(refunded),
    }


@router.get("/catalog")
async def catalog(_: P("products.stock"), session: SessionDep) -> dict:
    """Provider catalog with cost / resolved price / profit / why-not-sellable (for markup tuning)."""
    try:
        return await sms.admin_catalog(session)
    except (sms.ProviderTimeout, sms.ProviderError):
        raise HTTPException(503, "Провайдер недоступен")


class ReconcileIn(BaseModel):
    action: str = Field(pattern=r"^(bind|cancel)$")
    activation_id: str | None = Field(default=None, max_length=64)  # provider id to bind when action=bind


@router.post("/activations/{row_id}/reconcile")
async def reconcile(row_id: int, body: ReconcileIn, admin: P("orders.fulfill"), session: SessionDep) -> dict:
    """Resolve a RECONCILIATION_REQUIRED row: bind it to a confirmed provider activation, or cancel+refund."""
    act = await lock(session, SmsActivation, row_id)
    if act is None:
        raise HTTPException(404, "Активация не найдена")
    if act.status != "RECONCILIATION_REQUIRED":
        raise HTTPException(409, "Эта активация не требует сверки")
    if body.action == "bind":
        if not body.activation_id:
            raise HTTPException(422, "Нужен provider activation_id")
        act.activation_id = body.activation_id
        act.status = "WAITING"
        sms._log(act, "reconciled_manual", by=str(admin), activation_id=body.activation_id)
        log_admin(session, admin, "sms_reconcile_bind", "sms_activation", row_id, activation_id=body.activation_id)
    else:
        act.status = "CANCELLED"
        sms._log(act, "reconciled_cancel", by=str(admin))
        await sms._refund_once(session, act, "ручная сверка: отмена")
        log_admin(session, admin, "sms_reconcile_cancel", "sms_activation", row_id)
    await session.commit()
    return sms.out(act)


@router.post("/activations/{row_id}/cancel")
async def admin_cancel(row_id: int, admin: P("orders.fulfill"), session: SessionDep) -> dict:
    res = await sms.cancel(session, row_id, actor=str(admin))
    log_admin(session, admin, "sms_cancel", "sms_activation", row_id)
    await session.commit()
    return sms.out(res)


# ---------------------------------------------------------------- owned-number pool (operator's own numbers)


class PoolAddIn(BaseModel):
    phones: str = Field(min_length=3, max_length=200_000)  # one E.164 number per line
    country_iso2: str = Field(default="", max_length=2)
    service: str = Field(default="", max_length=32)
    price: float = Field(ge=0)
    note: str = Field(default="", max_length=255)


class PoolPatchIn(BaseModel):
    is_active: bool | None = None
    price: float | None = Field(default=None, ge=0)


@router.get("/pool")
async def pool_list(_: P("products.view"), session: SessionDep,
                    country: str | None = Query(None, max_length=2),
                    available: bool | None = None,
                    page: int = Query(1, ge=1), size: int = Query(100, ge=1, le=500)) -> dict:
    stmt = select(OwnedSmsNumber)
    if country:
        stmt = stmt.where(OwnedSmsNumber.country_iso2 == country.upper())
    if available is True:
        stmt = stmt.where(OwnedSmsNumber.is_active.is_(True), OwnedSmsNumber.in_use.is_(False))
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await session.scalars(stmt.order_by(OwnedSmsNumber.id.desc()).offset((page - 1) * size).limit(size))).all()
    return {"total": total, "items": [
        {"id": n.id, "phone_e164": n.phone_e164, "country_iso2": n.country_iso2, "service": n.service,
         "price": float(n.price), "is_active": n.is_active, "in_use": n.in_use, "times_used": n.times_used,
         "note": n.note} for n in rows]}


@router.post("/pool")
async def pool_add(body: PoolAddIn, admin: P("products.stock"), session: SessionDep) -> dict:
    from app.services import phones as phones_service

    lines = [ln.strip() for ln in body.phones.splitlines() if ln.strip()]
    added = duplicates = invalid = 0
    seen: set[str] = set()
    for raw in lines[:5000]:
        norm = phones_service.normalize_raw(raw)
        if not norm or len(norm) < 6:
            invalid += 1
            continue
        if norm in seen:
            duplicates += 1
            continue
        seen.add(norm)
        exists = await session.scalar(select(OwnedSmsNumber.id).where(OwnedSmsNumber.phone_e164 == norm))
        if exists:
            duplicates += 1
            continue
        session.add(OwnedSmsNumber(phone_e164=norm, country_iso2=body.country_iso2.upper(), service=body.service,
                                   price=money(body.price), added_by=str(admin)[:64], note=body.note))
        added += 1
    log_admin(session, admin, "sms_pool_add", "owned_sms", None, added=added, duplicates=duplicates, invalid=invalid)
    await session.commit()
    return {"added": added, "duplicates": duplicates, "invalid": invalid}


@router.patch("/pool/{number_id}")
async def pool_patch(number_id: int, body: PoolPatchIn, admin: P("products.stock"), session: SessionDep) -> dict:
    num = await lock(session, OwnedSmsNumber, number_id)
    if num is None:
        raise HTTPException(404, "Номер не найден")
    if body.is_active is not None:
        num.is_active = body.is_active
    if body.price is not None:
        num.price = money(body.price)
    log_admin(session, admin, "sms_pool_patch", "owned_sms", number_id)
    await session.commit()
    return {"id": num.id, "is_active": num.is_active, "price": float(num.price)}


@router.delete("/pool/{number_id}")
async def pool_delete(number_id: int, admin: P("products.stock"), session: SessionDep) -> dict:
    num = await lock(session, OwnedSmsNumber, number_id)
    if num is None:
        raise HTTPException(404, "Номер не найден")
    if num.in_use:
        raise HTTPException(409, "Номер сейчас арендован — дождитесь завершения активации")
    await session.delete(num)
    log_admin(session, admin, "sms_pool_delete", "owned_sms", number_id)
    await session.commit()
    return {"deleted": True}

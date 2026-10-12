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
from app.models import SmsActivation
from app.services import sms
from app.services.common import lock, log_admin

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

"""Two-person rule: money operations above the requester's role limit wait for the owner or an approver
(permission refunds.approve). The approver can't be the requester. Execution re-runs every server check."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ApprovalRequest
from app.services import inbox
from app.services.common import ServiceError, money, utcnow

KINDS = {"refund": "Возврат", "payment_confirm": "Подтверждение платежа"}


async def create(
    session: AsyncSession, kind: str, payload: dict[str, Any], amount: Decimal, summary: str, actor: str
) -> ApprovalRequest:
    dup = await session.scalar(
        select(ApprovalRequest).where(ApprovalRequest.kind == kind, ApprovalRequest.status == "pending",
                                      ApprovalRequest.summary == summary[:255])
    )
    if dup is not None:
        return dup
    req = ApprovalRequest(kind=kind, payload=payload, amount=money(amount), summary=summary[:255], requested_by=actor[:64])
    session.add(req)
    await session.flush()
    await inbox.notify_permission(
        session, "refunds.approve", "approval", f"Нужно одобрение: {KINDS.get(kind, kind)} на {money(amount)} грн",
        f"{summary}\nЗапросил: {actor}", link="/team?tab=approvals",
    )
    return req


async def decide(session: AsyncSession, req_id: int, approve: bool, actor_label: str, note: str = "") -> ApprovalRequest:
    from app.services import payments as payment_service
    from app.services import refunds

    req = await session.scalar(select(ApprovalRequest).where(ApprovalRequest.id == req_id).with_for_update())
    if req is None:
        raise ServiceError("Запрос не найден", 404)
    if req.status != "pending":
        raise ServiceError("Запрос уже рассмотрен", 409)
    if req.requested_by == actor_label:
        raise ServiceError("Нельзя одобрить собственный запрос", 403)
    req.decided_by, req.decided_at, req.decision_note = actor_label[:64], utcnow(), note[:255] or None
    if not approve:
        req.status = "rejected"
        return req
    if req.kind == "refund":
        await refunds.start(session, int(req.payload["order_id"]), req.payload["method"], req.payload["reason"],
                            f"{req.requested_by} ✓ {actor_label}")
        req.result = "возврат запущен"
    elif req.kind == "payment_confirm":
        payment, new = await payment_service.confirm_payment(
            session, int(req.payload["payment_id"]), actor=f"admin:{req.requested_by}+{actor_label}"
        )
        req.result = "платёж подтверждён" if new else "платёж уже был подтверждён"
    req.status = "approved"
    return req

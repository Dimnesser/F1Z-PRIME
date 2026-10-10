"""Incidents: items that need a human (payment mismatch, failed delivery, stuck order, dead job, refund failure)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Incident
from app.services.common import utcnow


async def open_incident(
    session: AsyncSession,
    kind: str,
    title: str,
    *,
    severity: str = "warning",
    order_id: int | None = None,
    payment_id: int | None = None,
    details: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
) -> bool:
    """Creates an incident; with dedupe_key a still-recorded incident is not duplicated. Returns True if new."""
    stmt = pg_insert(Incident).values(
        kind=kind, title=title[:200], severity=severity, order_id=order_id, payment_id=payment_id,
        details=details or {}, dedupe_key=dedupe_key, status="open",
    )
    if dedupe_key:
        stmt = stmt.on_conflict_do_nothing(index_elements=[Incident.dedupe_key])
    res = await session.execute(stmt.returning(Incident.id))
    return res.scalar_one_or_none() is not None


async def resolve_for_order(session: AsyncSession, order_id: int, kinds: list[str], actor: str) -> None:
    await session.execute(
        update(Incident)
        .where(Incident.order_id == order_id, Incident.kind.in_(kinds), Incident.status == "open")
        .values(status="resolved", resolved_at=utcnow(), resolved_by=actor[:64])
    )

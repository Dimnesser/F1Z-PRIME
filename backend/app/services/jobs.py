"""Durable job queue on PostgreSQL (no extra infrastructure).

- enqueue() is called inside the business transaction, so a job exists iff the change committed.
- claim() uses FOR UPDATE SKIP LOCKED: several workers never take the same job.
- failures retry with exponential backoff; after max_attempts the job is "dead" (dead-letter) + incident.
- jobs left "running" by a crashed/restarted worker are returned to the queue by recover_stale().
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job
from app.services.common import utcnow

log = logging.getLogger("f1z.jobs")

STALE_AFTER = timedelta(minutes=5)
BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX_SECONDS = 3600


async def enqueue(
    session: AsyncSession,
    kind: str,
    payload: dict[str, Any] | None = None,
    *,
    dedupe_key: str | None = None,
    delay_seconds: int = 0,
    max_attempts: int = 6,
    revive: bool = False,
) -> None:
    """Add a job. With dedupe_key an existing job is kept (idempotent); revive=True re-queues a finished/dead one."""
    values = {
        "kind": kind,
        "payload": payload or {},
        "status": "pending",
        "attempts": 0,
        "max_attempts": max_attempts,
        "run_at": utcnow() + timedelta(seconds=delay_seconds),
        "dedupe_key": dedupe_key,
    }
    stmt = pg_insert(Job).values(**values)
    if dedupe_key is None:
        await session.execute(stmt)
        return
    if revive:
        stmt = stmt.on_conflict_do_update(
            index_elements=[Job.dedupe_key],
            set_={"status": "pending", "attempts": 0, "run_at": values["run_at"], "last_error": None,
                  "finished_at": None, "payload": values["payload"]},
            where=Job.status.in_(["done", "dead"]),
        )
    else:
        stmt = stmt.on_conflict_do_nothing(index_elements=[Job.dedupe_key])
    await session.execute(stmt)


async def claim(session: AsyncSession, limit: int = 10) -> list[Job]:
    ids = (
        await session.scalars(
            select(Job.id)
            .where(Job.status == "pending", Job.run_at <= utcnow())
            .order_by(Job.run_at, Job.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).all()
    if not ids:
        return []
    await session.execute(
        update(Job).where(Job.id.in_(ids)).values(status="running", locked_at=utcnow(), attempts=Job.attempts + 1)
    )
    jobs = (await session.scalars(select(Job).where(Job.id.in_(ids)).execution_options(populate_existing=True))).all()
    await session.commit()
    return list(jobs)


async def mark_done(session: AsyncSession, job_id: int) -> None:
    await session.execute(update(Job).where(Job.id == job_id).values(status="done", finished_at=utcnow(), locked_at=None))


async def mark_failed(session: AsyncSession, job: Job, error: str) -> bool:
    """Returns True when the job is now dead (no more retries)."""
    dead = job.attempts >= job.max_attempts
    delay = min(BACKOFF_BASE_SECONDS * 2 ** max(0, job.attempts - 1), BACKOFF_MAX_SECONDS)
    await session.execute(
        update(Job)
        .where(Job.id == job.id)
        .values(
            status="dead" if dead else "pending",
            last_error=error[:500],
            locked_at=None,
            finished_at=utcnow() if dead else None,
            run_at=utcnow() + timedelta(seconds=delay),
        )
    )
    return dead


async def recover_stale(session: AsyncSession) -> int:
    """Jobs stuck in "running" (worker restarted mid-job) go back to the queue."""
    res = await session.execute(
        update(Job)
        .where(and_(Job.status == "running", Job.locked_at < utcnow() - STALE_AFTER))
        .values(status="pending", locked_at=None, run_at=utcnow())
    )
    return res.rowcount or 0

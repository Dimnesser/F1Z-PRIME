"""F1Z PRIME background worker (separate container: `entrypoint.sh worker`).

Jobs (table `jobs`, survive restarts):
  fulfill       — deliver a paid order (idempotent);
  tg_message    — send a Telegram message (customer/staff notifications);
  refund_stars  — refund a Telegram Stars payment via the official Bot API.
Periodic tasks (heartbeat in `task_runs`, interval kept across restarts):
  recover_jobs, expire_reservations, stuck_orders, payment_checks, low_stock, notification_outbox,
  backup, cleanup, daily_summary.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select, text, update

from app.config import get_settings
from app.db import dispose_engine, session_factory
from app.models import Incident, Job, NotificationOutbox, Order, OrderStatus, Payment, PaymentKind, PaymentMethod, PaymentStatus, Product, ProductStatus, TaskRun
from app.services import backup, fulfillment, incidents, jobs, monitor, notifications, refunds, sms, telegram
from app.services import settings as settings_service
from app.services.common import utcnow
from app.services.orders import expire_stale_orders

log = logging.getLogger("f1z.worker")


# ------------------------------------------------------------------ jobs


async def handle_fulfill(payload: dict) -> None:
    order_id = int(payload["order_id"])
    async with session_factory()() as session:
        try:
            result = await fulfillment.process(session, order_id)
            await session.commit()
            log.info("fulfill order %s -> %s", order_id, result)
        except fulfillment.FulfillmentError:
            await session.rollback()
            raise


async def handle_tg_message(payload: dict) -> None:
    chat_id = int(payload["chat_id"])
    body = {"chat_id": chat_id, "text": payload["text"], "parse_mode": "HTML", "disable_web_page_preview": True}
    if payload.get("reply_markup"):
        body["reply_markup"] = payload["reply_markup"]
    try:
        await telegram.call("sendMessage", body)
    except telegram.TelegramError as exc:
        msg = str(exc).lower()
        if exc.api and any(p in msg for p in telegram.PERMANENT_ERRORS):
            log.info("message to %s not deliverable: %s", chat_id, telegram.redact(exc))
            return  # user blocked the bot — retrying won't help
        if exc.api and "web_app" in msg:  # button not accepted in this chat: send plain text
            body.pop("reply_markup", None)
            await telegram.call("sendMessage", body)
            return
        raise


async def handle_refund_stars(payload: dict) -> None:
    async with session_factory()() as session:
        result = await refunds.execute_stars(session, int(payload["refund_id"]))
        await session.commit()
        log.info("refund %s -> %s", payload["refund_id"], result)


async def handle_rules(payload: dict) -> None:
    from app.services import rules

    async with session_factory()() as session:
        n = await rules.run_event(session, str(payload["event"]), int(payload["entity_id"]))
        await session.commit()
        log.info("rules for %s #%s: %s matched", payload["event"], payload["entity_id"], n)


HANDLERS: dict[str, Callable[[dict], Awaitable[None]]] = {
    "fulfill": handle_fulfill,
    "rules": handle_rules,
    "tg_message": handle_tg_message,
    "refund_stars": handle_refund_stars,
}


async def on_dead(job: Job, error: str) -> None:
    async with session_factory()() as session:
        if job.kind == "fulfill":
            await fulfillment.mark_failed(session, int(job.payload["order_id"]), error)
        else:
            await incidents.open_incident(
                session, "job_dead", f"Задача {job.kind} #{job.id} не выполнена после {job.attempts} попыток",
                severity="critical" if job.kind == "refund_stars" else "warning",
                details={"kind": job.kind, "error": error[:300]}, dedupe_key=f"job_dead:{job.id}",
            )
        await session.commit()


async def run_jobs(limit: int = 10) -> int:
    async with session_factory()() as session:
        batch = await jobs.claim(session, limit)
    for job in batch:
        handler = HANDLERS.get(job.kind)
        try:
            if handler is None:
                raise RuntimeError(f"unknown job kind {job.kind}")
            await handler(job.payload)
            async with session_factory()() as session:
                await jobs.mark_done(session, job.id)
                await session.commit()
        except Exception as exc:  # noqa: BLE001
            error = telegram.redact(f"{type(exc).__name__}: {exc}")
            log.warning("job %s %s failed (attempt %s): %s", job.id, job.kind, job.attempts, error)
            async with session_factory()() as session:
                dead = await jobs.mark_failed(session, job, error)
                await session.commit()
            if dead:
                await on_dead(job, error)
    return len(batch)


# --------------------------------------------------------- periodic tasks


async def task_recover_jobs() -> str:
    async with session_factory()() as session:
        n = await jobs.recover_stale(session)
        await session.commit()
    return f"recovered {n}"


async def task_expire_reservations() -> str:
    async with session_factory()() as session:
        if not await settings_service.get_bool(session, "expire_reservations"):
            return "disabled"
        n = await expire_stale_orders(session)
        await session.commit()
    return f"expired {n}"


async def task_stuck_orders() -> str:
    """Paid orders that are not delivered and not handed to a human for too long."""
    threshold = utcnow() - timedelta(minutes=15)
    async with session_factory()() as session:
        rows = (
            await session.scalars(
                select(Order).where(
                    Order.status.in_([OrderStatus.paid, OrderStatus.processing]),
                    Order.fulfillment_status.in_(["pending", "processing"]),
                    Order.paid_at < threshold,
                )
            )
        ).unique().all()
        for o in rows:
            # make sure a fulfill job exists (e.g. created before the worker existed) and flag the order
            await jobs.enqueue(session, "fulfill", {"order_id": o.id}, dedupe_key=f"fulfill:{o.id}")
            if await incidents.open_incident(
                session, "stuck_order", f"Заказ {o.public_id} оплачен, но не выдан более 15 минут", order_id=o.id,
                dedupe_key=f"stuck:{o.id}",
            ):
                await notifications.notify_staff(
                    session, "staff_incident", {"reason": f"Заказ {o.public_id} завис в выдаче"}, dedupe=f"stuck:{o.id}"
                )
        # manual tasks waiting > 2 hours: remind once
        old_manual = (
            await session.scalars(
                select(Order).where(
                    Order.status == OrderStatus.processing, Order.fulfillment_status.in_(["manual", "review", "failed"]),
                    Order.paid_at < utcnow() - timedelta(hours=2),
                )
            )
        ).unique().all()
        for o in old_manual:
            await incidents.open_incident(
                session, "manual_overdue", f"Заказ {o.public_id} ждёт оператора более 2 часов", order_id=o.id,
                dedupe_key=f"manual_overdue:{o.id}",
            )
        await session.commit()
    return f"stuck {len(rows)}, overdue {len(old_manual)}"


async def task_payment_checks() -> str:
    """Detect inconsistencies between payments and orders; cancel abandoned invoices."""
    found = 0
    async with session_factory()() as session:
        # confirmed order payment while the order is still unpaid -> should never happen
        bad = (
            await session.execute(
                select(Payment.id, Order.id, Order.public_id)
                .join(Order, Payment.order_id == Order.id)
                .where(Payment.kind == PaymentKind.order, Payment.status == PaymentStatus.confirmed,
                       Order.status == OrderStatus.pending)
            )
        ).all()
        for pid, oid, pub in bad:
            found += await incidents.open_incident(
                session, "payment_mismatch", f"Платёж #{pid} подтверждён, а заказ {pub} не оплачен", severity="critical",
                order_id=oid, payment_id=pid, dedupe_key=f"mismatch:{pid}",
            )
        # paid orders without any confirmed payment
        no_payment = (
            await session.execute(
                select(Order.id, Order.public_id).where(
                    Order.status.in_([OrderStatus.paid, OrderStatus.processing, OrderStatus.completed]),
                    ~select(Payment.id).where(Payment.order_id == Order.id, Payment.status == PaymentStatus.confirmed).exists(),
                )
            )
        ).all()
        for oid, pub in no_payment:
            found += await incidents.open_incident(
                session, "payment_mismatch", f"Заказ {pub} оплачен без подтверждённого платежа", severity="critical",
                order_id=oid, dedupe_key=f"nopay:{oid}",
            )
        # manual transfers waiting for review > 12h
        for p in (
            await session.scalars(
                select(Payment).where(Payment.status == PaymentStatus.awaiting_confirmation,
                                      Payment.updated_at < utcnow() - timedelta(hours=12))
            )
        ).unique().all():
            found += await incidents.open_incident(
                session, "payment_review_overdue", f"Перевод #{p.id} ждёт проверки более 12 часов", payment_id=p.id,
                order_id=p.order_id, dedupe_key=f"review_overdue:{p.id}",
            )
        # Stars invoices never paid within a day: close them (nothing was charged)
        await session.execute(
            update(Payment)
            .where(Payment.method == PaymentMethod.stars, Payment.status == PaymentStatus.pending,
                   Payment.created_at < utcnow() - timedelta(days=1))
            .values(status=PaymentStatus.cancelled, admin_comment="Счёт не оплачен за 24 часа")
        )
        await session.commit()
    return f"issues {found}"


_alerted_low: set[int] = set()
_alerted_out: set[int] = set()


async def task_low_stock() -> str:
    async with session_factory()() as session:
        if not await settings_service.get_bool(session, "low_stock_alerts"):
            return "disabled"
        threshold = int(await settings_service.get_value(session, "low_stock_threshold") or 5)
        products = (await session.scalars(select(Product).where(Product.status == ProductStatus.active))).unique().all()
        low = [p for p in products if 0 < p.stock <= threshold]
        out = [p for p in products if p.stock == 0]
        _alerted_low.intersection_update(p.id for p in low)
        _alerted_out.intersection_update(p.id for p in out)
        fresh_low = [p for p in low if p.id not in _alerted_low]
        fresh_out = [p for p in out if p.id not in _alerted_out]
        if fresh_low:
            lines = "\n".join(f"• {p.title}: {p.stock} шт." for p in fresh_low[:20])
            await notifications.notify_staff(session, "staff_low_stock", {"reason": f"Порог {threshold} шт.\n{lines}"})
        for p in fresh_out[:20]:
            await notifications.notify_staff(session, "staff_out_of_stock", {"product_name": p.title})
        _alerted_low.update(p.id for p in fresh_low)
        _alerted_out.update(p.id for p in fresh_out)
        await session.commit()
    return f"low {len(low)}, out {len(out)}"


async def task_outbox() -> str:
    async with session_factory()() as session:
        if not await settings_service.get_bool(session, "notification_retry"):
            return "disabled"
    r = await telegram.retry_outbox()
    return f"sent {r['sent']}, failed {r['failed']}"


_SMS_OWNER = f"{socket.gethostname()}:{os.getpid()}"


async def task_sms_poll() -> str:
    """Claim due SMS activations (lease), then poll each in its own transaction (zombie-safe via generation)."""
    async with session_factory()() as session:
        claimed = await sms.claim_due(session, _SMS_OWNER)
        work = [(a.id, a.lease_generation) for a in claimed]
        await session.commit()
    for aid, gen in work:
        async with session_factory()() as session:
            await sms.poll_one(session, aid, _SMS_OWNER, gen)
            await session.commit()
    return f"polled {len(work)}"


async def task_sms_outbox() -> str:
    """Deliver received SMS codes from the transactional outbox (UNKNOWN sends retried after an audit)."""
    async with session_factory()() as session:
        n = await sms.deliver_outbox(session)
        await session.commit()
    return f"delivered {n}"


async def task_sms_restore() -> str:
    """Recover SMS activations stranded by a crash (charged but never resolved) via safe reconciliation."""
    async with session_factory()() as session:
        n = await sms.restore_pending(session)
        await session.commit()
    return f"restored {n}"


async def task_backup() -> str:
    async with session_factory()() as session:
        if not await settings_service.get_bool(session, "auto_backup"):
            return "disabled"
        hours = int(await settings_service.get_value(session, "backup_interval_hours") or 24)
    age = backup.last_backup_age_hours()
    if age is not None and age < hours:
        return f"fresh ({age:.1f}h)"
    info = await backup.create_backup()
    return info["name"]


async def task_cleanup() -> str:
    async with session_factory()() as session:
        j = await session.execute(delete(Job).where(Job.status == "done", Job.finished_at < utcnow() - timedelta(days=14)))
        o = await session.execute(
            delete(NotificationOutbox).where(NotificationOutbox.status == "sent", NotificationOutbox.created_at < utcnow() - timedelta(days=14))
        )
        i = await session.execute(
            delete(Incident).where(Incident.status == "resolved", Incident.resolved_at < utcnow() - timedelta(days=60))
        )
        await session.commit()
    return f"jobs {j.rowcount}, outbox {o.rowcount}, incidents {i.rowcount}"


async def task_daily_summary() -> str:
    """Once a day after 09:00 (shop time): yesterday's numbers to the owner/finance."""
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("Europe/Kyiv")
    now = datetime.now(tz)
    if now.hour < 9:
        return "too early"
    day = (now - timedelta(days=1)).date()
    async with session_factory()() as session:
        if not await settings_service.get_bool(session, "daily_summary"):
            return "disabled"
        local = func.date(func.timezone("Europe/Kyiv", Order.paid_at))
        paid_statuses = [OrderStatus.paid, OrderStatus.processing, OrderStatus.completed]
        revenue, count = (
            await session.execute(
                select(func.coalesce(func.sum(Order.total), 0), func.count(Order.id))
                .where(Order.status.in_(paid_statuses), local == day)
            )
        ).one()
        created = await session.scalar(
            select(func.count(Order.id)).where(func.date(func.timezone("Europe/Kyiv", Order.created_at)) == day)
        )
        open_inc = await session.scalar(select(func.count(Incident.id)).where(Incident.status == "open"))
        text = (f"Оплачено заказов: {count} из {created}\nВыручка: {revenue} грн\n"
                f"Открытых инцидентов: {open_inc}")
        await notifications.notify_staff(
            session, "staff_daily_summary", {"date": day.strftime("%d.%m.%Y"), "reason": text}, dedupe=f"summary:{day}"
        )
        await session.commit()
    return f"summary {day}"


PERIODIC: list[tuple[str, int, Callable[[], Awaitable[str]]]] = [
    ("recover_jobs", 60, task_recover_jobs),
    ("expire_reservations", 60, task_expire_reservations),
    ("stuck_orders", 300, task_stuck_orders),
    ("payment_checks", 600, task_payment_checks),
    ("low_stock", 600, task_low_stock),
    ("sms_poll", 15, task_sms_poll),
    ("sms_outbox", 10, task_sms_outbox),
    ("sms_restore", 120, task_sms_restore),
    ("notification_outbox", 60, task_outbox),
    ("backup", 1800, task_backup),
    ("cleanup", 86400, task_cleanup),
    ("daily_summary", 1800, task_daily_summary),
]


async def run_periodic(force: bool = False) -> None:
    for name, interval, fn in PERIODIC:
        async with session_factory()() as session:
            row = await session.get(TaskRun, name)
            if row is None:
                row = TaskRun(name=name, runs=0, failures=0)
                session.add(row)
            due = force or row.last_started_at is None or (utcnow() - row.last_started_at).total_seconds() >= interval
            if not due:
                continue
            row.last_started_at = utcnow()
            await session.commit()
        started = time.monotonic()
        error = None
        try:
            result = await fn()
            log.debug("task %s: %s", name, result)
        except Exception as exc:  # noqa: BLE001
            error = telegram.redact(f"{type(exc).__name__}: {exc}")[:500]
            log.exception("task %s failed", name)
            await monitor.record("server", f"worker task {name}: {error}", "worker")
        async with session_factory()() as session:
            await session.execute(
                update(TaskRun).where(TaskRun.name == name).values(
                    runs=TaskRun.runs + 1,
                    failures=TaskRun.failures + (1 if error else 0),
                    last_error=error,
                    last_duration_ms=int((time.monotonic() - started) * 1000),
                    **({} if error else {"last_success_at": utcnow()}),
                )
            )
            await session.commit()


async def heartbeat() -> None:
    async with session_factory()() as session:
        row = await session.get(TaskRun, "worker")
        if row is None:
            session.add(TaskRun(name="worker", runs=1, failures=0, last_started_at=utcnow(), last_success_at=utcnow()))
        else:
            row.last_success_at = utcnow()
            row.runs += 1
        await session.commit()


async def main(install_signals: bool = True) -> None:
    s = get_settings()
    stop = asyncio.Event()
    if install_signals:  # standalone process; when embedded in the API, uvicorn owns logging and signals
        logging.basicConfig(level=s.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
        for noisy in ("httpx", "httpcore"):
            logging.getLogger(noisy).setLevel(logging.WARNING)
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, stop.set)
    async with session_factory()() as session:
        await session.execute(text("SELECT 1"))
    log.info("F1Z PRIME worker started")
    async with session_factory()() as session:
        await session.execute(
            update(TaskRun).where(TaskRun.name == "worker").values(last_started_at=utcnow())
        )
        await jobs.recover_stale(session)  # restart: return interrupted jobs to the queue right away
        await session.commit()
    last_periodic = 0.0
    last_beat = 0.0
    while not stop.is_set():
        try:
            n = await run_jobs()
            now = time.monotonic()
            if now - last_periodic >= 15:
                await run_periodic()
                last_periodic = now
            if now - last_beat >= 30:
                await heartbeat()
                last_beat = now
        except Exception:  # noqa: BLE001 - database restarts etc.: wait and continue
            log.exception("worker loop error")
            n = 0
            await asyncio.sleep(5)
        if n == 0:
            try:
                await asyncio.wait_for(stop.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass
    log.info("worker stopping")
    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())

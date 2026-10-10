"""Admin system endpoints: store settings, system health, automation center, incidents, jobs, templates, backups."""
from __future__ import annotations

import os
import re
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update

from app.api.deps import AdminDep, OwnerDep, SessionDep
from app.api.deps import perm as P
from app.config import get_settings
from app.models import (
    AdminUser,
    Incident,
    Job,
    NotificationOutbox,
    NotificationTemplate,
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
    PaymentStatus,
    Setting,
    TaskRun,
)
from app.schemas import SettingsUpdate
from app.services import backup, jobs, monitor, notifications
from app.services import settings as settings_service
from app.services import telegram
from app.services.common import log_admin, utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])


# ----------------------------------------------------------------- settings


def _need_for(key: str) -> str:
    group = settings_service.GROUP.get(key, "store")
    return {"automation": "system.automation", "notifications": "notifications.manage"}.get(group, "system.settings")


@router.get("/settings")
async def get_settings_values(admin: AdminDep, session: SessionDep) -> list[dict]:
    """Any staff member may read settings (they contain no secrets: tokens/passwords live only in .env)."""
    values = await settings_service.get_all(session)
    defaults = settings_service.DEFAULT_SETTINGS
    return [
        {
            "key": k,
            "value": v,
            "description": defaults[k][1],
            "is_public": defaults[k][2],
            "group": settings_service.GROUP.get(k, "store"),
            "type": settings_service.kind(k),
            "editable": admin.can(_need_for(k)),
            "restart_required": k in settings_service.RESTART_REQUIRED,
        }
        for k, v in values.items()
        if k in defaults
    ]


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin: AdminDep, session: SessionDep) -> list[dict]:
    clean: dict[str, str] = {}
    for key, value in body.values.items():
        if key in settings_service.DEFAULT_SETTINGS and not admin.can(_need_for(key)):
            raise HTTPException(403, f"Недостаточно прав для настройки «{settings_service.DEFAULT_SETTINGS[key][1]}»")
        try:
            clean[key] = settings_service.validate(key, value)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    current = await settings_service.get_all(session)
    merged = {**current, **clean}
    for lo_key, hi_key, label in (("min_topup", "max_topup", "пополнение"), ("min_order_total", "max_order_total", "сумма заказа")):
        lo, hi = float(merged.get(lo_key) or 0), float(merged.get(hi_key) or 0)
        if hi and lo > hi:
            raise HTTPException(422, f"Минимальное {label} больше максимального")
    changed: dict[str, dict[str, str]] = {}
    for key, value in clean.items():
        row = await session.get(Setting, key)
        _, desc, public = settings_service.DEFAULT_SETTINGS[key]
        old = row.value if row else settings_service.DEFAULT_SETTINGS[key][0]
        if old == value:
            continue
        changed[key] = {"from": old, "to": value}
        if row is None:
            session.add(Setting(key=key, value=value, description=desc, is_public=public))
        else:
            row.value = value
    if changed:
        log_admin(session, admin, "update", "settings", None, **changed)
    await session.commit()
    return await get_settings_values(admin, session)


# --------------------------------------------------------------- system/ops


async def _task_runs(session: SessionDep) -> dict[str, TaskRun]:
    return {t.name: t for t in (await session.scalars(select(TaskRun))).all()}


def _age(ts) -> float | None:  # noqa: ANN001
    return (utcnow() - ts).total_seconds() if ts else None


def _seen(row: TaskRun | None) -> str | None:
    return row.last_success_at.isoformat() if row and row.last_success_at else None


@router.get("/system/status")
async def system_status(admin: P("system.view"), session: SessionDep) -> dict:
    db_ok = True
    try:
        await session.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001
        db_ok = False
    runs = await _task_runs(session)
    worker, bot = runs.get("worker"), runs.get("bot")
    worker_age = _age(worker.last_success_at if worker else None)
    bot_age = _age(bot.last_success_at if bot else None)
    outbox = dict(
        (await session.execute(select(NotificationOutbox.status, func.count(NotificationOutbox.id))
                               .group_by(NotificationOutbox.status))).all()
    )
    job_counts = dict((await session.execute(select(Job.status, func.count(Job.id)).group_by(Job.status))).all())
    backups = backup.list_backups()
    s = get_settings()
    unprocessed = await session.scalar(
        select(func.count(Order.id)).where(
            Order.status.in_([OrderStatus.paid, OrderStatus.processing]), Order.fulfillment_status != "delivered"
        )
    )
    return {
        "version": os.environ.get("APP_VERSION", "unknown"),
        "environment": s.environment,
        "api": {"ok": True},
        "database": {"ok": db_ok},
        "worker": {"ok": worker_age is not None and worker_age < 120, "last_seen": _seen(worker)},
        "bot": {"ok": bot_age is not None and bot_age < 180, "last_seen": _seen(bot), "configured": bool(s.bot_token)},
        "maintenance": await settings_service.get_bool(session, "maintenance_mode"),
        "notifications": {"pending": outbox.get("pending", 0), "failed": outbox.get("failed", 0), "sent": outbox.get("sent", 0)},
        "jobs": {k: job_counts.get(k, 0) for k in ("pending", "running", "done", "dead")},
        "unprocessed_orders": unprocessed or 0,
        "open_incidents": await session.scalar(select(func.count(Incident.id)).where(Incident.status == "open")) or 0,
        "errors": monitor.stats(),
        "backups": {"count": len(backups), "last": backups[0] if backups else None},
        "payments": {
            "stars": {"enabled": await settings_service.get_bool(session, "stars_enabled"), "configured": bool(s.bot_token)},
            "manual": {"enabled": await settings_service.get_bool(session, "manual_enabled")},
        },
        "admin_notify_ids": len(s.admin_ids),
        "bot_configured": bool(s.bot_token),
    }


@router.get("/system/errors")
async def system_errors(admin: P("system.view"), limit: int = Query(100, ge=1, le=200)) -> list[dict]:
    return monitor.recent(limit)


@router.get("/system/notifications")
async def failed_notifications(
    admin: P("system.view"), session: SessionDep, status: str = Query("pending", pattern="^(pending|failed|sent)$")
) -> list[dict]:
    rows = (
        await session.scalars(
            select(NotificationOutbox).where(NotificationOutbox.status == status).order_by(NotificationOutbox.id.desc()).limit(100)
        )
    ).all()
    return [
        {"id": r.id, "chat_id": r.chat_id, "text": r.text[:300], "status": r.status, "attempts": r.attempts,
         "last_error": r.last_error, "created_at": r.created_at.isoformat(),
         "sent_at": r.sent_at.isoformat() if r.sent_at else None}
        for r in rows
    ]


@router.post("/system/notifications/retry")
async def retry_notifications(admin: P("system.automation"), session: SessionDep) -> dict:
    await session.execute(
        NotificationOutbox.__table__.update()
        .where(NotificationOutbox.status == "pending")
        .values(next_attempt_at=func.now())
    )
    await session.commit()
    result = await telegram.retry_outbox(limit=100)
    log_admin(session, admin, "retry", "notifications", None, **result)
    await session.commit()
    return result


# ----------------------------------------------------------- automation center


@router.get("/automation/overview")
async def automation_overview(admin: P("system.view"), session: SessionDep) -> dict:
    now = utcnow()
    month = now - timedelta(days=30)
    active = dict(
        (await session.execute(
            select(Order.status, func.count(Order.id))
            .where(Order.status.in_([OrderStatus.pending, OrderStatus.paid, OrderStatus.processing]))
            .group_by(Order.status)
        )).all()
    )
    fq = dict(
        (await session.execute(
            select(Order.fulfillment_status, func.count(Order.id))
            .where(Order.status.in_([OrderStatus.paid, OrderStatus.processing]))
            .group_by(Order.fulfillment_status)
        )).all()
    )
    overdue_reservations = await session.scalar(
        select(func.count(Order.id)).where(Order.status == OrderStatus.pending, Order.expires_at < now)
    )
    review = await session.scalar(select(func.count(Payment.id)).where(Payment.status == PaymentStatus.awaiting_confirmation))
    avg_seconds = await session.scalar(
        select(func.avg(func.extract("epoch", Order.delivered_at - Order.paid_at)))
        .where(Order.delivered_at.is_not(None), Order.paid_at.is_not(None), Order.paid_at > month)
    )
    delivered = await session.scalar(
        select(func.count(Order.id)).where(Order.fulfillment_status == "delivered", Order.paid_at > month)
    ) or 0
    auto_delivered = await session.scalar(
        select(func.count(func.distinct(OrderEvent.order_id))).where(
            OrderEvent.to_status == "completed", OrderEvent.actor.in_(["auto:fulfillment", "auto"]), OrderEvent.created_at > month
        )
    ) or 0
    retries = await session.scalar(
        select(func.coalesce(func.sum(Job.attempts - 1), 0)).where(Job.attempts > 1, Job.created_at > now - timedelta(days=1))
    )
    runs = await _task_runs(session)
    from app.worker import PERIODIC

    tasks = []
    for name, interval, _ in PERIODIC:
        r = runs.get(name)
        tasks.append({
            "name": name, "interval": interval,
            "last_started_at": r.last_started_at.isoformat() if r and r.last_started_at else None,
            "last_success_at": _seen(r), "last_error": r.last_error if r else None,
            "runs": r.runs if r else 0, "failures": r.failures if r else 0,
            "last_duration_ms": r.last_duration_ms if r else None,
        })
    worker = runs.get("worker")
    worker_age = _age(worker.last_success_at if worker else None)
    return {
        "active_orders": {k.value: v for k, v in active.items()},
        "fulfillment_queue": {str(k): v for k, v in fq.items()},
        "failed": fq.get("failed", 0),
        "overdue_reservations": overdue_reservations or 0,
        "payments_review": review or 0,
        "avg_fulfillment_seconds": float(avg_seconds) if avg_seconds is not None else None,
        "auto_rate": round(auto_delivered / delivered * 100, 1) if delivered else None,
        "delivered_30d": delivered,
        "retries_24h": int(retries or 0),
        "dead_jobs": await session.scalar(select(func.count(Job.id)).where(Job.status == "dead")) or 0,
        "open_incidents": await session.scalar(select(func.count(Incident.id)).where(Incident.status == "open")) or 0,
        "worker_last_seen": _seen(worker),
        "worker_ok": worker_age is not None and worker_age < 120,
        "tasks": tasks,
    }


@router.get("/automation/jobs")
async def list_jobs(
    admin: P("system.view"), session: SessionDep, status: str = Query("dead", pattern="^(pending|running|done|dead)$")
) -> list[dict]:
    rows = (await session.scalars(select(Job).where(Job.status == status).order_by(Job.id.desc()).limit(100))).all()
    return [
        {"id": j.id, "kind": j.kind, "status": j.status, "attempts": j.attempts, "max_attempts": j.max_attempts,
         "last_error": j.last_error, "run_at": j.run_at.isoformat(), "created_at": j.created_at.isoformat(),
         "order_id": (j.payload or {}).get("order_id")}
        for j in rows
    ]


@router.post("/automation/jobs/{job_id}/retry")
async def retry_job(job_id: int, admin: P("system.automation"), session: SessionDep) -> dict:
    res = await session.execute(
        update(Job).where(Job.id == job_id, Job.status == "dead")
        .values(status="pending", attempts=0, run_at=utcnow(), last_error=None, finished_at=None)
    )
    if not res.rowcount:
        raise HTTPException(409, "Задача не в очереди ошибок")
    log_admin(session, admin, "retry", "job", job_id)
    await session.commit()
    return {"status": "pending"}


TASKS_ON_DEMAND = ("expire_reservations", "stuck_orders", "payment_checks", "low_stock", "recover_jobs")


@router.post("/automation/tasks/{name}/run")
async def run_task(name: str, admin: P("system.automation"), session: SessionDep) -> dict:
    from app.worker import PERIODIC

    if name not in TASKS_ON_DEMAND:
        raise HTTPException(422, "Эту задачу нельзя запустить вручную")
    fn = next(f for n, _, f in PERIODIC if n == name)
    result = await fn()
    log_admin(session, admin, "run_task", "automation", None, task=name, result=result)
    await session.commit()
    return {"result": result}


@router.get("/incidents")
async def list_incidents(
    admin: P("system.view"), session: SessionDep, status: str = Query("open", pattern="^(open|resolved|all)$"),
    kind: str | None = Query(None, max_length=32), order_id: int | None = None,
) -> list[dict]:
    stmt = select(Incident)
    if status != "all":
        stmt = stmt.where(Incident.status == status)
    if kind:
        stmt = stmt.where(Incident.kind == kind)
    if order_id:
        stmt = stmt.where(Incident.order_id == order_id)
    rows = (await session.scalars(stmt.order_by(Incident.id.desc()).limit(200))).all()
    return [
        {"id": i.id, "kind": i.kind, "severity": i.severity, "status": i.status, "title": i.title, "details": i.details,
         "order_id": i.order_id, "payment_id": i.payment_id, "created_at": i.created_at.isoformat(),
         "resolved_at": i.resolved_at.isoformat() if i.resolved_at else None, "resolved_by": i.resolved_by}
        for i in rows
    ]


class ResolveIn(BaseModel):
    note: str = Field(default="", max_length=255)


@router.post("/incidents/{incident_id}/resolve")
async def resolve_incident(incident_id: int, body: ResolveIn, admin: P("system.view"), session: SessionDep) -> dict:
    inc = await session.get(Incident, incident_id)
    if inc is None:
        raise HTTPException(404, "Инцидент не найден")
    inc.status, inc.resolved_at, inc.resolved_by = "resolved", utcnow(), str(admin)[:64]
    if body.note:
        inc.details = {**(inc.details or {}), "resolution": body.note}
    log_admin(session, admin, "resolve", "incident", incident_id, note=body.note)
    await session.commit()
    return {"status": "resolved"}


# ------------------------------------------------------- notification templates

ALLOWED_TAGS = {"b", "strong", "i", "em", "u", "s", "code", "pre", "a", "tg-spoiler", "blockquote"}
TAG_RE = re.compile(r"</?\s*([a-zA-Z0-9-]+)[^>]*>")


class TemplateIn(BaseModel):
    enabled: bool
    text: str = Field(min_length=1, max_length=3500)
    button_text: str = Field(default="", max_length=64)


def _validate_template(t: str) -> None:
    for tag in TAG_RE.findall(t):
        if tag.lower() not in ALLOWED_TAGS:
            raise HTTPException(422, f"Тег <{tag}> не поддерживается Telegram. Можно: b, i, u, s, code, pre, a")
    if t.count("<") != t.count(">"):
        raise HTTPException(422, "Проверьте разметку: незакрытые < или >")


def _variables(audience: str, default_text: str) -> list[str]:
    found = set(notifications.VAR_RE.findall(default_text))
    if audience == "customer":
        found |= {"order_no", "order_id", "price", "customer_name", "product_name", "status"}
    return sorted(found)


@router.get("/notification-templates")
async def list_templates(admin: P("notifications.manage"), session: SessionDep) -> list[dict]:
    rows = {r.key: r for r in (await session.scalars(select(NotificationTemplate))).all()}
    out = []
    for key, (audience, title, text_, button, enabled) in notifications.TEMPLATES.items():
        r = rows.get(key)
        out.append({
            "key": key, "audience": audience, "title": title,
            "enabled": r.enabled if r else enabled, "text": r.text if r else text_,
            "button_text": r.button_text if r else button, "customized": r is not None,
            "default_text": text_, "variables": _variables(audience, text_),
        })
    return out


@router.put("/notification-templates/{key}")
async def update_template(key: str, body: TemplateIn, admin: P("notifications.manage"), session: SessionDep) -> dict:
    if key not in notifications.TEMPLATES:
        raise HTTPException(404, "Шаблон не найден")
    _validate_template(body.text)
    row = await session.get(NotificationTemplate, key)
    before = {"enabled": row.enabled, "text": row.text} if row else None
    if row is None:
        session.add(NotificationTemplate(key=key, enabled=body.enabled, text=body.text, button_text=body.button_text))
    else:
        row.enabled, row.text, row.button_text = body.enabled, body.text, body.button_text
    log_admin(session, admin, "update", "template", None, key=key, before=before, after=body.model_dump())
    await session.commit()
    return {"ok": True}


@router.delete("/notification-templates/{key}")
async def reset_template(key: str, admin: P("notifications.manage"), session: SessionDep) -> dict:
    row = await session.get(NotificationTemplate, key)
    if row is not None:
        await session.delete(row)
        log_admin(session, admin, "reset", "template", None, key=key)
        await session.commit()
    return {"ok": True}


class PreviewIn(BaseModel):
    text: str = Field(min_length=1, max_length=3500)


@router.post("/notification-templates/{key}/preview")
async def preview_template(key: str, body: PreviewIn, admin: P("notifications.manage")) -> dict:
    if key not in notifications.TEMPLATES:
        raise HTTPException(404, "Шаблон не найден")
    _validate_template(body.text)
    return {"html": notifications.render(body.text, notifications.sample_values())}


async def my_telegram_id(admin, session: SessionDep) -> int | None:  # noqa: ANN001
    s = get_settings()
    if admin.is_owner and s.owner_telegram_id:
        return s.owner_telegram_id
    if admin.account_id:
        acc = await session.get(AdminUser, admin.account_id)
        return acc.telegram_id if acc else None
    if admin.key.startswith("tg:"):
        return int(admin.key[3:])
    return None


@router.post("/notification-templates/{key}/test")
async def test_template(key: str, body: PreviewIn, admin: P("notifications.manage"), session: SessionDep) -> dict:
    """Sends the rendered template with sample data ONLY to the current admin's own Telegram."""
    if key not in notifications.TEMPLATES:
        raise HTTPException(404, "Шаблон не найден")
    _validate_template(body.text)
    chat = await my_telegram_id(admin, session)
    if not chat:
        raise HTTPException(409, "К вашей учётной записи не привязан Telegram")
    await jobs.enqueue(session, "tg_message", {
        "chat_id": chat, "text": "🧪 ТЕСТ\n\n" + notifications.render(body.text, notifications.sample_values()),
        "reply_markup": None,
    })
    log_admin(session, admin, "test_send", "template", None, key=key)
    await session.commit()
    return {"queued": True}


# ------------------------------------------------------------------ backups


@router.get("/system/backups")
async def list_backups(admin: P("system.backups")) -> list[dict]:
    return backup.list_backups()


@router.post("/system/backups")
async def create_backup(admin: P("system.backups"), session: SessionDep) -> dict:
    info = await backup.create_backup()
    log_admin(session, admin, "create", "backup", None, name=info["name"])
    await session.commit()
    return info


@router.get("/system/backups/{name}")
async def download_backup(name: str, admin: OwnerDep, session: SessionDep) -> FileResponse:
    """Full data copy: owner only (not delegable). Restoring is done on the server, not through the panel."""
    path = backup.get_path(name)
    if path is None:
        raise HTTPException(404, "Копия не найдена")
    log_admin(session, admin, "download", "backup", None, name=name)
    await session.commit()
    return FileResponse(path, media_type="application/gzip", filename=name)

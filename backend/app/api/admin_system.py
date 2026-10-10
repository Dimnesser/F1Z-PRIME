"""Admin system endpoints: store settings, automation, backups, admin accounts, monitoring."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from app.api.deps import ManagerDep, OwnerDep, SessionDep, StaffDep
from app.config import get_settings
from app.models import AdminRole, AdminUser, NotificationOutbox, Setting
from app.schemas import AdminAccountIn, AdminAccountOut, AdminAccountPatch, SettingsUpdate
from app.security import hash_password
from app.services import backup, monitor
from app.services import settings as settings_service
from app.services import telegram
from app.services.common import log_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Settings never contain secrets (tokens/passwords live only in .env), so every staff role may read them;
# changing them requires owner/admin.


# ----------------------------------------------------------------- settings


@router.get("/settings")
async def get_settings_values(admin: StaffDep, session: SessionDep) -> list[dict]:
    values = await settings_service.get_all(session)
    defaults = settings_service.DEFAULT_SETTINGS
    return [
        {
            "key": k,
            "value": v,
            "description": defaults.get(k, ("", k, False))[1],
            "is_public": defaults.get(k, ("", "", False))[2],
            "type": "bool" if k in settings_service.BOOL_KEYS else "number"
            if k in settings_service.POSITIVE_NUMBER_KEYS | settings_service.INT_KEYS else "text",
        }
        for k, v in values.items()
        if k in defaults
    ]


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin: ManagerDep, session: SessionDep) -> list[dict]:
    clean: dict[str, str] = {}
    for key, value in body.values.items():
        try:
            clean[key] = settings_service.validate(key, value)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
    if "min_topup" in clean or "max_topup" in clean:
        current = await settings_service.get_all(session)
        lo = float(clean.get("min_topup", current["min_topup"]))
        hi = float(clean.get("max_topup", current["max_topup"]))
        if lo > hi:
            raise HTTPException(422, "Минимальное пополнение больше максимального")
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


@router.get("/system/status")
async def system_status(admin: StaffDep, session: SessionDep) -> dict:
    outbox = dict(
        (await session.execute(select(NotificationOutbox.status, func.count(NotificationOutbox.id))
                               .group_by(NotificationOutbox.status))).all()
    )
    backups = backup.list_backups()
    s = get_settings()
    return {
        "environment": s.environment,
        "maintenance": await settings_service.get_bool(session, "maintenance_mode"),
        "notifications": {"pending": outbox.get("pending", 0), "failed": outbox.get("failed", 0),
                          "sent": outbox.get("sent", 0)},
        "errors": monitor.stats(),
        "backups": {"count": len(backups), "last": backups[0] if backups else None},
        "admin_notify_ids": len(s.admin_ids),
        "bot_configured": bool(s.bot_token),
    }


@router.get("/system/errors")
async def system_errors(admin: ManagerDep, limit: int = Query(100, ge=1, le=200)) -> list[dict]:
    return monitor.recent(limit)


@router.get("/system/notifications")
async def failed_notifications(admin: ManagerDep, session: SessionDep, status: str = Query("pending", pattern="^(pending|failed|sent)$")) -> list[dict]:
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
async def retry_notifications(admin: ManagerDep, session: SessionDep) -> dict:
    # failed (permanent) ones are left alone; pending ones are sent right away
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


@router.get("/system/backups")
async def list_backups(admin: OwnerDep) -> list[dict]:
    return backup.list_backups()


@router.post("/system/backups")
async def create_backup(admin: OwnerDep, session: SessionDep) -> dict:
    info = await backup.create_backup()
    log_admin(session, admin, "create", "backup", None, name=info["name"])
    await session.commit()
    return info


@router.get("/system/backups/{name}")
async def download_backup(name: str, admin: OwnerDep, session: SessionDep) -> FileResponse:
    path = backup.get_path(name)
    if path is None:
        raise HTTPException(404, "Копия не найдена")
    log_admin(session, admin, "download", "backup", None, name=name)
    await session.commit()
    return FileResponse(path, media_type="application/gzip", filename=name)


# ------------------------------------------------------------ admin accounts


@router.get("/accounts", response_model=list[AdminAccountOut])
async def list_accounts(admin: OwnerDep, session: SessionDep) -> list:
    return list((await session.scalars(select(AdminUser).order_by(AdminUser.id))).all())


@router.post("/accounts", response_model=AdminAccountOut, status_code=201)
async def create_account(body: AdminAccountIn, admin: OwnerDep, session: SessionDep) -> AdminUser:
    if body.username == get_settings().admin_username or await session.scalar(
        select(AdminUser.id).where(AdminUser.username == body.username)
    ):
        raise HTTPException(409, "Логин уже занят")
    if body.telegram_id and await session.scalar(select(AdminUser.id).where(AdminUser.telegram_id == body.telegram_id)):
        raise HTTPException(409, "Этот Telegram ID уже привязан к другому сотруднику")
    account = AdminUser(
        username=body.username, password_hash=hash_password(body.password), role=AdminRole(body.role),
        telegram_id=body.telegram_id,
    )
    session.add(account)
    await session.flush()
    log_admin(session, admin, "create", "admin_account", account.id, username=body.username, role=body.role,
              telegram_id=body.telegram_id)
    await session.commit()
    return account


@router.patch("/accounts/{account_id}", response_model=AdminAccountOut)
async def update_account(account_id: int, body: AdminAccountPatch, admin: OwnerDep, session: SessionDep) -> AdminUser:
    account = await session.get(AdminUser, account_id)
    if account is None:
        raise HTTPException(404, "Учётная запись не найдена")
    details: dict[str, object] = {}
    if body.role is not None:
        account.role = AdminRole(body.role)
        details["role"] = body.role
    if body.is_active is not None:
        account.is_active = body.is_active
        details["is_active"] = body.is_active
    if body.password:
        account.password_hash = hash_password(body.password)
        details["password"] = "changed"
    if body.telegram_id is not None:
        tid = body.telegram_id or None
        if tid and await session.scalar(
            select(AdminUser.id).where(AdminUser.telegram_id == tid, AdminUser.id != account.id)
        ):
            raise HTTPException(409, "Этот Telegram ID уже привязан к другому сотруднику")
        account.telegram_id = tid
        details["telegram_id"] = tid
    log_admin(session, admin, "update", "admin_account", account.id, **details)
    await session.commit()
    return account

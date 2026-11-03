"""Team management: staff accounts, roles & permissions (RBAC), approvals, staff inbox, UI preferences, counters.

All checks run on the server. Owner protection and anti-escalation rules live in services/rbac.py.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update

from app.api.deps import AdminDep, SessionDep
from app.api.deps import perm as P
from app.config import get_settings
from app.models import (
    AdminAction,
    AdminPrefs,
    AdminUser,
    ApprovalRequest,
    Incident,
    Payment,
    PaymentStatus,
    Role,
    StaffNotification,
    SupportTicket,
    TicketStatus,
)
from app.security import hash_password
from app.services import approvals, inbox, rbac
from app.services.common import ServiceError, log_admin, utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])

SLUG_RE = r"^[a-z][a-z0-9_]{1,31}$"


def _perm_list(values: list[str] | None) -> list[str]:
    values = sorted(set(values or []))
    unknown = [p for p in values if p not in rbac.ALL]
    if unknown:
        raise HTTPException(422, f"Неизвестные разрешения: {', '.join(unknown)}")
    return values


def _no_escalation(admin, perms: set[str] | frozenset[str], what: str) -> None:  # noqa: ANN001
    if admin.is_owner:
        return
    extra = set(perms) - set(admin.perms)
    if extra:
        names = ", ".join(rbac.PERMISSIONS[p][1] for p in sorted(extra))
        raise HTTPException(403, f"Нельзя {what} права, которых нет у вас: {names}")


# ------------------------------------------------------------ permissions


@router.get("/staff/permissions")
async def permission_catalog(admin: AdminDep) -> dict:
    groups: dict[str, list[dict]] = {}
    for code, (group, label) in rbac.PERMISSIONS.items():
        groups.setdefault(group, []).append({"code": code, "label": label})
    return {"groups": [{"name": g, "permissions": items} for g, items in groups.items()],
            "limits": [{"key": "payment_confirm_max", "label": "Макс. сумма ручного подтверждения платежа, грн"},
                       {"key": "refund_max", "label": "Макс. сумма возврата без одобрения, грн"},
                       {"key": "price_change_pct_max", "label": "Макс. изменение цены за раз, %"},
                       {"key": "bulk_max", "label": "Макс. товаров в массовой операции"}]}


# ------------------------------------------------------------------ roles


class RoleIn(BaseModel):
    slug: str = Field(pattern=SLUG_RE)
    name: str = Field(min_length=2, max_length=64)
    description: str = Field(default="", max_length=255)
    color: str = Field(default="#8B5CF6", pattern=r"^#[0-9A-Fa-f]{6}$")
    permissions: list[str] = Field(default_factory=list, max_length=100)
    limits: dict[str, Any] = Field(default_factory=dict)
    expires_at: datetime | None = None

    @field_validator("slug")
    @classmethod
    def _reserved(cls, v: str) -> str:
        if v == "owner":
            raise ValueError("роль owner зарезервирована")
        return v


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    description: str | None = Field(default=None, max_length=255)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    permissions: list[str] | None = Field(default=None, max_length=100)
    limits: dict[str, Any] | None = None
    expires_at: datetime | None = None
    clear_expiry: bool = False
    version: int = Field(ge=1)  # optimistic concurrency: two admins editing the same role


def _role_out(r: Role, used: int = 0) -> dict:
    return {"id": r.id, "slug": r.slug, "name": r.name, "description": r.description, "color": r.color,
            "permissions": sorted(r.permissions or []), "limits": r.limits or {}, "is_system": r.is_system,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None, "version": r.version,
            "updated_by": r.updated_by, "accounts": used}


@router.get("/roles")
async def list_roles(admin: AdminDep, session: SessionDep) -> list[dict]:
    if not (admin.can("staff.roles") or admin.can("staff.manage")):
        raise HTTPException(403, "Недостаточно прав: Управлять ролями")
    await rbac.ensure_builtin_roles(session)
    await session.commit()
    used = dict((await session.execute(select(AdminUser.role_slug, func.count(AdminUser.id)).group_by(AdminUser.role_slug))).all())
    rows = (await session.scalars(select(Role).order_by(Role.is_system.desc(), Role.id))).all()
    return [_role_out(r, used.get(r.slug, 0)) for r in rows]


@router.post("/roles", status_code=201)
async def create_role(body: RoleIn, admin: P("staff.roles"), session: SessionDep) -> dict:
    perms = _perm_list(body.permissions)
    _no_escalation(admin, set(perms), "выдать")
    try:
        limits = rbac.clean_limits(body.limits)
    except (ValueError, ArithmeticError) as exc:
        raise HTTPException(422, str(exc)) from None
    if not admin.is_owner and not rbac.limits_not_looser(limits, admin.limits):
        raise HTTPException(403, "Лимиты роли не могут быть шире ваших")
    if await session.scalar(select(Role.id).where(Role.slug == body.slug)) or body.slug in rbac.BUILTIN:
        raise HTTPException(409, "Роль с таким кодом уже есть")
    role = Role(slug=body.slug, name=body.name, description=body.description, color=body.color, permissions=perms,
                limits=limits, expires_at=body.expires_at, is_system=False, updated_by=str(admin))
    session.add(role)
    await session.flush()
    log_admin(session, admin, "create", "role", role.id, slug=role.slug, permissions=perms, limits=limits)
    await session.commit()
    return _role_out(role)


@router.post("/roles/{role_id}/copy", status_code=201)
async def copy_role(role_id: int, admin: P("staff.roles"), session: SessionDep) -> dict:
    src = await session.get(Role, role_id)
    if src is None:
        raise HTTPException(404, "Роль не найдена")
    _no_escalation(admin, set(src.permissions or []), "выдать")
    base = f"{src.slug}_copy"[:28]
    slug, n = base, 1
    while await session.scalar(select(Role.id).where(Role.slug == slug)):
        n += 1
        slug = f"{base}{n}"
    role = Role(slug=slug, name=f"{src.name} (копия)"[:64], description=src.description, color=src.color,
                permissions=list(src.permissions or []), limits=dict(src.limits or {}), is_system=False,
                updated_by=str(admin))
    session.add(role)
    await session.flush()
    log_admin(session, admin, "copy", "role", role.id, source=src.slug, slug=slug)
    await session.commit()
    return _role_out(role)


@router.patch("/roles/{role_id}")
async def update_role(role_id: int, body: RolePatch, admin: P("staff.roles"), session: SessionDep) -> dict:
    role = await session.scalar(select(Role).where(Role.id == role_id).with_for_update())
    if role is None:
        raise HTTPException(404, "Роль не найдена")
    if role.version != body.version:
        raise HTTPException(409, "Роль уже изменил другой администратор — обновите страницу")
    if not admin.is_owner and admin.role == role.slug:
        raise HTTPException(403, "Нельзя менять собственную роль")
    if not admin.is_owner and not set(role.permissions or []) <= set(admin.perms):
        raise HTTPException(403, "Нельзя менять роль с правами шире ваших")
    before = _role_out(role)
    if body.permissions is not None:
        perms = _perm_list(body.permissions)
        _no_escalation(admin, set(perms), "выдать")
        role.permissions = perms
    if body.limits is not None:
        try:
            limits = rbac.clean_limits(body.limits)
        except (ValueError, ArithmeticError) as exc:
            raise HTTPException(422, str(exc)) from None
        if not admin.is_owner and not rbac.limits_not_looser(limits, admin.limits):
            raise HTTPException(403, "Лимиты роли не могут быть шире ваших")
        role.limits = limits
    for f in ("name", "description", "color"):
        v = getattr(body, f)
        if v is not None:
            setattr(role, f, v)
    if body.clear_expiry:
        role.expires_at = None
    elif body.expires_at is not None:
        role.expires_at = body.expires_at
    role.version += 1
    role.updated_by = str(admin)
    log_admin(session, admin, "update", "role", role.id, before=before, after=_role_out(role))
    for acc in (await session.scalars(select(AdminUser).where(AdminUser.role_slug == role.slug))).all():
        await inbox.push(session, f"acc:{acc.id}", "permissions_changed", f"Права роли «{role.name}» изменены", f"Изменил: {admin}")
    await session.commit()
    return _role_out(role)


@router.delete("/roles/{role_id}")
async def delete_role(role_id: int, admin: P("staff.roles"), session: SessionDep) -> dict:
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(404, "Роль не найдена")
    if role.is_system:
        raise HTTPException(409, "Встроенную роль удалить нельзя — её можно скопировать и изменить")
    if await session.scalar(select(func.count(AdminUser.id)).where(AdminUser.role_slug == role.slug)):
        raise HTTPException(409, "Роль назначена сотрудникам — сначала смените им роль")
    await session.delete(role)
    log_admin(session, admin, "delete", "role", role_id, slug=role.slug)
    await session.commit()
    return {"deleted": True}


# --------------------------------------------------------------- accounts


class AccountIn(BaseModel):
    """Invite by Telegram ID (signs in from the Mini App) and/or username+password (browser login)."""

    telegram_id: int | None = Field(default=None, gt=0, lt=10**15)
    telegram_username: str | None = Field(default=None, max_length=64, pattern=r"^@?[A-Za-z0-9_]{3,64}$")
    username: str | None = Field(default=None, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str | None = Field(default=None, min_length=10, max_length=128)
    display_name: str | None = Field(default=None, max_length=64)
    role: str = Field(default="support", pattern=SLUG_RE)
    extra_permissions: list[str] = Field(default_factory=list)
    denied_permissions: list[str] = Field(default_factory=list)
    expires_at: datetime | None = None
    note: str | None = Field(default=None, max_length=255)


class AccountPatch(BaseModel):
    role: str | None = Field(default=None, pattern=SLUG_RE)
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=128)
    telegram_id: int | None = Field(default=None, ge=0, lt=10**15)  # 0 = unlink
    telegram_username: str | None = Field(default=None, max_length=64)
    display_name: str | None = Field(default=None, max_length=64)
    extra_permissions: list[str] | None = None
    denied_permissions: list[str] | None = None
    expires_at: datetime | None = None
    clear_expiry: bool = False
    note: str | None = Field(default=None, max_length=255)
    version: int | None = Field(default=None, ge=1)


async def _account_out(session: SessionDep, a: AdminUser, stats: dict[str, dict] | None = None, viewer_id: int | None = None) -> dict:
    perms, limits, role = await rbac.effective(session, a)
    st = (stats or {}).get(a.username, {})
    return {
        "id": a.id, "username": a.username, "display_name": a.display_name, "telegram_id": a.telegram_id,
        "telegram_username": a.telegram_username, "role": a.role_slug, "role_name": role.name if role else a.role_slug,
        "role_color": role.color if role else "#64748B", "is_active": a.is_active,
        "expired": bool(a.expires_at and a.expires_at <= utcnow()),
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
        "extra_permissions": sorted(a.extra_permissions or []), "denied_permissions": sorted(a.denied_permissions or []),
        "effective_permissions": sorted(perms), "limits": limits, "has_password": bool(a.password_hash),
        "last_login_at": a.last_login_at.isoformat() if a.last_login_at else None,
        "created_at": a.created_at.isoformat(), "note": a.note, "version": a.version,
        "orders_processed": st.get("orders", 0), "tickets_closed": st.get("tickets", 0),
        "is_self": viewer_id is not None and viewer_id == a.id,
    }


async def _staff_stats(session: SessionDep) -> dict[str, dict]:
    rows = (
        await session.execute(
            select(AdminAction.admin, AdminAction.entity, AdminAction.action, func.count(AdminAction.id))
            .where(or_(AdminAction.entity == "order", (AdminAction.entity == "ticket") & (AdminAction.action == "status")))
            .group_by(AdminAction.admin, AdminAction.entity, AdminAction.action)
        )
    ).all()
    out: dict[str, dict] = {}
    for who, entity, action, n in rows:
        d = out.setdefault(who, {"orders": 0, "tickets": 0})
        if entity == "order":
            d["orders"] += n
        elif entity == "ticket":
            d["tickets"] += n
    return out


async def _check_target(admin, session: SessionDep, account: AdminUser) -> None:  # noqa: ANN001
    if admin.is_owner:
        return
    if admin.account_id == account.id:
        raise HTTPException(403, "Нельзя менять собственную учётную запись")
    perms, _, _ = await rbac.effective(session, account)
    if not set(perms) <= set(admin.perms):
        raise HTTPException(403, "Нельзя управлять сотрудником с правами шире ваших")


async def _check_grant(admin, session: SessionDep, role_slug: str, extra: list[str]) -> Role:  # noqa: ANN001
    role = await rbac.get_role(session, role_slug)
    if role is None:
        raise HTTPException(422, "Роль не найдена")
    _no_escalation(admin, set(role.permissions or []) | set(extra), "выдать")
    if not admin.is_owner and not rbac.limits_not_looser(role.limits or {}, admin.limits):
        raise HTTPException(403, "Лимиты роли шире ваших")
    return role


@router.get("/accounts")
async def list_accounts(admin: P("staff.manage"), session: SessionDep) -> list[dict]:
    stats = await _staff_stats(session)
    rows = (await session.scalars(select(AdminUser).order_by(AdminUser.id))).all()
    return [await _account_out(session, a, stats, admin.account_id) for a in rows]


@router.post("/accounts", status_code=201)
async def create_account(body: AccountIn, admin: P("staff.manage"), session: SessionDep) -> dict:
    s = get_settings()
    if not body.telegram_id and not (body.username and body.password):
        raise HTTPException(422, "Укажите Telegram ID или логин и пароль")
    if body.telegram_id and s.owner_telegram_id and body.telegram_id == s.owner_telegram_id:
        raise HTTPException(409, "Это Telegram ID владельца — он уже имеет полный доступ")
    username = body.username or f"tg{body.telegram_id}"
    if username == s.admin_username or await session.scalar(select(AdminUser.id).where(AdminUser.username == username)):
        raise HTTPException(409, "Логин уже занят")
    if body.telegram_id and await session.scalar(select(AdminUser.id).where(AdminUser.telegram_id == body.telegram_id)):
        raise HTTPException(409, "Этот Telegram ID уже привязан к другому сотруднику")
    extra = _perm_list(body.extra_permissions)
    denied = _perm_list(body.denied_permissions)
    await _check_grant(admin, session, body.role, extra)
    account = AdminUser(
        username=username, password_hash=hash_password(body.password) if body.password else None,
        role_slug=body.role, telegram_id=body.telegram_id,
        telegram_username=(body.telegram_username or "").lstrip("@") or None, display_name=body.display_name,
        extra_permissions=extra, denied_permissions=denied, expires_at=body.expires_at, note=body.note,
    )
    session.add(account)
    await session.flush()
    log_admin(session, admin, "create", "admin_account", account.id, username=username, role=body.role,
              telegram_id=body.telegram_id, extra=extra, denied=denied,
              expires_at=body.expires_at.isoformat() if body.expires_at else None)
    await inbox.push(session, f"acc:{account.id}", "welcome", "Вам открыт доступ к админ-панели F1Z PRIME",
                     f"Роль назначил: {admin}")
    await session.commit()
    return await _account_out(session, account)


@router.patch("/accounts/{account_id}")
async def update_account(account_id: int, body: AccountPatch, admin: P("staff.manage"), session: SessionDep) -> dict:
    account = await session.scalar(select(AdminUser).where(AdminUser.id == account_id).with_for_update())
    if account is None:
        raise HTTPException(404, "Учётная запись не найдена")
    if body.version is not None and body.version != account.version:
        raise HTTPException(409, "Сотрудника уже изменил другой администратор — обновите страницу")
    await _check_target(admin, session, account)
    before = await _account_out(session, account)
    details: dict[str, Any] = {}
    s = get_settings()
    role_slug = body.role or account.role_slug
    extra = _perm_list(body.extra_permissions) if body.extra_permissions is not None else list(account.extra_permissions or [])
    if body.role is not None or body.extra_permissions is not None:
        await _check_grant(admin, session, role_slug, extra)
    if body.role is not None:
        account.role_slug = body.role
        details["role"] = body.role
    if body.extra_permissions is not None:
        account.extra_permissions = extra
        details["extra_permissions"] = extra
    if body.denied_permissions is not None:
        account.denied_permissions = _perm_list(body.denied_permissions)
        details["denied_permissions"] = account.denied_permissions
    if body.is_active is not None and body.is_active != account.is_active:
        account.is_active = body.is_active
        details["is_active"] = body.is_active
        if not body.is_active:
            account.token_version += 1  # suspension ends live sessions at once
    if body.password:
        account.password_hash = hash_password(body.password)
        account.token_version += 1
        details["password"] = "changed"
    if body.telegram_id is not None:
        tid = body.telegram_id or None
        if tid and s.owner_telegram_id and tid == s.owner_telegram_id:
            raise HTTPException(409, "Это Telegram ID владельца")
        if tid and await session.scalar(select(AdminUser.id).where(AdminUser.telegram_id == tid, AdminUser.id != account.id)):
            raise HTTPException(409, "Этот Telegram ID уже привязан к другому сотруднику")
        if tid != account.telegram_id:
            account.token_version += 1
        account.telegram_id = tid
        details["telegram_id"] = tid
    for f in ("telegram_username", "display_name", "note"):
        v = getattr(body, f)
        if v is not None:
            setattr(account, f, v.lstrip("@") if f == "telegram_username" else v)
            details[f] = v
    if body.clear_expiry:
        account.expires_at = None
        details["expires_at"] = None
    elif body.expires_at is not None:
        account.expires_at = body.expires_at
        details["expires_at"] = body.expires_at.isoformat()
    account.version += 1
    log_admin(session, admin, "update", "admin_account", account.id, before=before, changes=details)
    if {"role", "extra_permissions", "denied_permissions"} & details.keys():
        await inbox.push(session, f"acc:{account.id}", "permissions_changed", "Ваши права изменены", f"Изменил: {admin}")
    await session.commit()
    return await _account_out(session, account)


@router.post("/accounts/{account_id}/revoke-sessions")
async def revoke_sessions(account_id: int, admin: P("staff.manage"), session: SessionDep) -> dict:
    account = await session.scalar(select(AdminUser).where(AdminUser.id == account_id).with_for_update())
    if account is None:
        raise HTTPException(404, "Учётная запись не найдена")
    await _check_target(admin, session, account)
    account.token_version += 1
    log_admin(session, admin, "revoke_sessions", "admin_account", account.id)
    await session.commit()
    return {"revoked": True}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: int, admin: P("staff.manage"), session: SessionDep) -> dict:
    account = await session.get(AdminUser, account_id)
    if account is None:
        raise HTTPException(404, "Учётная запись не найдена")
    await _check_target(admin, session, account)
    log_admin(session, admin, "delete", "admin_account", account.id, username=account.username)
    await session.delete(account)
    await session.commit()
    return {"deleted": True}


@router.get("/accounts/{account_id}/history")
async def account_history(account_id: int, admin: P("staff.manage"), session: SessionDep,
                          limit: int = Query(100, ge=1, le=500)) -> list[dict]:
    if not admin.can("system.audit"):
        raise HTTPException(403, "Недостаточно прав: Просматривать журнал действий")
    account = await session.get(AdminUser, account_id)
    if account is None:
        raise HTTPException(404, "Учётная запись не найдена")
    rows = (
        await session.scalars(
            select(AdminAction).where(AdminAction.admin == account.username).order_by(AdminAction.id.desc()).limit(limit)
        )
    ).all()
    return [{"id": r.id, "action": r.action, "entity": r.entity, "entity_id": r.entity_id, "details": r.details,
             "created_at": r.created_at.isoformat()} for r in rows]


# -------------------------------------------------------------- approvals


@router.get("/approvals")
async def list_approvals(admin: AdminDep, session: SessionDep,
                         status: str = Query("pending", pattern="^(pending|approved|rejected|all)$")) -> list[dict]:
    stmt = select(ApprovalRequest)
    if status != "all":
        stmt = stmt.where(ApprovalRequest.status == status)
    if not admin.can("refunds.approve"):
        stmt = stmt.where(ApprovalRequest.requested_by == str(admin))  # own requests only
    rows = (await session.scalars(stmt.order_by(ApprovalRequest.id.desc()).limit(200))).all()
    return [{"id": r.id, "kind": r.kind, "kind_label": approvals.KINDS.get(r.kind, r.kind), "summary": r.summary,
             "amount": float(r.amount) if r.amount is not None else None, "status": r.status,
             "requested_by": r.requested_by, "decided_by": r.decided_by, "decision_note": r.decision_note,
             "result": r.result, "created_at": r.created_at.isoformat(),
             "decided_at": r.decided_at.isoformat() if r.decided_at else None,
             "can_decide": admin.can("refunds.approve") and r.requested_by != str(admin) and r.status == "pending"}
            for r in rows]


class DecisionIn(BaseModel):
    approve: bool
    note: str = Field(default="", max_length=255)


@router.post("/approvals/{req_id}/decide")
async def decide_approval(req_id: int, body: DecisionIn, admin: P("refunds.approve"), session: SessionDep) -> dict:
    try:
        req = await approvals.decide(session, req_id, body.approve, str(admin), body.note)
    except ServiceError:
        await session.rollback()
        raise
    log_admin(session, admin, "approve" if body.approve else "reject", "approval", req_id, kind=req.kind, note=body.note)
    acc = await session.scalar(select(AdminUser).where(AdminUser.username == req.requested_by))
    await inbox.push(session, f"acc:{acc.id}" if acc else "owner", "approval_decided",
                     f"Запрос #{req.id} {'одобрен' if body.approve else 'отклонён'}", body.note or (req.result or ""))
    await session.commit()
    if body.approve and req.kind == "payment_confirm":
        from app.models import Payment as _P
        from app.services import fulfillment

        p = await session.get(_P, int(req.payload["payment_id"]))
        if p is not None and p.order_id:
            await fulfillment.run_now(p.order_id)
    return {"status": req.status, "result": req.result}


# ------------------------------------------------------------------- inbox


@router.get("/inbox")
async def list_inbox(admin: AdminDep, session: SessionDep, unread: bool = False) -> dict:
    stmt = select(StaffNotification).where(StaffNotification.recipient == admin.key)
    if unread:
        stmt = stmt.where(StaffNotification.read_at.is_(None))
    rows = (await session.scalars(stmt.order_by(StaffNotification.id.desc()).limit(100))).all()
    count = await session.scalar(
        select(func.count(StaffNotification.id)).where(StaffNotification.recipient == admin.key, StaffNotification.read_at.is_(None))
    )
    return {"unread": count or 0, "items": [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link,
         "created_at": n.created_at.isoformat(), "read": n.read_at is not None} for n in rows]}


class ReadIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=500)
    all: bool = False


@router.post("/inbox/read")
async def mark_read(body: ReadIn, admin: AdminDep, session: SessionDep) -> dict:
    stmt = update(StaffNotification).where(StaffNotification.recipient == admin.key, StaffNotification.read_at.is_(None))
    if not body.all:
        stmt = stmt.where(StaffNotification.id.in_(body.ids or [0]))
    res = await session.execute(stmt.values(read_at=utcnow()))
    await session.commit()
    return {"updated": res.rowcount or 0}


# ------------------------------------------------------------------- prefs


class PrefsIn(BaseModel):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def _size(cls, v: dict[str, Any]) -> dict[str, Any]:
        import json

        if len(json.dumps(v)) > 20_000:
            raise ValueError("слишком много настроек")
        return v


@router.get("/prefs")
async def get_prefs(admin: AdminDep, session: SessionDep) -> dict:
    row = await session.get(AdminPrefs, admin.key)
    return row.data if row else {}


@router.put("/prefs")
async def put_prefs(body: PrefsIn, admin: AdminDep, session: SessionDep) -> dict:
    row = await session.get(AdminPrefs, admin.key)
    if row is None:
        session.add(AdminPrefs(owner_key=admin.key, data=body.data))
    else:
        row.data = body.data
    await session.commit()
    return body.data


# ---------------------------------------------------------------- counters


@router.get("/counters")
async def counters(admin: AdminDep, session: SessionDep) -> dict:
    """Badges for the navigation, filtered by what the admin is allowed to see."""
    out: dict[str, int] = {"inbox": await session.scalar(
        select(func.count(StaffNotification.id)).where(StaffNotification.recipient == admin.key, StaffNotification.read_at.is_(None))
    ) or 0}
    if admin.can("support.view"):
        out["tickets"] = await session.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.status == TicketStatus.open)) or 0
    if admin.can("payments.view"):
        out["review"] = await session.scalar(
            select(func.count(Payment.id)).where(Payment.status == PaymentStatus.awaiting_confirmation)) or 0
    if admin.can("system.view"):
        out["incidents"] = await session.scalar(select(func.count(Incident.id)).where(Incident.status == "open")) or 0
    if admin.can("refunds.approve"):
        out["approvals"] = await session.scalar(
            select(func.count(ApprovalRequest.id)).where(ApprovalRequest.status == "pending")) or 0
    return out


def _unused() -> Decimal:  # keep Decimal import for type hints in limits
    return Decimal(0)

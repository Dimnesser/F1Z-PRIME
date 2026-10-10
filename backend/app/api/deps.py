from __future__ import annotations

import logging
from typing import Annotated

import time
from collections import defaultdict, deque

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import AdminUser, User
from app.security import InitDataError, TelegramUser, decode_admin_claims, validate_init_data
from app.services import admin_access, rbac
from app.services.orders import upsert_user

log = logging.getLogger("f1z.auth")

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Authenticate a Mini App user by Telegram `initData` (header: `Authorization: tma <initData>`)."""
    settings = get_settings()
    init_data = ""
    if authorization and authorization.lower().startswith("tma "):
        init_data = authorization[4:].strip()

    if init_data:
        try:
            tg = validate_init_data(init_data, settings.bot_token, settings.init_data_ttl_seconds)
        except InitDataError as exc:
            log.info("initData rejected: %s", exc)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Неверные данные Telegram: {exc}") from exc
    elif settings.dev_mode and not settings.is_production:
        tg = TelegramUser(id=settings.dev_user_id, first_name="Dev", last_name="Tester", username="dev_tester")
    else:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Откройте магазин через Telegram")

    user = await upsert_user(session, tg)
    if user.is_blocked:
        await session.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Аккаунт заблокирован")
    await session.commit()
    return user


UserDep = Annotated[User, Depends(current_user)]


class AdminIdentity(str):
    """Admin label (a str, so it can be logged as-is) with role, effective permissions and limits attached."""

    role: str
    perms: frozenset[str]
    limits: dict
    key: str  # stable inbox/prefs key: owner | acc:<id> | tg:<telegram id>
    is_owner: bool
    account_id: int | None

    def __new__(
        cls, username: str, role: str, perms: frozenset[str] | None = None, limits: dict | None = None,
        key: str | None = None, account_id: int | None = None,
    ) -> AdminIdentity:
        obj = super().__new__(cls, username)
        obj.role = role
        obj.is_owner = role == "owner"
        obj.perms = rbac.ALL if obj.is_owner else (perms or frozenset())
        obj.limits = {} if obj.is_owner else (limits or {})
        obj.key = key or ("owner" if obj.is_owner else username)
        obj.account_id = account_id
        return obj

    def can(self, perm: str) -> bool:
        return self.is_owner or perm in self.perms


ROLE_LABELS = {"owner": "Владелец", **{k: v[0] for k, v in rbac.BUILTIN.items()}}

# Mutating admin requests per account per minute (protects against runaway scripts / stolen tokens).
_admin_writes: dict[str, deque[float]] = defaultdict(deque)
ADMIN_WRITE_LIMIT, ADMIN_WRITE_WINDOW = 120, 60.0


def _rate_limit(key: str) -> None:
    hits = _admin_writes[key]
    now = time.monotonic()
    while hits and now - hits[0] > ADMIN_WRITE_WINDOW:
        hits.popleft()
    if len(hits) >= ADMIN_WRITE_LIMIT:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много действий подряд. Подождите минуту.")
    hits.append(now)


async def identity_for_account(session: AsyncSession, account: AdminUser, label: str | None = None) -> AdminIdentity:
    perms, limits, _ = await rbac.effective(session, account)
    if not perms:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Доступ к админ-панели отключён или истёк")
    return AdminIdentity(label or account.username, account.role_slug, perms, limits, key=f"acc:{account.id}",
                         account_id=account.id)


async def current_admin(
    request: Request,
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> AdminIdentity:
    """Bearer-token auth (header, not cookies — so the admin API is not exposed to CSRF).
    Role, permissions, suspension and session revocation are re-checked on every request."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация администратора")
    settings = get_settings()
    claims = decode_admin_claims(authorization[7:].strip(), settings.secret_key)
    if claims is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
    username = str(claims["sub"])
    source = claims.get("src", "env")
    if source == "tg":
        tid = claims.get("tid")
        if not isinstance(tid, int):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
        if settings.owner_telegram_id and tid == settings.owner_telegram_id:
            identity = AdminIdentity(username, "owner")
        else:
            account = await session.scalar(select(AdminUser).where(AdminUser.telegram_id == tid))
            if account is not None:
                if claims.get("tv", 0) != account.token_version:
                    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия отозвана владельцем")
                identity = await identity_for_account(session, account)  # audit under the account name
            elif tid in admin_access.env_admin_ids():
                role = await rbac.get_role(session, "admin")
                identity = AdminIdentity(username, "admin", frozenset(role.permissions if role else []),
                                         dict(role.limits if role else {}), key=f"tg:{tid}")
            else:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Доступ к админ-панели отозван")
    elif source == "env":
        if username != settings.admin_username:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
        identity = AdminIdentity(username, "owner")
    else:
        account = await session.scalar(select(AdminUser).where(AdminUser.username == username))
        if account is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Учётная запись удалена")
        if claims.get("tv", 0) != account.token_version:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия отозвана владельцем")
        identity = await identity_for_account(session, account)
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        _rate_limit(identity.key)
    return identity


AdminDep = Annotated[AdminIdentity, Depends(current_admin)]


def require(*perms: str):
    """Dependency: the admin must hold ALL listed permissions."""

    async def dep(admin: AdminDep) -> AdminIdentity:
        missing = [p for p in perms if not admin.can(p)]
        if missing:
            labels = ", ".join(rbac.PERMISSIONS.get(p, ("", p))[1] for p in missing)
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Недостаточно прав: {labels}")
        return admin

    return Depends(dep)


def perm(*perms: str) -> type:
    return Annotated[AdminIdentity, require(*perms)]  # type: ignore[return-value]


def require_role(*roles: str):
    async def dep(admin: AdminDep) -> AdminIdentity:
        if admin.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав для этого действия")
        return admin

    return dep


# Any staff session.
StaffDep = AdminDep
# Owner only.
OwnerDep = Annotated[AdminIdentity, Depends(require_role("owner"))]

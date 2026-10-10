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
    """Admin username (a str, so it can be logged as-is) with its role attached."""

    role: str

    def __new__(cls, username: str, role: str) -> AdminIdentity:
        obj = super().__new__(cls, username)
        obj.role = role
        return obj


ROLE_LABELS = {"owner": "Владелец", "admin": "Администратор", "support": "Поддержка"}

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


async def current_admin(
    request: Request,
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> AdminIdentity:
    """Bearer-token auth (header, not cookies — so the admin API is not exposed to CSRF)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация администратора")
    settings = get_settings()
    claims = decode_admin_claims(authorization[7:].strip(), settings.secret_key)
    if claims is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
    username = str(claims["sub"])
    if claims.get("src", "env") == "env":
        if username != settings.admin_username:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
        role = "owner"
    else:
        account = await session.scalar(select(AdminUser).where(AdminUser.username == username))
        if account is None or not account.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Учётная запись отключена")
        role = account.role.value  # role changes apply immediately, not at next login
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        _rate_limit(username)
    return AdminIdentity(username, role)


AdminDep = Annotated[AdminIdentity, Depends(current_admin)]


def require_role(*roles: str):
    async def dep(admin: AdminDep) -> AdminIdentity:
        if admin.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Недостаточно прав для этого действия")
        return admin

    return dep


# Any admin-panel account (owner / admin / support).
StaffDep = AdminDep
# Owner and admins: catalog, orders, payments, settings.
ManagerDep = Annotated[AdminIdentity, Depends(require_role("owner", "admin"))]
# Owner only: admin accounts, backups.
OwnerDep = Annotated[AdminIdentity, Depends(require_role("owner"))]

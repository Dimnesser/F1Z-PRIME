from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import User
from app.security import InitDataError, TelegramUser, decode_admin_token, validate_init_data
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


async def current_admin(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация администратора")
    admin = decode_admin_token(authorization[7:].strip(), get_settings().secret_key)
    if admin is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия администратора истекла")
    return admin


AdminDep = Annotated[str, Depends(current_admin)]

"""Who may open the admin panel from the Telegram Mini App.

Decided only on the server from the Telegram id proven by signed initData:
- OWNER_TELEGRAM_ID                      -> owner (all permissions, can't be changed in the panel)
- a staff account linked to the id         -> its role and permissions (if active and not expired)
- ADMIN_TELEGRAM_IDS                     -> built-in role "admin"
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AdminUser

TELEGRAM_TOKEN_TTL_HOURS = 1.0  # short-lived; the panel re-exchanges initData when it expires


def env_admin_ids() -> set[int]:
    raw = get_settings().admin_telegram_ids.replace(" ", "")
    return {int(x) for x in raw.split(",") if x.isdigit()}


async def telegram_access(session: AsyncSession, telegram_id: int) -> tuple[str | None, AdminUser | None]:
    """(role slug, account) for a Telegram user, or (None, None) when they have no panel access."""
    from app.services import rbac

    s = get_settings()
    if s.owner_telegram_id and telegram_id == s.owner_telegram_id:
        return "owner", None
    account = await session.scalar(select(AdminUser).where(AdminUser.telegram_id == telegram_id))
    if account is not None:
        if await rbac.account_has(session, account, None):
            return account.role_slug, account
        return None, None  # suspended / expired / no permissions: an account overrides the env list
    if telegram_id in env_admin_ids():
        return "admin", None
    return None, None


async def telegram_role(session: AsyncSession, telegram_id: int) -> str | None:
    return (await telegram_access(session, telegram_id))[0]


def telegram_label(telegram_id: int, username: str | None) -> str:
    """Name used in the audit log and ticket assignment for Mini App admin sessions."""
    return f"tg:{username}" if username else f"tg:{telegram_id}"

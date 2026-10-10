"""Who may open the admin panel from the Telegram Mini App.

Decided only on the server from the Telegram id proven by signed initData:
- OWNER_TELEGRAM_ID                      -> owner
- an active staff account linked to the id -> its role (owner/admin/support)
- ADMIN_TELEGRAM_IDS                     -> admin
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AdminUser

MINIAPP_ROLES = ("owner", "admin")  # roles allowed to enter the panel from the Mini App
TELEGRAM_TOKEN_TTL_HOURS = 1.0  # short-lived; the panel re-exchanges initData when it expires


def _env_admin_ids() -> set[int]:
    raw = get_settings().admin_telegram_ids.replace(" ", "")
    return {int(x) for x in raw.split(",") if x.isdigit()}


async def telegram_role(session: AsyncSession, telegram_id: int) -> str | None:
    s = get_settings()
    if s.owner_telegram_id and telegram_id == s.owner_telegram_id:
        return "owner"
    account = await session.scalar(
        select(AdminUser).where(AdminUser.telegram_id == telegram_id, AdminUser.is_active.is_(True))
    )
    if account is not None:
        return account.role.value
    if telegram_id in _env_admin_ids():
        return "admin"
    return None


def telegram_label(telegram_id: int, username: str | None) -> str:
    """Name used in the audit log and ticket assignment for Mini App admin sessions."""
    return f"tg:{username}" if username else f"tg:{telegram_id}"

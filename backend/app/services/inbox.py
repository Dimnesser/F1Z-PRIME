"""Staff inbox (in-panel notifications with unread counters)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminUser, StaffNotification


async def push(session: AsyncSession, recipient: str, kind: str, title: str, body: str = "", link: str | None = None) -> None:
    session.add(StaffNotification(recipient=recipient[:64], kind=kind[:48], title=title[:200], body=body[:2000], link=link))


async def notify_permission(
    session: AsyncSession, perm: str | None, kind: str, title: str, body: str = "", link: str | None = None,
    exclude: str | None = None,
) -> int:
    """Owner + every active staff account holding `perm`."""
    from app.services import rbac

    recipients = ["owner"]
    for a in (await session.scalars(select(AdminUser).where(AdminUser.is_active.is_(True)))).all():
        if await rbac.account_has(session, a, perm):
            recipients.append(f"acc:{a.id}")
    n = 0
    for r in recipients:
        if r != exclude:
            await push(session, r, kind, title, body, link)
            n += 1
    return n

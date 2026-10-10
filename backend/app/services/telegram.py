"""Minimal Telegram Bot API client used by the API process (notifications, invoices)."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger("f1z.telegram")


class TelegramError(Exception):
    pass


def redact(text: object) -> str:
    """Remove the bot token from any text that may end up in logs."""
    out = str(text)
    token = get_settings().bot_token
    return out.replace(token, "***") if token else out


async def call(method: str, payload: dict[str, Any], timeout: float = 10.0) -> Any:
    token = get_settings().bot_token
    if not token:
        raise TelegramError("BOT_TOKEN is not configured")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(f"https://api.telegram.org/bot{token}/{method}", json=payload)
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise TelegramError(redact(exc)) from None
    if not data.get("ok"):
        raise TelegramError(data.get("description", "Telegram API error"))
    return data["result"]


async def create_stars_invoice_link(title: str, description: str, payload: str, stars: int) -> str:
    """Official Telegram Stars flow: currency XTR, empty provider token."""
    return await call(
        "createInvoiceLink",
        {
            "title": title[:32],
            "description": description[:255],
            "payload": payload,
            "provider_token": "",
            "currency": "XTR",
            "prices": [{"label": title[:32], "amount": stars}],
        },
    )


PERMANENT_ERRORS = ("bot was blocked", "chat not found", "user is deactivated", "bot can't initiate")


async def _send(chat_id: int, text: str) -> None:
    try:
        await call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
    except TelegramError as exc:
        # User-supplied text may contain "<" etc. — resend as plain text instead of losing the message.
        if "parse entities" not in str(exc).lower():
            raise
        await call("sendMessage", {"chat_id": chat_id, "text": text})


async def notify(chat_id: int, text: str) -> bool:
    """Fire-and-forget message. Failures are logged and queued for retry, never raised."""
    if not get_settings().bot_token:
        return False
    try:
        await _send(chat_id, text)
        return True
    except Exception as exc:  # noqa: BLE001
        error = redact(exc)
        log.warning("notify %s failed: %s", chat_id, error)
        await _queue_failed(chat_id, text, error)
        return False


async def _queue_failed(chat_id: int, text: str, error: str) -> None:
    from datetime import timedelta

    from app.db import session_factory
    from app.models import NotificationOutbox
    from app.services.common import utcnow

    permanent = any(p in error.lower() for p in PERMANENT_ERRORS)
    try:
        async with session_factory()() as session:
            session.add(
                NotificationOutbox(
                    chat_id=chat_id,
                    text=text[:4000],
                    status="failed" if permanent else "pending",
                    last_error=error[:255],
                    next_attempt_at=utcnow() + timedelta(minutes=1),
                )
            )
            await session.commit()
    except Exception:  # noqa: BLE001
        log.exception("could not queue failed notification")


async def retry_outbox(limit: int = 20) -> dict[str, int]:
    """Resend queued notifications with exponential backoff (1, 2, 4, 8... min, max 6 attempts)."""
    from datetime import timedelta

    from sqlalchemy import select

    from app.db import session_factory
    from app.models import NotificationOutbox
    from app.services.common import utcnow

    result = {"sent": 0, "failed": 0}
    async with session_factory()() as session:
        rows = (
            await session.scalars(
                select(NotificationOutbox)
                .where(NotificationOutbox.status == "pending", NotificationOutbox.next_attempt_at <= utcnow())
                .order_by(NotificationOutbox.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).all()
        for row in rows:
            try:
                await _send(row.chat_id, row.text)
                row.status, row.sent_at = "sent", utcnow()
                result["sent"] += 1
            except Exception as exc:  # noqa: BLE001
                error = redact(exc)
                row.attempts += 1
                row.last_error = error[:255]
                if row.attempts >= 6 or any(p in error.lower() for p in PERMANENT_ERRORS):
                    row.status = "failed"
                    result["failed"] += 1
                else:
                    row.next_attempt_at = utcnow() + timedelta(minutes=2 ** row.attempts)
        await session.commit()
    return result


async def notify_admins(text: str, kind: str | None = None) -> None:
    """Notify all admin Telegram ids. `kind` (orders/payments/tickets) respects the notify_<kind> setting."""
    if kind:
        from app.db import session_factory
        from app.services import settings as settings_service

        try:
            async with session_factory()() as session:
                if not await settings_service.get_bool(session, f"notify_{kind}"):
                    return
        except Exception:  # noqa: BLE001
            log.exception("could not read notification settings")
    for admin_id in get_settings().admin_ids:
        await notify(admin_id, text)

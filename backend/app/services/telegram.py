"""Minimal Telegram Bot API client used by the API process (notifications, invoices)."""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

log = logging.getLogger("f1z.telegram")


class TelegramError(Exception):
    pass


async def call(method: str, payload: dict[str, Any], timeout: float = 10.0) -> Any:
    token = get_settings().bot_token
    if not token:
        raise TelegramError("BOT_TOKEN is not configured")
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"https://api.telegram.org/bot{token}/{method}", json=payload)
    data = resp.json()
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


async def notify(chat_id: int, text: str) -> None:
    """Fire-and-forget message. Failures are logged, never raised."""
    if not get_settings().bot_token:
        return
    try:
        await call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML"})
    except Exception as exc:  # noqa: BLE001
        log.warning("notify %s failed: %s", chat_id, exc)


async def notify_admins(text: str) -> None:
    for admin_id in get_settings().admin_ids:
        await notify(admin_id, text)

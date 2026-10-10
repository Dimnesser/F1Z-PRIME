"""In-memory error journal (last 200 server/Mini App errors) + optional admin alerts."""
from __future__ import annotations

import logging
import time
from collections import deque
from datetime import datetime, timezone

log = logging.getLogger("f1z.monitor")

_errors: deque[dict] = deque(maxlen=200)
_last_alert = 0.0
ALERT_INTERVAL = 600  # at most one Telegram alert per 10 minutes


def recent(limit: int = 100) -> list[dict]:
    return list(reversed(_errors))[:limit]


def stats() -> dict:
    day_ago = time.time() - 86400
    last_day = [e for e in _errors if e["ts"] >= day_ago]
    return {
        "total": len(_errors),
        "last_24h": len(last_day),
        "server_24h": sum(1 for e in last_day if e["source"] == "server"),
        "client_24h": sum(1 for e in last_day if e["source"] == "client"),
    }


async def record(source: str, message: str, path: str = "", detail: str = "") -> None:
    """source: server | client. Sends a rate-limited alert when error_monitoring is enabled."""
    global _last_alert
    now = time.time()
    _errors.append(
        {
            "ts": now,
            "at": datetime.now(timezone.utc).isoformat(),
            "source": source,
            "message": message[:500],
            "path": path[:200],
            "detail": detail[:1500],
        }
    )
    if now - _last_alert < ALERT_INTERVAL:
        return
    try:
        from app.db import session_factory
        from app.services import settings as settings_service
        from app.services import telegram

        async with session_factory()() as session:
            enabled = await settings_service.get_bool(session, "error_monitoring")
        if not enabled:
            return
        _last_alert = now
        where = "сервера" if source == "server" else "Mini App"
        await telegram.notify_admins(f"⚠️ Ошибка {where}: {message[:200]}\n{path}")
    except Exception:  # noqa: BLE001
        log.exception("error alert failed")

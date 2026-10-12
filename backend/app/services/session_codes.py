"""Extract Telegram login codes from sold inventory .session files (Telethon).

Sold units store a phone / session basename. The matching file lives under SESSIONS_DIR.
Always disconnects the client so the SQLite session DB is not left locked.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import InventoryItem, Order, OrderStatus
from app.services import inventory
from app.services.common import ServiceError

log = logging.getLogger("f1z.session_codes")

TELEGRAM_SYSTEM_ID = 777000
# Login codes are 5 digits (legacy) or 6 digits; avoid matching years / long numbers nearby.
CODE_RE = re.compile(r"(?<!\d)(\d{5,6})(?!\d)")
_SESSION_SUFFIX = ".session"

# One Telethon connection per session file at a time (SQLite lock).
_locks: dict[str, asyncio.Lock] = {}
_locks_guard = asyncio.Lock()


async def _file_lock(path: Path) -> asyncio.Lock:
    key = str(path.resolve())
    async with _locks_guard:
        lock = _locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _locks[key] = lock
        return lock


def extract_code(text: str | None) -> str | None:
    """Return the most likely 5–6 digit auth code from a message body."""
    if not text:
        return None
    matches = CODE_RE.findall(text)
    if not matches:
        return None
    # Prefer 5–6 digit tokens that appear near typical login wording.
    lower = text.lower()
    for m in matches:
        idx = text.find(m)
        window = lower[max(0, idx - 40) : idx + len(m) + 40]
        if any(w in window for w in ("code", "код", "login", "вход", "confirm", "подтверж")):
            return m
    return matches[-1]


def resolve_session_path(secret: str, sessions_dir: Path) -> Path:
    """Map an inventory secret to a Telethon session file path."""
    raw = secret.strip().strip("\"'")
    if not raw:
        raise ServiceError("Пустой идентификатор сессии", 404, "session_missing")

    candidate = Path(raw)
    if candidate.is_absolute() and candidate.suffix == _SESSION_SUFFIX:
        return candidate
    if raw.endswith(_SESSION_SUFFIX):
        return sessions_dir / Path(raw).name

    digits = re.sub(r"\D+", "", raw)
    if digits:
        return sessions_dir / f"{digits}{_SESSION_SUFFIX}"

    # basename without extension
    name = Path(raw).name
    if not name.endswith(_SESSION_SUFFIX):
        name = f"{name}{_SESSION_SUFFIX}"
    return sessions_dir / name


async def read_login_code(session_path: Path, *, limit: int = 30) -> dict[str, str | None]:
    """Connect to a .session file, find the latest login code from 777000 (or inbox fallback)."""
    try:
        from telethon import TelegramClient
        from telethon.errors import RPCError
    except ImportError as exc:
        raise ServiceError("Пакет Telethon не установлен на сервере", 503, "telethon_missing") from exc

    settings = get_settings()
    if not settings.telegram_api_id or not settings.telegram_api_hash:
        raise ServiceError("Telegram API_ID / API_HASH не настроены на сервере", 503, "telethon_unconfigured")
    if not session_path.exists():
        raise ServiceError("Файл сессии не найден", 404, "session_missing")

    # Telethon appends .session itself when given a path without the suffix.
    session_name = str(session_path.with_suffix(""))
    lock = await _file_lock(session_path)
    async with lock:
        client = TelegramClient(session_name, settings.telegram_api_id, settings.telegram_api_hash)
        try:
            await client.connect()
            if not await client.is_user_authorized():
                raise ServiceError("Сессия не авторизована", 409, "session_unauthorized")

            code, source, message = await _scan_dialog(client, TELEGRAM_SYSTEM_ID, limit)
            if code is None:
                code, source, message = await _scan_inbox(client, limit)
            if code is None:
                raise ServiceError("Код входа пока не найден. Запросите код в Telegram и нажмите снова.", 404, "code_not_found")
            return {"code": code, "source": source, "message": message}
        except ServiceError:
            raise
        except RPCError as exc:
            log.warning("telethon RPC error for %s: %s", session_path.name, exc)
            raise ServiceError("Telegram временно недоступен, попробуйте чуть позже", 502, "telethon_rpc") from exc
        except OSError as exc:
            log.warning("session file error %s: %s", session_path.name, exc)
            raise ServiceError("Не удалось открыть файл сессии", 500, "session_io") from exc
        except Exception as exc:  # noqa: BLE001
            log.exception("unexpected telethon failure for %s", session_path.name)
            raise ServiceError("Не удалось получить код входа", 500, "telethon_error") from exc
        finally:
            if client.is_connected():
                await client.disconnect()


async def _scan_dialog(client, peer_id: int, limit: int) -> tuple[str | None, str | None, str | None]:  # noqa: ANN001
    try:
        messages = await client.get_messages(peer_id, limit=limit)
    except Exception:  # noqa: BLE001 - dialog may be missing
        return None, None, None
    for msg in messages:
        text = getattr(msg, "message", None) or getattr(msg, "text", None)
        code = extract_code(text)
        if code:
            return code, str(peer_id), (text or "")[:200]
    return None, None, None


async def _scan_inbox(client, limit: int) -> tuple[str | None, str | None, str | None]:  # noqa: ANN001
    """Fallback: newest incoming private messages that look like login codes."""
    from telethon.tl.types import User as TlUser

    async for dialog in client.iter_dialogs(limit=15):
        entity = dialog.entity
        if not isinstance(entity, TlUser) or entity.bot:
            continue
        if dialog.id == TELEGRAM_SYSTEM_ID:
            continue  # already tried
        messages = await client.get_messages(entity, limit=min(10, limit))
        for msg in messages:
            if getattr(msg, "out", False):
                continue
            text = getattr(msg, "message", None) or getattr(msg, "text", None)
            code = extract_code(text)
            if code:
                return code, str(getattr(entity, "id", dialog.id)), (text or "")[:200]
    return None, None, None


async def code_for_order(session: AsyncSession, order_id: int, user_id: int) -> dict[str, str | None]:
    """Resolve the order's sold session and return its latest login code."""
    order = await session.get(Order, order_id)
    if order is None or order.user_id != user_id:
        raise ServiceError("Заказ не найден", 404, "order_not_found")
    if order.status != OrderStatus.completed or order.fulfillment_status != "delivered":
        raise ServiceError("Код доступен только после выдачи заказа", 409, "order_not_delivered")

    units = list(
        (
            await session.scalars(
                select(InventoryItem)
                .where(InventoryItem.order_id == order.id, InventoryItem.status == "sold")
                .order_by(InventoryItem.id)
            )
        ).all()
    )
    if not units:
        raise ServiceError("У этого заказа нет сессии для получения кода", 404, "no_session_unit")

    secrets = inventory.delivered_secrets(units)
    settings = get_settings()
    sessions_dir = Path(settings.sessions_dir)
    last_err: ServiceError | None = None
    for secret in secrets:
        try:
            path = resolve_session_path(secret, sessions_dir)
            result = await read_login_code(path)
            log.info("login code issued for order %s from %s", order.id, path.name)
            return result
        except ServiceError as exc:
            last_err = exc
            if exc.code not in ("session_missing", "session_unauthorized"):
                raise
            continue
    raise last_err or ServiceError("Файл сессии не найден", 404, "session_missing")

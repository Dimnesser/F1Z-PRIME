"""Automatic delivery of premium-number accounts.

A paid premium order whose number has a bound manual session is delivered to the buyer by the bot (the .session file
and the 2FA password) and then completed, with no operator action. The same send routine backs the admin button.

Orders whose number has no session yet are left untouched and picked up as soon as a session is uploaded. A buyer who
has blocked the bot is retried on a backoff rather than on every tick.
"""
from __future__ import annotations

import html
import logging

from sqlalchemy import select

from app.db import session_factory
from app.models import ManualSession, Order, OrderStatus, PremiumNumber
from app.services import crypto, telegram
from app.services.common import ServiceError, lock, utcnow
from app.services.file_storage import lock_filename

log = logging.getLogger("f1z.premium_delivery")
DELIVERABLE = (OrderStatus.paid, OrderStatus.processing, OrderStatus.completed)
RETRY_BACKOFF = 600  # seconds between retries for a buyer the bot cannot reach


async def send(session, order: Order, row: ManualSession, number: PremiumNumber | None) -> None:  # noqa: ANN001
    """Send the bound .session + 2FA to the buyer and mark the manual session delivered (caller commits)."""
    from app.services.session_downloads import session_path

    await lock_filename(session, row.filename)
    path = session_path(row.filename)
    chat_id = order.user.telegram_id
    phone = number.number if number else row.phone_e164
    password = crypto.decrypt(row.two_fa_enc) if row.two_fa_enc else None
    text = (f"\U0001F381 <b>Ваш красивый номер · {html.escape(order.public_id or str(order.id))}</b>\n"
            f"{html.escape(order.item_title)}\n\n\U0001F4F1 Номер: <code>{html.escape(phone)}</code>\n")
    if password:
        text += f"\U0001F510 Пароль 2FA: <code>{html.escape(password)}</code>\n"
    text += ("\nФайл .session отправлен отдельным сообщением (клиенты с поддержкой Telethon). "
             "Храните файл и пароль в надёжном месте и проверьте активные сеансы после входа.")
    try:
        await telegram.send_document(chat_id, path, caption=f"{order.public_id or order.id} · Сессия")
        await telegram.call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                                            "protect_content": True, "disable_web_page_preview": True}, timeout=15)
    except telegram.TelegramError:
        raise ServiceError("Telegram не принял сообщение: покупатель мог заблокировать бота. Повторите позже.", 502,
                           "premium_send_failed") from None
    row.delivered_order_id, row.delivered_at = order.id, utcnow()


async def _deliver_one(order_id: int) -> bool:
    from app.services import orders as order_service

    async with session_factory()() as session:
        order = await lock(session, Order, order_id)
        if order is None or not order.premium_number_id or order.status not in DELIVERABLE:
            return False
        row = await session.scalar(select(ManualSession).where(
            ManualSession.premium_number_id == order.premium_number_id).with_for_update())
        if row is None or row.delivered_order_id not in (None, order.id):
            return False
        number = await session.get(PremiumNumber, order.premium_number_id)
        await send(session, order, row, number)
        if order.status != OrderStatus.completed:
            await order_service.change_status(session, order.id, OrderStatus.completed,
                                              delivery_data=number.number if number else None, admin_note=None,
                                              actor="auto:premium_delivery")
        await session.commit()
    return True


async def deliver_due() -> str:
    """Deliver every paid premium order that has a bound, not-yet-delivered session."""
    async with session_factory()() as session:
        ids = list((await session.scalars(
            select(Order.id).join(ManualSession, ManualSession.premium_number_id == Order.premium_number_id)
            .where(Order.premium_number_id.is_not(None), Order.status.in_((OrderStatus.paid, OrderStatus.processing)),
                   ManualSession.delivered_order_id.is_(None)).order_by(Order.id))).all())
    sent = failed = 0
    for order_id in ids:
        try:
            if await _deliver_one(order_id):
                sent += 1
        except ServiceError:
            failed += 1  # buyer unreachable; retried next tick
        except Exception:
            log.exception("premium auto-delivery failed for order %s", order_id)
            failed += 1
    return f"premium_delivered:{sent},pending:{failed}"

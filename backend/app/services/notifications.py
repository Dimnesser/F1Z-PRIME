"""Telegram notifications for customers and staff, built from editable templates.

- Variables like {order_id} are substituted by a strict regex (no str.format, no attribute access) and
  HTML-escaped, so template text and user data can't inject markup or code.
- Messages are sent by the worker through the job queue: retries with backoff, and a dedupe key per
  (order, event) so repeated events never send the same message twice.
- Secrets (license keys etc.) are never put into notifications — the message links to the order instead.
"""
from __future__ import annotations

import html
import re
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AdminUser, NotificationTemplate, Order
from app.services import jobs
from app.services import settings as settings_service

VAR_RE = re.compile(r"\{([a-z_]{2,32})\}")

# key: (audience, title for the editor, default text, default button, enabled by default)
TEMPLATES: dict[str, tuple[str, str, str, str, bool]] = {
    # --- customers
    "order_created": ("customer", "Заказ создан",
                      "🧾 <b>Заказ {order_no} создан</b>\n{product_name}\nСумма: <b>{price}</b>\n\nОплатите в течение {reserve_minutes} мин — товар зарезервирован за вами.",
                      "Оплатить", False),
    "payment_review": ("customer", "Платёж на проверке",
                       "🔎 <b>Платёж по заказу {order_no} на проверке</b>\nМы сообщим, как только администратор подтвердит поступление.",
                       "Открыть заказ", True),
    "payment_confirmed": ("customer", "Оплата подтверждена",
                          "✅ <b>Оплата заказа {order_no} подтверждена</b>\n{product_name} · {price}",
                          "Открыть заказ", True),
    "payment_rejected": ("customer", "Платёж отклонён",
                         "❌ <b>Платёж по заказу {order_no} отклонён</b>\n{reason}",
                         "Открыть заказ", True),
    "order_processing": ("customer", "Заказ обрабатывается",
                         "⏳ <b>Заказ {order_no} оплачен и передан в обработку</b>\n{product_name}\nОператор выдаст товар в ближайшее время.",
                         "Открыть заказ", True),
    "order_delivered": ("customer", "Товар выдан",
                        "🎉 <b>Заказ {order_no} выполнен</b>\n{product_name}\nДанные для получения — в карточке заказа.",
                        "Получить товар", True),
    "order_review": ("customer", "Требуется проверка",
                     "🛡 <b>Заказ {order_no} на дополнительной проверке</b>\nЭто займёт немного времени, оплата сохранена.",
                     "Открыть заказ", True),
    "order_cancelled": ("customer", "Заказ отменён",
                        "🚫 <b>Заказ {order_no} отменён</b>\n{reason}", "Открыть заказ", True),
    "order_expired": ("customer", "Резерв истёк",
                      "⌛️ <b>Время на оплату заказа {order_no} истекло</b>\nТовар снова в продаже — оформите заказ заново.",
                      "В магазин", True),
    "order_refunded": ("customer", "Возврат выполнен",
                       "↩️ <b>Возврат по заказу {order_no}</b>\nСумма: <b>{price}</b> — {reason}", "Открыть заказ", True),
    "order_problem": ("customer", "Возникла проблема",
                      "⚠️ <b>С заказом {order_no} возникла задержка</b>\nОплата сохранена, мы уже разбираемся. При вопросах — напишите в поддержку.",
                      "Открыть заказ", True),
    # --- staff
    "staff_new_sale": ("staff", "Новая продажа", "💰 <b>Продажа {order_no}</b>\n{product_name} · {price}\nПокупатель: {customer_name}", "", True),
    "staff_big_order": ("staff", "Крупный заказ", "💎 <b>Крупный заказ {order_no}</b> на {price}\n{product_name}", "", True),
    "staff_manual_task": ("staff", "Нужна ручная выдача", "📦 <b>Заказ {order_no} ждёт выдачи оператором</b>\n{product_name} · {price}", "", True),
    "staff_payment_review": ("staff", "Платёж на проверке", "🧾 <b>Платёж {payment_id} на проверке</b>\nЗаказ {order_no} · {price}\nКомментарий: {reason}", "", True),
    "staff_fulfillment_failed": ("staff", "Ошибка выдачи", "🔥 <b>Ошибка выдачи заказа {order_no}</b>\n{reason}", "", True),
    "staff_refund_request": ("staff", "Запрос на возврат", "↩️ <b>Возврат по заказу {order_no}</b> на {price}\nПричина: {reason}", "", True),
    "staff_low_stock": ("staff", "Низкий остаток", "📉 <b>Низкий остаток</b>\n{reason}", "", True),
    "staff_out_of_stock": ("staff", "Товар закончился", "🚫 <b>Закончился товар</b>\n{product_name}", "", True),
    "staff_new_ticket": ("staff", "Новое обращение", "🆘 <b>Обращение {ticket_id}</b>: {reason}", "", True),
    "staff_incident": ("staff", "Критическая ошибка", "⚠️ <b>{reason}</b>", "", True),
    "staff_phone_verification": ("staff", "Проверка номера", "📞 <b>Заявка на подтверждение номера</b>\nЗаказ {order_no} · {product_name}\n{reason}", "", True),
    "staff_daily_summary": ("staff", "Ежедневная сводка", "📊 <b>Сводка за {date}</b>\n{reason}", "", True),
}

# which staff permission is needed to receive a staff notification (used with RBAC)
STAFF_KIND_PERMISSION = {
    "staff_new_sale": "orders.view", "staff_big_order": "orders.view", "staff_manual_task": "orders.fulfill",
    "staff_payment_review": "payments.confirm", "staff_fulfillment_failed": "orders.fulfill",
    "staff_refund_request": "refunds.approve", "staff_low_stock": "products.stock",
    "staff_out_of_stock": "products.stock", "staff_new_ticket": "support.reply",
    "staff_incident": "system.view", "staff_daily_summary": "finance.view",
    "staff_phone_verification": "orders.fulfill",
}

CRITICAL = {"staff_incident", "staff_fulfillment_failed"}


def render(text: str, values: dict[str, Any]) -> str:
    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in values:
            return m.group(0)
        return html.escape(str(values[key]), quote=False)

    return VAR_RE.sub(sub, text)


def sample_values() -> dict[str, str]:
    return {
        "order_id": "128", "order_no": "F1Z-000128", "product_name": "Номер США", "price": "75 грн",
        "status": "Выполнен", "customer_name": "Иван", "reason": "пример причины", "payment_id": "#42",
        "ticket_id": "#7", "date": "11.10.2026", "reserve_minutes": "30",
    }


async def get_template(session: AsyncSession, key: str) -> tuple[bool, str, str]:
    row = await session.get(NotificationTemplate, key)
    _, _, text, button, enabled = TEMPLATES[key]
    if row is None:
        return enabled, text, button
    return row.enabled, row.text, row.button_text


def order_values(order: Order, **extra: Any) -> dict[str, Any]:
    u = order.user
    name = " ".join(x for x in (u.first_name, u.last_name) if x) or (f"@{u.username}" if u.username else str(u.telegram_id))
    values = {
        "order_id": order.id, "order_no": order.public_id or f"#{order.id}", "product_name": order.item_title,
        "price": f"{order.total} грн", "status": order.status.value, "customer_name": name, "reason": "",
    }
    values.update(extra)
    return values


def order_button(order_id: int, text: str) -> dict | None:
    url = get_settings().webapp_url.rstrip("/")
    if not text or not url.startswith("https://"):
        return None
    return {"inline_keyboard": [[{"text": text, "web_app": {"url": f"{url}/orders/{order_id}"}}]]}


async def notify_customer(session: AsyncSession, order: Order, event: str, *, dedupe: str | None = None, **extra: Any) -> bool:
    """Queue a customer message for an order event. Returns False if disabled. Same (order, event) is sent once."""
    if not await settings_service.get_bool(session, "notify_customers"):
        return False
    enabled, text, button = await get_template(session, event)
    if not enabled:
        return False
    if event == "order_created":
        extra.setdefault("reserve_minutes", get_settings().order_ttl_minutes)
    payload = {
        "chat_id": order.user.telegram_id,
        "text": render(text, order_values(order, **extra)),
        "reply_markup": order_button(order.id, button),
    }
    await jobs.enqueue(session, "tg_message", payload, dedupe_key=f"notify:{order.id}:{dedupe or event}")
    return True


async def staff_recipients(session: AsyncSession, kind: str) -> list[int]:
    """Owner + ADMIN_TELEGRAM_IDS + active staff accounts with a linked Telegram id that hold the permission."""
    return await recipients_with_permission(session, STAFF_KIND_PERMISSION.get(kind))


async def recipients_with_permission(session: AsyncSession, perm: str | None) -> list[int]:
    from app.services import rbac

    ids = list(get_settings().admin_ids)
    accounts = (
        await session.scalars(select(AdminUser).where(AdminUser.is_active.is_(True), AdminUser.telegram_id.is_not(None)))
    ).all()
    for a in accounts:
        if await rbac.account_has(session, a, perm) and a.telegram_id not in ids:
            ids.append(a.telegram_id)  # type: ignore[arg-type]
    return ids


def _quiet_delay(start: str, end: str, now: datetime | None = None) -> int:
    """Seconds until quiet hours end (0 when not in quiet hours). Times are HH:MM in the shop timezone."""
    try:
        sh, sm = map(int, start.split(":"))
        eh, em = map(int, end.split(":"))
    except ValueError:
        return 0
    if (sh, sm) == (eh, em):
        return 0
    tz = ZoneInfo("Europe/Kyiv")
    now = (now or datetime.now(tz)).astimezone(tz)
    s = now.replace(hour=sh, minute=sm, second=0, microsecond=0)
    e = now.replace(hour=eh, minute=em, second=0, microsecond=0)
    if s < e:
        inside = s <= now < e
        until = e
    else:  # over midnight, e.g. 23:00-08:00
        inside = now >= s or now < e
        until = e if now < e else e + timedelta(days=1)
    return int((until - now).total_seconds()) if inside else 0


async def notify_staff(
    session: AsyncSession, kind: str, values: dict[str, Any], *, dedupe: str | None = None
) -> int:
    """Queue a staff message to every recipient allowed to see it. Returns the number of queued messages."""
    enabled, text, _ = await get_template(session, kind)
    if not enabled or not await settings_service.get_bool(session, "notify_staff"):
        return 0
    group = {"staff_new_sale": "notify_orders", "staff_big_order": "notify_orders", "staff_manual_task": "notify_orders",
             "staff_payment_review": "notify_payments", "staff_new_ticket": "notify_tickets"}.get(kind)
    if group and not await settings_service.get_bool(session, group):
        return 0
    delay = 0
    if kind not in CRITICAL and await settings_service.get_bool(session, "quiet_hours_enabled"):
        delay = _quiet_delay(
            await settings_service.get_value(session, "quiet_hours_start"),
            await settings_service.get_value(session, "quiet_hours_end"),
        )
    body = render(text, {**sample_values_empty(), **values})
    n = 0
    for chat_id in await staff_recipients(session, kind):
        await jobs.enqueue(
            session, "tg_message", {"chat_id": chat_id, "text": body, "reply_markup": None},
            dedupe_key=f"staff:{dedupe}:{chat_id}" if dedupe else None, delay_seconds=delay,
        )
        n += 1
    return n


def sample_values_empty() -> dict[str, str]:
    return {k: "" for k in sample_values()}

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting

# key: (default, description, is_public)
DEFAULT_SETTINGS: dict[str, tuple[str, str, bool]] = {
    "shop_name": ("F1Z PRIME", "Название магазина", True),
    "banner_title": ("Премиальные цифровые товары", "Заголовок баннера на главной", True),
    "banner_subtitle": (
        "Номера 8 стран, красивые номера и мгновенная выдача после оплаты",
        "Подзаголовок баннера",
        True,
    ),
    "currency": ("грн", "Валюта отображения", True),
    "support_contact": ("@f1z_support", "Контакт поддержки", True),
    "uah_per_star": ("0.85", "Курс: сколько грн стоит 1 Telegram Star", True),
    "stars_enabled": ("true", "Оплата Telegram Stars включена", True),
    "manual_enabled": ("true", "Ручная оплата (перевод на карту) включена", True),
    "manual_payment_details": (
        "Переведите сумму на карту, указанную администратором, и укажите номер платежа в комментарии.",
        "Реквизиты для ручной оплаты",
        True,
    ),
    "min_topup": ("50", "Минимальная сумма пополнения, грн", True),
    "max_topup": ("50000", "Максимальная сумма пополнения, грн", True),
    # --- store profile (shown in the Mini App)
    "shop_description": ("", "Описание магазина", True),
    "support_url": ("", "Ссылка на поддержку (https://t.me/...)", True),
    "channel_url": ("", "Ссылка на канал / новости", True),
    "rules_url": ("", "Ссылка на правила магазина", True),
    "banner_image_url": ("", "Изображение баннера на главной (https://...)", True),
    "maintenance_mode": ("false", "Технический режим: покупки и пополнения временно отключены", True),
    "maintenance_message": (
        "Магазин на техническом обслуживании. Скоро вернёмся!",
        "Текст для покупателей в техническом режиме",
        True,
    ),
    # --- admin notifications (private)
    "notify_orders": ("true", "Уведомлять администраторов о новых оплаченных заказах", False),
    "notify_payments": ("true", "Уведомлять о платежах (ручные переводы, Stars)", False),
    "notify_tickets": ("true", "Уведомлять о новых обращениях и сообщениях", False),
    # --- automation (private)
    "auto_complete_digital": (
        "false",
        "Автоматически завершать оплаченные заказы цифровых товаров (выдаётся «инструкция после оплаты»)",
        False,
    ),
    "low_stock_alerts": ("true", "Уведомлять о низких остатках товаров", False),
    "low_stock_threshold": ("5", "Порог низкого остатка, шт.", False),
    "notification_retry": ("true", "Повторно отправлять недоставленные уведомления", False),
    "expire_reservations": ("true", "Снимать резерв с неоплаченных заказов по истечении времени", False),
    "auto_backup": ("true", "Ежедневная резервная копия базы", False),
    "error_monitoring": ("true", "Сообщать администраторам об ошибках сервера и Mini App", False),
}

BOOL_KEYS = {
    "stars_enabled", "manual_enabled", "maintenance_mode", "notify_orders", "notify_payments", "notify_tickets",
    "auto_complete_digital", "low_stock_alerts", "notification_retry", "expire_reservations", "auto_backup",
    "error_monitoring",
}
POSITIVE_NUMBER_KEYS = {"uah_per_star", "min_topup", "max_topup"}
INT_KEYS = {"low_stock_threshold"}
URL_KEYS = {"support_url", "channel_url", "rules_url", "banner_image_url"}


def validate(key: str, value: str) -> str:
    """Normalise and validate a setting value. Raises ValueError with a user-facing message."""
    value = value.strip()
    if key not in DEFAULT_SETTINGS:
        raise ValueError(f"Неизвестная настройка: {key}")
    if key in BOOL_KEYS:
        low = value.lower()
        if low not in {"true", "false"}:
            raise ValueError(f"{key}: ожидается true или false")
        return low
    if key in POSITIVE_NUMBER_KEYS:
        try:
            if Decimal(value) <= 0:
                raise InvalidOperation
        except InvalidOperation:
            raise ValueError(f"{key}: нужно положительное число") from None
    if key in INT_KEYS and (not value.isdigit() or int(value) > 100_000):
        raise ValueError(f"{key}: нужно целое число от 0")
    if key in URL_KEYS and value and not value.startswith("https://"):
        raise ValueError(f"{key}: ссылка должна начинаться с https://")
    if key == "shop_name" and not value:
        raise ValueError("Название магазина не может быть пустым")
    return value


async def get_all(session: AsyncSession, public_only: bool = False) -> dict[str, str]:
    values = {k: v[0] for k, v in DEFAULT_SETTINGS.items() if not public_only or v[2]}
    rows = (await session.scalars(select(Setting))).all()
    for row in rows:
        if public_only and not row.is_public:
            continue
        values[row.key] = row.value
    return values


async def get_value(session: AsyncSession, key: str) -> str:
    row = await session.get(Setting, key)
    if row is not None:
        return row.value
    return DEFAULT_SETTINGS.get(key, ("", "", False))[0]


async def get_bool(session: AsyncSession, key: str) -> bool:
    return (await get_value(session, key)).strip().lower() in {"1", "true", "yes", "on"}


async def get_decimal(session: AsyncSession, key: str, fallback: str = "0") -> Decimal:
    try:
        return Decimal(await get_value(session, key))
    except InvalidOperation:
        return Decimal(fallback)


async def ensure_open(session: AsyncSession) -> None:
    """Technical mode: browsing works, but new purchases and top-ups are paused (Mini App and bot)."""
    if await get_bool(session, "maintenance_mode"):
        from app.services.common import ServiceError

        message = await get_value(session, "maintenance_message")
        raise ServiceError(message or "Магазин на техническом обслуживании", 503, "maintenance")


async def ensure_defaults(session: AsyncSession) -> None:
    existing = set((await session.scalars(select(Setting.key))).all())
    for key, (value, description, is_public) in DEFAULT_SETTINGS.items():
        if key not in existing:
            session.add(Setting(key=key, value=value, description=description, is_public=is_public))

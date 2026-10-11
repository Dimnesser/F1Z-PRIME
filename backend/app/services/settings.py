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
        "Номера 13 стран, красивые номера и аккаунты — выдача после подтверждения оплаты",
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
        "Автоматическая выдача товаров с режимом «auto» (ключи из склада или инструкция) после подтверждённой оплаты",
        False,
    ),
    "low_stock_alerts": ("true", "Уведомлять о низких остатках товаров", False),
    "low_stock_threshold": ("5", "Порог низкого остатка, шт.", False),
    "notification_retry": ("true", "Повторно отправлять недоставленные уведомления", False),
    "expire_reservations": ("true", "Снимать резерв с неоплаченных заказов по истечении времени", False),
    "auto_backup": ("true", "Ежедневная резервная копия базы", False),
    "error_monitoring": ("true", "Сообщать администраторам об ошибках сервера и Mini App", False),
    # --- store profile & catalog (public)
    "shop_logo_url": ("", "Логотип магазина (https://...)", True),
    "language": ("ru", "Язык интерфейса Mini App", True),
    "show_out_of_stock": ("true", "Показывать товары без остатка (с пометкой «нет в наличии»)", True),
    "catalog_sort": ("manual", "Сортировка каталога: manual, price_asc, price_desc, popular, new", True),
    "promo_banner_text": ("", "Текст промо-баннера на главной (пусто — скрыт)", True),
    "promo_banner_url": ("", "Ссылка промо-баннера (https://...)", True),
    # --- guarantee block (Mini App: product, country and checkout screens)
    "guarantee_enabled": ("true", "Показывать блок гарантии", True),
    "guarantee_days": ("14", "Срок гарантии, дней", True),
    "guarantee_title": ("Гарантия 14 дней", "Заголовок блока гарантии", True),
    "guarantee_text": (
        "Если в течение 14 дней пропал доступ — заменим товар или вернём 80% стоимости. "
        "Решение принимается после проверки обращения в поддержку.",
        "Условия гарантии",
        True,
    ),
    "guarantee_categories": ("numbers,accounts", "Категории с гарантией (через запятую)", True),
    "country_requests_enabled": ("true", "Разрешить заказ страны, которой нет в каталоге (через поддержку)", True),
    "phone_verification_enabled": ("false", "Открывать заявку на подтверждение владения номером (мок-провайдер)", False),
    "refund_policy": ("Возврат возможен, если товар не был выдан. Обратитесь в поддержку.", "Правила возвратов", True),
    # --- orders (private)
    "min_order_total": ("0", "Минимальная сумма заказа, грн (0 — без ограничения)", False),
    "max_order_total": ("0", "Максимальная сумма заказа, грн (0 — без ограничения)", False),
    "max_items_per_user_day": ("0", "Лимит покупок одного товара на пользователя в сутки (0 — без лимита)", False),
    "big_order_threshold": ("1000", "Крупный заказ от, грн (уведомление владельцу)", False),
    # --- notifications (private)
    "notify_customers": ("true", "Отправлять покупателям уведомления о заказах", False),
    "notify_staff": ("true", "Отправлять уведомления сотрудникам в Telegram", False),
    "quiet_hours_enabled": ("false", "Тихие часы для некритичных уведомлений сотрудникам", False),
    "quiet_hours_start": ("23:00", "Начало тихих часов (Киев)", False),
    "quiet_hours_end": ("08:00", "Конец тихих часов (Киев)", False),
    "daily_summary": ("true", "Ежедневная сводка продаж владельцу", False),
    "backup_interval_hours": ("24", "Интервал резервного копирования, часов", False),
}

GROUP: dict[str, str] = {
    **{k: "store" for k in ("shop_name", "shop_description", "shop_logo_url", "currency", "language", "support_contact",
                            "support_url", "channel_url", "rules_url", "refund_policy", "guarantee_enabled",
                            "guarantee_days", "guarantee_title", "guarantee_text", "guarantee_categories",
                            "country_requests_enabled")},
    **{k: "showcase" for k in ("banner_title", "banner_subtitle", "banner_image_url", "promo_banner_text",
                               "promo_banner_url", "show_out_of_stock", "catalog_sort")},
    **{k: "payments" for k in ("uah_per_star", "stars_enabled", "manual_enabled", "manual_payment_details", "min_topup",
                               "max_topup")},
    **{k: "orders" for k in ("min_order_total", "max_order_total", "max_items_per_user_day", "big_order_threshold",
                             "maintenance_mode", "maintenance_message")},
    **{k: "notifications" for k in ("notify_orders", "notify_payments", "notify_tickets", "notify_customers",
                                    "notify_staff", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end",
                                    "daily_summary")},
    **{k: "automation" for k in ("auto_complete_digital", "low_stock_alerts", "low_stock_threshold",
                                 "notification_retry", "expire_reservations", "auto_backup", "error_monitoring",
                                 "backup_interval_hours", "phone_verification_enabled")},
}
# settings read once at process start (shown with a warning in the panel)
RESTART_REQUIRED: set[str] = set()
TIME_KEYS = {"quiet_hours_start", "quiet_hours_end"}
CHOICES = {"catalog_sort": {"manual", "price_asc", "price_desc", "popular", "new"}, "language": {"ru", "uk", "en"}}

BOOL_KEYS = {
    "stars_enabled", "manual_enabled", "maintenance_mode", "notify_orders", "notify_payments", "notify_tickets",
    "auto_complete_digital", "low_stock_alerts", "notification_retry", "expire_reservations", "auto_backup",
    "error_monitoring", "show_out_of_stock", "guarantee_enabled", "country_requests_enabled", "phone_verification_enabled", "notify_customers", "notify_staff", "quiet_hours_enabled", "daily_summary",
}
POSITIVE_NUMBER_KEYS = {"uah_per_star", "min_topup", "max_topup"}
NON_NEGATIVE_NUMBER_KEYS = {"min_order_total", "max_order_total", "big_order_threshold"}
INT_KEYS = {"guarantee_days", "low_stock_threshold", "max_items_per_user_day", "backup_interval_hours"}
URL_KEYS = {"support_url", "channel_url", "rules_url", "banner_image_url", "shop_logo_url", "promo_banner_url"}


def kind(key: str) -> str:
    if key in BOOL_KEYS:
        return "bool"
    if key in POSITIVE_NUMBER_KEYS | NON_NEGATIVE_NUMBER_KEYS | INT_KEYS:
        return "number"
    if key in TIME_KEYS:
        return "time"
    if key in CHOICES:
        return "choice"
    return "text"


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
    if key in NON_NEGATIVE_NUMBER_KEYS:
        try:
            if Decimal(value) < 0:
                raise InvalidOperation
        except InvalidOperation:
            raise ValueError(f"{key}: нужно число от 0") from None
    if key in INT_KEYS and (not value.isdigit() or int(value) > 100_000):
        raise ValueError(f"{key}: нужно целое число от 0")
    if key == "backup_interval_hours" and not 1 <= int(value) <= 168:
        raise ValueError("Интервал резервного копирования: от 1 до 168 часов")
    if key in TIME_KEYS:
        import re

        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
            raise ValueError(f"{key}: время в формате ЧЧ:ММ")
    if key in CHOICES and value not in CHOICES[key]:
        raise ValueError(f"{key}: допустимо {', '.join(sorted(CHOICES[key]))}")
    if len(value) > 4000:
        raise ValueError(f"{key}: слишком длинное значение")
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

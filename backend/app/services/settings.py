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
}


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


async def ensure_defaults(session: AsyncSession) -> None:
    existing = set((await session.scalars(select(Setting.key))).all())
    for key, (value, description, is_public) in DEFAULT_SETTINGS.items():
        if key not in existing:
            session.add(Setting(key=key, value=value, description=description, is_public=is_public))

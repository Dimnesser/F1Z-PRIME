"""Number regions added after the 2026-10 catalog update (currently: Japan, +81).

Runs from the seed step at every API start, after `catalog_update.apply` (which hides countries outside its
13-country list on a fresh database). Idempotent: a missing country / numbers product is created; an existing
one is never overwritten, so prices and settings edited in the admin panel stay as they are.

Each region's product is ready for automatic delivery of verified Telegram sessions («номер + код входа»):
when the session wizard saves a session, `session_registry.register` finds this product via
`phones._product_for_country`, adds the number to `phone_inventory` as AVAILABLE and recomputes the stock.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Country, Product, ProductStatus

log = logging.getLogger("f1z.regions")

# code, name, flag, dial code, UAH, USD, Stars, sort order (after RU = 130)
REGIONS: list[tuple[str, str, str, str, str, str, int, int]] = [
    ("JP", "Япония", "🇯🇵", "+81", "250", "6.00", 650, 140),
]

DESCRIPTION = (
    "Виртуальный номер {flag} {name} ({dial}) для приёма SMS и регистрации в сервисах, "
    "разрешённых правилами платформ."
)
DELIVERY_NOTE = (
    "После подтверждения оплаты номер выдаётся автоматически. "
    "Для кода входа запросите его в Telegram и нажмите «Получить код входа»."
)


async def ensure(session: AsyncSession) -> list[str]:
    added: list[str] = []
    for code, name, flag, dial, uah, usd, stars, order in REGIONS:
        country = await session.scalar(select(Country).where(Country.code == code))
        if country is None:
            country = Country(code=code, name=name, flag=flag, dial_code=dial, sort_order=order, is_active=True)
            session.add(country)
            await session.flush()
            added.append(f"country:{code}")
        product = await session.scalar(
            select(Product).where(Product.country_id == country.id, Product.category == "numbers")
            .order_by(Product.id).limit(1)
        )
        if product is None:
            session.add(Product(
                title=f"Номер {name}", category="numbers", country_id=country.id,
                description=DESCRIPTION.format(flag=flag, name=name, dial=dial),
                price=Decimal(uah), price_usd=Decimal(usd), price_stars=stars, stock=0,
                status=ProductStatus.active, sort_order=order,
                fulfillment_mode="auto", uses_inventory=False, uses_phone_inventory=True,
                attributes={"delivery_kind": "phone_code"}, delivery_note=DELIVERY_NOTE,
            ))
            await session.flush()
            added.append(f"product:{code}")
    if added:
        log.info("regions added: %s", added)
    return added

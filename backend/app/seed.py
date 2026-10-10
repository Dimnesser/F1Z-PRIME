"""Idempotent seed: starting countries, products (prices/stock) and settings.

Usage:
    python -m app.seed            # countries + products + settings
    python -m app.seed --demo     # + demo premium numbers (DEMO data, replace before real sales)
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from decimal import Decimal

from sqlalchemy import select

from app.db import dispose_engine, session_factory
from app.models import Category, Country, PremiumNumber, Product, ProductStatus
from app.services import rbac
from app.services import settings as settings_service
from app.services.masks import auto_mask

log = logging.getLogger("f1z.seed")

COUNTRIES = [
    # code, name, flag, dial, price, stock
    ("CL", "Чили", "🇨🇱", "+56", "60", 40),
    ("UA", "Украина", "🇺🇦", "+380", "225", 25),
    ("US", "США", "🇺🇸", "+1", "75", 60),
    ("CA", "Канада", "🇨🇦", "+1", "75", 35),
    ("PL", "Польша", "🇵🇱", "+48", "225", 20),
    ("VN", "Вьетнам", "🇻🇳", "+84", "175", 30),
    ("ID", "Индонезия", "🇮🇩", "+62", "65", 45),
    ("BR", "Бразилия", "🇧🇷", "+55", "85", 50),
]

POPULAR = {"US", "UA", "PL", "BR"}

DEMO_PREMIUM = [
    ("US", "+1 415 777 7012", "+1 *** 7777 ***", "platinum", "299"),
    ("UA", "+380 67 000 0000", None, "vip", "1499"),
    ("PL", "+48 600 123 456", None, "gold", "449"),
    ("BR", "+55 11 9888 8811", None, "premium", "349"),
    ("CA", "+1 604 555 5555", None, "gold", "599"),
    ("VN", "+84 90 999 9900", None, "premium", "259"),
]


CATEGORIES = [
    ("numbers", "Номера по странам", "globe", 10),
    ("digital", "Цифровые товары", "sparkles", 20),
    ("services", "Сервисы", "zap", 30),
]


async def seed(demo: bool = False) -> dict[str, int]:
    created = {"countries": 0, "products": 0, "premium": 0}
    async with session_factory()() as session:
        await settings_service.ensure_defaults(session)
        await rbac.ensure_builtin_roles(session)
        known = set((await session.scalars(select(Category.slug))).all())
        for slug, title, icon, order in CATEGORIES:
            if slug not in known:
                session.add(Category(slug=slug, title=title, icon=icon, sort_order=order))
        by_code: dict[str, Country] = {
            c.code: c for c in (await session.scalars(select(Country))).all()
        }
        for i, (code, name, flag, dial, price, stock) in enumerate(COUNTRIES):
            country = by_code.get(code)
            if country is None:
                country = Country(code=code, name=name, flag=flag, dial_code=dial, sort_order=(i + 1) * 10)
                session.add(country)
                await session.flush()
                by_code[code] = country
                created["countries"] += 1
            exists = await session.scalar(
                select(Product.id).where(Product.country_id == country.id, Product.category == "numbers")
            )
            if exists is None:
                session.add(
                    Product(
                        title=f"Номер {name}",
                        description=(
                            f"Виртуальный номер {flag} {name} ({dial}) для приёма SMS и регистрации в сервисах, "
                            "разрешённых правилами платформ."
                        ),
                        category="numbers",
                        country_id=country.id,
                        price=Decimal(price),
                        stock=stock,
                        status=ProductStatus.active,
                        is_popular=code in POPULAR,
                        sort_order=(i + 1) * 10,
                        delivery_note="Данные номера будут выданы в этом заказе после обработки администратором.",
                    )
                )
                created["products"] += 1
        if demo:
            for code, number, mask, tier, price in DEMO_PREMIUM:
                normalized = "+" + "".join(ch for ch in number if ch.isdigit())
                if await session.scalar(select(PremiumNumber.id).where(PremiumNumber.number == normalized)):
                    continue
                country = by_code[code]
                session.add(
                    PremiumNumber(
                        country_id=country.id,
                        number=normalized,
                        display_mask=mask or auto_mask(normalized, country.dial_code),
                        tier=tier,
                        title=f"{tier.upper()} NUMBER",
                        description="ДЕМО-номер для презентации. Замените реальными номерами в админ-панели.",
                        price=Decimal(price),
                    )
                )
                created["premium"] += 1
        await session.commit()
    return created


def main() -> None:
    logging.basicConfig(level="INFO")
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="add demo premium numbers")
    args = parser.parse_args()

    async def run() -> None:
        result = await seed(demo=args.demo)
        log.info("seed done: %s", result)
        await dispose_engine()

    asyncio.run(run())


if __name__ == "__main__":
    main()

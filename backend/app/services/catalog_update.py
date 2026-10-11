"""One-time catalog update «countries 2026-10» (13 countries with UAH / USD / Stars prices, accounts category).

Runs from the seed step at API start and is recorded in the setting `catalog_version`, so it is applied once:
later edits made in the admin panel are never overwritten. Idempotent and duplicate-free:
countries are matched by ISO code, number products by (country, category «numbers»).
Existing orders, payments and paid amounts are not touched — orders keep their own unit price.
"""
from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Category, Country, PriceHistory, Product, ProductStatus, Setting, StockMovement
from app.services import inventory

log = logging.getLogger("f1z.catalog")

VERSION = "2026-10-countries"
ACTOR = "catalog:2026-10"

# code, name, flag, dial code, UAH, USD, Stars
COUNTRIES_2026_10: list[tuple[str, str, str, str, str, str, int]] = [
    ("US", "США", "🇺🇸", "+1", "75", "2.00", 150),
    ("CA", "Канада", "🇨🇦", "+1", "65", "1.90", 150),
    ("UA", "Украина", "🇺🇦", "+380", "140", "3.60", 375),
    ("GB", "Великобритания", "🇬🇧", "+44", "70", "3.40", 175),
    ("BD", "Бангладеш", "🇧🇩", "+880", "60", "1.40", 150),
    ("TR", "Турция", "🇹🇷", "+90", "55", "1.40", 150),
    ("IN", "Индия", "🇮🇳", "+91", "45", "1.20", 125),
    ("EG", "Египет", "🇪🇬", "+20", "50", "1.80", 125),
    ("PL", "Польша", "🇵🇱", "+48", "140", "3.60", 375),
    ("MR", "Мавритания", "🇲🇷", "+222", "100", "3.30", 275),
    ("UZ", "Узбекистан", "🇺🇿", "+998", "75", "2.00", 200),
    ("BR", "Бразилия", "🇧🇷", "+55", "80", "2.20", 215),
    ("RU", "Россия", "🇷🇺", "+7", "150", "4.00", 400),
]

ACCOUNTS_CATEGORY = ("accounts", "Рандом аккаунты 2015–2019", "user-round", 15)
ACCOUNTS_PRODUCT = {
    "title": "Рандом аккаунт 2015–2019",
    "description": (
        "Аккаунт с датой регистрации 2015–2019 (случайный). Заказ обрабатывается оператором вручную: "
        "после подтверждения оплаты оператор свяжется с вами в поддержке. Магазин не передаёт данные входа "
        "автоматически и не хранит сессии."
    ),
    "price": Decimal("75"),
    "price_stars": 150,
}

NUMBER_DESCRIPTION = (
    "Виртуальный номер {flag} {name} ({dial}) для приёма SMS и регистрации в сервисах, "
    "разрешённых правилами платформ. Выдаётся оператором после подтверждения оплаты."
)
OLD_BANNER = "Номера 8 стран, красивые номера и мгновенная выдача после оплаты"
NEW_BANNER = "Номера 13 стран, красивые номера и аккаунты — выдача после подтверждения оплаты"


def _history(session: AsyncSession, product: Product, field: str, old, new) -> None:  # noqa: ANN001
    if old != new:
        session.add(PriceHistory(product_id=product.id, field=field, old_value=old, new_value=new, actor=ACTOR))


async def _confirmed(session: AsyncSession, product_id: int) -> bool:
    """Stock is "confirmed" when staff set it at least once (manual correction, import, upload, initial)."""
    return (
        await session.scalar(
            select(StockMovement.id).where(
                StockMovement.product_id == product_id,
                StockMovement.reason.in_(["manual", "import", "initial", "mode"]),
            ).limit(1)
        )
    ) is not None


async def apply(session: AsyncSession, *, reset_unconfirmed_stock: bool, demo_stock: int = 0) -> dict | None:
    row = await session.get(Setting, "catalog_version")
    if row is not None and row.value == VERSION:
        return None
    report: dict = {"countries_added": [], "countries_updated": [], "prices_changed": [], "stock_reset": []}

    countries = {c.code: c for c in (await session.scalars(select(Country))).all()}
    for i, (code, name, flag, dial, uah, usd, stars) in enumerate(COUNTRIES_2026_10):
        country = countries.get(code)
        if country is None:
            country = Country(code=code, name=name, flag=flag, dial_code=dial, sort_order=(i + 1) * 10, is_active=True)
            session.add(country)
            await session.flush()
            report["countries_added"].append(code)
        else:
            country.flag, country.dial_code, country.is_active = flag, dial, True
            country.sort_order = (i + 1) * 10
            report["countries_updated"].append(code)

        product = await session.scalar(
            select(Product).where(Product.country_id == country.id, Product.category == "numbers")
            .order_by(Product.id).limit(1)
        )
        new_price, new_usd = Decimal(uah), Decimal(usd)
        if product is None:
            product = Product(
                title=f"Номер {country.name}", category="numbers", country_id=country.id, price=new_price,
                price_usd=new_usd, price_stars=stars, stock=demo_stock, status=ProductStatus.active, sort_order=(i + 1) * 10,
                description=NUMBER_DESCRIPTION.format(flag=flag, name=country.name, dial=dial),
                delivery_note="Данные номера будут выданы в этом заказе после обработки оператором.",
                fulfillment_mode="manual",
            )
            session.add(product)
            await session.flush()
            _history(session, product, "price", None, new_price)
            report["prices_changed"].append(f"{code}: новый товар {new_price} грн / ${new_usd} / {stars}⭐")
            continue
        if Decimal(product.price) != new_price:
            report["prices_changed"].append(f"{code}: {product.price} → {new_price} грн")
        _history(session, product, "price", Decimal(product.price), new_price)
        product.price, product.price_usd, product.price_stars = new_price, new_usd, stars
        product.sale_price = None  # the new list price replaces any old promotion
        product.sort_order = (i + 1) * 10
        if product.status == ProductStatus.archived:
            product.status = ProductStatus.active
    # the catalog is exactly these 13 countries: others are hidden (not deleted — orders keep their history,
    # and staff can show them again in the panel)
    listed = {c[0] for c in COUNTRIES_2026_10}
    for country in countries.values():
        if country.code not in listed and country.is_active:
            country.is_active = False
            report.setdefault("countries_hidden", []).append(country.code)
            for p in (await session.scalars(select(Product).where(Product.country_id == country.id,
                                                                  Product.category == "numbers"))).unique():
                if p.status == ProductStatus.active:
                    p.status = ProductStatus.hidden

    if reset_unconfirmed_stock:
        # numbers created by the initial seed carry placeholder stock nobody confirmed: hide "in stock" until staff
        # sets a real count (admin panel → Товары → остаток with a reason)
        for p in (await session.scalars(select(Product).where(Product.category == "numbers", Product.stock > 0))).unique():
            if not await _confirmed(session, p.id):
                report["stock_reset"].append(f"{p.title}: {p.stock} → 0")
                old_stock = p.stock
                p.stock = 0
                inventory.record(session, p, -old_stock, "catalog", actor=ACTOR,
                                 note="остаток не был подтверждён сотрудником — обнулён при обновлении каталога")

    slug, title, icon, order = ACCOUNTS_CATEGORY
    if await session.scalar(select(Category.id).where(Category.slug == slug)) is None:
        session.add(Category(slug=slug, title=title, icon=icon, sort_order=order))
    acc = await session.scalar(select(Product).where(Product.category == slug).order_by(Product.id).limit(1))
    if acc is None:
        acc = Product(
            title=ACCOUNTS_PRODUCT["title"], description=ACCOUNTS_PRODUCT["description"], category=slug,
            price=ACCOUNTS_PRODUCT["price"], price_stars=ACCOUNTS_PRODUCT["price_stars"], stock=0,
            status=ProductStatus.active, sort_order=10, fulfillment_mode="manual", uses_inventory=False,
            # Telegram's rules for Stars: transferring Telegram accounts isn't an allowed digital good, so this
            # product is paid by balance / card transfer only until the owner decides otherwise in the panel.
            stars_enabled=False,
            delivery_note="Оператор свяжется с вами в поддержке после подтверждения оплаты.",
        )
        session.add(acc)
        await session.flush()
        _history(session, acc, "price", None, acc.price)
        report["accounts_product"] = acc.id

    banner = await session.get(Setting, "banner_subtitle")
    if banner is not None and banner.value == OLD_BANNER:
        banner.value = NEW_BANNER
    if row is None:
        session.add(Setting(key="catalog_version", value=VERSION, description="Версия применённого обновления каталога",
                            is_public=False))
    else:
        row.value = VERSION
    log.info("catalog update %s applied: %s", VERSION, report)
    return report

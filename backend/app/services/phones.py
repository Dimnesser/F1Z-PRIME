"""Phone-number inventory: E.164 normalisation, automatic country detection, dedup, and atomic allocation.

Country is detected from the international dialling code with Google's libphonenumber (``phonenumbers``).
Numbers that resolve to several regions (e.g. +1 → US/CA/…) are reported as *ambiguous* and never guessed —
the admin picks the country explicitly. Stock per country/product is derived by counting ``AVAILABLE`` rows,
so counters can never drift from the real records.

This module stores and delivers only the sellable phone number. It never reads, stores or forwards any
Telegram login code or ``.session`` data.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import phonenumbers
from phonenumbers import NumberParseException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Country, Order, PhoneInventory, Product, ProductStatus
from app.services.common import ServiceError, utcnow

log = logging.getLogger("f1z.phones")

STATUSES = ("AVAILABLE", "RESERVED", "SOLD", "DISABLED")
MAX_BULK = 5000

# ISO region code -> Russian country name + flag (extends as the catalogue grows; falls back to the ISO code)
COUNTRY_RU: dict[str, tuple[str, str]] = {
    "US": ("США", "🇺🇸"), "CA": ("Канада", "🇨🇦"), "UA": ("Украина", "🇺🇦"), "GB": ("Великобритания", "🇬🇧"),
    "PL": ("Польша", "🇵🇱"), "BD": ("Бангладеш", "🇧🇩"), "TR": ("Турция", "🇹🇷"), "IN": ("Индия", "🇮🇳"),
    "EG": ("Египет", "🇪🇬"), "MR": ("Мавритания", "🇲🇷"), "UZ": ("Узбекистан", "🇺🇿"), "BR": ("Бразилия", "🇧🇷"),
    "RU": ("Россия", "🇷🇺"), "CL": ("Чили", "🇨🇱"), "VN": ("Вьетнам", "🇻🇳"), "ID": ("Индонезия", "🇮🇩"),
    "KZ": ("Казахстан", "🇰🇿"), "DE": ("Германия", "🇩🇪"), "FR": ("Франция", "🇫🇷"), "ES": ("Испания", "🇪🇸"),
    "IT": ("Италия", "🇮🇹"), "NL": ("Нидерланды", "🇳🇱"), "RO": ("Румыния", "🇷🇴"), "LT": ("Литва", "🇱🇹"),
    "LV": ("Латвия", "🇱🇻"), "EE": ("Эстония", "🇪🇪"), "GE": ("Грузия", "🇬🇪"), "AZ": ("Азербайджан", "🇦🇿"),
    "KG": ("Киргизия", "🇰🇬"), "TJ": ("Таджикистан", "🇹🇯"), "MD": ("Молдова", "🇲🇩"), "PH": ("Филиппины", "🇵🇭"),
    "ID_": ("Индонезия", "🇮🇩"),
}


def country_label(iso2: str) -> tuple[str, str]:
    """(name, flag) for an ISO-3166 alpha-2 code; falls back to the code itself and a generic flag."""
    return COUNTRY_RU.get(iso2.upper(), (iso2.upper(), "🏳️"))


@dataclass
class Detection:
    normalized: str | None          # E.164, e.g. "+14155552671"
    country_iso2: str | None        # single confident region, else None
    country_name: str | None
    flag: str | None
    ambiguous: list[str]            # several possible regions (admin must choose)
    valid: bool
    error: str | None


def normalize_raw(raw: str) -> str:
    """Strip spaces, dashes, brackets etc.; keep a leading '+'. Does not validate."""
    raw = (raw or "").strip()
    cleaned = re.sub(r"[^\d+]", "", raw)
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    return cleaned


def detect(raw: str, region_hint: str | None = None) -> Detection:
    """Parse and detect the country of a single number. Never guesses between several regions."""
    cleaned = normalize_raw(raw)
    if not cleaned:
        return Detection(None, None, None, None, [], False, "пустой номер")
    to_parse = cleaned if cleaned.startswith("+") else cleaned
    try:
        num = phonenumbers.parse(to_parse, region_hint or None)
    except NumberParseException as exc:
        return Detection(None, None, None, None, [], False, f"не удалось разобрать номер ({exc.error_type})")
    if not phonenumbers.is_valid_number(num):
        return Detection(None, None, None, None, [], False, "номер не прошёл проверку корректности")
    e164 = phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
    region = phonenumbers.region_code_for_number(num)
    regions = list(phonenumbers.region_codes_for_country_code(num.country_code) or [])
    regions = [r for r in regions if r and r != "ZZ"]
    if region and region != "ZZ":
        name, flag = country_label(region)
        return Detection(e164, region, name, flag, [], True, None)
    if len(regions) == 1:
        name, flag = country_label(regions[0])
        return Detection(e164, regions[0], name, flag, [], True, None)
    if len(regions) > 1:
        return Detection(e164, None, None, None, regions, True, None)  # ambiguous: admin chooses
    return Detection(e164, None, None, None, [], True, "страну определить не удалось")


# ---------------------------------------------------------------- product mapping / stock


async def _product_for_country(session: AsyncSession, iso2: str) -> Product | None:
    """The active `numbers` product for a country (by ISO code). None if the country/product is absent."""
    country = await session.scalar(select(Country).where(Country.code == iso2.upper()))
    if country is None:
        return None
    return await session.scalar(
        select(Product).where(Product.country_id == country.id, Product.category == "numbers")
        .order_by(Product.id).limit(1)
    )


async def available_count(session: AsyncSession, product_id: int) -> int:
    return await session.scalar(
        select(func.count(PhoneInventory.id)).where(
            PhoneInventory.product_id == product_id, PhoneInventory.status == "AVAILABLE"
        )
    ) or 0


async def sync_product_stock(session: AsyncSession, product: Product) -> int:
    """Recompute product.stock from AVAILABLE phone rows (the single source of truth)."""
    n = await available_count(session, product.id)
    product.stock = n
    if product.uses_phone_inventory and product.status == ProductStatus.hidden and n > 0 and product.price and product.price > 0:
        pass  # visibility is left to staff; stock is always truthful
    return n


async def counts(session: AsyncSession, product_ids: list[int]) -> dict[int, dict[str, int]]:
    if not product_ids:
        return {}
    rows = (
        await session.execute(
            select(PhoneInventory.product_id, PhoneInventory.status, func.count(PhoneInventory.id))
            .where(PhoneInventory.product_id.in_(product_ids))
            .group_by(PhoneInventory.product_id, PhoneInventory.status)
        )
    ).all()
    out: dict[int, dict[str, int]] = {}
    for pid, status, n in rows:
        out.setdefault(pid, {})[status] = n
    return out


# ---------------------------------------------------------------- adding numbers


async def add_one(
    session: AsyncSession, raw: str, *, actor: str, country_override: str | None = None, batch: str | None = None,
    note: str = "",
) -> dict:
    """Add a single number. Returns {status: added|duplicate|invalid|ambiguous, ...}. Commit is the caller's job."""
    det = detect(raw, region_hint=country_override)
    if det.normalized is None or not det.valid:
        return {"status": "invalid", "input": raw, "error": det.error or "некорректный номер"}
    iso2 = (country_override or det.country_iso2 or "").upper()
    if not iso2:
        return {"status": "ambiguous", "input": raw, "normalized": det.normalized, "options": det.ambiguous}
    if det.ambiguous and country_override and country_override.upper() not in det.ambiguous:
        return {"status": "invalid", "input": raw, "error": f"{country_override} не входит в возможные страны номера"}
    name, flag = country_label(iso2)
    product = await _product_for_country(session, iso2)
    res = await session.execute(
        pg_insert(PhoneInventory)
        .values(phone_e164=det.normalized, country_iso2=iso2, country_name=name,
                product_id=product.id if product else None, status="AVAILABLE",
                added_by=actor[:64], batch=batch, note=note[:255])
        .on_conflict_do_nothing(constraint="uq_phone_inventory_e164")
        .returning(PhoneInventory.id)
    )
    new_id = res.scalar_one_or_none()
    if new_id is None:
        return {"status": "duplicate", "normalized": det.normalized, "country_iso2": iso2}
    if product is not None:
        if not product.uses_phone_inventory:
            product.uses_phone_inventory = True
        await sync_product_stock(session, product)
    return {"status": "added", "id": new_id, "normalized": det.normalized, "country_iso2": iso2,
            "country_name": name, "flag": flag, "linked_product": product.id if product else None}


async def add_bulk(
    session: AsyncSession, raw_lines: list[str], *, actor: str, country_override: str | None = None,
    batch: str | None = None,
) -> dict:
    """Import many numbers. Dedups within the file and against the DB; recomputes affected product stock."""
    items = [ln for ln in (x.strip() for x in raw_lines) if ln]
    if len(items) > MAX_BULK:
        raise ServiceError(f"За один раз можно загрузить не более {MAX_BULK} номеров", 422)
    added = duplicates = invalid = ambiguous = 0
    seen: set[str] = set()
    errors: list[dict] = []
    ambiguous_samples: list[dict] = []
    touched: set[int] = set()
    for raw in items:
        det = detect(raw, region_hint=country_override)
        if det.normalized is None or not det.valid:
            invalid += 1
            if len(errors) < 50:
                errors.append({"input": raw, "error": det.error or "некорректный номер"})
            continue
        if det.normalized in seen:
            duplicates += 1
            continue
        seen.add(det.normalized)
        iso2 = (country_override or det.country_iso2 or "").upper()
        if not iso2:
            ambiguous += 1
            if len(ambiguous_samples) < 50:
                ambiguous_samples.append({"input": raw, "normalized": det.normalized, "options": det.ambiguous})
            continue
        name, _ = country_label(iso2)
        product = await _product_for_country(session, iso2)
        res = await session.execute(
            pg_insert(PhoneInventory)
            .values(phone_e164=det.normalized, country_iso2=iso2, country_name=name,
                    product_id=product.id if product else None, status="AVAILABLE",
                    added_by=actor[:64], batch=batch)
            .on_conflict_do_nothing(constraint="uq_phone_inventory_e164")
            .returning(PhoneInventory.id)
        )
        if res.scalar_one_or_none() is None:
            duplicates += 1
            continue
        added += 1
        if product is not None:
            touched.add(product.id)
            if not product.uses_phone_inventory:
                product.uses_phone_inventory = True
    for pid in touched:
        product = await session.get(Product, pid)
        if product is not None:
            await sync_product_stock(session, product)
    return {"added": added, "duplicates": duplicates, "invalid": invalid, "ambiguous": ambiguous,
            "errors": errors, "ambiguous_samples": ambiguous_samples, "touched_products": sorted(touched)}


# ---------------------------------------------------------------- allocation (orders)


async def reserve_for_order(session: AsyncSession, product: Product, order: Order, qty: int) -> None:
    """Atomically attach `qty` AVAILABLE numbers to an order. Concurrency-safe via SKIP LOCKED.

    The caller holds the product row lock; two simultaneous buyers can never take the same number.
    """
    ids = (
        await session.scalars(
            select(PhoneInventory.id)
            .where(PhoneInventory.product_id == product.id, PhoneInventory.status == "AVAILABLE")
            .order_by(PhoneInventory.id)
            .limit(qty)
            .with_for_update(skip_locked=True)
        )
    ).all()
    if len(ids) < qty:
        raise ServiceError("Недостаточно номеров в наличии", 409, "out_of_stock")
    now = utcnow()
    for row in (await session.scalars(select(PhoneInventory).where(PhoneInventory.id.in_(ids)))).all():
        row.status, row.reserved_order_id, row.reserved_at = "RESERVED", order.id, now
    await sync_product_stock(session, product)


async def release_for_order(session: AsyncSession, order: Order) -> int:
    """Return RESERVED numbers of a cancelled/expired order to the pool and recompute stock."""
    rows = (
        await session.scalars(
            select(PhoneInventory).where(
                PhoneInventory.reserved_order_id == order.id, PhoneInventory.status == "RESERVED"
            ).with_for_update()
        )
    ).all()
    touched: set[int] = set()
    for row in rows:
        row.status, row.reserved_order_id, row.reserved_at = "AVAILABLE", None, None
        if row.product_id:
            touched.add(row.product_id)
    for pid in touched:
        product = await session.get(Product, pid)
        if product is not None:
            await sync_product_stock(session, product)
    return len(rows)


async def sell_for_order(session: AsyncSession, order: Order, product: Product) -> list[PhoneInventory]:
    """Mark the order's reserved numbers SOLD (idempotent). Falls back to free numbers if none were reserved."""
    rows = list(
        (
            await session.scalars(
                select(PhoneInventory)
                .where(PhoneInventory.reserved_order_id == order.id, PhoneInventory.status.in_(["RESERVED", "SOLD"]))
                .order_by(PhoneInventory.id)
                .with_for_update()
            )
        ).all()
    )
    rows += list(
        (
            await session.scalars(
                select(PhoneInventory)
                .where(PhoneInventory.sold_order_id == order.id, PhoneInventory.status == "SOLD")
                .order_by(PhoneInventory.id)
            )
        ).all()
    )
    rows = list({r.id: r for r in rows}.values())
    missing = order.quantity - len(rows)
    if missing > 0:
        extra = (
            await session.scalars(
                select(PhoneInventory)
                .where(PhoneInventory.product_id == product.id, PhoneInventory.status == "AVAILABLE")
                .order_by(PhoneInventory.id)
                .limit(missing)
                .with_for_update(skip_locked=True)
            )
        ).all()
        if len(extra) < missing:
            raise ServiceError("Нет свободных номеров для выдачи", 409, "no_numbers")
        rows += list(extra)
    now = utcnow()
    for row in rows:
        if row.status != "SOLD":
            row.status, row.sold_order_id, row.sold_at = "SOLD", order.id, now
            row.reserved_order_id = order.id
    await sync_product_stock(session, product)
    return rows


def numbers_of(rows: list[PhoneInventory]) -> list[str]:
    return [r.phone_e164 for r in rows]

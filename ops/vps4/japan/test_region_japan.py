"""Japan (+81): country detection, catalog product, and session ingestion into phone_inventory."""
from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import Country, PhoneInventory, Product, ProductStatus
from app.seed import seed
from app.services import phones, regions
from app.services.session_registry import describe
from tests.test_session_wizard import BASE, CODE, start, wizard  # noqa: F401

JP_PHONE = "+819012345678"


def test_detects_japan_by_e164_prefix():
    for raw in ("+81 90 1234 5678", "+819012345678", "0081 90-1234-5678"):
        d = phones.detect(raw)
        assert d.valid and d.normalized == JP_PHONE and d.country_iso2 == "JP", raw
    assert phones.country_label("JP") == ("Япония", "🇯🇵")
    assert describe(JP_PHONE, 42)["country_iso2"] == "JP"


async def _jp_product() -> Product:
    async with session_factory()() as db:
        return await phones._product_for_country(db, "JP")


async def test_japan_product_is_ready_for_auto_delivery(client):
    product = await _jp_product()
    assert product is not None and product.title == "Номер Япония" and product.category == "numbers"
    assert product.status == ProductStatus.active and product.fulfillment_mode == "auto"
    assert product.uses_phone_inventory and not product.uses_inventory
    assert product.attributes.get("delivery_kind") == "phone_code" and product.price > 0
    async with session_factory()() as db:
        country = await db.scalar(select(Country).where(Country.code == "JP"))
        assert country.is_active and country.dial_code == "+81" and country.flag == "🇯🇵"
    catalog = {c["code"]: c for c in (await client.get("/api/countries")).json()}
    assert catalog["JP"]["product_id"] == product.id and catalog["JP"]["dial_code"] == "+81"


async def test_seed_is_idempotent_and_keeps_admin_edits():
    async with session_factory()() as db:
        product = await phones._product_for_country(db, "JP")
        product.price = 199
        await db.commit()
    await seed(demo=True)
    async with session_factory()() as db:
        assert await regions.ensure(db) == []
        rows = (await db.scalars(select(Product).join(Country).where(Country.code == "JP"))).all()
        assert len(rows) == 1 and float(rows[0].price) == 199


async def test_wizard_session_with_81_lands_in_japan_stock(client, admin_headers, wizard):
    flow = await start(client, admin_headers, phone=JP_PHONE)
    done = await client.post(f"{BASE}/{flow['id']}/code", headers=admin_headers, json={"code": CODE})
    assert done.status_code == 200, done.text
    assert done.json()["registered"] is True and done.json()["account"]["country_iso2"] == "JP"
    product = await _jp_product()
    async with session_factory()() as db:
        row = await db.scalar(select(PhoneInventory).where(PhoneInventory.phone_e164 == JP_PHONE))
        assert row.status == "AVAILABLE" and row.product_id == product.id and row.country_iso2 == "JP"
    assert product.stock == 1 and product.status == ProductStatus.active
    catalog = {c["code"]: c for c in (await client.get("/api/countries")).json()}
    assert catalog["JP"]["stock"] == 1

"""China (+86): country detection, catalog product, and session ingestion into phone_inventory."""
from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import Country, PhoneInventory, Product, ProductStatus
from app.services import phones
from app.services.session_registry import describe
from tests.test_session_wizard import BASE, CODE, start, wizard  # noqa: F401

CN_PHONE = "+8613812345678"


def test_detects_china_by_e164_prefix():
    for raw in ("+86 138 1234 5678", "+8613812345678", "0086 138-1234-5678"):
        d = phones.detect(raw)
        assert d.valid and d.normalized == CN_PHONE and d.country_iso2 == "CN", raw
    assert phones.country_label("CN") == ("Китай", "🇨🇳")
    assert describe(CN_PHONE, 42)["country_iso2"] == "CN"


async def test_china_product_is_ready_for_auto_delivery(client):
    async with session_factory()() as db:
        product = await phones._product_for_country(db, "CN")
        country = await db.scalar(select(Country).where(Country.code == "CN"))
    assert product is not None and product.title == "Номер Китай" and product.category == "numbers"
    assert product.status == ProductStatus.active and product.fulfillment_mode == "auto"
    assert product.uses_phone_inventory and not product.uses_inventory and product.price > 0
    assert product.attributes.get("delivery_kind") == "phone_code"
    assert country.is_active and country.dial_code == "+86" and country.flag == "🇨🇳"
    catalog = {c["code"]: c for c in (await client.get("/api/countries")).json()}
    assert catalog["CN"]["product_id"] == product.id and catalog["CN"]["dial_code"] == "+86"


async def test_wizard_session_with_86_lands_in_china_stock(client, admin_headers, wizard):
    flow = await start(client, admin_headers, phone=CN_PHONE)
    done = await client.post(f"{BASE}/{flow['id']}/code", headers=admin_headers, json={"code": CODE})
    assert done.status_code == 200, done.text
    assert done.json()["registered"] is True and done.json()["account"]["country_iso2"] == "CN"
    async with session_factory()() as db:
        product = await phones._product_for_country(db, "CN")
        row = await db.scalar(select(PhoneInventory).where(PhoneInventory.phone_e164 == CN_PHONE))
    assert row.status == "AVAILABLE" and row.product_id == product.id and row.country_iso2 == "CN"
    assert product.stock == 1

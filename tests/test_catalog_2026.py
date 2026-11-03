"""Catalog update 2026-10: 13 countries with UAH / USD / Stars prices, accounts category, guarantee, country requests."""
from __future__ import annotations

from sqlalchemy import func, select

from app.db import session_factory
from app.models import Country, Order, PriceHistory, Product, Setting
from app.services import catalog_update


async def _country_product(client, code: str) -> dict:
    return next(c for c in (await client.get("/api/countries")).json() if c["code"] == code)


async def test_all_13_countries_with_three_prices(client):
    data = {c["code"]: c for c in (await client.get("/api/countries")).json()}
    assert list(data) == [c[0] for c in catalog_update.COUNTRIES_2026_10]  # order of the price list
    for code, _name, flag, dial, uah, usd, stars in catalog_update.COUNTRIES_2026_10:
        c = data[code]
        assert (c["flag"], c["dial_code"], c["price"], c["price_usd"], c["price_stars"]) == (
            flag, dial, float(uah), float(usd), stars), code


async def test_update_is_idempotent_and_keeps_orders(client, user_headers):
    us = await _country_product(client, "US")
    order = (await client.post("/api/orders", json={"product_id": us["product_id"], "idempotency_key": "cat-keep-01"},
                               headers=user_headers)).json()
    async with session_factory()() as s:
        before = await s.scalar(select(func.count(Country.id)))
        # force a second run: still no duplicates, existing order untouched
        await s.execute(Setting.__table__.update().where(Setting.key == "catalog_version").values(value="old"))
        await s.commit()
        await catalog_update.apply(s, reset_unconfirmed_stock=False)
        await s.commit()
        assert await s.scalar(select(func.count(Country.id))) == before
        dup = await s.scalar(
            select(func.count()).select_from(
                select(Product.country_id).where(Product.category == "numbers").group_by(Product.country_id)
                .having(func.count() > 1).subquery()
            )
        )
        assert dup == 0
        o = await s.get(Order, order["id"])
        assert float(o.total) == 75 and float(o.unit_price) == 75


async def test_old_prices_replaced_with_history(client):
    async with session_factory()() as s:
        ua = await s.scalar(select(Product).join(Country).where(Country.code == "UA", Product.category == "numbers"))
        hist = (await s.scalars(select(PriceHistory).where(PriceHistory.product_id == ua.id))).all()
        assert float(ua.price) == 140 and any(float(h.old_value or 0) == 225 and float(h.new_value) == 140 for h in hist)


async def test_unconfirmed_stock_is_reset_in_production_mode(client):
    async with session_factory()() as s:
        await s.execute(Setting.__table__.update().where(Setting.key == "catalog_version").values(value="old"))
        await s.commit()
        report = await catalog_update.apply(s, reset_unconfirmed_stock=True)
        await s.commit()
    assert report and report["stock_reset"]
    us = await _country_product(client, "US")
    assert us["stock"] == 0
    prod = (await client.get(f"/api/products/{us['product_id']}")).json()
    assert prod["instant"] is False  # manual numbers are never advertised as instant


async def test_stars_price_is_the_products_own_and_follows_promo(client, admin_headers, user_headers):
    tr = await _country_product(client, "TR")  # 55 UAH / 150 Stars
    await client.post("/api/admin/promo-codes", json={"code": "HALF", "kind": "percent", "value": "50"}, headers=admin_headers)
    o = (await client.post("/api/orders", json={"product_id": tr["product_id"], "idempotency_key": "cat-stars-1",
                                                "promo_code": "HALF"}, headers=user_headers)).json()
    assert o["total"] == 27.5 and o["stars_total"] == 75 and o["usd_total"] == 0.7
    r = await client.post(f"/api/orders/{o['id']}/pay", json={"method": "stars"}, headers=user_headers)
    assert r.status_code == 200 and r.json()["payment"]["stars_amount"] == 75


async def test_accounts_category_manual_and_no_stars(client, user_headers):
    cats = {c["slug"]: c for c in (await client.get("/api/categories")).json()}
    assert cats["accounts"]["title"] == "Рандом аккаунты 2015–2019"
    async with session_factory()() as s:
        acc = await s.scalar(select(Product).where(Product.category == "accounts"))
        assert (float(acc.price), acc.price_stars, acc.fulfillment_mode, acc.stars_enabled, acc.stock) == (75, 150, "manual", False, 0)
        acc.stock = 2  # staff confirmed two
        await s.commit()
        pid = acc.id
    o = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "cat-acc-001"}, headers=user_headers)).json()
    r = await client.post(f"/api/orders/{o['id']}/pay", json={"method": "stars"}, headers=user_headers)
    assert r.status_code == 400 and "Stars" in r.json()["detail"]


async def test_country_request_creates_support_ticket(client, admin_headers, user_headers):
    r = await client.post("/api/support/country-request", json={"country": "Казахстан", "quantity": 3, "comment": "срочно"},
                          headers=user_headers)
    assert r.status_code == 201
    t = r.json()
    assert t["category"] == "country_request" and "Казахстан" in t["subject"] and "Количество: 3" in t["messages"][0]["text"]
    await client.put("/api/admin/settings", json={"values": {"country_requests_enabled": "false"}}, headers=admin_headers)
    r = await client.post("/api/support/country-request", json={"country": "Чили"}, headers=user_headers)
    assert r.status_code == 403


async def test_guarantee_settings_public_and_editable(client, admin_headers):
    cfg = (await client.get("/api/config")).json()["settings"]
    assert cfg["guarantee_days"] == "14" and "80%" in cfg["guarantee_text"]
    r = await client.put("/api/admin/settings", json={"values": {"guarantee_text": "Новые условия", "guarantee_days": "7"}},
                         headers=admin_headers)
    assert r.status_code == 200
    cfg = (await client.get("/api/config")).json()["settings"]
    assert cfg["guarantee_text"] == "Новые условия" and cfg["guarantee_days"] == "7"


async def test_admin_edits_usd_and_stars_separately(client, admin_headers):
    eg = await _country_product(client, "EG")
    r = await client.patch(f"/api/admin/products/{eg['product_id']}", json={"price_usd": "1.95", "price_stars": 130},
                           headers=admin_headers)
    assert r.status_code == 200 and r.json()["price_usd"] == 1.95 and r.json()["price_stars"] == 130
    assert r.json()["price"] == 50  # UAH untouched — nothing is converted by a rate
    hist = (await client.get(f"/api/admin/products/{eg['product_id']}/price-history", headers=admin_headers)).json()
    assert {"price_usd", "price_stars"} <= {h["field"] for h in hist}

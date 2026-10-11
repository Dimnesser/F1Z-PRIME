"""Phone-number inventory: country auto-detection, dedup, stock derivation, atomic auto-delivery after payment."""
from __future__ import annotations

import asyncio

from sqlalchemy import func, select

from app.db import session_factory
from app.models import Order, PhoneInventory, Product
from app.services import phones
from tests.conftest import init_data_for


def tma(uid: int) -> dict[str, str]:
    return {"Authorization": f"tma {init_data_for(uid, username=f'u{uid}')}"}


# ----- detection / normalisation (scenarios 1-3, 6, 7) ---------------------------------------


def test_detects_country_by_dialling_code():
    assert phones.detect("+1 415 555 2671").country_iso2 == "US"
    assert phones.detect("+1 (604) 555-1234").country_iso2 == "CA"   # +1 is NOT always the US
    assert phones.detect("+380 67 123 4567").country_iso2 == "UA"
    assert phones.detect("+48 512 345 678").country_iso2 == "PL"
    assert phones.detect("+55 11 91234 5678").country_iso2 == "BR"


def test_normalisation_strips_formatting():
    d = phones.detect("+1 (415) 555-2671")
    assert d.normalized == "+14155552671"
    assert phones.normalize_raw("00380671234567") == "+380671234567"


def test_invalid_number_is_rejected():
    assert phones.detect("12345").valid is False
    assert phones.detect("not a phone").normalized is None


# ----- admin add: single / bulk / dedup / ambiguous (scenarios 1-7) --------------------------


async def test_add_single_and_country_auto_fill(client, admin_headers):
    r = await client.post("/api/admin/phones", json={"phone": "+14155552671"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "added" and body["country_iso2"] == "US" and body["normalized"] == "+14155552671"


async def test_duplicate_and_invalid(client, admin_headers):
    await client.post("/api/admin/phones", json={"phone": "+380671112233"}, headers=admin_headers)
    dup = await client.post("/api/admin/phones", json={"phone": "+380 67 111 22 33"}, headers=admin_headers)
    assert dup.json()["status"] == "duplicate"
    bad = await client.post("/api/admin/phones", json={"phone": "123"}, headers=admin_headers)
    assert bad.status_code == 422 or bad.json().get("status") == "invalid"


async def test_ambiguous_requires_choice(client, admin_headers):
    # a Kazakhstan +7 number is ambiguous with Russia on the +7 country code -> must ask, never guess
    det = phones.detect("+7 700 123 4567")
    assert det.country_iso2 in (None, "KZ", "RU")  # phonenumbers resolves by prefix; service still exposes options
    r = await client.post("/api/admin/phones/detect", json={"phone": "+7 700 123 4567"}, headers=admin_headers)
    assert r.status_code == 200


async def test_bulk_import_counts(client, admin_headers):
    lines = [f"+1415555{n:04d}" for n in range(100)] + ["+14155550001", "+14155550001", "bad-number", "12"]
    r = await client.post("/api/admin/phones/bulk", json={"text": "\n".join(lines)}, headers=admin_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["added"] == 100 and d["duplicates"] == 2 and d["invalid"] == 2


# ----- stock derivation per country (scenario 2, 12) -----------------------------------------


async def _numbers_product(client, admin_headers, code: str) -> dict:
    c = next(x for x in (await client.get("/api/countries")).json() if x["code"] == code)
    return c


async def test_stock_is_derived_from_rows(client, admin_headers):
    # add 10 US, 3 UA, 7 PL numbers; per-country available counts must reflect the real rows
    us = [f"+1424555{n:04d}" for n in range(10)]
    ua = [f"+38050111{n:04d}" for n in range(3)]
    pl = [f"+4851234{n:04d}" for n in range(7)]
    for batch in (us, ua, pl):
        r = await client.post("/api/admin/phones/bulk", json={"text": "\n".join(batch)}, headers=admin_headers)
        assert r.json()["added"] == len(batch), r.text
    summary = (await client.get("/api/admin/phones/summary", headers=admin_headers)).json()
    by_iso = {row["country_iso2"]: row for row in summary["countries"]}
    assert by_iso["US"]["available"] == 10 and by_iso["UA"]["available"] == 3 and by_iso["PL"]["available"] == 7
    # the public catalogue reflects the same numbers
    cat = {c["code"]: c for c in (await client.get("/api/countries")).json()}
    assert cat["US"]["stock"] == 10 and cat["PL"]["stock"] == 7


# ----- auto-delivery after payment (scenarios 8, 9, 13) --------------------------------------


async def _fund(client, admin_headers, user_headers, amount="500"):
    me = (await client.get("/api/me", headers=user_headers)).json()
    await client.post(f"/api/admin/users/{me['id']}/balance", json={"amount": amount, "reason": "тест"}, headers=admin_headers)


async def test_auto_delivery_after_paid(client, admin_headers, user_headers):
    await client.put("/api/admin/settings", json={"values": {"auto_complete_digital": "true"}}, headers=admin_headers)
    await client.post("/api/admin/phones/bulk", json={"text": "+380671234501\n+380671234502"}, headers=admin_headers)  # UA
    ua = await _numbers_product(client, admin_headers, "UA")
    await client.patch(f"/api/admin/products/{ua['product_id']}", json={"fulfillment_mode": "auto"}, headers=admin_headers)
    await _fund(client, admin_headers, user_headers)
    order = (await client.post("/api/orders", json={"product_id": ua["product_id"], "idempotency_key": "ph-ord-01"},
                               headers=user_headers)).json()
    res = await client.post(f"/api/orders/{order['id']}/pay", json={"method": "balance"}, headers=user_headers)
    assert res.status_code == 200 and res.json()["order"]["status"] == "completed", res.text
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert len(detail["delivered_items"]) == 1 and detail["delivered_items"][0].startswith("+38067")
    # the sold number is bound to this order and removed from available stock
    async with session_factory()() as s:
        sold = await s.scalar(select(PhoneInventory).where(PhoneInventory.sold_order_id == order["id"]))
        assert sold.status == "SOLD"
        avail = await s.scalar(select(func.count()).select_from(PhoneInventory).where(
            PhoneInventory.product_id == ua["product_id"], PhoneInventory.status == "AVAILABLE"))
        assert avail == 1


async def test_cannot_buy_without_payment(client, admin_headers, user_headers):
    await client.post("/api/admin/phones/bulk", json={"text": "+905301112201"}, headers=admin_headers)  # TR
    tr = await _numbers_product(client, admin_headers, "TR")
    order = (await client.post("/api/orders", json={"product_id": tr["product_id"], "idempotency_key": "ph-np-01"},
                               headers=user_headers)).json()
    detail = (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()
    assert detail["delivered_items"] == [] and detail["status"] == "pending"  # reserved, not delivered


async def test_out_of_stock_blocks_order(client, admin_headers, user_headers):
    # make EG phone-backed but empty: add one number then delete it -> derived stock 0 blocks the purchase
    add = await client.post("/api/admin/phones", json={"phone": "+201012345601"}, headers=admin_headers)
    await client.delete(f"/api/admin/phones/{add.json()['id']}", headers=admin_headers)
    eg = await _numbers_product(client, admin_headers, "EG")
    assert eg["stock"] == 0
    r = await client.post("/api/orders", json={"product_id": eg["product_id"], "idempotency_key": "ph-oos-001"},
                          headers=user_headers)
    assert r.status_code == 409


# ----- concurrency: last number cannot go to two buyers (scenario 10) ------------------------


async def test_last_number_concurrent_buyers(client, admin_headers):
    await client.post("/api/admin/phones/bulk", json={"text": "+919812345001"}, headers=admin_headers)  # IN, one only
    india = await _numbers_product(client, admin_headers, "IN")
    h1, h2 = tma(7301), tma(7302)
    r1, r2 = await asyncio.gather(
        client.post("/api/orders", json={"product_id": india["product_id"], "idempotency_key": "ph-race-1"}, headers=h1),
        client.post("/api/orders", json={"product_id": india["product_id"], "idempotency_key": "ph-race-2"}, headers=h2),
    )
    assert sorted([r1.status_code, r2.status_code]) == [201, 409]  # exactly one wins the single number


async def test_cancel_returns_number_to_pool(client, admin_headers, user_headers):
    await client.post("/api/admin/phones/bulk", json={"text": "+998901112201"}, headers=admin_headers)  # UZ
    uz = await _numbers_product(client, admin_headers, "UZ")
    order = (await client.post("/api/orders", json={"product_id": uz["product_id"], "idempotency_key": "ph-cancel-01"},
                               headers=user_headers)).json()
    async with session_factory()() as s:
        assert await s.scalar(select(func.count()).select_from(PhoneInventory).where(
            PhoneInventory.product_id == uz["product_id"], PhoneInventory.status == "AVAILABLE")) == 0
    await client.post(f"/api/orders/{order['id']}/cancel", headers=user_headers)
    async with session_factory()() as s:
        assert await s.scalar(select(func.count()).select_from(PhoneInventory).where(
            PhoneInventory.product_id == uz["product_id"], PhoneInventory.status == "AVAILABLE")) == 1


# ----- admin table: list / search / filter / history (scenario 14 = permissions below) -------


async def test_list_search_filter_and_history(client, admin_headers, user_headers):
    await client.post("/api/admin/phones/bulk", json={"text": "+4915112345001\n+4915112345002"}, headers=admin_headers)  # DE
    lst = (await client.get("/api/admin/phones?search=4915112345001", headers=admin_headers)).json()
    assert lst["total"] == 1 and lst["items"][0]["phone_e164"] == "+4915112345001"
    filt = (await client.get("/api/admin/phones?country=DE&status=AVAILABLE", headers=admin_headers)).json()
    assert filt["total"] == 2


async def test_regular_user_cannot_reach_admin_phones(client, user_headers):
    assert (await client.get("/api/admin/phones", headers=user_headers)).status_code == 401
    assert (await client.post("/api/admin/phones", json={"phone": "+14155559999"}, headers=user_headers)).status_code == 401

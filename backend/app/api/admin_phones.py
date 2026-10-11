"""Admin: «База номеров» — phone-number stock with automatic country detection and sales history.

Reads need `products.view`; changes need `products.stock`. Stock per country is always the count of
AVAILABLE rows. Only sellable phone numbers are stored here — never Telegram login codes or sessions.
"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.admin import csv_response, date_range
from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import PhoneInventory, Product
from app.services import phones
from app.services.common import lock, log_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])


class PhoneIn(BaseModel):
    phone: str = Field(min_length=3, max_length=40)
    country: str | None = Field(default=None, max_length=2)  # override / disambiguation
    note: str = Field(default="", max_length=255)
    batch: str | None = Field(default=None, max_length=64)


class BulkIn(BaseModel):
    text: str = Field(min_length=1, max_length=2_000_000)  # one number per line (TXT/CSV first column)
    country: str | None = Field(default=None, max_length=2)
    batch: str | None = Field(default=None, max_length=64)


class PhonePatch(BaseModel):
    status: str | None = Field(default=None, pattern="^(AVAILABLE|DISABLED)$")  # free numbers only
    note: str | None = Field(default=None, max_length=255)


def _out(p: PhoneInventory) -> dict:
    return {
        "id": p.id, "phone_e164": p.phone_e164, "country_iso2": p.country_iso2, "country_name": p.country_name,
        "flag": phones.country_label(p.country_iso2)[1], "status": p.status, "product_id": p.product_id,
        "reserved_order_id": p.reserved_order_id, "sold_order_id": p.sold_order_id, "batch": p.batch,
        "added_by": p.added_by, "note": p.note, "created_at": p.created_at, "sold_at": p.sold_at,
    }


# ---------------------------------------------------------------- detect / add


@router.post("/phones/detect")
async def detect_phone(body: PhoneIn, _: P("products.view")) -> dict:
    """Preview the auto-detected country without saving (used by the «Добавить номер» form)."""
    d = phones.detect(body.phone, region_hint=body.country)
    return {"normalized": d.normalized, "valid": d.valid, "country_iso2": d.country_iso2,
            "country_name": d.country_name, "flag": d.flag, "ambiguous": d.ambiguous, "error": d.error}


@router.post("/phones", status_code=201)
async def add_phone(body: PhoneIn, admin: P("products.stock"), session: SessionDep) -> dict:
    res = await phones.add_one(session, body.phone, actor=str(admin), country_override=body.country,
                               batch=body.batch, note=body.note)
    if res["status"] == "invalid":
        raise HTTPException(422, res.get("error") or "Некорректный номер")
    if res["status"] == "added":
        log_admin(session, admin, "phone_add", "phone", res["id"], country=res["country_iso2"])
    await session.commit()
    return res


@router.post("/phones/bulk")
async def bulk_phones(body: BulkIn, admin: P("products.stock"), session: SessionDep) -> dict:
    lines = [row.split(",")[0].split(";")[0] for row in body.text.splitlines()]
    res = await phones.add_bulk(session, lines, actor=str(admin), country_override=body.country, batch=body.batch)
    log_admin(session, admin, "phone_bulk", "phone", None,
              added=res["added"], duplicates=res["duplicates"], invalid=res["invalid"], ambiguous=res["ambiguous"])
    await session.commit()
    return res


# ---------------------------------------------------------------- list / summary / history


@router.get("/phones")
async def list_phones(
    _: P("products.view"), session: SessionDep,
    search: str | None = Query(None, max_length=40),
    country: str | None = Query(None, max_length=2),
    status: str | None = Query(None, pattern="^(AVAILABLE|RESERVED|SOLD|DISABLED)$"),
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
) -> dict:
    stmt = select(PhoneInventory)
    if search:
        digits = phones.normalize_raw(search)
        stmt = stmt.where(or_(PhoneInventory.phone_e164.ilike(f"%{digits}%"),
                              PhoneInventory.phone_e164.ilike(f"%{search}%")))
    if country:
        stmt = stmt.where(PhoneInventory.country_iso2 == country.upper())
    if status:
        stmt = stmt.where(PhoneInventory.status == status)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = (await session.scalars(stmt.order_by(PhoneInventory.id.desc()).offset((page - 1) * size).limit(size))).all()
    return {"total": total, "items": [_out(p) for p in rows]}


@router.get("/phones/summary")
async def phones_summary(_: P("products.view"), session: SessionDep) -> dict:
    rows = (
        await session.execute(
            select(PhoneInventory.country_iso2, PhoneInventory.status, func.count(PhoneInventory.id))
            .group_by(PhoneInventory.country_iso2, PhoneInventory.status)
        )
    ).all()
    by_country: dict[str, dict] = {}
    totals = {s.lower(): 0 for s in phones.STATUSES}
    for iso, st, n in rows:
        c = by_country.setdefault(iso, {"country_iso2": iso, "country_name": phones.country_label(iso)[0],
                                        "flag": phones.country_label(iso)[1], **{s.lower(): 0 for s in phones.STATUSES}})
        c[st.lower()] = n
        if st.lower() in totals:
            totals[st.lower()] += n
    recent_added = (await session.scalars(select(PhoneInventory).order_by(PhoneInventory.id.desc()).limit(10))).all()
    recent_sold = (
        await session.scalars(
            select(PhoneInventory).where(PhoneInventory.status == "SOLD")
            .order_by(PhoneInventory.sold_at.desc().nullslast()).limit(10)
        )
    ).all()
    return {
        "totals": {"total": sum(totals.values()), **totals},
        "countries": sorted(by_country.values(), key=lambda c: -(c["available"] + c["sold"])),
        "recent_added": [_out(p) for p in recent_added],
        "recent_sold": [_out(p) for p in recent_sold],
    }


@router.get("/phones/history")
async def phones_history(
    _: P("products.view"), session: SessionDep, country: str | None = Query(None, max_length=2),
    date_from: date | None = None, date_to: date | None = None, limit: int = Query(200, ge=1, le=1000),
) -> list[dict]:
    stmt = select(PhoneInventory).where(PhoneInventory.status == "SOLD")
    if country:
        stmt = stmt.where(PhoneInventory.country_iso2 == country.upper())
    stmt = date_range(stmt, PhoneInventory.sold_at, date_from, date_to)
    rows = (await session.scalars(stmt.order_by(PhoneInventory.sold_at.desc().nullslast()).limit(limit))).all()
    return [{**_out(p), "order_public_id": None} for p in rows]


@router.get("/phones/export.csv")
async def export_phones(_: P("products.import"), session: SessionDep,
                        status: str | None = Query(None, pattern="^(AVAILABLE|RESERVED|SOLD|DISABLED)$")) -> Response:
    stmt = select(PhoneInventory)
    if status:
        stmt = stmt.where(PhoneInventory.status == status)
    rows = (await session.scalars(stmt.order_by(PhoneInventory.id))).all()
    return csv_response(
        "phone-inventory.csv",
        ["id", "phone_e164", "country_iso2", "status", "sold_order_id", "batch", "created_at", "sold_at"],
        [[p.id, p.phone_e164, p.country_iso2, p.status, p.sold_order_id, p.batch, p.created_at, p.sold_at] for p in rows],
    )


# ---------------------------------------------------------------- edit / delete


@router.patch("/phones/{phone_id}")
async def update_phone(phone_id: int, body: PhonePatch, admin: P("products.stock"), session: SessionDep) -> dict:
    row = await lock(session, PhoneInventory, phone_id)
    if row is None:
        raise HTTPException(404, "Номер не найден")
    if row.status in ("RESERVED", "SOLD"):
        raise HTTPException(409, "Нельзя менять зарезервированный или проданный номер")
    if body.status is not None:
        row.status = body.status
    if body.note is not None:
        row.note = body.note
    if row.product_id:
        product = await session.get(Product, row.product_id)
        if product is not None:
            await phones.sync_product_stock(session, product)
    log_admin(session, admin, "phone_update", "phone", phone_id, status=row.status)
    await session.commit()
    return _out(row)


@router.delete("/phones/{phone_id}")
async def delete_phone(phone_id: int, admin: P("products.stock"), session: SessionDep) -> dict:
    row = await lock(session, PhoneInventory, phone_id)
    if row is None:
        raise HTTPException(404, "Номер не найден")
    if row.status == "SOLD":
        raise HTTPException(409, "Проданный номер удалить нельзя — он привязан к заказу")
    product_id = row.product_id
    await session.delete(row)
    if product_id:
        product = await session.get(Product, product_id)
        if product is not None:
            await phones.sync_product_stock(session, product)
    log_admin(session, admin, "phone_delete", "phone", phone_id)
    await session.commit()
    return {"deleted": True}

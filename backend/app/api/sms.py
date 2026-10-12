"""Public Mini App / bot API for SMS-activations. Auth + ownership via the existing UserDep (initData)."""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import SessionDep, UserDep
from app.config import get_settings
from app.models import SmsActivation
from app.services import owned_sms, sms
from app.services import settings as settings_service

router = APIRouter(prefix="/api/sms", tags=["sms"])

_purchases: dict[int, deque[float]] = defaultdict(deque)
PURCHASES_PER_MIN = 6


def _rate(user_id: int) -> None:
    hits = _purchases[user_id]
    now = time.monotonic()
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= PURCHASES_PER_MIN:
        raise HTTPException(429, "Слишком много запросов. Попробуйте через минуту.")
    hits.append(now)


async def _require_enabled(session: SessionDep) -> None:
    if not await settings_service.get_bool(session, "sms_enabled"):
        raise HTTPException(404, "Продажа номеров временно недоступна")


async def _catalog_or_503(session: SessionDep) -> dict:
    try:
        return await sms.catalog(session)
    except (sms.ProviderTimeout, sms.ProviderError):
        raise HTTPException(503, "Сервис номеров временно недоступен. Повторите позже.")


class PurchaseIn(BaseModel):
    country: str = Field(min_length=1, max_length=8)
    service: str = Field(min_length=1, max_length=32)
    idempotency_key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")


@router.get("/countries")
async def sms_countries(user: UserDep, session: SessionDep) -> list[dict]:
    await _require_enabled(session)
    return (await _catalog_or_503(session))["countries"]


@router.get("/services")
async def sms_services(user: UserDep, session: SessionDep) -> list[dict]:
    await _require_enabled(session)
    return (await _catalog_or_503(session))["services"]


@router.get("/prices")
async def sms_prices(user: UserDep, session: SessionDep,
                     country: str | None = Query(None, max_length=8)) -> dict:
    """Sellable items with final prices and real availability (no provider cost exposed)."""
    await _require_enabled(session)
    cat = await _catalog_or_503(session)
    items = [i for i in cat["items"] if country is None or i["country"] == country]
    return {"configured": cat["configured"], "countries": cat["countries"], "services": cat["services"], "items": items}


@router.post("/purchase", status_code=201)
async def sms_purchase(body: PurchaseIn, user: UserDep, session: SessionDep) -> dict:
    """Buy a number. Price is computed on the server from the live provider cost + admin markup."""
    await _require_enabled(session)
    _rate(user.id)
    # idempotent on double-tap: an in-flight activation is returned instead of creating a second one
    existing = await session.scalar(
        select(SmsActivation).where(SmsActivation.user_id == user.id, SmsActivation.status.in_(sms.ACTIVE))
        .order_by(SmsActivation.id.desc()).limit(1)
    )
    if existing is not None:
        return sms.out(existing)
    # authoritative price from the provider catalog (never trust a client-sent price)
    raw = await sms.provider_catalog(session)
    info = raw["prices"].get(body.country, {}).get(body.service)
    if info is None:
        raise HTTPException(404, "Нет такой позиции в каталоге")
    if info["count"] <= 0:
        raise HTTPException(409, "Номера этой позиции закончились")
    m = await sms._markups(session)
    if f"{body.country}:{body.service}" in m["disabled"]:
        raise HTTPException(409, "Позиция недоступна")
    price = sms.quote(info["cost"], body.country, body.service, m)  # raises 409 pricing_not_configured
    act = await sms.buy(session, user.id, user.telegram_id, service=body.service, country=body.country,
                        cost=price, provider_cost=info["cost"])
    await session.commit()
    return sms.out(act)


@router.get("/activations")
async def sms_activations(user: UserDep, session: SessionDep,
                          limit: int = Query(50, ge=1, le=200)) -> list[dict]:
    rows = (await session.scalars(
        select(SmsActivation).where(SmsActivation.user_id == user.id)
        .order_by(SmsActivation.id.desc()).limit(limit)
    )).all()
    return [sms.out(a) for a in rows]


@router.get("/activations/{activation_id}")
async def sms_activation_detail(activation_id: int, user: UserDep, session: SessionDep) -> dict:
    act = await session.get(SmsActivation, activation_id)
    if act is None or act.user_id != user.id:  # IDOR guard
        raise HTTPException(404, "Активация не найдена")
    return sms.out(act)


@router.post("/activations/{activation_id}/cancel")
async def sms_activation_cancel(activation_id: int, user: UserDep, session: SessionDep) -> dict:
    act = await session.get(SmsActivation, activation_id)
    if act is None or act.user_id != user.id:
        raise HTTPException(404, "Активация не найдена")
    res = await sms.cancel(session, activation_id, actor=f"user:{user.id}")
    await session.commit()
    return sms.out(res)


class GatewaySmsIn(BaseModel):
    phone: str = Field(min_length=3, max_length=24)
    text: str = Field(min_length=1, max_length=2000)


@router.post("/gateway/incoming")
async def gateway_incoming(body: GatewaySmsIn, session: SessionDep,
                           x_gateway_token: str = Header(default="")) -> dict:
    """Ingest an incoming SMS the operator's OWN gateway forwards for one of the owned numbers.

    Auth is a shared secret (X-Gateway-Token) from .env — not a user endpoint. Numbers only; this never
    handles Telegram sessions or login codes for pre-existing accounts.
    """
    token = get_settings().sms_gateway_token
    if not token or x_gateway_token != token:
        raise HTTPException(401, "bad gateway token")
    row = await owned_sms.ingest(session, body.phone.strip(), body.text)
    await session.commit()
    return {"stored": True, "code_parsed": bool(row.code)}

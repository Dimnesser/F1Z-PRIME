"""Owned-number pool as an ActivationProvider for the existing SMS-activation engine.

The operator loads numbers THEY own; a buyer rents one to receive the registration code for their OWN new
signup; the operator's own SMS gateway POSTs the incoming SMS to the ingest webhook, which lands here. This
is the same model as the external sms-activate provider, sourced from the operator's pool instead of an API.
Numbers only — no Telegram session/.session/TData, and no login-code relay for any pre-existing account.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session_factory
from app.models import OwnedSmsInbox, OwnedSmsNumber, SmsActivation
from app.services.common import utcnow
from app.services.sms import ActivationProvider, ProviderError

log = logging.getLogger("f1z.owned_sms")

_CODE_RE = re.compile(r"(\d{4,8})")


def extract_code(text: str) -> str | None:
    """Pull the confirmation code out of an incoming SMS body (first 4–8 digit run)."""
    m = _CODE_RE.search(text or "")
    return m.group(1) if m else None


def _nid(activation_id: str) -> int | None:
    try:
        return int(activation_id.split(":", 1)[1])
    except (IndexError, ValueError):
        return None


class OwnedPoolProvider(ActivationProvider):
    """Allocates/receives against the operator's own number pool (self-contained DB sessions)."""

    name = "owned_pool"

    async def get_number(self, service: str, country: str) -> dict:
        async with session_factory()() as s:
            stmt = (
                select(OwnedSmsNumber)
                .where(OwnedSmsNumber.is_active.is_(True), OwnedSmsNumber.in_use.is_(False),
                       OwnedSmsNumber.country_iso2 == country,
                       OwnedSmsNumber.service.in_(("", service)))
                .order_by(OwnedSmsNumber.price, OwnedSmsNumber.id)
                .limit(1).with_for_update(skip_locked=True)
            )
            row = (await s.scalars(stmt)).first()
            if row is None:
                raise ProviderError("NO_NUMBERS")
            row.in_use = True
            row.last_used_at = utcnow()
            await s.commit()
            return {"activation_id": f"own:{row.id}", "phone": row.phone_e164}

    async def get_status(self, activation_id: str) -> dict:
        nid = _nid(activation_id)
        if nid is None:
            return {"state": "WAITING", "code": None}
        async with session_factory()() as s:
            num = await s.get(OwnedSmsNumber, nid)
            if num is None:
                return {"state": "CANCELLED", "code": None}
            row = (
                await s.scalars(
                    select(OwnedSmsInbox).where(
                        OwnedSmsInbox.phone_e164 == num.phone_e164,
                        OwnedSmsInbox.consumed.is_(False), OwnedSmsInbox.code.isnot(None))
                    .order_by(OwnedSmsInbox.id).limit(1)
                )
            ).first()
            return {"state": "OK", "code": row.code} if row else {"state": "WAITING", "code": None}

    async def set_status(self, activation_id: str, status: int) -> None:
        nid = _nid(activation_id)
        if nid is None:
            return
        async with session_factory()() as s:
            num = await s.get(OwnedSmsNumber, nid, with_for_update=True)
            if num is None:
                return
            if status == 6:  # done: consume the delivered code and count the use
                await s.execute(
                    update(OwnedSmsInbox)
                    .where(OwnedSmsInbox.phone_e164 == num.phone_e164, OwnedSmsInbox.consumed.is_(False))
                    .values(consumed=True)
                )
                num.times_used += 1
            num.in_use = False  # release back to the pool
            await s.commit()

    async def get_active_activations(self) -> list[dict]:
        async with session_factory()() as s:
            rows = (await s.scalars(select(OwnedSmsNumber).where(OwnedSmsNumber.in_use.is_(True)))).all()
            return [{"activation_id": f"own:{r.id}", "phone": r.phone_e164, "service": r.service, "status": "WAITING",
                     "code": None} for r in rows]

    async def get_catalog(self) -> dict:
        async with session_factory()() as s:
            rows = (
                await s.execute(
                    select(OwnedSmsNumber.country_iso2, OwnedSmsNumber.service,
                           func.count(OwnedSmsNumber.id), func.min(OwnedSmsNumber.price))
                    .where(OwnedSmsNumber.is_active.is_(True), OwnedSmsNumber.in_use.is_(False))
                    .group_by(OwnedSmsNumber.country_iso2, OwnedSmsNumber.service)
                )
            ).all()
        prices: dict = {}
        countries: dict[str, str] = {}
        services: dict[str, str] = {}
        for country, service, count, price in rows:
            svc = service or "any"
            countries.setdefault(country, country)
            services.setdefault(svc, svc)
            prices.setdefault(country, {})[svc] = {"cost": price, "count": int(count)}
        return {"countries": [{"code": c, "title": t} for c, t in countries.items()],
                "services": [{"code": c, "title": t} for c, t in services.items()], "prices": prices}


async def ingest(session: AsyncSession, phone_e164: str, text: str) -> OwnedSmsInbox:
    """Store an incoming SMS the operator's gateway forwarded for one of the owned numbers."""
    num = await session.scalar(select(OwnedSmsNumber).where(OwnedSmsNumber.phone_e164 == phone_e164))
    row = OwnedSmsInbox(number_id=num.id if num else None, phone_e164=phone_e164,
                        text=text[:2000], code=extract_code(text))
    session.add(row)
    await session.flush()
    return row


async def release_orphans(session: AsyncSession) -> int:
    """Free numbers stuck in_use with no in-flight activation (e.g. a buy tx that rolled back after get_number)."""
    active_ids = set(
        (await session.scalars(
            select(SmsActivation.activation_id).where(
                SmsActivation.status.in_(("WAITING", "API_PENDING", "RESERVED")),
                SmsActivation.activation_id.like("own:%"))
        )).all()
    )
    rows = (await session.scalars(
        select(OwnedSmsNumber).where(OwnedSmsNumber.in_use.is_(True)).with_for_update(skip_locked=True)
    )).all()
    freed = 0
    for num in rows:
        if f"own:{num.id}" not in active_ids:
            num.in_use = False
            freed += 1
    return freed

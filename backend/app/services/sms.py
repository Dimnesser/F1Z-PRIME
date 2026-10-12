"""SMS-activation service: buy a virtual number, poll for its one confirmation code, deliver it reliably.

This is a standard SMS-activation reseller flow (a number that receives ONE SMS for a third-party signup).
It never reads or forwards Telegram login codes or .session data.

Resilience guarantees (see migration 0009):
- **Lease (owner + generation).** A poll update is applied only while the row's lease_generation still
  matches the value the worker claimed — a revived "zombie" worker after a TTL lapse cannot clobber a
  newer lease.
- **Reconciliation.** If `get_number` times out we never blindly bind a number: we reconcile against the
  provider's active list and bind only on an unambiguous match, else move to RECONCILIATION_REQUIRED.
- **Transactional outbox.** A received code is queued in `delivery_outbox` in the same transaction that
  stores it, then delivered to the buyer. An indeterminate Telegram send (timeout/5xx) becomes UNKNOWN and
  is retried only after an audited warning, because the Bot API does not deduplicate outgoing messages.
- **Refund-once.** Each activation refunds at most once (the `refunded` flag, under a row lock).
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from datetime import timedelta
from decimal import Decimal

import httpx
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import DeliveryOutbox, SmsActivation, TxType, User
from app.services import telegram
from app.services.common import ServiceError, change_balance, lock, money, utcnow

log = logging.getLogger("f1z.sms")

ACTIVE = ("RESERVED", "API_PENDING", "WAITING", "CANCEL_REQUESTED", "RECONCILIATION_REQUIRED")
TERMINAL = ("COMPLETED", "CANCELLED", "TIMEOUT", "FAILED")
LEASE_TTL_SECONDS = 120
ACTIVATION_TTL_MINUTES = 20
OUTBOX_MAX_ATTEMPTS = 6


# ----------------------------------------------------------------- provider abstraction


class ProviderTimeout(Exception):
    """The provider call did not return a definite answer (network timeout / 5xx) — reconcile, never guess."""


class ProviderError(Exception):
    """The provider returned a definite negative answer (no numbers, bad key, etc.)."""


class ActivationProvider(ABC):
    name = "base"

    @abstractmethod
    async def get_number(self, service: str, country: str) -> dict:
        """Buy a number. Returns {activation_id, phone}. Raises ProviderTimeout / ProviderError."""

    @abstractmethod
    async def get_status(self, activation_id: str) -> dict:
        """Poll. Returns {state: 'WAITING'|'OK'|'CANCELLED', code: str|None}."""

    @abstractmethod
    async def set_status(self, activation_id: str, status: int) -> None:
        """Tell the provider the outcome (8 = cancel, 6 = done)."""

    @abstractmethod
    async def get_active_activations(self) -> list[dict]:
        """For reconciliation after a get_number timeout: the provider's current active list."""

    @abstractmethod
    async def get_catalog(self) -> dict:
        """Provider catalog: {countries: [{code,title}], services: [{code,title}],
        prices: {country: {service: {cost: Decimal, count: int}}}}. Raises ProviderTimeout/Error."""


class MockActivationProvider(ActivationProvider):
    """In-process fake for tests and for the UI before a real key is configured. No external calls."""

    name = "mock"
    _seq = 1000

    def __init__(self) -> None:
        self._codes: dict[str, str] = {}
        self._active: dict[str, dict] = {}

    async def get_number(self, service: str, country: str) -> dict:
        MockActivationProvider._seq += 1
        aid = str(MockActivationProvider._seq)
        phone = f"+70009{aid}"
        self._active[aid] = {"activation_id": aid, "phone": phone, "service": service, "status": "WAITING", "code": None}
        return {"activation_id": aid, "phone": phone}

    async def get_status(self, activation_id: str) -> dict:
        code = self._codes.get(activation_id)
        return {"state": "OK", "code": code} if code else {"state": "WAITING", "code": None}

    async def set_status(self, activation_id: str, status: int) -> None:
        if status == 8:
            self._active.pop(activation_id, None)

    async def get_active_activations(self) -> list[dict]:
        return list(self._active.values())

    async def get_catalog(self) -> dict:
        # representative sandbox catalog for dev/tests (never shown in production without a real key)
        return {
            "countries": [{"code": "0", "title": "Россия"}, {"code": "1", "title": "Украина"},
                          {"code": "2", "title": "Казахстан"}],
            "services": [{"code": "tg", "title": "Telegram"}, {"code": "wa", "title": "WhatsApp"},
                         {"code": "go", "title": "Google"}],
            "prices": {
                "0": {"tg": {"cost": Decimal("18.00"), "count": 120}, "wa": {"cost": Decimal("22.00"), "count": 40}},
                "1": {"tg": {"cost": Decimal("20.00"), "count": 15}, "go": {"cost": Decimal("12.00"), "count": 0}},
            },
        }

    # test helper: simulate the provider receiving a code
    def _deliver_code(self, activation_id: str, code: str) -> None:
        self._codes[activation_id] = code


class SmsActivateProvider(ActivationProvider):
    """Adapter for sms-activate.org's handler_api.php protocol. Key is read from settings (.env)."""

    name = "sms_activate"

    def __init__(self, api_key: str, base_url: str) -> None:
        self._key = api_key
        self._url = base_url

    async def _call(self, action: str, **params) -> str:
        q = {"api_key": self._key, "action": action, **params}
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(self._url, params=q)
            if resp.status_code >= 500:
                raise ProviderTimeout(f"{action} http {resp.status_code}")
            return resp.text.strip()
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise ProviderTimeout(f"{action}: {exc}") from exc

    async def get_number(self, service: str, country: str) -> dict:
        body = await self._call("getNumber", service=service, country=country)
        if body.startswith("ACCESS_NUMBER"):
            _, aid, phone = body.split(":", 2)
            return {"activation_id": aid, "phone": phone if phone.startswith("+") else f"+{phone}"}
        # NO_NUMBERS, NO_BALANCE, BAD_KEY, etc. — a definite negative answer
        raise ProviderError(body)

    async def get_status(self, activation_id: str) -> dict:
        body = await self._call("getStatus", id=activation_id)
        if body.startswith("STATUS_OK"):
            return {"state": "OK", "code": body.split(":", 1)[1] if ":" in body else None}
        if body == "STATUS_CANCEL":
            return {"state": "CANCELLED", "code": None}
        return {"state": "WAITING", "code": None}  # STATUS_WAIT_CODE / STATUS_WAIT_RETRY

    async def set_status(self, activation_id: str, status: int) -> None:
        await self._call("setStatus", id=activation_id, status=status)

    async def get_active_activations(self) -> list[dict]:
        import json

        body = await self._call("getActiveActivations")
        try:
            data = json.loads(body)
        except ValueError:
            return []
        out = []
        for a in data.get("activeActivations", []) if isinstance(data, dict) else []:
            out.append({"activation_id": str(a.get("activationId")), "phone": a.get("phoneNumber"),
                        "service": a.get("serviceCode"), "status": "WAITING", "code": None})
        return out

    async def get_catalog(self) -> dict:
        import json

        try:
            countries = json.loads(await self._call("getCountries"))
            prices_raw = json.loads(await self._call("getPrices"))
        except ValueError as exc:
            raise ProviderError(f"bad catalog response: {exc}") from exc
        clist = [{"code": str(k), "title": (v.get("rus") or v.get("eng") or str(k))}
                 for k, v in (countries.items() if isinstance(countries, dict) else [])]
        prices: dict = {}
        services: dict[str, str] = {}
        for country, svcs in (prices_raw.items() if isinstance(prices_raw, dict) else []):
            prices[str(country)] = {}
            for svc, info in (svcs.items() if isinstance(svcs, dict) else []):
                cost = Decimal(str(info.get("cost", 0)))
                count = int(info.get("count", 0))
                prices[str(country)][svc] = {"cost": cost, "count": count}
                services.setdefault(svc, svc)
        return {"countries": clist, "services": [{"code": c, "title": t} for c, t in services.items()], "prices": prices}


def get_provider() -> ActivationProvider:
    s = get_settings()
    if s.sms_activate_api_key:
        return SmsActivateProvider(s.sms_activate_api_key, s.sms_activate_base_url)
    return _MOCK


_MOCK = MockActivationProvider()


# ----------------------------------------------------------------- helpers


def _log(act: SmsActivation, event: str, **data) -> None:
    events = list(act.events or [])
    events.append({"at": utcnow().isoformat(), "event": event, **data})
    act.events = events[-50:]


def out(act: SmsActivation) -> dict:
    return {
        "id": act.id, "user_id": act.user_id, "status": act.status, "service": act.service,
        "country": act.country, "phone_number": act.phone_number, "activation_id": act.activation_id,
        "code": act.code, "cost": float(act.cost), "refunded": act.refunded,
        "created_at": act.created_at.isoformat() if act.created_at else None,
        "expires_at": act.expires_at.isoformat() if act.expires_at else None,
    }


async def _refund_once(session: AsyncSession, act: SmsActivation, reason: str) -> None:
    """Credit the cost back to the buyer's balance at most once per activation (under a user-row lock)."""
    if act.refunded or act.cost <= 0:
        return
    user = await lock(session, User, act.user_id)
    if user is None:
        return
    await change_balance(session, user, money(act.cost), TxType.refund, f"Возврат за SMS-активацию #{act.id}: {reason}"[:255])
    act.refunded = True
    _log(act, "refunded", reason=reason)


# ----------------------------------------------------------------- buy


async def buy(session: AsyncSession, user_id: int, chat_id: int, *, service: str, country: str, cost: Decimal,
              provider_cost: Decimal = Decimal("0"), provider: ActivationProvider | None = None) -> SmsActivation:
    """Reserve + charge + request a number. One in-flight activation per user (DB-enforced)."""
    prov = provider or get_provider()
    user = await lock(session, User, user_id)
    if user is None:
        raise ServiceError("Пользователь не найден", 404)
    act = SmsActivation(user_id=user_id, chat_id=chat_id, provider=prov.name, service=service,
                        country=country, status="RESERVED", cost=money(cost), provider_cost=money(provider_cost),
                        expires_at=utcnow() + timedelta(minutes=ACTIVATION_TTL_MINUTES))
    # charge first; the partial unique index rejects a second active activation for this user
    await change_balance(session, user, -money(cost), TxType.purchase, f"SMS-активация {service}/{country}")
    session.add(act)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ServiceError("У вас уже есть незавершённая активация. Завершите или отмените её.", 409, "one_active") from exc
    _log(act, "reserved", service=service, country=country, cost=float(cost))

    act.status = "API_PENDING"
    await session.flush()
    try:
        res = await prov.get_number(service, country)
    except ProviderTimeout:
        await _reconcile(session, act, prov)
        return act
    except ProviderError as exc:
        act.status = "FAILED"
        _log(act, "provider_error", detail=str(exc)[:200])
        await _refund_once(session, act, "нет номера у провайдера")
        return act
    act.activation_id = str(res["activation_id"])
    act.phone_number = res.get("phone")
    act.status = "WAITING"
    _log(act, "number_received", activation_id=act.activation_id)
    return act


async def _reconcile(session: AsyncSession, act: SmsActivation, prov: ActivationProvider) -> None:
    """getNumber timed out: bind only an unambiguous active number, else require manual reconciliation."""
    try:
        active = await prov.get_active_activations()
    except (ProviderTimeout, ProviderError):
        active = []
    known = set(
        (await session.scalars(select(SmsActivation.activation_id).where(SmsActivation.activation_id.isnot(None)))).all()
    )
    candidates = [a for a in active if a.get("service") == act.service and str(a.get("activation_id")) not in known]
    if len(candidates) == 1:
        c = candidates[0]
        act.activation_id = str(c["activation_id"])
        act.phone_number = c.get("phone")
        act.status = "WAITING"
        _log(act, "reconciled_bound", activation_id=act.activation_id)
    else:
        act.status = "RECONCILIATION_REQUIRED"
        _log(act, "reconciliation_required", candidates=len(candidates))


# ----------------------------------------------------------------- lease + poll (worker)


async def claim_due(session: AsyncSession, owner: str, limit: int = 10) -> list[SmsActivation]:
    """Claim WAITING/API_PENDING rows whose lease is free or expired; bump lease_generation (zombie guard)."""
    now = utcnow()
    rows = (
        await session.scalars(
            select(SmsActivation)
            .where(SmsActivation.status.in_(("WAITING", "API_PENDING")),
                   or_(SmsActivation.lease_expires_at.is_(None), SmsActivation.lease_expires_at < now))
            .order_by(SmsActivation.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).all()
    for act in rows:
        act.lease_owner = owner
        act.lease_generation += 1
        act.lease_expires_at = now + timedelta(seconds=LEASE_TTL_SECONDS)
    return rows


async def poll_one(session: AsyncSession, activation_id: int, owner: str, generation: int,
                   provider: ActivationProvider | None = None) -> None:
    """Poll one leased activation. Applies changes only while the lease we claimed is still current."""
    prov = provider or get_provider()
    act = await lock(session, SmsActivation, activation_id)
    if act is None:
        return
    if act.lease_owner != owner or act.lease_generation != generation:
        log.warning("sms poll skipped: stale lease on activation %s (owner=%s gen=%s)", activation_id, owner, generation)
        return
    if act.status not in ("WAITING", "API_PENDING") or not act.activation_id:
        return
    if act.expires_at and act.expires_at <= utcnow():
        act.status = "TIMEOUT"
        _log(act, "timeout")
        await _refund_once(session, act, "код не пришёл вовремя")
        try:
            await prov.set_status(act.activation_id, 8)
        except (ProviderTimeout, ProviderError):
            pass
        return
    try:
        st = await prov.get_status(act.activation_id)
    except (ProviderTimeout, ProviderError):
        return  # try again next tick; lease will be renewed
    if st["state"] == "OK" and st.get("code"):
        act.code = str(st["code"])[:32]
        act.status = "COMPLETED"
        _log(act, "code_received")
        await enqueue_delivery(session, act)
        try:
            await prov.set_status(act.activation_id, 6)
        except (ProviderTimeout, ProviderError):
            pass
    elif st["state"] == "CANCELLED":
        act.status = "CANCELLED"
        _log(act, "provider_cancelled")
        await _refund_once(session, act, "отменено провайдером")


RESTORE_GRACE_SECONDS = 120


async def restore_pending(session: AsyncSession, *, provider: ActivationProvider | None = None,
                          grace_seconds: int = RESTORE_GRACE_SECONDS) -> int:
    """Recover activations stranded by a crash between charging and resolving get_number.

    A RESERVED/API_PENDING row with no provider activation_id, older than the grace window, is reconciled
    against the provider's active list — bound only on an unambiguous match, otherwise moved to
    RECONCILIATION_REQUIRED. It is never silently re-bought (unknown result ≠ success).
    """
    prov = provider or get_provider()
    cutoff = utcnow() - timedelta(seconds=grace_seconds)
    rows = (
        await session.scalars(
            select(SmsActivation)
            .where(SmsActivation.status.in_(("RESERVED", "API_PENDING")),
                   SmsActivation.activation_id.is_(None), SmsActivation.created_at < cutoff)
            .order_by(SmsActivation.id).limit(20).with_for_update(skip_locked=True)
        )
    ).all()
    for act in rows:
        log.warning("restoring stranded SMS activation %s (status=%s)", act.id, act.status)
        _log(act, "restore_pending", prev=act.status)
        await _reconcile(session, act, prov)
    return len(rows)


async def cancel(session: AsyncSession, activation_id: int, *, actor: str = "user",
                 provider: ActivationProvider | None = None) -> SmsActivation:
    """Buyer/operator cancels a waiting activation; refunds once."""
    prov = provider or get_provider()
    act = await lock(session, SmsActivation, activation_id)
    if act is None:
        raise ServiceError("Активация не найдена", 404)
    if act.status in TERMINAL:
        raise ServiceError(f"Активация уже завершена ({act.status})", 409, "already_final")
    if act.activation_id:
        try:
            await prov.set_status(act.activation_id, 8)
        except (ProviderTimeout, ProviderError):
            pass
    act.status = "CANCELLED"
    _log(act, "cancelled", by=actor)
    await _refund_once(session, act, "отмена покупателем")
    return act


# ----------------------------------------------------------------- outbox (resilient delivery)


async def enqueue_delivery(session: AsyncSession, act: SmsActivation) -> None:
    """Queue the code for delivery in the same transaction that stored it. Idempotent per activation."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    text = f"✅ Код подтверждения для номера {act.phone_number or ''}:\n<code>{act.code}</code>"
    await session.execute(
        pg_insert(DeliveryOutbox)
        .values(sms_activation_id=act.id, user_id=act.user_id, chat_id=act.chat_id,
                kind="activation_code", text=text, status="PENDING", dedupe_key=f"sms:{act.id}")
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
    )


async def deliver_outbox(session: AsyncSession, limit: int = 20) -> int:
    """Send queued codes. UNKNOWN (indeterminate send) is retried only after an audited warning."""
    rows = (
        await session.scalars(
            select(DeliveryOutbox)
            .where(DeliveryOutbox.status.in_(("PENDING", "UNKNOWN")))
            .order_by(DeliveryOutbox.id)
            .limit(limit)
            .with_for_update(skip_locked=True)
        )
    ).all()
    sent = 0
    for row in rows:
        if row.status == "UNKNOWN":
            # Bot API has no native dedup: re-sending an UNKNOWN may double-send. Audit before retrying.
            log.warning("outbox %s is UNKNOWN (attempt %s) — re-sending with possible duplicate", row.id, row.attempts)
        row.attempts += 1
        try:
            await telegram.call("sendMessage", {"chat_id": row.chat_id, "text": row.text, "parse_mode": "HTML"})
            row.status = "SENT"
            row.sent_at = utcnow()
            sent += 1
        except telegram.TelegramError as exc:
            if getattr(exc, "api", False):
                # definite rejection (blocked, bad chat) — do not retry forever
                row.status = "FAILED"
                row.last_error = str(exc)[:500]
            else:
                # transport/timeout: the send may or may not have landed
                row.status = "UNKNOWN" if row.attempts < OUTBOX_MAX_ATTEMPTS else "FAILED"
                row.last_error = str(exc)[:500]
                log.warning("outbox %s delivery indeterminate: %s", row.id, exc)
    return sent


# ----------------------------------------------------------------- pricing & catalog

import json  # noqa: E402
import time  # noqa: E402

from app.services import settings as settings_service  # noqa: E402

_catalog_cache: dict = {"at": 0.0, "data": None}


class PricingNotConfigured(ServiceError):
    def __init__(self) -> None:
        super().__init__("Наценка для SMS-активаций не настроена администратором", 409, "pricing_not_configured")


def _resolve_markup(country: str, service: str, g: str, cmap: dict, smap: dict) -> Decimal | None:
    """Most specific markup wins: service → country → global. None = not configured (do not sell)."""
    for val in (smap.get(service), cmap.get(country), g):
        if val not in (None, ""):
            try:
                return Decimal(str(val))
            except (ArithmeticError, ValueError):
                continue
    return None


async def _markups(session: AsyncSession) -> dict:
    def _jload(raw: str, default):
        try:
            return json.loads(raw) if raw else default
        except ValueError:
            return default
    return {
        "global": (await settings_service.get_value(session, "sms_markup_percent")).strip(),
        "country": _jload(await settings_service.get_value(session, "sms_markup_country"), {}),
        "service": _jload(await settings_service.get_value(session, "sms_markup_service"), {}),
        "min_profit": await settings_service.get_decimal(session, "sms_min_profit", "0"),
        "disabled": set(_jload(await settings_service.get_value(session, "sms_disabled_items"), [])),
    }


def quote(provider_cost: Decimal, country: str, service: str, m: dict) -> Decimal:
    """Final buyer price in shop currency via Decimal. Raises PricingNotConfigured if no markup applies."""
    pct = _resolve_markup(country, service, m["global"], m["country"], m["service"])
    if pct is None:
        raise PricingNotConfigured()
    price = money(provider_cost * (Decimal(1) + pct / Decimal(100)))
    if price - money(provider_cost) < money(m["min_profit"]):
        price = money(provider_cost) + money(m["min_profit"])
    return price


async def provider_catalog(session: AsyncSession, provider: ActivationProvider | None = None) -> dict:
    """Cached provider catalog (TTL from settings). Raises ProviderTimeout/Error when unreachable."""
    prov = provider or get_provider()
    ttl = int(await settings_service.get_value(session, "sms_catalog_ttl_seconds") or 300)
    now = time.monotonic()
    if _catalog_cache["data"] is not None and now - _catalog_cache["at"] < ttl:
        return _catalog_cache["data"]
    data = await prov.get_catalog()
    _catalog_cache.update(at=now, data=data)
    return data


async def catalog(session: AsyncSession, provider: ActivationProvider | None = None) -> dict:
    """Sellable catalog for the buyer: real availability + final prices. No provider cost leaked.

    Returns {enabled, configured, countries, items}. `configured` is False when markup is unset — the UI
    then shows "not configured" instead of a fake price, and nothing is sellable.
    """
    enabled = await settings_service.get_bool(session, "sms_enabled")
    m = await _markups(session)
    raw = await provider_catalog(session, provider)
    items, configured_any = [], False
    for country, svcs in raw["prices"].items():
        for service, info in svcs.items():
            if info["count"] <= 0 or f"{country}:{service}" in m["disabled"]:
                continue
            try:
                price = quote(info["cost"], country, service, m)
            except PricingNotConfigured:
                continue  # not priced -> not offered
            configured_any = True
            items.append({"country": country, "service": service, "price": float(price), "count": info["count"]})
    return {
        "enabled": enabled, "configured": configured_any,
        "countries": raw["countries"], "services": raw["services"], "items": items,
    }


async def admin_catalog(session: AsyncSession, provider: ActivationProvider | None = None) -> dict:
    """Catalog for admins: includes provider cost, resolved price, profit, and why a row is not sellable."""
    m = await _markups(session)
    raw = await provider_catalog(session, provider)
    rows = []
    for country, svcs in raw["prices"].items():
        for service, info in svcs.items():
            disabled = f"{country}:{service}" in m["disabled"]
            try:
                price = quote(info["cost"], country, service, m)
                profit = float(price - money(info["cost"]))
                priced = True
            except PricingNotConfigured:
                price, profit, priced = None, None, False
            rows.append({"country": country, "service": service, "cost": float(info["cost"]),
                         "count": info["count"], "price": float(price) if price is not None else None,
                         "profit": profit, "priced": priced, "disabled": disabled})
    return {"markups": {"global": m["global"], "country": m["country"], "service": m["service"],
                        "min_profit": float(m["min_profit"])}, "rows": rows}

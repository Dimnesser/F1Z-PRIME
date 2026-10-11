"""Number-ownership verification scaffold.

This module defines a provider interface and a **mock-only** implementation that generates fake,
non-functional codes for testing the UI and the order-review workflow. It deliberately does NOT read,
intercept or forward any real Telegram login code or ``.session`` data.

A real provider may be registered later ONLY where a documented, authorised ownership-confirmation API
exists for the operator of the sold numbers. Until then the mock is the only provider, and the owner
confirms issuance manually on the review screen.

Status flow:  WAITING → RECEIVED → APPROVED
                     ↘ EXPIRED / FAILED
"""
from __future__ import annotations

import logging
import secrets
from abc import ABC, abstractmethod
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Order, PhoneInventory, PhoneVerification
from app.services.common import ServiceError, utcnow

log = logging.getLogger("f1z.verification")

STATUSES = ("WAITING", "RECEIVED", "APPROVED", "EXPIRED", "FAILED")
TERMINAL = ("APPROVED", "EXPIRED", "FAILED")
DEFAULT_TTL_MINUTES = 15
MAX_ATTEMPTS = 5


def _mask_code(code: str) -> str:
    """Never store a full code. Keep only a length hint and the last two chars for UI correlation."""
    if not code:
        return ""
    return f"••••{code[-2:]}" if len(code) > 2 else "••"


class VerificationProvider(ABC):
    """Interface a future authorised provider must implement. No method ever returns a real Telegram OTP."""

    name: str = "base"

    @abstractmethod
    async def request(self, phone_e164: str, *, order_public_id: str) -> dict:
        """Start a verification. Returns provider metadata (never a real code)."""

    @abstractmethod
    async def poll(self, reference: str) -> dict:
        """Check provider status. For mock, returns a FAKE code marked as test-only."""


class MockVerificationProvider(VerificationProvider):
    """Generates clearly-fake codes for interface testing. The codes are random and non-functional."""

    name = "mock"

    async def request(self, phone_e164: str, *, order_public_id: str) -> dict:
        return {"reference": f"mock-{secrets.token_hex(6)}", "note": "Тестовый провайдер: коды фиктивные"}

    async def poll(self, reference: str) -> dict:
        fake = f"TEST-{secrets.randbelow(900000) + 100000}"  # fictitious, not a real verification code
        return {"code": fake, "test_only": True}


_PROVIDERS: dict[str, VerificationProvider] = {"mock": MockVerificationProvider()}


def get_provider(name: str = "mock") -> VerificationProvider:
    provider = _PROVIDERS.get(name)
    if provider is None:
        raise ServiceError(f"Провайдер проверки «{name}» не подключён", 400, "no_provider")
    return provider


def _log(v: PhoneVerification, event: str, **data) -> None:
    events = list(v.events or [])
    events.append({"at": utcnow().isoformat(), "event": event, **data})
    v.events = events[-50:]


async def open_for_order(session: AsyncSession, order: Order, *, provider: str = "mock") -> PhoneVerification:
    """Create a verification request bound to a paid order and its sold number (idempotent per order)."""
    existing = await session.scalar(select(PhoneVerification).where(PhoneVerification.order_id == order.id))
    if existing is not None:
        return existing
    phone = await session.scalar(
        select(PhoneInventory).where(PhoneInventory.sold_order_id == order.id, PhoneInventory.status == "SOLD")
        .order_by(PhoneInventory.id).limit(1)
    )
    prov = get_provider(provider)
    meta = await prov.request(phone.phone_e164 if phone else "", order_public_id=order.public_id or str(order.id))
    v = PhoneVerification(
        order_id=order.id, phone_id=phone.id if phone else None, provider=provider, status="WAITING",
        expires_at=utcnow() + timedelta(minutes=DEFAULT_TTL_MINUTES),
    )
    _log(v, "requested", provider=provider, reference=meta.get("reference"))
    session.add(v)
    await session.flush()
    return v


async def fetch_code(session: AsyncSession, verification_id: int, *, actor: str) -> PhoneVerification:
    """Mock-only: pull a FAKE code from the provider, move WAITING → RECEIVED. Guards against reuse/expiry."""
    v = await session.scalar(
        select(PhoneVerification).where(PhoneVerification.id == verification_id).with_for_update()
    )
    if v is None:
        raise ServiceError("Запрос проверки не найден", 404)
    if v.status in TERMINAL:
        raise ServiceError(f"Запрос уже завершён ({v.status})", 409, "already_final")
    if v.expires_at and v.expires_at <= utcnow():
        v.status = "EXPIRED"
        _log(v, "expired")
        raise ServiceError("Срок запроса истёк", 409, "expired")
    if v.attempts >= MAX_ATTEMPTS:
        v.status = "FAILED"
        _log(v, "failed", reason="too_many_attempts")
        raise ServiceError("Превышено число попыток", 429, "too_many")
    v.attempts += 1
    result = await get_provider(v.provider).poll(f"ref-{v.id}")
    v.code_masked = _mask_code(result.get("code", ""))
    v.status = "RECEIVED"
    _log(v, "received", test_only=result.get("test_only", False), by=actor, masked=v.code_masked)
    return v


async def decide(session: AsyncSession, verification_id: int, approve: bool, *, actor: str, note: str = "") -> PhoneVerification:
    """Owner decision. APPROVED confirms the issuance; reject marks FAILED. Protected against double-processing."""
    v = await session.scalar(
        select(PhoneVerification).where(PhoneVerification.id == verification_id).with_for_update()
    )
    if v is None:
        raise ServiceError("Запрос проверки не найден", 404)
    if v.status in TERMINAL:
        raise ServiceError(f"Решение уже принято ({v.status})", 409, "already_decided")
    v.status = "APPROVED" if approve else "FAILED"
    v.decided_by = actor[:64]
    _log(v, "approved" if approve else "rejected", by=actor, note=note[:200])
    return v


def out(v: PhoneVerification, phone: PhoneInventory | None = None) -> dict:
    return {
        "id": v.id, "order_id": v.order_id, "phone_id": v.phone_id,
        "phone_e164": phone.phone_e164 if phone else None, "provider": v.provider, "status": v.status,
        "code_masked": v.code_masked, "attempts": v.attempts, "events": v.events,
        "expires_at": v.expires_at.isoformat() if v.expires_at else None, "decided_by": v.decided_by,
        "created_at": v.created_at.isoformat(), "updated_at": v.updated_at.isoformat(),
    }

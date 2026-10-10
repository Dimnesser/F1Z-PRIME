from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import TypeVar

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base
from app.models import AdminAction, BalanceTransaction, TxType, User

T = TypeVar("T", bound=Base)


class ServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str = "bad_request") -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def money(value: Decimal | int | float | str) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def lock(session: AsyncSession, model: type[T], pk: int) -> T | None:
    """SELECT ... FOR UPDATE OF <table> — serialises concurrent changes of a row."""
    stmt = (
        select(model)
        .where(model.id == pk)  # type: ignore[attr-defined]
        .with_for_update(of=model)
        .execution_options(populate_existing=True)
    )
    return (await session.execute(stmt)).unique().scalar_one_or_none()


async def change_balance(
    session: AsyncSession,
    user: User,
    amount: Decimal,
    tx_type: TxType,
    description: str,
    *,
    order_id: int | None = None,
    payment_id: int | None = None,
) -> BalanceTransaction:
    """Must be called with `user` locked (see `lock`)."""
    amount = money(amount)
    new_balance = money(user.balance) + amount
    if new_balance < 0:
        raise ServiceError("Недостаточно средств на балансе", 402, "insufficient_funds")
    user.balance = new_balance
    tx = BalanceTransaction(
        user_id=user.id,
        type=tx_type,
        amount=amount,
        balance_after=new_balance,
        description=description[:255],
        order_id=order_id,
        payment_id=payment_id,
    )
    session.add(tx)
    return tx


SENSITIVE = ("password", "token", "secret", "key_value", "units", "number_full")


def _scrub(value):  # noqa: ANN001, ANN202
    if isinstance(value, dict):
        return {k: ("***" if any(x in str(k).lower() for x in SENSITIVE) else _scrub(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub(v) for v in value]
    return value


def log_admin(session: AsyncSession, admin: str, action: str, entity: str, entity_id: int | None, **details) -> None:
    """Audit log entry. Passwords, tokens and deliverable secrets are never stored (masked as ***)."""
    clean = _scrub(json.loads(json.dumps(details, default=lambda v: v.value if hasattr(v, "value") else str(v))))
    session.add(AdminAction(admin=admin, action=action, entity=entity, entity_id=entity_id, details=clean))

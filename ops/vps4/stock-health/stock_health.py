"""Keep «номер + код входа» stock sellable: only accounts whose sole Telegram authorization is the shop session.

A number is handed over only when the shop session is the account's only device (`phone_handoff.prepare`).
Stock that fails that check (other devices still logged in, revoked or missing session) is put on hold:
status DISABLED with a `hold:<reason>|` note prefix, so it is never sold. The periodic check releases it back
to AVAILABLE automatically as soon as the account is clean again (devices logged out, session re-created).
Manually disabled numbers (no `hold:` prefix) are never touched.

If a held-worthy number still gets sold (it was added between two checks), `fail_sale` refunds the order to
the balance at once and holds the number, instead of leaving the buyer with an order stuck in «sending».
"""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import or_, select

from app.db import session_factory
from app.models import Order, OrderStatus, PhoneInventory, Product, SessionAccount
from app.services import account_delivery, handoff_telegram, incidents, phones
from app.services.common import ServiceError, lock, log_admin, utcnow
from app.services.file_storage import lock_filename

log = logging.getLogger("f1z.stock_health")

HOLD = "hold:"
ACTOR = "auto:stock_health"
# Reasons that make a number unsellable; transient Telegram/network errors are never a reason to hold.
UNSELLABLE = {"other_devices", "handoff_baseline_invalid", "handoff_session_revoked", "handoff_session_missing",
              "handoff_identity_mismatch", "handoff_existing_devices", "phone_session_missing"}
NEW_STOCK = timedelta(minutes=15)       # fresh numbers: checked on every run
HELD_EVERY = timedelta(minutes=10)      # held numbers: rechecked for automatic return
AVAILABLE_EVERY = timedelta(hours=6)    # the rest of the sellable stock
_checked: dict[int, object] = {}        # phone_id -> last check time (per worker process)


def held_reason(row: PhoneInventory) -> str | None:
    note = row.note or ""
    return note[len(HOLD):].split("|", 1)[0] if row.status == "DISABLED" and note.startswith(HOLD) else None


def hold(session, row: PhoneInventory, reason: str) -> None:  # noqa: ANN001
    old = row.note or ""
    if old.startswith(HOLD):
        old = old.split("|", 1)[1] if "|" in old else ""
    row.status = "DISABLED"
    row.note = f"{HOLD}{reason}|{old}"[:255]
    log_admin(session, ACTOR, "phone_hold", "phone", row.id, reason=reason)


def release(session, row: PhoneInventory) -> None:  # noqa: ANN001
    note = row.note or ""
    row.status = "AVAILABLE"
    row.note = note.split("|", 1)[1] if note.startswith(HOLD) and "|" in note else ""
    log_admin(session, ACTOR, "phone_release", "phone", row.id)


async def diagnose(filename: str, phone: str) -> str | None:
    """None = clean, a reason from UNSELLABLE, or "unknown" when Telegram could not be asked."""
    try:
        snapshot = await handoff_telegram.inspect(filename, phone)
    except ServiceError as exc:
        return exc.code if exc.code in UNSELLABLE else "unknown"
    except Exception:  # noqa: BLE001 - never hold stock because of our own transient failure
        return "unknown"
    if sum(a.current for a in snapshot.authorizations) != 1:
        return "handoff_baseline_invalid"
    if any(not a.current for a in snapshot.authorizations):
        return "other_devices"
    return None


async def check_one(phone_id: int) -> str:
    """Check one AVAILABLE or held phone-code number under its row and file locks; hold or release it."""
    async with session_factory()() as session:
        row = await lock(session, PhoneInventory, phone_id)
        if row is None or row.reserved_order_id or row.sold_order_id:
            return "skip"
        held = held_reason(row)
        if row.status != "AVAILABLE" and held is None:
            return "skip"
        product = await session.get(Product, row.product_id) if row.product_id else None
        if product is None or (product.attributes or {}).get("delivery_kind") != "phone_code":
            return "skip"
        account = await session.scalar(select(SessionAccount).where(
            SessionAccount.phone_e164 == row.phone_e164, SessionAccount.retired_at.is_(None)).order_by(SessionAccount.id))
        if account is None:
            reason = "handoff_session_missing"
        else:
            await lock_filename(session, account.filename)
            reason = await diagnose(account.filename, row.phone_e164)
        _checked[phone_id] = utcnow()
        if reason == "unknown":
            await session.rollback()
            return "unknown"
        result = "ok"
        if reason and row.status == "AVAILABLE":
            hold(session, row, reason)
            result = f"held:{reason}"
        elif reason and held != reason:
            hold(session, row, reason)
            result = f"held:{reason}"
        elif reason is None and held is not None:
            release(session, row)
            result = "released"
        product = await lock(session, Product, product.id)
        await phones.sync_product_stock(session, product)
        await session.commit()
        if result != "ok":
            log.info("stock health phone=%s %s", phone_id, result)
        return result


async def check(limit: int = 25) -> str:
    """Periodic: fresh and held numbers often, the rest of the sellable stock every few hours."""
    now = utcnow()
    async with session_factory()() as session:
        rows = (await session.execute(
            select(PhoneInventory.id, PhoneInventory.status, PhoneInventory.created_at)
            .join(Product, Product.id == PhoneInventory.product_id)
            .where(Product.attributes["delivery_kind"].as_string() == "phone_code",
                   PhoneInventory.reserved_order_id.is_(None), PhoneInventory.sold_order_id.is_(None),
                   or_(PhoneInventory.status == "AVAILABLE",
                       (PhoneInventory.status == "DISABLED") & PhoneInventory.note.startswith(HOLD)))
            .order_by(PhoneInventory.id))).all()
    due = []
    for phone_id, status, created_at in rows:
        last = _checked.get(phone_id)
        every = HELD_EVERY if status == "DISABLED" else (timedelta(0) if now - created_at < NEW_STOCK else AVAILABLE_EVERY)
        if last is None or now - last >= every:
            due.append(phone_id)
    counts: dict[str, int] = {}
    for phone_id in due[:limit]:
        try:
            result = await check_one(phone_id)
        except Exception:  # noqa: BLE001 - one bad number must not stop the rest
            log.warning("stock health check failed for phone=%s", phone_id, exc_info=True)
            result = "error"
        key = result.split(":", 1)[0]
        counts[key] = counts.get(key, 0) + 1
    return ",".join(f"{k}:{v}" for k, v in sorted(counts.items())) or "idle"


async def fail_sale(session, order: Order, rows: list[PhoneInventory], row: PhoneInventory, exc: ServiceError) -> bool:  # noqa: ANN001
    """Called from phone delivery (order locked) when the handoff check refuses the number before it was sent.

    Refunds the whole order to the balance and holds the number. Returns False when the failure is transient
    or part of the order was already sent; the caller then keeps its normal retry/alert path.
    """
    code = getattr(exc, "code", None)
    if code not in UNSELLABLE or order.status != OrderStatus.processing or order.phone_sent_at:
        return False
    if any(r.bot_sent_at for r in rows):
        return False
    from app.services.orders import add_event, refund_to_balance

    reason = "other_devices" if code == "handoff_existing_devices" else code
    row.sold_order_id = row.reserved_order_id = None
    row.sold_at = row.reserved_at = row.bot_sent_at = None
    hold(session, row, reason)
    await refund_to_balance(session, order, actor=ACTOR,
                            reason="Номер оказался недоступен для безопасной передачи. Деньги возвращены на баланс.")
    old = order.status
    order.status = OrderStatus.refunded
    add_event(session, order, OrderStatus.refunded, ACTOR, old,
              note="Автовозврат: номер не прошёл проверку перед выдачей, снят с продажи до исправления")
    product = await lock(session, Product, row.product_id) if row.product_id else None
    if product is not None:
        await phones.sync_product_stock(session, product)
    await incidents.resolve_for_order(session, order.id, ["phone_handoff_prepare_failed"], ACTOR)
    await account_delivery.alert(session, order, "phone_auto_refunded",
        "Номер не прошёл проверку перед выдачей (другие устройства или завершённая сессия). Заказ автоматически "
        "возвращён на баланс, номер снят с продажи и вернётся сам после исправления.")
    log.warning("auto refund order=%s phone=%s reason=%s", order.id, row.id, reason)
    return True

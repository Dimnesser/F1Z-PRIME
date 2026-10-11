"""Fulfillment: what happens after a payment is confirmed.

Runs only from the worker (job "fulfill"), never from a request handler. Idempotent: the order row is locked,
a delivered order is never delivered again, and inventory units are attached to exactly one order.

Modes (per product, set in the admin panel):
  auto    — encrypted inventory units (license keys/vouchers) or the product's delivery text are issued
            automatically when the global switch "auto_fulfillment" is on;
  manual  — an operator task is created (e.g. virtual numbers, anything that needs a human);
  review  — the order is held for a manual check first.
Premium numbers are revealed to the buyer at payment time (existing behaviour).
Selling or transferring Telegram accounts/sessions/login codes is never automated.
"""
from __future__ import annotations

import logging

from app.models import Order, OrderStatus, Product
from app.services import incidents, inventory, notifications, phones, rules
from app.services import settings as settings_service
from app.services.common import ServiceError, lock, utcnow
from app.services.orders import add_event

log = logging.getLogger("f1z.fulfillment")

MODES = ("auto", "manual", "review")


class FulfillmentError(Exception):
    pass


async def process(session, order_id: int) -> str:  # noqa: ANN001
    """Returns the resulting fulfillment status. Raises FulfillmentError for retryable failures."""
    order = await lock(session, Order, order_id)
    if order is None:
        return "missing"
    if order.fulfillment_status == "delivered" or order.status == OrderStatus.completed:
        return "delivered"  # already done — repeated events must not deliver twice
    if order.status not in (OrderStatus.paid, OrderStatus.processing):
        return f"skipped:{order.status.value}"  # cancelled / refunded before delivery
    if order.fulfillment_status in ("manual", "review"):
        return order.fulfillment_status  # waiting for a human; retry happens only via an admin action

    product = await lock(session, Product, order.product_id) if order.product_id else None
    mode = product.fulfillment_mode if product else "manual"
    auto_enabled = await settings_service.get_bool(session, "auto_complete_digital")
    order.fulfillment_attempts += 1

    if mode == "review":
        return await _hand_over(session, order, "review", "Заказ требует проверки перед выдачей")
    held_by = await rules.should_hold(session, order)
    if held_by:
        return await _hand_over(session, order, "review", f"Задержан правилом «{held_by}»")
    if mode != "auto" or not auto_enabled or product is None:
        reason = "Автовыдача выключена в настройках" if mode == "auto" and not auto_enabled else "Ручная выдача"
        return await _hand_over(session, order, "manual", reason)

    order.fulfillment_status = "processing"
    try:
        if product.uses_inventory:
            items = await inventory.sell_units(session, order, product)
            order.delivery_data = f"Выдано единиц: {len(items)}. Данные доступны в карточке заказа."
        elif product.uses_phone_inventory:
            rows = await phones.sell_for_order(session, order, product)
            order.delivery_data = "\n".join(phones.numbers_of(rows))
        elif product.delivery_note.strip():
            order.delivery_data = product.delivery_note
        else:
            return await _hand_over(session, order, "manual", "У товара нет данных для автовыдачи")
    except ServiceError as exc:
        order.fulfillment_error = exc.message[:500]
        raise FulfillmentError(exc.message) from exc

    now = utcnow()
    old = order.status
    order.status = OrderStatus.completed
    order.completed_at = now
    order.delivered_at = now
    order.fulfillment_status = "delivered"
    order.fulfillment_error = None
    add_event(session, order, OrderStatus.completed, "auto:fulfillment", old, note="Товар выдан автоматически")
    await incidents.resolve_for_order(session, order.id, ["fulfillment_failed", "stuck_order"], "auto")
    await notifications.notify_customer(session, order, "order_delivered")
    await rules.fire(session, "order_delivered", order.id)
    if product.uses_phone_inventory and await settings_service.get_bool(session, "phone_verification_enabled"):
        # optional, non-blocking: open an ownership-confirmation request for the owner to review (mock provider)
        from app.services import verification

        await verification.open_for_order(session, order)
        await notifications.notify_staff(
            session, "staff_phone_verification",
            notifications.order_values(order, reason="Открыта заявка на подтверждение владения номером"),
            dedupe=f"phv:{order.id}",
        )
    return "delivered"


async def _hand_over(session, order: Order, status: str, reason: str) -> str:  # noqa: ANN001
    order.fulfillment_status = status
    if order.status == OrderStatus.paid:
        order.status = OrderStatus.processing
        add_event(session, order, OrderStatus.processing, "auto:fulfillment", OrderStatus.paid, note=reason)
    await notifications.notify_customer(session, order, "order_review" if status == "review" else "order_processing")
    await notifications.notify_staff(session, "staff_manual_task", notifications.order_values(order), dedupe=f"task:{order.id}")
    return status


async def mark_failed(session, order_id: int, error: str) -> None:  # noqa: ANN001
    """Called when the fulfill job is dead: keep the payment, move the order to the manual queue."""
    order = await lock(session, Order, order_id)
    if order is None or order.fulfillment_status == "delivered":
        return
    order.fulfillment_status = "failed"
    order.fulfillment_error = error[:500]
    if order.status == OrderStatus.paid:
        order.status = OrderStatus.processing
        add_event(session, order, OrderStatus.processing, "auto:fulfillment", OrderStatus.paid, note=f"Ошибка выдачи: {error[:200]}")
    await incidents.open_incident(
        session, "fulfillment_failed", f"Не удалось выдать заказ {order.public_id or order.id}", severity="critical",
        order_id=order.id, details={"error": error[:500]}, dedupe_key=f"fulfillment_failed:{order.id}",
    )
    await notifications.notify_customer(session, order, "order_problem")
    await rules.fire(session, "fulfillment_failed", order.id)
    await notifications.notify_staff(
        session, "staff_fulfillment_failed", notifications.order_values(order, reason=error[:300]), dedupe=f"ff:{order.id}"
    )


async def retry(session, order_id: int, actor: str) -> None:  # noqa: ANN001
    """Admin action: put a failed / manual / review order back into the automatic queue."""
    from app.services import jobs

    order = await lock(session, Order, order_id)
    if order is None:
        raise ServiceError("Заказ не найден", 404)
    if order.status not in (OrderStatus.paid, OrderStatus.processing) or order.fulfillment_status == "delivered":
        raise ServiceError("Заказ не ожидает выдачи", 409)
    order.fulfillment_status = "pending"
    order.fulfillment_error = None
    add_event(session, order, order.status, actor, order.status, note="Повторная обработка выдачи")
    await jobs.enqueue(session, "fulfill", {"order_id": order.id}, dedupe_key=f"fulfill:{order.id}", revive=True)


async def hand_to_operator(session, order_id: int, actor: str, note: str = "") -> None:  # noqa: ANN001
    order = await lock(session, Order, order_id)
    if order is None:
        raise ServiceError("Заказ не найден", 404)
    if order.status not in (OrderStatus.paid, OrderStatus.processing) or order.fulfillment_status == "delivered":
        raise ServiceError("Заказ не ожидает выдачи", 409)
    order.fulfillment_status = "manual"
    if order.status == OrderStatus.paid:
        order.status = OrderStatus.processing
    add_event(session, order, OrderStatus.processing, actor, None, note=note or "Передан оператору")


async def run_now(order_id: int) -> str | None:
    """Try to deliver right after the payment commit (fast path). The durable job stays as the fallback:
    if this fails or the process dies, the worker delivers later; delivered orders are never delivered twice."""
    from sqlalchemy import update

    from app.db import session_factory
    from app.models import Job

    try:
        async with session_factory()() as session:
            result = await process(session, order_id)
            if result in ("delivered", "manual", "review") or result.startswith("skipped") or result == "missing":
                await session.execute(
                    update(Job).where(Job.dedupe_key == f"fulfill:{order_id}", Job.status == "pending")
                    .values(status="done", finished_at=utcnow())
                )
            await session.commit()
            return result
    except Exception as exc:  # noqa: BLE001 - worker will retry
        log.warning("immediate fulfillment of order %s deferred to worker: %s", order_id, exc)
        return None

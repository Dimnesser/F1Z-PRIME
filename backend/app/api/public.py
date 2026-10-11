from __future__ import annotations

import logging
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api.deps import SessionDep, UserDep
from app.config import get_settings
from app.models import (
    BalanceTransaction,
    Category,
    Country,
    InventoryItem,
    Order,
    OrderStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    PremiumNumber,
    PremiumStatus,
    Product,
    ProductStatus,
    SupportMessage,
    SupportTicket,
    TicketStatus,
)
from app.schemas import (
    CountryCatalogOut,
    ManualSubmit,
    MessageCreate,
    OrderCreate,
    OrderDetailOut,
    OrderOut,
    OrderSupportCreate,
    PaymentOut,
    PayRequest,
    PayResponse,
    PremiumNumberOut,
    ProductOut,
    TicketCreate,
    TicketDetailOut,
    TicketOut,
    TopupRequest,
    TransactionOut,
    UserOut,
)
from app.services import orders as order_service
from app.services import payments as payment_service
from app.services import settings as settings_service
from app.services import fulfillment, inventory, monitor, notifications
from app.services import promo as promo_service
from app.services import rules
from app.services import support as support_service
from app.services.common import utcnow

router = APIRouter(prefix="/api", tags=["miniapp"])
client_log = logging.getLogger("f1z.client")
_client_errors: dict[str, deque[float]] = defaultdict(deque)


class ClientError(BaseModel):
    message: str = Field(max_length=500)
    stack: str = Field(default="", max_length=2000)
    path: str = Field(default="", max_length=200)
    ua: str = Field(default="", max_length=300)
    kind: str = Field(default="error", max_length=32)


@router.post("/client-errors", status_code=204, response_class=Response)
async def report_client_error(body: ClientError, request: Request) -> Response:
    """Mini App runtime errors -> server log (no auth, rate limited, size limited)."""
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    hits = _client_errors[ip]
    now = time.monotonic()
    while hits and now - hits[0] > 600:
        hits.popleft()
    if len(hits) >= 20:
        return Response(status_code=204)
    hits.append(now)
    client_log.warning(
        "client %s on %s: %s | ua=%s | stack=%s",
        body.kind, body.path, body.message, body.ua, body.stack.replace("\n", " <- ")[:2000],
    )
    if body.kind != "smoke":
        await monitor.record("client", body.message, body.path, f"{body.ua}\n{body.stack}")
    return Response(status_code=204)

CATEGORY_META = {
    "numbers": {"title": "Номера по странам", "icon": "globe"},
    "premium": {"title": "Красивые номера", "icon": "gem"},
    "digital": {"title": "Цифровые товары", "icon": "sparkles"},
    "services": {"title": "Сервисы", "icon": "zap"},
}


@router.get("/config")
async def public_config(session: SessionDep) -> dict:
    s = get_settings()
    values = await settings_service.get_all(session, public_only=True)
    methods = ["balance"]
    if values.get("stars_enabled", "").lower() == "true" and s.bot_token:
        methods.append("stars")
    if values.get("manual_enabled", "").lower() == "true":
        methods.append("manual")
    if s.dev_mode and not s.is_production:
        methods.append("test")
    return {
        "settings": values,
        "dev_mode": s.dev_mode and not s.is_production,
        "bot_username": s.bot_username,
        "payment_methods": methods,
    }


async def _country_catalog(session: SessionDep) -> list[CountryCatalogOut]:
    countries = (
        await session.scalars(select(Country).where(Country.is_active).order_by(Country.sort_order, Country.name))
    ).all()
    now = utcnow()
    products = sorted(
        (
            p for p in (
                await session.scalars(
                    select(Product).where(
                        Product.status == ProductStatus.active, Product.category == "numbers",
                        Product.country_id.is_not(None),
                    )
                )
            ).unique().all()
            if p.on_sale_window(now)
        ),
        key=lambda p: p.effective_price(now),
    )
    by_country: dict[int, list[Product]] = {}
    for p in products:
        by_country.setdefault(p.country_id, []).append(p)  # type: ignore[arg-type]
    out = []
    for c in countries:
        items = by_country.get(c.id, [])
        in_stock = [p for p in items if p.stock > 0]
        main = in_stock[0] if in_stock else (items[0] if items else None)
        out.append(
            CountryCatalogOut(
                **CountryCatalogOut.model_validate(c, from_attributes=True).model_dump(
                    exclude={"product_id", "price", "stock", "price_usd", "price_stars", "stars_enabled"}
                ),
                product_id=main.id if main else None,
                price=main.effective_price(now) if main else None,
                price_usd=main.price_usd if main else None,
                price_stars=main.price_stars if main else None,
                stars_enabled=main.stars_enabled if main else True,
                stock=sum(p.stock for p in items),
            )
        )
    return out


@router.get("/countries", response_model=list[CountryCatalogOut])
async def countries(session: SessionDep) -> list[CountryCatalogOut]:
    return await _country_catalog(session)


@router.get("/categories")
async def categories(session: SessionDep) -> list[dict]:
    rows = (
        await session.execute(
            select(Product.category, func.count(Product.id), func.coalesce(func.sum(Product.stock), 0))
            .where(Product.status == ProductStatus.active)
            .group_by(Product.category)
        )
    ).all()
    meta = {c.slug: c for c in (await session.scalars(select(Category))).all()}
    premium = await session.scalar(
        select(func.count(PremiumNumber.id)).where(PremiumNumber.status == PremiumStatus.available)
    )
    result = []
    for cat, cnt, stock in sorted(rows, key=lambda r: (meta[r[0]].sort_order if r[0] in meta else 1000, r[0])):
        c = meta.get(cat)
        if c is not None and not c.is_active:
            continue
        fallback = CATEGORY_META.get(cat, {"title": cat.title(), "icon": "box"})
        result.append({
            "slug": cat, "count": cnt, "stock": int(stock),
            "title": c.title if c else fallback["title"], "icon": c.icon if c else fallback["icon"],
        })
    result.append({"slug": "premium", "count": premium or 0, "stock": premium or 0, **CATEGORY_META["premium"]})
    return result


@router.get("/products", response_model=list[ProductOut])
async def products(
    session: SessionDep,
    country_id: int | None = None,
    category: str | None = Query(default=None, max_length=32),
    popular: bool | None = None,
    tag: str | None = Query(default=None, max_length=32),
) -> list[Product]:
    stmt = select(Product).where(Product.status == ProductStatus.active)
    if country_id:
        stmt = stmt.where(Product.country_id == country_id)
    if category:
        stmt = stmt.where(Product.category == category)
    if popular:
        stmt = stmt.where(Product.is_popular)
    rows = list((await session.scalars(stmt.order_by(Product.sort_order, Product.id))).unique().all())
    return await _storefront(session, rows, tag)


async def _storefront(session: SessionDep, rows: list[Product], tag: str | None = None) -> list[Product]:
    """Applies the store settings: sale window, out-of-stock visibility and catalog sort order."""
    now = utcnow()
    rows = [p for p in rows if p.on_sale_window(now) and (not tag or tag in (p.tags or []))]
    if not await settings_service.get_bool(session, "show_out_of_stock"):
        rows = [p for p in rows if p.stock > 0]
    sort = await settings_service.get_value(session, "catalog_sort")
    if sort == "price_asc":
        rows.sort(key=lambda p: p.effective_price(now))
    elif sort == "price_desc":
        rows.sort(key=lambda p: p.effective_price(now), reverse=True)
    elif sort == "popular":
        rows.sort(key=lambda p: (not p.is_popular, p.sort_order, p.id))
    elif sort == "new":
        rows.sort(key=lambda p: p.id, reverse=True)
    return rows


@router.get("/products/{product_id}", response_model=ProductOut)
async def product_detail(product_id: int, session: SessionDep) -> Product:
    product = await session.get(Product, product_id)
    if product is None or product.status != ProductStatus.active or not product.on_sale_window(utcnow()):
        raise HTTPException(404, "Товар не найден")
    return product


PROMO_CHECKS_PER_MIN = 15  # guards against guessing codes
_promo_checks: dict[int, deque[float]] = defaultdict(deque)


class PromoCheck(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    product_id: int = Field(gt=0)
    quantity: int = Field(default=1, ge=1, le=10)


@router.post("/promo/check")
async def promo_check(body: PromoCheck, user: UserDep, session: SessionDep) -> dict:
    """Preview of a promo code discount. The order applies it again on the server, under a lock."""
    hits = _promo_checks[user.id]
    now = time.monotonic()
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= PROMO_CHECKS_PER_MIN:
        raise HTTPException(429, "Слишком много попыток. Попробуйте через минуту.")
    hits.append(now)
    product = await session.get(Product, body.product_id)
    if product is None or product.status != ProductStatus.active:
        raise HTTPException(404, "Товар не найден")
    subtotal = product.effective_price(utcnow()) * body.quantity
    res = await promo_service.preview(session, user, body.code, product, subtotal)
    return {"code": res["code"], "discount": float(res["discount"]), "total": float(res["total"]),
            "subtotal": float(subtotal)}


@router.get("/premium-numbers", response_model=list[PremiumNumberOut])
async def premium_numbers(
    session: SessionDep, country_id: int | None = None, tier: str | None = Query(default=None, max_length=16)
) -> list[PremiumNumber]:
    stmt = select(PremiumNumber).where(PremiumNumber.status == PremiumStatus.available)
    if country_id:
        stmt = stmt.where(PremiumNumber.country_id == country_id)
    if tier:
        stmt = stmt.where(PremiumNumber.tier == tier)
    return list((await session.scalars(stmt.order_by(PremiumNumber.price.desc()))).all())


@router.get("/premium-numbers/{number_id}", response_model=PremiumNumberOut)
async def premium_detail(number_id: int, session: SessionDep) -> PremiumNumber:
    number = await session.get(PremiumNumber, number_id)
    if number is None or number.status == PremiumStatus.hidden:
        raise HTTPException(404, "Номер не найден")
    return number


# ------------------------------------------------------------------ profile


@router.get("/me", response_model=UserOut)
async def me(user: UserDep) -> object:
    return user


@router.get("/me/admin-access")
async def my_admin_access(user: UserDep, session: SessionDep) -> dict:
    """Whether to show the «Админ-панель» button. Decided on the server from the Telegram id in signed initData."""
    from app.services.admin_access import telegram_access

    role, _ = await telegram_access(session, user.telegram_id)
    return {"allowed": role is not None, "role": role}


@router.get("/me/transactions", response_model=list[TransactionOut])
async def my_transactions(user: UserDep, session: SessionDep, limit: int = Query(50, ge=1, le=200)) -> list:
    stmt = (
        select(BalanceTransaction)
        .where(BalanceTransaction.user_id == user.id)
        .order_by(BalanceTransaction.id.desc())
        .limit(limit)
    )
    return list((await session.scalars(stmt)).all())


@router.get("/me/payments", response_model=list[PaymentOut])
async def my_payments(user: UserDep, session: SessionDep) -> list:
    stmt = select(Payment).where(Payment.user_id == user.id).order_by(Payment.id.desc()).limit(50)
    return list((await session.scalars(stmt)).all())


# ------------------------------------------------------------------- orders


@router.post("/orders", response_model=OrderOut, status_code=201)
async def create_order(body: OrderCreate, user: UserDep, session: SessionDep) -> Order:
    order, created = await order_service.create_order(
        session,
        user,
        idempotency_key=body.idempotency_key,
        product_id=body.product_id,
        premium_number_id=body.premium_number_id,
        quantity=body.quantity,
        promo_code=body.promo_code or None,
    )
    if created:
        await notifications.notify_customer(session, order, "order_created")  # off by default (template switch)
    await session.commit()
    return order


@router.get("/orders", response_model=list[OrderOut])
async def my_orders(user: UserDep, session: SessionDep) -> list:
    stmt = select(Order).where(Order.user_id == user.id).order_by(Order.id.desc()).limit(100)
    return list((await session.scalars(stmt)).unique().all())


async def _order_detail(session: SessionDep, order: Order) -> OrderDetailOut:
    payments = (await session.scalars(select(Payment).where(Payment.order_id == order.id).order_by(Payment.id))).all()
    data = OrderDetailOut.model_validate(order, from_attributes=True)
    data.payments = [PaymentOut.model_validate(p, from_attributes=True) for p in payments]
    review = any(p.status == PaymentStatus.awaiting_confirmation for p in payments)
    data.stage = order_service.order_stage(order, payment_review=review)
    if order.product and order.status.value in ("paid", "processing", "completed"):
        data.delivery_note = order.product.delivery_note or None
    # secrets are decrypted only for a delivered order of this buyer (never before confirmed payment)
    if order.status == OrderStatus.completed and order.fulfillment_status == "delivered":
        units = (
            await session.scalars(
                select(InventoryItem)
                .where(InventoryItem.order_id == order.id, InventoryItem.status == "sold")
                .order_by(InventoryItem.id)
            )
        ).all()
        data.delivered_items = inventory.delivered_secrets(list(units))
    data.support_ticket_id = await session.scalar(
        select(SupportTicket.id)
        .where(SupportTicket.order_id == order.id, SupportTicket.status != TicketStatus.closed)
        .order_by(SupportTicket.id.desc())
        .limit(1)
    )
    return data


@router.get("/orders/{order_id}", response_model=OrderDetailOut)
async def order_detail(order_id: int, user: UserDep, session: SessionDep) -> OrderDetailOut:
    order = await session.get(Order, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, "Заказ не найден")
    return await _order_detail(session, order)


@router.post("/orders/{order_id}/pay", response_model=PayResponse)
async def pay_order(order_id: int, body: PayRequest, user: UserDep, session: SessionDep) -> PayResponse:
    result = await payment_service.start_order_payment(session, user, order_id, body.method)
    await session.commit()
    if body.method in (PaymentMethod.balance, PaymentMethod.test):
        # instant delivery right after the payment commit; the queued worker job is the durable fallback
        await fulfillment.run_now(order_id)
    order = await session.get(Order, order_id, populate_existing=True)
    return PayResponse(
        payment=PaymentOut.model_validate(result.payment, from_attributes=True),
        order=OrderOut.model_validate(order, from_attributes=True) if order else None,
        invoice_link=result.invoice_link,
        instructions=result.instructions,
    )


@router.post("/orders/{order_id}/cancel", response_model=OrderOut)
async def cancel_order(order_id: int, user: UserDep, session: SessionDep) -> Order:
    order = await order_service.cancel_by_user(session, user, order_id)
    await session.commit()
    return order


# ---------------------------------------------------------------- payments


@router.post("/balance/topup", response_model=PayResponse)
async def topup(body: TopupRequest, user: UserDep, session: SessionDep) -> PayResponse:
    result = await payment_service.start_topup(session, user, body.amount, body.method)
    await session.commit()
    return PayResponse(
        payment=PaymentOut.model_validate(result.payment, from_attributes=True),
        invoice_link=result.invoice_link,
        instructions=result.instructions,
    )


@router.get("/payments/{payment_id}", response_model=PaymentOut)
async def payment_status(payment_id: int, user: UserDep, session: SessionDep) -> Payment:
    payment = await session.get(Payment, payment_id)
    if payment is None or payment.user_id != user.id:
        raise HTTPException(404, "Платёж не найден")
    return payment


@router.post("/payments/{payment_id}/submit", response_model=PaymentOut)
async def submit_manual(payment_id: int, body: ManualSubmit, user: UserDep, session: SessionDep) -> Payment:
    payment = await payment_service.submit_manual(session, user, payment_id, body.comment)
    order = await session.get(Order, payment.order_id) if payment.order_id else None
    values = {
        "payment_id": f"#{payment.id}", "price": f"{payment.amount} грн",
        "order_no": (order.public_id or f"#{order.id}") if order else "пополнение баланса",
        "reason": body.comment or "-", "customer_name": f"{user.telegram_id} @{user.username or '-'}",
    }
    if order is not None:
        await notifications.notify_customer(session, order, "payment_review", dedupe=f"payment_review:{payment.id}")
        await rules.fire(session, "payment_review", order.id)
    await notifications.notify_staff(session, "staff_payment_review", values, dedupe=f"review:{payment.id}")
    await session.commit()
    return payment


# ----------------------------------------------------------------- support


@router.get("/support/tickets", response_model=list[TicketOut])
async def my_tickets(user: UserDep, session: SessionDep) -> list:
    stmt = select(SupportTicket).where(SupportTicket.user_id == user.id).order_by(SupportTicket.updated_at.desc())
    return list((await session.scalars(stmt)).unique().all())


@router.post("/support/tickets", response_model=TicketDetailOut, status_code=201)
async def create_ticket(body: TicketCreate, user: UserDep, session: SessionDep) -> SupportTicket:
    ticket = await support_service.create_ticket(session, user, body.subject, body.text, category=body.category)
    await session.commit()
    return await _load_ticket(session, ticket.id, user.id)


@router.get("/support/categories")
async def support_categories() -> list[dict]:
    return [
        {"key": k, "label": v, "text": support_service.DEFAULT_TEXT[k]} for k, v in support_service.CATEGORIES.items()
    ]


class CountryRequest(BaseModel):
    country: str = Field(min_length=2, max_length=60)
    quantity: int = Field(default=1, ge=1, le=100)
    comment: str = Field(default="", max_length=1000)


@router.post("/support/country-request", response_model=TicketDetailOut, status_code=201)
async def country_request(body: CountryRequest, user: UserDep, session: SessionDep) -> SupportTicket:
    """A country that isn't in the catalog: a support ticket for the operator (no payment is taken here)."""
    if not await settings_service.get_bool(session, "country_requests_enabled"):
        raise HTTPException(403, "Заказ стран вне каталога сейчас недоступен")
    country = " ".join(body.country.split())
    text = f"Хочу заказать номер страны: {country}\nКоличество: {body.quantity}"
    if body.comment.strip():
        text += f"\nКомментарий: {body.comment.strip()}"
    ticket = await support_service.create_ticket(
        session, user, f"Запрос страны: {country}"[:160], text, category="country_request"
    )
    await session.commit()
    return await _load_ticket(session, ticket.id, user.id)


@router.post("/orders/{order_id}/support", response_model=TicketDetailOut, status_code=201)
async def order_support(order_id: int, body: OrderSupportCreate, user: UserDep, session: SessionDep) -> SupportTicket:
    """One tap from the order card: opens (or continues) a support ticket linked to this order."""
    ticket = await support_service.ticket_for_order(session, user, order_id, body.category, body.text)
    await session.commit()
    return await _load_ticket(session, ticket.id, user.id)


async def _load_ticket(session: SessionDep, ticket_id: int, user_id: int) -> SupportTicket:
    ticket = await session.scalar(
        select(SupportTicket)
        .options(selectinload(SupportTicket.messages))
        .where(SupportTicket.id == ticket_id)
        .execution_options(populate_existing=True)
    )
    if ticket is None or ticket.user_id != user_id:
        raise HTTPException(404, "Обращение не найдено")
    return ticket


@router.get("/support/tickets/{ticket_id}", response_model=TicketDetailOut)
async def ticket_detail(ticket_id: int, user: UserDep, session: SessionDep) -> SupportTicket:
    return await _load_ticket(session, ticket_id, user.id)


@router.post("/support/tickets/{ticket_id}/messages", response_model=TicketDetailOut)
async def ticket_reply(ticket_id: int, body: MessageCreate, user: UserDep, session: SessionDep) -> SupportTicket:
    ticket = await _load_ticket(session, ticket_id, user.id)
    if ticket.status == TicketStatus.closed:
        raise HTTPException(409, "Обращение закрыто")
    session.add(SupportMessage(ticket_id=ticket.id, is_admin=False, text=body.text.strip()))
    ticket.status = TicketStatus.open
    ticket.updated_at = utcnow()
    await notifications.notify_staff(
        session, "staff_new_ticket", {"ticket_id": f"#{ticket.id}", "reason": f"новое сообщение\n{body.text.strip()[:400]}"}
    )
    await session.commit()
    return await _load_ticket(session, ticket_id, user.id)

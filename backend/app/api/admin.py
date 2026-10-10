from __future__ import annotations

import time
from collections import defaultdict, deque
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query, Request
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminDep, SessionDep
from app.config import get_settings
from app.models import (
    AdminAction,
    BalanceTransaction,
    Country,
    Order,
    OrderStatus,
    Payment,
    PaymentStatus,
    PremiumNumber,
    PremiumStatus,
    Product,
    ProductStatus,
    Setting,
    SupportMessage,
    SupportTicket,
    TicketStatus,
    TxType,
    User,
)
from app.schemas import (
    AdminLogin,
    AdminOrderOut,
    AdminPaymentOut,
    AdminPremiumOut,
    AdminProductOut,
    AdminTicketDetailOut,
    AdminTicketOut,
    AdminUserOut,
    BalanceAdjust,
    CountryIn,
    CountryOut,
    CountryPatch,
    MaskPreviewIn,
    MessageCreate,
    OrderStatusChange,
    PaymentDecision,
    PremiumIn,
    PremiumPatch,
    ProductIn,
    ProductPatch,
    SettingsUpdate,
    TicketStatusIn,
    TransactionOut,
    UserPatch,
)
from app.security import check_admin_credentials, create_admin_token
from app.services import masks
from app.services import orders as order_service
from app.services import payments as payment_service
from app.services import settings as settings_service
from app.services import telegram
from app.services.common import change_balance, lock, log_admin, utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])

# --------------------------------------------------------------------- auth

_login_attempts: dict[str, deque[float]] = defaultdict(deque)
LOGIN_WINDOW, LOGIN_MAX = 300, 10


@router.post("/login")
async def login(body: AdminLogin, request: Request) -> dict:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    attempts = _login_attempts[ip]
    now = time.monotonic()
    while attempts and now - attempts[0] > LOGIN_WINDOW:
        attempts.popleft()
    if len(attempts) >= LOGIN_MAX:
        raise HTTPException(429, "Слишком много попыток входа. Попробуйте через 5 минут.")
    s = get_settings()
    if not check_admin_credentials(body.username, body.password, s):
        attempts.append(now)
        raise HTTPException(401, "Неверный логин или пароль")
    attempts.clear()
    return {
        "token": create_admin_token(body.username, s.secret_key, s.admin_token_ttl_hours),
        "username": body.username,
        "expires_in": s.admin_token_ttl_hours * 3600,
    }


@router.get("/me")
async def admin_me(admin: AdminDep) -> dict:
    return {"username": admin, "dev_mode": get_settings().dev_mode, "environment": get_settings().environment}


# ---------------------------------------------------------------- dashboard


@router.get("/dashboard")
async def dashboard(admin: AdminDep, session: SessionDep) -> dict:
    paid_statuses = [OrderStatus.paid, OrderStatus.processing, OrderStatus.completed]
    users = await session.scalar(select(func.count(User.id)))
    orders = await session.scalar(select(func.count(Order.id)))
    paid_orders = await session.scalar(select(func.count(Order.id)).where(Order.status.in_(paid_statuses)))
    revenue = await session.scalar(
        select(func.coalesce(func.sum(Order.total), 0)).where(Order.status.in_(paid_statuses))
    )
    stock = await session.scalar(
        select(func.coalesce(func.sum(Product.stock), 0)).where(Product.status == ProductStatus.active)
    )
    premium_available = await session.scalar(
        select(func.count(PremiumNumber.id)).where(PremiumNumber.status == PremiumStatus.available)
    )
    pending_payments = await session.scalar(
        select(func.count(Payment.id)).where(Payment.status == PaymentStatus.awaiting_confirmation)
    )
    open_tickets = await session.scalar(
        select(func.count(SupportTicket.id)).where(SupportTicket.status == TicketStatus.open)
    )
    # revenue for the last 14 days
    day = func.date_trunc("day", Order.paid_at)
    daily_rows = (
        await session.execute(
            select(day.label("d"), func.sum(Order.total), func.count(Order.id))
            .where(Order.status.in_(paid_statuses), Order.paid_at.is_not(None))
            .where(Order.paid_at > func.now() - func.make_interval(0, 0, 0, 14))
            .group_by("d")
            .order_by("d")
        )
    ).all()
    recent_orders = (await session.scalars(select(Order).order_by(Order.id.desc()).limit(8))).unique().all()
    recent_users = (await session.scalars(select(User).order_by(User.id.desc()).limit(8))).all()
    return {
        "users": users or 0,
        "orders": orders or 0,
        "paid_orders": paid_orders or 0,
        "revenue": float(revenue or 0),
        "stock": int(stock or 0),
        "premium_available": premium_available or 0,
        "pending_payments": pending_payments or 0,
        "open_tickets": open_tickets or 0,
        "daily": [{"date": d.date().isoformat(), "revenue": float(r), "orders": c} for d, r, c in daily_rows],
        "recent_orders": [AdminOrderOut.model_validate(o, from_attributes=True).model_dump(mode="json") for o in recent_orders],
        "recent_users": [AdminUserOut.model_validate(u, from_attributes=True).model_dump(mode="json") for u in recent_users],
    }


# -------------------------------------------------------------------- users


def _paginate(stmt: Select, page: int, size: int) -> Select:
    return stmt.offset((page - 1) * size).limit(size)


@router.get("/users")
async def list_users(
    admin: AdminDep,
    session: SessionDep,
    search: str | None = Query(None, max_length=64),
    blocked: bool | None = None,
    has_orders: bool | None = None,
    sort: str = Query("new", pattern="^(new|old|balance|spent|orders)$"),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = select(User)
    if search:
        term = search.strip().lstrip("@")
        conds = [User.username.ilike(f"%{term}%"), User.first_name.ilike(f"%{term}%"), User.last_name.ilike(f"%{term}%")]
        if term.isdigit():
            conds.append(User.telegram_id == int(term))
        stmt = stmt.where(or_(*conds))
    if blocked is not None:
        stmt = stmt.where(User.is_blocked == blocked)
    if has_orders is not None:
        stmt = stmt.where(User.orders_count > 0 if has_orders else User.orders_count == 0)
    order_by = {
        "new": User.id.desc(),
        "old": User.id.asc(),
        "balance": User.balance.desc(),
        "spent": User.total_spent.desc(),
        "orders": User.orders_count.desc(),
    }[sort]
    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(order_by), page, size))).all()
    return {"total": total or 0, "items": [AdminUserOut.model_validate(u, from_attributes=True) for u in items]}


@router.get("/users/{user_id}")
async def user_detail(user_id: int, admin: AdminDep, session: SessionDep) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    orders = (
        await session.scalars(select(Order).where(Order.user_id == user_id).order_by(Order.id.desc()).limit(50))
    ).unique().all()
    txs = (
        await session.scalars(
            select(BalanceTransaction)
            .where(BalanceTransaction.user_id == user_id)
            .order_by(BalanceTransaction.id.desc())
            .limit(50)
        )
    ).all()
    return {
        "user": AdminUserOut.model_validate(user, from_attributes=True),
        "orders": [AdminOrderOut.model_validate(o, from_attributes=True) for o in orders],
        "transactions": [TransactionOut.model_validate(t, from_attributes=True) for t in txs],
    }


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def patch_user(user_id: int, body: UserPatch, admin: AdminDep, session: SessionDep) -> User:
    user = await lock(session, User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    if body.is_blocked is not None:
        user.is_blocked = body.is_blocked
        log_admin(session, admin, "block" if body.is_blocked else "unblock", "user", user.id)
    await session.commit()
    return user


@router.post("/users/{user_id}/balance", response_model=AdminUserOut)
async def adjust_balance(user_id: int, body: BalanceAdjust, admin: AdminDep, session: SessionDep) -> User:
    user = await lock(session, User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    await change_balance(session, user, body.amount, TxType.admin_adjust, f"Корректировка: {body.reason}")
    log_admin(session, admin, "balance_adjust", "user", user.id, amount=body.amount, reason=body.reason)
    await session.commit()
    await telegram.notify(user.telegram_id, f"💳 Баланс изменён на {body.amount} грн. Причина: {body.reason}")
    return user


# ---------------------------------------------------------------- countries


@router.get("/countries", response_model=list[CountryOut])
async def list_countries(admin: AdminDep, session: SessionDep) -> list:
    return list((await session.scalars(select(Country).order_by(Country.sort_order, Country.id))).all())


@router.post("/countries", response_model=CountryOut, status_code=201)
async def create_country(body: CountryIn, admin: AdminDep, session: SessionDep) -> Country:
    if await session.scalar(select(Country).where(Country.code == body.code)):
        raise HTTPException(409, "Страна с таким кодом уже есть")
    country = Country(**body.model_dump())
    session.add(country)
    await session.flush()
    log_admin(session, admin, "create", "country", country.id, **body.model_dump())
    await session.commit()
    return country


@router.patch("/countries/{country_id}", response_model=CountryOut)
async def update_country(country_id: int, body: CountryPatch, admin: AdminDep, session: SessionDep) -> Country:
    country = await session.get(Country, country_id)
    if country is None:
        raise HTTPException(404, "Страна не найдена")
    changes = body.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"]:
        changes["code"] = changes["code"].upper()
        dup = await session.scalar(select(Country).where(Country.code == changes["code"], Country.id != country_id))
        if dup:
            raise HTTPException(409, "Страна с таким кодом уже есть")
    for k, v in changes.items():
        if v is not None:
            setattr(country, k, v)
    log_admin(session, admin, "update", "country", country.id, **changes)
    await session.commit()
    return country


@router.delete("/countries/{country_id}")
async def delete_country(country_id: int, admin: AdminDep, session: SessionDep) -> dict:
    country = await session.get(Country, country_id)
    if country is None:
        raise HTTPException(404, "Страна не найдена")
    used = await session.scalar(select(func.count(Product.id)).where(Product.country_id == country_id))
    if used:
        raise HTTPException(409, "К стране привязаны товары. Удалите/перенесите их или отключите страну.")
    await session.delete(country)
    log_admin(session, admin, "delete", "country", country_id, name=country.name)
    await session.commit()
    return {"deleted": True}


# ----------------------------------------------------------------- products


@router.get("/products", response_model=list[AdminProductOut])
async def list_products(
    admin: AdminDep,
    session: SessionDep,
    search: str | None = Query(None, max_length=64),
    status: ProductStatus | None = None,
    country_id: int | None = None,
) -> list:
    stmt = select(Product)
    if search:
        stmt = stmt.where(Product.title.ilike(f"%{search}%"))
    if status:
        stmt = stmt.where(Product.status == status)
    if country_id:
        stmt = stmt.where(Product.country_id == country_id)
    return list((await session.scalars(stmt.order_by(Product.sort_order, Product.id))).all())


async def _check_country(session: SessionDep, country_id: int | None) -> None:
    if country_id is not None and await session.get(Country, country_id) is None:
        raise HTTPException(422, "Страна не найдена")


@router.post("/products", response_model=AdminProductOut, status_code=201)
async def create_product(body: ProductIn, admin: AdminDep, session: SessionDep) -> Product:
    await _check_country(session, body.country_id)
    product = Product(**body.model_dump())
    session.add(product)
    await session.flush()
    log_admin(session, admin, "create", "product", product.id, **body.model_dump())
    await session.commit()
    return await session.get(Product, product.id, populate_existing=True)  # type: ignore[return-value]


@router.patch("/products/{product_id}", response_model=AdminProductOut)
async def update_product(product_id: int, body: ProductPatch, admin: AdminDep, session: SessionDep) -> Product:
    product = await lock(session, Product, product_id)
    if product is None:
        raise HTTPException(404, "Товар не найден")
    changes = body.model_dump(exclude_unset=True)
    if "country_id" in changes:
        await _check_country(session, changes["country_id"])
    before = {k: getattr(product, k) for k in changes}
    for k, v in changes.items():
        if v is None and k != "country_id":
            continue
        setattr(product, k, v)
    log_admin(session, admin, "update", "product", product.id, before=before, after=changes)
    await session.commit()
    return await session.get(Product, product.id, populate_existing=True)  # type: ignore[return-value]


@router.delete("/products/{product_id}")
async def delete_product(product_id: int, admin: AdminDep, session: SessionDep) -> dict:
    product = await lock(session, Product, product_id)
    if product is None:
        raise HTTPException(404, "Товар не найден")
    has_orders = await session.scalar(select(func.count(Order.id)).where(Order.product_id == product_id))
    if has_orders:
        product.status = ProductStatus.archived
        log_admin(session, admin, "archive", "product", product.id)
        await session.commit()
        return {"archived": True, "detail": "У товара есть заказы — он перемещён в архив"}
    await session.delete(product)
    log_admin(session, admin, "delete", "product", product_id, title=product.title)
    await session.commit()
    return {"deleted": True}


# ---------------------------------------------------------- premium numbers


@router.get("/premium-numbers", response_model=list[AdminPremiumOut])
async def list_premium(admin: AdminDep, session: SessionDep, status: PremiumStatus | None = None) -> list:
    stmt = select(PremiumNumber)
    if status:
        stmt = stmt.where(PremiumNumber.status == status)
    return list((await session.scalars(stmt.order_by(PremiumNumber.id.desc()))).all())


@router.post("/premium-numbers/mask-preview")
async def mask_preview(body: MaskPreviewIn, admin: AdminDep) -> dict:
    return {"mask": masks.auto_mask(body.number, body.dial_code, body.visible)}


async def _resolve_mask(session: SessionDep, number: str, mask: str | None, country_id: int | None) -> str:
    if mask:
        mask = mask.strip()
        if not masks.validate_mask(mask):
            raise HTTPException(422, "Маска должна скрывать минимум 2 цифры символами * и содержать только +, цифры, пробелы")
        return mask
    dial = ""
    if country_id:
        country = await session.get(Country, country_id)
        dial = country.dial_code if country else ""
    return masks.auto_mask(number, dial)


@router.post("/premium-numbers", response_model=AdminPremiumOut, status_code=201)
async def create_premium(body: PremiumIn, admin: AdminDep, session: SessionDep) -> PremiumNumber:
    await _check_country(session, body.country_id)
    number = "+" + masks.digits_only(body.number)
    if await session.scalar(select(PremiumNumber).where(PremiumNumber.number == number)):
        raise HTTPException(409, "Такой номер уже добавлен")
    data = body.model_dump()
    data["number"] = number
    data["display_mask"] = await _resolve_mask(session, number, body.display_mask, body.country_id)
    item = PremiumNumber(**data)
    session.add(item)
    await session.flush()
    log_admin(session, admin, "create", "premium_number", item.id, mask=item.display_mask, price=item.price)
    await session.commit()
    return await session.get(PremiumNumber, item.id, populate_existing=True)  # type: ignore[return-value]


@router.patch("/premium-numbers/{number_id}", response_model=AdminPremiumOut)
async def update_premium(number_id: int, body: PremiumPatch, admin: AdminDep, session: SessionDep) -> PremiumNumber:
    item = await lock(session, PremiumNumber, number_id)
    if item is None:
        raise HTTPException(404, "Номер не найден")
    changes = body.model_dump(exclude_unset=True)
    if "country_id" in changes:
        await _check_country(session, changes["country_id"])
    if changes.get("number"):
        changes["number"] = "+" + masks.digits_only(changes["number"])
    if "display_mask" in changes:
        changes["display_mask"] = await _resolve_mask(
            session, changes.get("number") or item.number, changes["display_mask"], changes.get("country_id", item.country_id)
        )
    if "status" in changes and item.status in (PremiumStatus.reserved, PremiumStatus.sold):
        if changes["status"] != item.status:
            raise HTTPException(409, "Номер забронирован/продан — статус меняется через заказ")
    for k, v in changes.items():
        if v is None and k != "country_id":
            continue
        setattr(item, k, v)
    log_admin(session, admin, "update", "premium_number", item.id, **changes)
    await session.commit()
    return await session.get(PremiumNumber, item.id, populate_existing=True)  # type: ignore[return-value]


@router.delete("/premium-numbers/{number_id}")
async def delete_premium(number_id: int, admin: AdminDep, session: SessionDep) -> dict:
    item = await lock(session, PremiumNumber, number_id)
    if item is None:
        raise HTTPException(404, "Номер не найден")
    if await session.scalar(select(func.count(Order.id)).where(Order.premium_number_id == number_id)):
        if item.status in (PremiumStatus.reserved, PremiumStatus.sold):
            raise HTTPException(409, "Номер участвует в заказе и не может быть удалён")
        item.status = PremiumStatus.hidden
        await session.commit()
        return {"archived": True, "detail": "Номер скрыт (есть история заказов)"}
    await session.delete(item)
    log_admin(session, admin, "delete", "premium_number", number_id)
    await session.commit()
    return {"deleted": True}


# ------------------------------------------------------------------- orders


@router.get("/orders")
async def list_orders(
    admin: AdminDep,
    session: SessionDep,
    status: OrderStatus | None = None,
    search: str | None = Query(None, max_length=64),
    user_id: int | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = select(Order).join(User, Order.user_id == User.id)
    if status:
        stmt = stmt.where(Order.status == status)
    if user_id:
        stmt = stmt.where(Order.user_id == user_id)
    if search:
        term = search.strip().lstrip("#@")
        conds = [Order.item_title.ilike(f"%{term}%"), User.username.ilike(f"%{term}%")]
        if term.isdigit():
            conds += [Order.id == int(term), User.telegram_id == int(term)]
        stmt = stmt.where(or_(*conds))
    total = await session.scalar(select(func.count()).select_from(stmt.with_only_columns(Order.id).subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(Order.id.desc()), page, size))).unique().all()
    return {
        "total": total or 0,
        "items": [AdminOrderOut.model_validate(o, from_attributes=True) for o in items],
        "transitions": {k.value: sorted(x.value for x in v) for k, v in order_service.ALLOWED_TRANSITIONS.items()},
    }


@router.post("/orders/{order_id}/status", response_model=AdminOrderOut)
async def change_order_status(order_id: int, body: OrderStatusChange, admin: AdminDep, session: SessionDep) -> Order:
    order = await order_service.change_status(
        session, order_id, body.status, delivery_data=body.delivery_data, admin_note=body.admin_note
    )
    log_admin(session, admin, "status", "order", order_id, status=body.status.value)
    await session.commit()
    order = await session.get(Order, order_id, populate_existing=True)  # type: ignore[assignment]
    label = order_service.STATUS_LABELS[order.status]
    text = f"📦 Заказ #{order.id}: {label}"
    if order.status == OrderStatus.completed and order.delivery_data:
        text += f"\n\n{order.delivery_data}"
    await telegram.notify(order.user.telegram_id, text)
    return order


# ----------------------------------------------------------------- payments


@router.get("/payments")
async def list_payments(
    admin: AdminDep,
    session: SessionDep,
    status: PaymentStatus | None = None,
    method: str | None = Query(None, max_length=16),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = select(Payment)
    if status:
        stmt = stmt.where(Payment.status == status)
    if method:
        stmt = stmt.where(Payment.method == method)
    total = await session.scalar(select(func.count()).select_from(stmt.with_only_columns(Payment.id).subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(Payment.id.desc()), page, size))).unique().all()
    return {"total": total or 0, "items": [AdminPaymentOut.model_validate(p, from_attributes=True) for p in items]}


@router.post("/payments/{payment_id}/confirm", response_model=AdminPaymentOut)
async def confirm_payment(payment_id: int, body: PaymentDecision, admin: AdminDep, session: SessionDep) -> Payment:
    payment, new = await payment_service.confirm_payment(session, payment_id, actor=f"admin:{admin}")
    if not new:
        raise HTTPException(409, "Платёж уже подтверждён ранее")
    if body.comment:
        payment.admin_comment = body.comment
    log_admin(session, admin, "confirm", "payment", payment_id, amount=payment.amount)
    await session.commit()
    payment = await session.get(Payment, payment_id, populate_existing=True)  # type: ignore[assignment]
    await telegram.notify(payment.user.telegram_id, f"✅ Платёж #{payment.id} на {payment.amount} грн подтверждён")
    return payment


@router.post("/payments/{payment_id}/reject", response_model=AdminPaymentOut)
async def reject_payment(payment_id: int, body: PaymentDecision, admin: AdminDep, session: SessionDep) -> Payment:
    payment = await payment_service.reject_payment(session, payment_id, actor=f"admin:{admin}", comment=body.comment)
    log_admin(session, admin, "reject", "payment", payment_id, comment=body.comment)
    await session.commit()
    payment = await session.get(Payment, payment_id, populate_existing=True)  # type: ignore[assignment]
    await telegram.notify(
        payment.user.telegram_id, f"❌ Платёж #{payment.id} отклонён. {body.comment or 'Свяжитесь с поддержкой.'}"
    )
    return payment


# ------------------------------------------------------------------ support


@router.get("/support/tickets")
async def list_tickets(admin: AdminDep, session: SessionDep, status: TicketStatus | None = None) -> list:
    stmt = select(SupportTicket)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    rows = (await session.scalars(stmt.order_by(SupportTicket.updated_at.desc()).limit(200))).unique().all()
    return [AdminTicketOut.model_validate(t, from_attributes=True) for t in rows]


async def _ticket(session: SessionDep, ticket_id: int) -> SupportTicket:
    ticket = await session.scalar(
        select(SupportTicket)
        .options(selectinload(SupportTicket.messages))
        .where(SupportTicket.id == ticket_id)
        .execution_options(populate_existing=True)
    )
    if ticket is None:
        raise HTTPException(404, "Обращение не найдено")
    return ticket


@router.get("/support/tickets/{ticket_id}", response_model=AdminTicketDetailOut)
async def ticket_detail(ticket_id: int, admin: AdminDep, session: SessionDep) -> SupportTicket:
    return await _ticket(session, ticket_id)


@router.post("/support/tickets/{ticket_id}/reply", response_model=AdminTicketDetailOut)
async def ticket_reply(ticket_id: int, body: MessageCreate, admin: AdminDep, session: SessionDep) -> SupportTicket:
    ticket = await _ticket(session, ticket_id)
    session.add(SupportMessage(ticket_id=ticket.id, is_admin=True, text=body.text.strip()))
    ticket.status = TicketStatus.answered
    ticket.updated_at = utcnow()
    log_admin(session, admin, "reply", "ticket", ticket.id)
    await session.commit()
    await telegram.notify(
        ticket.user.telegram_id, f"💬 Ответ поддержки по обращению #{ticket.id} «{ticket.subject}»:\n\n{body.text}"
    )
    return await _ticket(session, ticket_id)


@router.post("/support/tickets/{ticket_id}/status", response_model=AdminTicketDetailOut)
async def ticket_status(ticket_id: int, body: TicketStatusIn, admin: AdminDep, session: SessionDep) -> SupportTicket:
    ticket = await _ticket(session, ticket_id)
    ticket.status = body.status
    ticket.updated_at = utcnow()
    log_admin(session, admin, "status", "ticket", ticket.id, status=body.status.value)
    await session.commit()
    return await _ticket(session, ticket_id)


# ----------------------------------------------------------------- settings


@router.get("/settings")
async def get_settings_values(admin: AdminDep, session: SessionDep) -> list[dict]:
    values = await settings_service.get_all(session)
    return [
        {
            "key": k,
            "value": v,
            "description": settings_service.DEFAULT_SETTINGS.get(k, ("", k, False))[1],
            "is_public": settings_service.DEFAULT_SETTINGS.get(k, ("", "", False))[2],
        }
        for k, v in values.items()
    ]


@router.put("/settings")
async def update_settings(body: SettingsUpdate, admin: AdminDep, session: SessionDep) -> list[dict]:
    for key, value in body.values.items():
        if key not in settings_service.DEFAULT_SETTINGS:
            raise HTTPException(422, f"Неизвестная настройка: {key}")
        if key in ("uah_per_star", "min_topup", "max_topup"):
            try:
                if Decimal(value) <= 0:
                    raise ValueError
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(422, f"{key}: нужно положительное число") from exc
        row = await session.get(Setting, key)
        default, desc, public = settings_service.DEFAULT_SETTINGS[key]
        if row is None:
            session.add(Setting(key=key, value=value, description=desc, is_public=public))
        else:
            row.value = value
    log_admin(session, admin, "update", "settings", None, **body.values)
    await session.commit()
    return await get_settings_values(admin, session)


@router.get("/actions")
async def admin_actions(admin: AdminDep, session: SessionDep, limit: int = Query(100, ge=1, le=500)) -> list[dict]:
    rows = (await session.scalars(select(AdminAction).order_by(AdminAction.id.desc()).limit(limit))).all()
    return [
        {"id": r.id, "admin": r.admin, "action": r.action, "entity": r.entity, "entity_id": r.entity_id,
         "details": r.details, "created_at": r.created_at.isoformat()}
        for r in rows
    ]


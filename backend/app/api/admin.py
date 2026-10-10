"""Admin panel API: auth, users, catalog, orders, payments, support.

Roles: owner (everything), admin (shop management), support (tickets, read-only users/orders).
Reports and system endpoints live in admin_reports.py / admin_system.py.
"""
from __future__ import annotations

import csv
import io
import time
from collections import defaultdict, deque
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import ROLE_LABELS, AdminDep, ManagerDep, SessionDep, StaffDep
from app.config import get_settings
from app.models import (
    AdminUser,
    BalanceTransaction,
    Category,
    Country,
    Order,
    OrderEvent,
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
    CategoryIn,
    CategoryOut,
    CategoryPatch,
    CountryIn,
    CountryOut,
    CountryPatch,
    MaskPreviewIn,
    MessageCreate,
    OrderEventOut,
    OrderStatusChange,
    PaymentDecision,
    PremiumIn,
    PremiumPatch,
    ProductBulk,
    ProductImport,
    ProductIn,
    ProductPatch,
    TicketAssign,
    TicketStatusIn,
    TransactionOut,
    UserPatch,
)
from app.security import check_admin_credentials, create_admin_token, verify_password
from app.services import masks
from app.services import orders as order_service
from app.services import payments as payment_service
from app.services import telegram
from app.services.common import change_balance, lock, log_admin, money, utcnow

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Shop timezone for "today" and date filters (computed in Postgres, which ships its own tz database).
REPORT_TZ = "Europe/Kyiv"
PAID_STATUSES = [OrderStatus.paid, OrderStatus.processing, OrderStatus.completed]

# --------------------------------------------------------------------- helpers


def local_date(column):  # noqa: ANN001, ANN201
    return func.date(func.timezone(REPORT_TZ, column))


def date_range(stmt: Select, column, date_from: date | None, date_to: date | None) -> Select:  # noqa: ANN001
    if date_from:
        stmt = stmt.where(local_date(column) >= date_from)
    if date_to:
        stmt = stmt.where(local_date(column) <= date_to)
    return stmt


def _paginate(stmt: Select, page: int, size: int) -> Select:
    return stmt.offset((page - 1) * size).limit(size)


def csv_response(filename: str, header: list[str], rows: list[list[object]]) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")  # ";" opens correctly in Excel with ru/uk locale
    writer.writerow(header)
    for row in rows:
        writer.writerow(["" if v is None else _csv_safe(v) for v in row])
    return Response(
        "﻿" + buf.getvalue(),  # BOM: Excel detects UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _csv_safe(value: object) -> object:
    """Neutralise spreadsheet formula injection in user-controlled text (=, +, -, @ at start)."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@") and not _is_number(value):
        return "'" + value
    if hasattr(value, "value"):
        return value.value  # enums
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[union-attr]
    return value


def _is_number(value: str) -> bool:
    try:
        Decimal(value)
        return True
    except InvalidOperation:
        return False


def user_label(u: User) -> str:
    return f"@{u.username}" if u.username else str(u.telegram_id)


# --------------------------------------------------------------------- auth

_login_attempts: dict[str, deque[float]] = defaultdict(deque)
LOGIN_WINDOW, LOGIN_MAX = 300, 10


@router.post("/login")
async def login(body: AdminLogin, request: Request, session: SessionDep) -> dict:
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    attempts = _login_attempts[ip]
    now = time.monotonic()
    while attempts and now - attempts[0] > LOGIN_WINDOW:
        attempts.popleft()
    if len(attempts) >= LOGIN_MAX:
        raise HTTPException(429, "Слишком много попыток входа. Попробуйте через 5 минут.")
    s = get_settings()
    role, source = None, "env"
    if check_admin_credentials(body.username, body.password, s):
        role = "owner"
    else:
        account = await session.scalar(select(AdminUser).where(AdminUser.username == body.username))
        if account and account.is_active and verify_password(body.password, account.password_hash):
            role, source = account.role.value, "db"
            account.last_login_at = utcnow()
    if role is None:
        attempts.append(now)
        raise HTTPException(401, "Неверный логин или пароль")
    attempts.clear()
    log_admin(session, body.username, "login", "admin", None, ip=ip)
    await session.commit()
    return {
        "token": create_admin_token(body.username, s.secret_key, s.admin_token_ttl_hours, role, source),
        "username": body.username,
        "role": role,
        "expires_in": s.admin_token_ttl_hours * 3600,
    }


@router.get("/me")
async def admin_me(admin: AdminDep) -> dict:
    s = get_settings()
    return {
        "username": str(admin),
        "role": admin.role,
        "role_label": ROLE_LABELS.get(admin.role, admin.role),
        "dev_mode": s.dev_mode,
        "environment": s.environment,
    }


# -------------------------------------------------------------------- users

USER_SORTS = {
    "new": User.id.desc(),
    "old": User.id.asc(),
    "balance": User.balance.desc(),
    "spent": User.total_spent.desc(),
    "orders": User.orders_count.desc(),
    "seen": User.last_seen_at.desc().nulls_last(),
}


def _users_query(search: str | None, blocked: bool | None, has_orders: bool | None, has_balance: bool | None) -> Select:
    stmt = select(User)
    if search:
        term = search.strip().lstrip("@")
        conds = [User.username.ilike(f"%{term}%"), User.first_name.ilike(f"%{term}%"), User.last_name.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 18:
            conds.append(User.telegram_id == int(term))
            if len(term) <= 9:
                conds.append(User.id == int(term))
        stmt = stmt.where(or_(*conds))
    if blocked is not None:
        stmt = stmt.where(User.is_blocked == blocked)
    if has_orders is not None:
        stmt = stmt.where(User.orders_count > 0 if has_orders else User.orders_count == 0)
    if has_balance is not None:
        stmt = stmt.where(User.balance > 0 if has_balance else User.balance == 0)
    return stmt


@router.get("/users")
async def list_users(
    admin: StaffDep,
    session: SessionDep,
    search: str | None = Query(None, max_length=64),
    blocked: bool | None = None,
    has_orders: bool | None = None,
    has_balance: bool | None = None,
    sort: str = Query("new", pattern="^(new|old|balance|spent|orders|seen)$"),
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = _users_query(search, blocked, has_orders, has_balance)
    total = await session.scalar(select(func.count()).select_from(stmt.subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(USER_SORTS[sort], User.id.desc()), page, size))).all()
    return {"total": total or 0, "items": [AdminUserOut.model_validate(u, from_attributes=True) for u in items]}


@router.get("/users/export.csv")
async def export_users(
    admin: ManagerDep,
    session: SessionDep,
    search: str | None = Query(None, max_length=64),
    blocked: bool | None = None,
    has_orders: bool | None = None,
    has_balance: bool | None = None,
) -> Response:
    stmt = _users_query(search, blocked, has_orders, has_balance).order_by(User.id)
    users = (await session.scalars(stmt.limit(50_000))).all()
    log_admin(session, admin, "export", "users", None, count=len(users))
    await session.commit()
    return csv_response(
        "f1z-users.csv",
        ["id", "telegram_id", "username", "first_name", "last_name", "balance", "total_spent", "orders_count",
         "is_blocked", "created_at", "last_seen_at"],
        [[u.id, u.telegram_id, u.username, u.first_name, u.last_name, u.balance, u.total_spent, u.orders_count,
          "yes" if u.is_blocked else "no", u.created_at, u.last_seen_at] for u in users],
    )


@router.get("/users/{user_id}")
async def user_detail(user_id: int, admin: StaffDep, session: SessionDep) -> dict:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    orders = (
        await session.scalars(select(Order).where(Order.user_id == user_id).order_by(Order.id.desc()).limit(100))
    ).unique().all()
    txs = (
        await session.scalars(
            select(BalanceTransaction)
            .where(BalanceTransaction.user_id == user_id)
            .order_by(BalanceTransaction.id.desc())
            .limit(100)
        )
    ).all()
    payments = (
        await session.scalars(select(Payment).where(Payment.user_id == user_id).order_by(Payment.id.desc()).limit(100))
    ).unique().all()
    tickets = await session.scalar(select(func.count(SupportTicket.id)).where(SupportTicket.user_id == user_id))
    return {
        "user": AdminUserOut.model_validate(user, from_attributes=True),
        "orders": [AdminOrderOut.model_validate(o, from_attributes=True) for o in orders],
        "transactions": [TransactionOut.model_validate(t, from_attributes=True) for t in txs],
        "payments": [AdminPaymentOut.model_validate(p, from_attributes=True) for p in payments],
        "tickets_count": tickets or 0,
    }


@router.patch("/users/{user_id}", response_model=AdminUserOut)
async def patch_user(user_id: int, body: UserPatch, admin: ManagerDep, session: SessionDep) -> User:
    user = await lock(session, User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    if body.is_blocked is not None and body.is_blocked != user.is_blocked:
        user.is_blocked = body.is_blocked
        log_admin(session, admin, "block" if body.is_blocked else "unblock", "user", user.id)
    await session.commit()
    return user


@router.post("/users/{user_id}/balance", response_model=AdminUserOut)
async def adjust_balance(user_id: int, body: BalanceAdjust, admin: ManagerDep, session: SessionDep) -> User:
    user = await lock(session, User, user_id)
    if user is None:
        raise HTTPException(404, "Пользователь не найден")
    before = user.balance
    # Financial journal entry keeps the amount, reason and the admin who made the change.
    await change_balance(session, user, body.amount, TxType.admin_adjust, f"Корректировка ({admin}): {body.reason}")
    log_admin(session, admin, "balance_adjust", "user", user.id, amount=body.amount, reason=body.reason,
              before=before, after=user.balance)
    await session.commit()
    await telegram.notify(user.telegram_id, f"💳 Баланс изменён на {body.amount} грн. Причина: {body.reason}")
    return user


# ---------------------------------------------------------------- countries


@router.get("/countries", response_model=list[CountryOut])
async def list_countries(admin: StaffDep, session: SessionDep) -> list:
    return list((await session.scalars(select(Country).order_by(Country.sort_order, Country.id))).all())


@router.post("/countries", response_model=CountryOut, status_code=201)
async def create_country(body: CountryIn, admin: ManagerDep, session: SessionDep) -> Country:
    if await session.scalar(select(Country).where(Country.code == body.code)):
        raise HTTPException(409, "Страна с таким кодом уже есть")
    country = Country(**body.model_dump())
    session.add(country)
    await session.flush()
    log_admin(session, admin, "create", "country", country.id, **body.model_dump())
    await session.commit()
    return country


@router.patch("/countries/{country_id}", response_model=CountryOut)
async def update_country(country_id: int, body: CountryPatch, admin: ManagerDep, session: SessionDep) -> Country:
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
async def delete_country(country_id: int, admin: ManagerDep, session: SessionDep) -> dict:
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


# --------------------------------------------------------------- categories


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(admin: StaffDep, session: SessionDep) -> list:
    return list((await session.scalars(select(Category).order_by(Category.sort_order, Category.id))).all())


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(body: CategoryIn, admin: ManagerDep, session: SessionDep) -> Category:
    if await session.scalar(select(Category).where(Category.slug == body.slug)):
        raise HTTPException(409, "Категория с таким кодом уже есть")
    item = Category(**body.model_dump())
    session.add(item)
    await session.flush()
    log_admin(session, admin, "create", "category", item.id, **body.model_dump())
    await session.commit()
    return item


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(category_id: int, body: CategoryPatch, admin: ManagerDep, session: SessionDep) -> Category:
    item = await session.get(Category, category_id)
    if item is None:
        raise HTTPException(404, "Категория не найдена")
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for k, v in changes.items():
        setattr(item, k, v)
    log_admin(session, admin, "update", "category", item.id, **changes)
    await session.commit()
    return item


@router.delete("/categories/{category_id}")
async def delete_category(category_id: int, admin: ManagerDep, session: SessionDep) -> dict:
    item = await session.get(Category, category_id)
    if item is None:
        raise HTTPException(404, "Категория не найдена")
    used = await session.scalar(select(func.count(Product.id)).where(Product.category == item.slug))
    if used:
        raise HTTPException(409, f"В категории {used} товаров. Перенесите их или отключите категорию.")
    await session.delete(item)
    log_admin(session, admin, "delete", "category", category_id, slug=item.slug)
    await session.commit()
    return {"deleted": True}


async def _check_category(session: SessionDep, slug: str | None) -> None:
    if slug is not None and await session.scalar(select(Category.id).where(Category.slug == slug)) is None:
        raise HTTPException(422, f"Категория «{slug}» не найдена. Создайте её в настройках каталога.")


# ----------------------------------------------------------------- products


@router.get("/products", response_model=list[AdminProductOut])
async def list_products(
    admin: StaffDep,
    session: SessionDep,
    search: str | None = Query(None, max_length=64),
    status: ProductStatus | None = None,
    country_id: int | None = None,
    category: str | None = Query(None, max_length=32),
) -> list:
    stmt = select(Product)
    if search:
        term = search.strip()
        conds = [Product.title.ilike(f"%{term}%"), Product.description.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 9:
            conds.append(Product.id == int(term))
        stmt = stmt.where(or_(*conds))
    if status:
        stmt = stmt.where(Product.status == status)
    if country_id:
        stmt = stmt.where(Product.country_id == country_id)
    if category:
        stmt = stmt.where(Product.category == category)
    return list((await session.scalars(stmt.order_by(Product.sort_order, Product.id))).all())


async def _check_country(session: SessionDep, country_id: int | None) -> None:
    if country_id is not None and await session.get(Country, country_id) is None:
        raise HTTPException(422, "Страна не найдена")


@router.post("/products", response_model=AdminProductOut, status_code=201)
async def create_product(body: ProductIn, admin: ManagerDep, session: SessionDep) -> Product:
    await _check_country(session, body.country_id)
    await _check_category(session, body.category)
    product = Product(**body.model_dump())
    session.add(product)
    await session.flush()
    log_admin(session, admin, "create", "product", product.id, **body.model_dump())
    await session.commit()
    return await session.get(Product, product.id, populate_existing=True)  # type: ignore[return-value]


@router.patch("/products/{product_id}", response_model=AdminProductOut)
async def update_product(product_id: int, body: ProductPatch, admin: ManagerDep, session: SessionDep) -> Product:
    product = await lock(session, Product, product_id)
    if product is None:
        raise HTTPException(404, "Товар не найден")
    changes = body.model_dump(exclude_unset=True)
    if "country_id" in changes:
        await _check_country(session, changes["country_id"])
    if changes.get("category"):
        await _check_category(session, changes["category"])
    before = {k: getattr(product, k) for k in changes}
    for k, v in changes.items():
        if v is None and k != "country_id":
            continue
        setattr(product, k, v)
    log_admin(session, admin, "update", "product", product.id, before=before, after=changes)
    await session.commit()
    return await session.get(Product, product.id, populate_existing=True)  # type: ignore[return-value]


@router.delete("/products/{product_id}")
async def delete_product(product_id: int, admin: ManagerDep, session: SessionDep) -> dict:
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


@router.post("/products/bulk")
async def bulk_products(body: ProductBulk, admin: ManagerDep, session: SessionDep) -> dict:
    """Mass update. Validates every product first; nothing is saved if any row would become invalid."""
    products = (
        await session.scalars(
            select(Product).where(Product.id.in_(body.ids)).order_by(Product.id).with_for_update(of=Product)
        )
    ).unique().all()
    if not products:
        raise HTTPException(404, "Товары не найдены")
    value = body.value.strip()
    try:
        if body.action == "status":
            new_status = ProductStatus(value)
        elif body.action == "category":
            await _check_category(session, value)
        elif body.action in ("stock_set", "stock_delta"):
            number = int(value)
        else:
            amount = Decimal(value)
    except (ValueError, InvalidOperation):
        raise HTTPException(422, "Некорректное значение") from None

    changes: list[tuple[Product, str, object]] = []
    for p in products:
        if body.action == "status":
            changes.append((p, "status", new_status))
        elif body.action == "category":
            changes.append((p, "category", value))
        elif body.action == "stock_set":
            changes.append((p, "stock", number))
        elif body.action == "stock_delta":
            changes.append((p, "stock", p.stock + number))
        else:
            if body.action == "price_set":
                price = amount
            elif body.action == "price_percent":
                price = Decimal(p.price) * (Decimal(100) + amount) / Decimal(100)
            else:
                price = Decimal(p.price) + amount
            changes.append((p, "price", money(price)))
    for p, field, new in changes:
        if field == "price" and not (Decimal("0.01") <= new <= Decimal(1_000_000)):  # type: ignore[operator]
            raise HTTPException(422, f"Цена «{p.title}» станет {new} — допустимо от 0.01 до 1 000 000")
        if field == "stock" and not (0 <= new <= 1_000_000):  # type: ignore[operator]
            raise HTTPException(422, f"Остаток «{p.title}» станет {new} — допустимо от 0 до 1 000 000")
    for p, field, new in changes:
        setattr(p, field, new)
    log_admin(session, admin, "bulk_" + body.action, "product", None, ids=[p.id for p in products], value=value)
    await session.commit()
    return {"updated": len(products)}


PRODUCT_CSV_FIELDS = ["id", "title", "description", "category", "country_code", "price", "stock", "status",
                      "is_popular", "sort_order", "delivery_note"]


@router.get("/products/export.csv")
async def export_products(admin: ManagerDep, session: SessionDep) -> Response:
    products = (await session.scalars(select(Product).order_by(Product.sort_order, Product.id))).unique().all()
    return csv_response(
        "f1z-products.csv",
        PRODUCT_CSV_FIELDS + ["created_at"],
        [[p.id, p.title, p.description, p.category, p.country.code if p.country else "", p.price, p.stock,
          p.status, "yes" if p.is_popular else "no", p.sort_order, p.delivery_note, p.created_at] for p in products],
    )


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "да", "+"}


@router.post("/products/import")
async def import_products(body: ProductImport, admin: ManagerDep, session: SessionDep) -> dict:
    """CSV import (same columns as export, ";" or "," separated). Rows with an existing id are updated,
    rows without id are created. All-or-nothing: any error rolls back the whole file."""
    text = body.csv.lstrip("﻿")
    sample = text.split("\n", 1)[0]
    reader = csv.DictReader(io.StringIO(text), delimiter=";" if sample.count(";") >= sample.count(",") else ",")
    if not reader.fieldnames or "title" not in reader.fieldnames or "price" not in reader.fieldnames:
        raise HTTPException(422, "Нужны колонки как в экспорте: минимум title и price")
    countries = {c.code: c.id for c in (await session.scalars(select(Country))).all()}
    categories = set((await session.scalars(select(Category.slug))).all())
    created = updated = 0
    errors: list[dict] = []
    for n, row in enumerate(reader, start=2):
        row = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        if not any(row.values()):
            continue
        try:
            code = row.get("country_code", "").upper()
            if code and code not in countries:
                raise ValueError(f"страна {code} не найдена")
            data: dict = {
                "title": row["title"],
                "price": row["price"].replace(",", "."),
                "country_id": countries.get(code) if code else None,
            }
            for key in ("description", "delivery_note"):
                if key in row:
                    data[key] = row[key]
            if row.get("category"):
                if row["category"] not in categories:
                    raise ValueError(f"категория {row['category']} не найдена")
                data["category"] = row["category"]
            if row.get("stock"):
                data["stock"] = int(row["stock"])
            if row.get("status"):
                data["status"] = row["status"]
            if row.get("is_popular"):
                data["is_popular"] = _parse_bool(row["is_popular"])
            if row.get("sort_order"):
                data["sort_order"] = int(row["sort_order"])
            product_id = int(row["id"]) if row.get("id") else None
            if product_id:
                product = await lock(session, Product, product_id)
                if product is None:
                    raise ValueError(f"товар id={product_id} не найден")
                patch = ProductPatch.model_validate(data).model_dump(exclude_unset=True)
                for k, v in patch.items():
                    setattr(product, k, v)
                updated += 1
            else:
                session.add(Product(**ProductIn.model_validate(data).model_dump()))
                created += 1
        except Exception as exc:  # noqa: BLE001
            msg = str(exc).split("\n")[0] if not hasattr(exc, "errors") else "; ".join(
                f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()  # type: ignore[attr-defined]
            )
            errors.append({"row": n, "error": msg[:200]})
    if errors or body.dry_run:
        await session.rollback()
        return {"created": created, "updated": updated, "errors": errors, "applied": False}
    log_admin(session, admin, "import", "product", None, created=created, updated=updated)
    await session.commit()
    return {"created": created, "updated": updated, "errors": [], "applied": True}


# ---------------------------------------------------------- premium numbers


@router.get("/premium-numbers", response_model=list[AdminPremiumOut])
async def list_premium(admin: StaffDep, session: SessionDep, status: PremiumStatus | None = None) -> list:
    stmt = select(PremiumNumber)
    if status:
        stmt = stmt.where(PremiumNumber.status == status)
    return list((await session.scalars(stmt.order_by(PremiumNumber.id.desc()))).all())


@router.post("/premium-numbers/mask-preview")
async def mask_preview(body: MaskPreviewIn, admin: StaffDep) -> dict:
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
async def create_premium(body: PremiumIn, admin: ManagerDep, session: SessionDep) -> PremiumNumber:
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
async def update_premium(number_id: int, body: PremiumPatch, admin: ManagerDep, session: SessionDep) -> PremiumNumber:
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
    # never write the full number into the audit log
    log_admin(session, admin, "update", "premium_number", item.id, **{k: v for k, v in changes.items() if k != "number"})
    await session.commit()
    return await session.get(PremiumNumber, item.id, populate_existing=True)  # type: ignore[return-value]


@router.delete("/premium-numbers/{number_id}")
async def delete_premium(number_id: int, admin: ManagerDep, session: SessionDep) -> dict:
    item = await lock(session, PremiumNumber, number_id)
    if item is None:
        raise HTTPException(404, "Номер не найден")
    if await session.scalar(select(func.count(Order.id)).where(Order.premium_number_id == number_id)):
        if item.status in (PremiumStatus.reserved, PremiumStatus.sold):
            raise HTTPException(409, "Номер участвует в заказе и не может быть удалён")
        item.status = PremiumStatus.hidden
        log_admin(session, admin, "archive", "premium_number", number_id)
        await session.commit()
        return {"archived": True, "detail": "Номер скрыт (есть история заказов)"}
    await session.delete(item)
    log_admin(session, admin, "delete", "premium_number", number_id)
    await session.commit()
    return {"deleted": True}


# ------------------------------------------------------------------- orders

ORDER_FILTERS = {s.value for s in OrderStatus} | {"awaiting_payment"}


def _in_review_ids() -> Select:
    return select(Payment.order_id).where(
        Payment.status == PaymentStatus.awaiting_confirmation, Payment.order_id.is_not(None)
    )


def _orders_query(
    status: str | None, search: str | None, user_id: int | None, method: str | None,
    date_from: date | None, date_to: date | None,
) -> Select:
    stmt = select(Order).join(User, Order.user_id == User.id)
    if status == "awaiting_payment":
        # pending order whose manual transfer was submitted and waits for admin verification
        stmt = stmt.where(Order.status == OrderStatus.pending, Order.id.in_(_in_review_ids()))
    elif status:
        stmt = stmt.where(Order.status == OrderStatus(status))
    if user_id:
        stmt = stmt.where(Order.user_id == user_id)
    if method:
        stmt = stmt.where(Order.payment_method == method)
    if search:
        term = search.strip().lstrip("#@")
        conds = [Order.item_title.ilike(f"%{term}%"), User.username.ilike(f"%{term}%"), User.first_name.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 18:
            conds += [Order.id == int(term)] if len(term) <= 9 else []
            conds.append(User.telegram_id == int(term))
        stmt = stmt.where(or_(*conds))
    return date_range(stmt, Order.created_at, date_from, date_to)


def _transitions() -> dict:
    return {k.value: sorted(x.value for x in v) for k, v in order_service.ALLOWED_TRANSITIONS.items()}


@router.get("/orders")
async def list_orders(
    admin: StaffDep,
    session: SessionDep,
    status: str | None = Query(None, max_length=32),
    search: str | None = Query(None, max_length=64),
    user_id: int | None = None,
    method: str | None = Query(None, max_length=16),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    if status and status not in ORDER_FILTERS:
        raise HTTPException(422, "Неизвестный статус")
    stmt = _orders_query(status, search, user_id, method, date_from, date_to)
    total = await session.scalar(select(func.count()).select_from(stmt.with_only_columns(Order.id).subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(Order.id.desc()), page, size))).unique().all()
    ids = [o.id for o in items]
    in_review = set((await session.scalars(_in_review_ids().where(Payment.order_id.in_(ids)))).all()) if ids else set()
    counts = dict(
        (await session.execute(select(Order.status, func.count(Order.id)).group_by(Order.status))).all()
    )
    return {
        "total": total or 0,
        "items": [
            {**AdminOrderOut.model_validate(o, from_attributes=True).model_dump(mode="json"), "in_review": o.id in in_review}
            for o in items
        ],
        "transitions": _transitions(),
        "counts": {k.value: v for k, v in counts.items()},
    }


@router.get("/orders/export.csv")
async def export_orders(
    admin: ManagerDep,
    session: SessionDep,
    status: str | None = Query(None, max_length=32),
    search: str | None = Query(None, max_length=64),
    method: str | None = Query(None, max_length=16),
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    if status and status not in ORDER_FILTERS:
        raise HTTPException(422, "Неизвестный статус")
    stmt = _orders_query(status, search, None, method, date_from, date_to).order_by(Order.id)
    orders = (await session.scalars(stmt.limit(50_000))).unique().all()
    return csv_response(
        "f1z-orders.csv",
        ["id", "created_at", "status", "item", "quantity", "unit_price", "total", "payment_method", "paid_at",
         "completed_at", "user_telegram_id", "username"],
        [[o.id, o.created_at, o.status, o.item_title, o.quantity, o.unit_price, o.total, o.payment_method, o.paid_at,
          o.completed_at, o.user.telegram_id, o.user.username] for o in orders],
    )


@router.get("/orders/{order_id}")
async def order_detail(order_id: int, admin: StaffDep, session: SessionDep) -> dict:
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "Заказ не найден")
    payments = (
        await session.scalars(select(Payment).where(Payment.order_id == order_id).order_by(Payment.id))
    ).unique().all()
    events = (
        await session.scalars(select(OrderEvent).where(OrderEvent.order_id == order_id).order_by(OrderEvent.id))
    ).all()
    return {
        "order": AdminOrderOut.model_validate(order, from_attributes=True),
        "payments": [AdminPaymentOut.model_validate(p, from_attributes=True) for p in payments],
        "events": [OrderEventOut.model_validate(e, from_attributes=True) for e in events],
        "allowed": sorted(x.value for x in order_service.ALLOWED_TRANSITIONS[order.status]),
        "product": {"id": order.product.id, "category": order.product.category, "delivery_note": order.product.delivery_note}
        if order.product else None,
    }


@router.post("/orders/{order_id}/status", response_model=AdminOrderOut)
async def change_order_status(order_id: int, body: OrderStatusChange, admin: ManagerDep, session: SessionDep) -> Order:
    order = await order_service.change_status(
        session, order_id, body.status, delivery_data=body.delivery_data, admin_note=body.admin_note,
        actor=f"admin:{admin}",
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


def _payments_query(
    status: PaymentStatus | None, method: str | None, kind: str | None, search: str | None,
    date_from: date | None, date_to: date | None,
) -> Select:
    stmt = select(Payment).join(User, Payment.user_id == User.id)
    if status:
        stmt = stmt.where(Payment.status == status)
    if method:
        stmt = stmt.where(Payment.method == method)
    if kind:
        stmt = stmt.where(Payment.kind == kind)
    if search:
        term = search.strip().lstrip("#@")
        conds = [User.username.ilike(f"%{term}%"), Payment.payload.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 18:
            conds += [Payment.id == int(term), Payment.order_id == int(term)] if len(term) <= 9 else []
            conds.append(User.telegram_id == int(term))
        stmt = stmt.where(or_(*conds))
    return date_range(stmt, Payment.created_at, date_from, date_to)


@router.get("/payments")
async def list_payments(
    admin: ManagerDep,
    session: SessionDep,
    status: PaymentStatus | None = None,
    method: str | None = Query(None, max_length=16),
    kind: str | None = Query(None, pattern="^(order|topup)$"),
    search: str | None = Query(None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = _payments_query(status, method, kind, search, date_from, date_to)
    total = await session.scalar(select(func.count()).select_from(stmt.with_only_columns(Payment.id).subquery()))
    items = (await session.scalars(_paginate(stmt.order_by(Payment.id.desc()), page, size))).unique().all()
    return {"total": total or 0, "items": [AdminPaymentOut.model_validate(p, from_attributes=True) for p in items]}


@router.get("/payments/export.csv")
async def export_payments(
    admin: ManagerDep,
    session: SessionDep,
    status: PaymentStatus | None = None,
    method: str | None = Query(None, max_length=16),
    kind: str | None = Query(None, pattern="^(order|topup)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    stmt = _payments_query(status, method, kind, None, date_from, date_to).order_by(Payment.id)
    items = (await session.scalars(stmt.limit(50_000))).unique().all()
    return csv_response(
        "f1z-payments.csv",
        ["id", "created_at", "kind", "method", "status", "amount", "stars", "order_id", "user_telegram_id", "username",
         "is_test", "confirmed_by", "confirmed_at", "user_comment", "admin_comment"],
        [[p.id, p.created_at, p.kind, p.method, p.status, p.amount, p.stars_amount, p.order_id, p.user.telegram_id,
          p.user.username, "yes" if p.is_test else "no", p.confirmed_by, p.confirmed_at, p.user_comment,
          p.admin_comment] for p in items],
    )


@router.post("/payments/{payment_id}/confirm", response_model=AdminPaymentOut)
async def confirm_payment(payment_id: int, body: PaymentDecision, admin: ManagerDep, session: SessionDep) -> Payment:
    """Manual verification is allowed only for bank transfers the buyer submitted for review.
    Stars payments are confirmed exclusively by Telegram (successful_payment)."""
    payment = await session.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(404, "Платёж не найден")
    if payment.status == PaymentStatus.confirmed:
        raise HTTPException(409, "Платёж уже подтверждён ранее")
    if payment.method != PaymentMethod.manual or payment.status != PaymentStatus.awaiting_confirmation:
        raise HTTPException(
            409, "Вручную подтверждается только перевод, который покупатель отправил на проверку"
        )
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
async def reject_payment(payment_id: int, body: PaymentDecision, admin: ManagerDep, session: SessionDep) -> Payment:
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
async def list_tickets(
    admin: StaffDep,
    session: SessionDep,
    status: TicketStatus | None = None,
    assigned: str | None = Query(None, pattern="^(me|none|any)$"),
    search: str | None = Query(None, max_length=64),
) -> list:
    stmt = select(SupportTicket).join(User, SupportTicket.user_id == User.id)
    if status:
        stmt = stmt.where(SupportTicket.status == status)
    if assigned == "me":
        stmt = stmt.where(SupportTicket.assigned_to == str(admin))
    elif assigned == "none":
        stmt = stmt.where(SupportTicket.assigned_to.is_(None))
    if search:
        term = search.strip().lstrip("#@")
        conds = [SupportTicket.subject.ilike(f"%{term}%"), User.username.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 18:
            conds += [SupportTicket.id == int(term)] if len(term) <= 9 else []
            conds.append(User.telegram_id == int(term))
        stmt = stmt.where(or_(*conds))
    rows = (await session.scalars(stmt.order_by(SupportTicket.updated_at.desc()).limit(200))).unique().all()
    ids = [t.id for t in rows]
    last: dict[int, SupportMessage] = {}
    counts: dict[int, int] = {}
    if ids:
        latest = (
            select(func.max(SupportMessage.id)).where(SupportMessage.ticket_id.in_(ids)).group_by(SupportMessage.ticket_id)
        )
        for m in (await session.scalars(select(SupportMessage).where(SupportMessage.id.in_(latest)))).all():
            last[m.ticket_id] = m
        counts = dict(
            (await session.execute(
                select(SupportMessage.ticket_id, func.count(SupportMessage.id))
                .where(SupportMessage.ticket_id.in_(ids))
                .group_by(SupportMessage.ticket_id)
            )).all()
        )
    result = []
    for t in rows:
        m = last.get(t.id)
        result.append({
            **AdminTicketOut.model_validate(t, from_attributes=True).model_dump(mode="json"),
            "last_message": {"text": m.text[:160], "is_admin": m.is_admin, "created_at": m.created_at.isoformat()} if m else None,
            "messages_count": counts.get(t.id, 0),
        })
    return result


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
async def ticket_detail(ticket_id: int, admin: StaffDep, session: SessionDep) -> SupportTicket:
    return await _ticket(session, ticket_id)


@router.post("/support/tickets/{ticket_id}/reply", response_model=AdminTicketDetailOut)
async def ticket_reply(ticket_id: int, body: MessageCreate, admin: StaffDep, session: SessionDep) -> SupportTicket:
    ticket = await _ticket(session, ticket_id)
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "Пустое сообщение")
    session.add(SupportMessage(ticket_id=ticket.id, is_admin=True, text=text))
    ticket.status = TicketStatus.answered
    ticket.updated_at = utcnow()
    if ticket.assigned_to is None:
        ticket.assigned_to = str(admin)
    log_admin(session, admin, "reply", "ticket", ticket.id)
    await session.commit()
    await telegram.notify(
        ticket.user.telegram_id, f"💬 Ответ поддержки по обращению #{ticket.id} «{ticket.subject}»:\n\n{text}"
    )
    return await _ticket(session, ticket_id)


@router.post("/support/tickets/{ticket_id}/status", response_model=AdminTicketDetailOut)
async def ticket_status(ticket_id: int, body: TicketStatusIn, admin: StaffDep, session: SessionDep) -> SupportTicket:
    ticket = await _ticket(session, ticket_id)
    ticket.status = body.status
    ticket.updated_at = utcnow()
    log_admin(session, admin, "status", "ticket", ticket.id, status=body.status.value)
    await session.commit()
    if body.status == TicketStatus.closed:
        await telegram.notify(ticket.user.telegram_id, f"✅ Обращение #{ticket.id} «{ticket.subject}» закрыто.")
    return await _ticket(session, ticket_id)


@router.post("/support/tickets/{ticket_id}/assign", response_model=AdminTicketDetailOut)
async def ticket_assign(ticket_id: int, body: TicketAssign, admin: StaffDep, session: SessionDep) -> SupportTicket:
    ticket = await _ticket(session, ticket_id)
    target = (body.assigned_to or "").strip() or None
    if target and target != get_settings().admin_username:
        account = await session.scalar(select(AdminUser).where(AdminUser.username == target, AdminUser.is_active.is_(True)))
        if account is None:
            raise HTTPException(422, "Оператор не найден")
    if admin.role == "support" and target not in (None, str(admin)):
        raise HTTPException(403, "Оператор поддержки может назначить обращение только на себя")
    ticket.assigned_to = target
    log_admin(session, admin, "assign", "ticket", ticket.id, assigned_to=target)
    await session.commit()
    return await _ticket(session, ticket_id)


@router.get("/operators")
async def operators(admin: StaffDep, session: SessionDep) -> list[dict]:
    """Accounts that can be assigned to tickets."""
    owner = get_settings().admin_username
    rows = (await session.scalars(select(AdminUser).where(AdminUser.is_active.is_(True)).order_by(AdminUser.username))).all()
    return [{"username": owner, "role": "owner"}] + [{"username": a.username, "role": a.role.value} for a in rows]

"""Admin analytics: dashboard, finance, transactions journal, audit log."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import Response
from sqlalchemy import Select, case, func, or_, select

from app.api.admin import PAID_STATUSES, _paginate, csv_response, date_range, local_date
from app.api.deps import SessionDep
from app.api.deps import perm as P
from app.models import (
    AdminAction,
    BalanceTransaction,
    Category,
    Order,
    OrderStatus,
    Payment,
    PaymentKind,
    PaymentStatus,
    PhoneInventory,
    PremiumNumber,
    PremiumStatus,
    Product,
    ProductStatus,
    SupportTicket,
    TicketStatus,
    TxType,
    User,
)
from app.schemas import AdminOrderOut, AdminUserOut
from app.services import settings as settings_service

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _today(session: SessionDep) -> date:
    return await session.scalar(select(local_date(func.now())))  # type: ignore[return-value]


def _series(rows: list, start: date, days: int, keys: tuple[str, ...]) -> list[dict]:
    """Fill missing days with zeros so charts have a continuous x-axis."""
    by_day = {r[0]: r[1:] for r in rows}
    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        values = by_day.get(d, (0,) * len(keys))
        out.append({"date": d.isoformat(), **{k: float(v or 0) for k, v in zip(keys, values)}})
    return out


@router.get("/dashboard")
async def dashboard(admin: P("analytics.view"), session: SessionDep, days: int = Query(30, ge=7, le=365)) -> dict:
    today = await _today(session)
    start = today - timedelta(days=days - 1)
    paid_day = local_date(Order.paid_at)

    users = await session.scalar(select(func.count(User.id)))
    orders = await session.scalar(select(func.count(Order.id)))
    paid_orders = await session.scalar(select(func.count(Order.id)).where(Order.status.in_(PAID_STATUSES)))
    revenue = await session.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(Order.status.in_(PAID_STATUSES)))
    revenue_today, orders_today = (
        await session.execute(
            select(func.coalesce(func.sum(Order.total), 0), func.count(Order.id))
            .where(Order.status.in_(PAID_STATUSES), paid_day == today)
        )
    ).one()
    revenue_period = await session.scalar(
        select(func.coalesce(func.sum(Order.total), 0)).where(Order.status.in_(PAID_STATUSES), paid_day >= start)
    )
    new_users_today = await session.scalar(select(func.count(User.id)).where(local_date(User.created_at) == today))
    stock = await session.scalar(
        select(func.coalesce(func.sum(Product.stock), 0)).where(Product.status == ProductStatus.active)
    )
    premium_available = await session.scalar(
        select(func.count(PremiumNumber.id)).where(PremiumNumber.status == PremiumStatus.available)
    )
    pending_orders = await session.scalar(select(func.count(Order.id)).where(Order.status == OrderStatus.pending))
    pending_payments = await session.scalar(
        select(func.count(Payment.id)).where(Payment.status == PaymentStatus.awaiting_confirmation)
    )
    failed_payments = await session.scalar(
        select(func.count(Payment.id)).where(Payment.status == PaymentStatus.rejected)
    )
    # paid orders whose automatic delivery failed and need an operator — a key health signal
    failed_fulfillments = await session.scalar(
        select(func.count(Order.id)).where(Order.fulfillment_status == "failed")
    )
    # phone-number warehouse: numbers ready to sell right now (derived from real rows)
    phones_available = await session.scalar(
        select(func.count(PhoneInventory.id)).where(PhoneInventory.status == "AVAILABLE")
    )
    open_tickets = await session.scalar(
        select(func.count(SupportTicket.id)).where(SupportTicket.status == TicketStatus.open)
    )

    sales_rows = (
        await session.execute(
            select(paid_day.label("d"), func.sum(Order.total), func.count(Order.id))
            .where(Order.status.in_(PAID_STATUSES), Order.paid_at.is_not(None), paid_day >= start)
            .group_by("d")
        )
    ).all()
    user_day = local_date(User.created_at)
    user_rows = (
        await session.execute(select(user_day.label("d"), func.count(User.id)).where(user_day >= start).group_by("d"))
    ).all()

    # popular categories by paid revenue in the period
    cat_expr = func.coalesce(
        Product.category, case((Order.premium_number_id.is_not(None), "premium"), else_="other")
    ).label("cat")
    cat_rows = (
        await session.execute(
            select(cat_expr, func.sum(Order.total), func.count(Order.id))
            .select_from(Order)
            .outerjoin(Product, Order.product_id == Product.id)
            .where(Order.status.in_(PAID_STATUSES), paid_day >= start)
            .group_by(cat_expr)
            .order_by(func.sum(Order.total).desc())
        )
    ).all()
    titles = {c.slug: c.title for c in (await session.scalars(select(Category))).all()}
    titles.update({"premium": "Красивые номера", "other": "Другое"})

    threshold = int(await settings_service.get_value(session, "low_stock_threshold") or 5)
    low_stock = (
        await session.scalars(
            select(Product)
            .where(Product.status == ProductStatus.active, Product.stock <= threshold)
            .order_by(Product.stock, Product.id)
            .limit(10)
        )
    ).unique().all()
    recent_orders = (await session.scalars(select(Order).order_by(Order.id.desc()).limit(10))).unique().all()
    recent_users = (await session.scalars(select(User).order_by(User.id.desc()).limit(8))).all()
    sales = _series(sales_rows, start, days, ("revenue", "orders"))
    if not admin.can("finance.view"):  # e.g. catalog manager: counts yes, money no
        revenue = revenue_today = revenue_period = None
        for x in sales:
            x["revenue"] = 0.0
        cat_rows = [(slug, 0, cnt) for slug, _, cnt in cat_rows]
    return {
        "finance_hidden": not admin.can("finance.view"),
        "days": days,
        "today": today.isoformat(),
        "users": users or 0,
        "new_users_today": new_users_today or 0,
        "orders": orders or 0,
        "paid_orders": paid_orders or 0,
        "orders_today": orders_today or 0,
        "revenue": float(revenue) if revenue is not None else None,
        "revenue_today": float(revenue_today) if revenue_today is not None else None,
        "revenue_period": float(revenue_period) if revenue_period is not None else None,
        "stock": int(stock or 0),
        "premium_available": premium_available or 0,
        "pending_orders": pending_orders or 0,
        "pending_payments": pending_payments or 0,
        "failed_payments": failed_payments or 0,
        "failed_fulfillments": failed_fulfillments or 0,
        "phones_available": phones_available or 0,
        "open_tickets": open_tickets or 0,
        "low_stock_threshold": threshold,
        "sales": sales,
        "daily": [x for x in sales if x["orders"]],  # backwards compatible shape
        "new_users": _series(user_rows, start, days, ("users",)),
        "categories": [
            {"slug": slug, "title": titles.get(slug, slug), "revenue": float(rev or 0), "orders": cnt}
            for slug, rev, cnt in cat_rows
        ],
        "low_stock": [
            {"id": p.id, "title": p.title, "stock": p.stock, "flag": p.country.flag if p.country else None,
             "price": float(p.price)}
            for p in low_stock
        ],
        "recent_orders": [AdminOrderOut.model_validate(o, from_attributes=True).model_dump(mode="json") for o in recent_orders],
        "recent_users": [AdminUserOut.model_validate(u, from_attributes=True).model_dump(mode="json") for u in recent_users],
    }


# ------------------------------------------------------------------ finance


@router.get("/finance/summary")
async def finance_summary(
    admin: P("finance.view"),
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    """All sums come from confirmed money movements: paid orders, confirmed payments, refund transactions."""
    today = await _today(session)
    date_to = date_to or today
    date_from = date_from or (date_to - timedelta(days=29))
    days = min((date_to - date_from).days + 1, 366)

    revenue, paid_count = (
        await session.execute(
            date_range(
                select(func.coalesce(func.sum(Order.total), 0), func.count(Order.id))
                .where(Order.status.in_(PAID_STATUSES)),
                Order.paid_at, date_from, date_to,
            )
        )
    ).one()
    method_expr = func.coalesce(Order.payment_method, "—").label("method")
    by_method = (
        await session.execute(
            select(method_expr, func.sum(Order.total), func.count(Order.id))
            .where(Order.status.in_(PAID_STATUSES))
            .where(local_date(Order.paid_at) >= date_from, local_date(Order.paid_at) <= date_to)
            .group_by(method_expr)
            .order_by(func.sum(Order.total).desc())
        )
    ).all()
    refunds_sum, refunds_count = (
        await session.execute(
            date_range(
                select(func.coalesce(func.sum(BalanceTransaction.amount), 0), func.count(BalanceTransaction.id))
                .where(BalanceTransaction.type == TxType.refund),
                BalanceTransaction.created_at, date_from, date_to,
            )
        )
    ).one()
    topups_sum, topups_count = (
        await session.execute(
            date_range(
                select(func.coalesce(func.sum(Payment.amount), 0), func.count(Payment.id))
                .where(Payment.kind == PaymentKind.topup, Payment.status == PaymentStatus.confirmed,
                       Payment.is_test.is_(False)),
                Payment.confirmed_at, date_from, date_to,
            )
        )
    ).one()
    status_counts = dict(
        (await session.execute(
            date_range(select(Payment.status, func.count(Payment.id)), Payment.created_at, date_from, date_to)
            .group_by(Payment.status)
        )).all()
    )
    failed = (
        await session.scalars(
            date_range(
                select(Payment).where(Payment.status == PaymentStatus.rejected), Payment.created_at, date_from, date_to
            ).order_by(Payment.id.desc()).limit(20)
        )
    ).unique().all()
    day = local_date(Order.paid_at)
    rows = (
        await session.execute(
            select(day.label("d"), func.sum(Order.total), func.count(Order.id))
            .where(Order.status.in_(PAID_STATUSES), day >= date_from, day <= date_to)
            .group_by("d")
        )
    ).all()
    balances = await session.scalar(select(func.coalesce(func.sum(User.balance), 0)))
    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "revenue": float(revenue or 0),
        "paid_orders": paid_count or 0,
        "average_check": float(revenue / paid_count) if paid_count else 0.0,
        "refunds": float(refunds_sum or 0),
        "refunds_count": refunds_count or 0,
        "topups": float(topups_sum or 0),
        "topups_count": topups_count or 0,
        "users_balance_total": float(balances or 0),
        "by_method": [{"method": m, "revenue": float(r or 0), "orders": c} for m, r, c in by_method],
        "payment_statuses": {k.value: v for k, v in status_counts.items()},
        "failed_payments": [
            {"id": p.id, "amount": float(p.amount), "method": p.method.value, "kind": p.kind.value,
             "user": f"@{p.user.username}" if p.user.username else str(p.user.telegram_id),
             "comment": p.admin_comment, "created_at": p.created_at.isoformat()}
            for p in failed
        ],
        "daily": _series(rows, date_from, days, ("revenue", "orders")),
    }


def _tx_query(tx_type: str | None, search: str | None, date_from: date | None, date_to: date | None) -> Select:
    stmt = select(BalanceTransaction, User).join(User, BalanceTransaction.user_id == User.id)
    if tx_type:
        stmt = stmt.where(BalanceTransaction.type == TxType(tx_type))
    if search:
        term = search.strip().lstrip("@#")
        conds = [User.username.ilike(f"%{term}%"), BalanceTransaction.description.ilike(f"%{term}%")]
        if term.isdigit() and len(term) <= 18:
            conds.append(User.telegram_id == int(term))
        stmt = stmt.where(or_(*conds))
    return date_range(stmt, BalanceTransaction.created_at, date_from, date_to)


def _tx_dict(t: BalanceTransaction, u: User) -> dict:
    return {
        "id": t.id, "type": t.type.value, "amount": float(t.amount), "balance_after": float(t.balance_after),
        "description": t.description, "order_id": t.order_id, "payment_id": t.payment_id,
        "created_at": t.created_at.isoformat(),
        "user": {"id": u.id, "telegram_id": u.telegram_id, "username": u.username, "first_name": u.first_name},
    }


@router.get("/finance/transactions")
async def transactions(
    admin: P("finance.view"),
    session: SessionDep,
    type: str | None = Query(None, pattern="^(topup|purchase|refund|admin_adjust)$"),
    search: str | None = Query(None, max_length=64),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=100),
) -> dict:
    stmt = _tx_query(type, search, date_from, date_to)
    total = await session.scalar(select(func.count()).select_from(stmt.with_only_columns(BalanceTransaction.id).subquery()))
    rows = (await session.execute(_paginate(stmt.order_by(BalanceTransaction.id.desc()), page, size))).all()
    return {"total": total or 0, "items": [_tx_dict(t, u) for t, u in rows]}


@router.get("/finance/transactions/export.csv")
async def export_transactions(
    admin: P("finance.export"),
    session: SessionDep,
    type: str | None = Query(None, pattern="^(topup|purchase|refund|admin_adjust)$"),
    date_from: date | None = None,
    date_to: date | None = None,
) -> Response:
    rows = (await session.execute(_tx_query(type, None, date_from, date_to).order_by(BalanceTransaction.id).limit(100_000))).all()
    return csv_response(
        "f1z-transactions.csv",
        ["id", "created_at", "type", "amount", "balance_after", "description", "order_id", "payment_id",
         "user_telegram_id", "username"],
        [[t.id, t.created_at, t.type, t.amount, t.balance_after, t.description, t.order_id, t.payment_id,
          u.telegram_id, u.username] for t, u in rows],
    )


@router.get("/finance/report.csv")
async def export_report(
    admin: P("finance.export"), session: SessionDep, date_from: date | None = None, date_to: date | None = None
) -> Response:
    data = await finance_summary(admin, session, date_from, date_to)
    rows: list[list[object]] = [["Период", f"{data['date_from']} — {data['date_to']}"],
                                ["Выручка, грн", data["revenue"]], ["Оплаченных заказов", data["paid_orders"]],
                                ["Средний чек, грн", round(data["average_check"], 2)],
                                ["Возвраты, грн", data["refunds"]], ["Возвратов", data["refunds_count"]],
                                ["Пополнения, грн", data["topups"]], ["Пополнений", data["topups_count"]], []]
    rows.append(["Способ оплаты", "Выручка", "Заказов"])
    rows += [[m["method"], m["revenue"], m["orders"]] for m in data["by_method"]]
    rows += [[], ["Дата", "Выручка", "Заказов"]]
    rows += [[d["date"], d["revenue"], int(d["orders"])] for d in data["daily"]]
    return csv_response(f"f1z-report-{data['date_from']}-{data['date_to']}.csv", ["Отчёт F1Z PRIME", ""], rows)


# ---------------------------------------------------------------- audit log


@router.get("/actions/export.csv")
async def export_actions(
    admin: P("system.audit"), session: SessionDep, entity: str | None = Query(None, max_length=32),
    who: str | None = Query(None, max_length=64), date_from: date | None = None, date_to: date | None = None,
) -> Response:
    stmt = select(AdminAction)
    if entity:
        stmt = stmt.where(AdminAction.entity == entity)
    if who:
        stmt = stmt.where(AdminAction.admin == who)
    stmt = date_range(stmt, AdminAction.created_at, date_from, date_to)
    rows = (await session.scalars(stmt.order_by(AdminAction.id.desc()).limit(50_000))).all()
    import json as _json

    return csv_response(
        "f1z-audit.csv", ["id", "created_at", "admin", "action", "entity", "entity_id", "details"],
        [[r.id, r.created_at, r.admin, r.action, r.entity, r.entity_id, _json.dumps(r.details, ensure_ascii=False)] for r in rows],
    )


@router.get("/actions")
async def admin_actions(
    admin: P("system.audit"),
    session: SessionDep,
    limit: int = Query(100, ge=1, le=500),
    entity: str | None = Query(None, max_length=32),
    who: str | None = Query(None, max_length=64),
    page: int = Query(1, ge=1),
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    stmt = select(AdminAction)
    if entity:
        stmt = stmt.where(AdminAction.entity == entity)
    if who:
        stmt = stmt.where(AdminAction.admin == who)
    stmt = date_range(stmt, AdminAction.created_at, date_from, date_to)
    rows = (await session.scalars(stmt.order_by(AdminAction.id.desc()).offset((page - 1) * limit).limit(limit))).all()
    return [
        {"id": r.id, "admin": r.admin, "action": r.action, "entity": r.entity, "entity_id": r.entity_id,
         "details": r.details, "created_at": r.created_at.isoformat()}
        for r in rows
    ]

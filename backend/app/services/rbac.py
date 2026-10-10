"""Role-based access control with per-account overrides.

Effective permissions of a staff account = role permissions + extra_permissions - denied_permissions,
empty when the account is suspended/expired or its role has expired. The owner (ADMIN_USERNAME from .env or
OWNER_TELEGRAM_ID) always has every permission and can't be edited or blocked through the panel.

Escalation rules for anyone except the owner:
  - you can't change your own account or a role you hold;
  - you can only grant permissions you have yourself;
  - you can't edit an account whose permissions are not a subset of yours.
Every admin endpoint checks permissions on the server; hiding buttons in the UI is only cosmetics.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminUser, Role
from app.services.common import utcnow

# code: (group, label)
PERMISSIONS: dict[str, tuple[str, str]] = {
    "analytics.view": ("Аналитика", "Дашборд и графики"),
    "users.view": ("Пользователи", "Просматривать"),
    "users.history": ("Пользователи", "Смотреть историю покупок"),
    "users.block": ("Пользователи", "Блокировать и разблокировать"),
    "users.notes": ("Пользователи", "Редактировать заметки"),
    "users.balance": ("Пользователи", "Корректировать баланс"),
    "users.export": ("Пользователи", "Экспортировать"),
    "orders.view": ("Заказы", "Просматривать"),
    "orders.status": ("Заказы", "Менять статус"),
    "orders.fulfill": ("Заказы", "Подтверждать ручную выдачу и повторять выдачу"),
    "orders.cancel": ("Заказы", "Отменять"),
    "orders.export": ("Заказы", "Экспортировать"),
    "payments.view": ("Финансы", "Просматривать платежи"),
    "payments.confirm": ("Финансы", "Подтверждать ручные платежи"),
    "refunds.create": ("Финансы", "Инициировать возвраты"),
    "refunds.approve": ("Финансы", "Одобрять запросы (два подтверждения)"),
    "finance.view": ("Финансы", "Просматривать выручку"),
    "finance.export": ("Финансы", "Экспортировать отчёты"),
    "products.view": ("Товары", "Просматривать"),
    "products.edit": ("Товары", "Добавлять и редактировать"),
    "products.delete": ("Товары", "Удалять и архивировать"),
    "products.price": ("Товары", "Изменять цены"),
    "products.stock": ("Товары", "Управлять остатками и единицами"),
    "products.import": ("Товары", "Импорт и экспорт"),
    "promo.manage": ("Товары", "Промокоды и скидки"),
    "support.view": ("Поддержка", "Просматривать обращения"),
    "support.reply": ("Поддержка", "Отвечать"),
    "support.close": ("Поддержка", "Закрывать"),
    "support.assign": ("Поддержка", "Переназначать оператору"),
    "system.view": ("Система", "Состояние системы и инциденты"),
    "system.settings": ("Система", "Менять настройки магазина"),
    "system.automation": ("Система", "Управлять автоматизацией и правилами"),
    "system.audit": ("Система", "Просматривать журнал действий"),
    "system.backups": ("Система", "Резервные копии"),
    "notifications.manage": ("Система", "Шаблоны уведомлений"),
    "staff.manage": ("Система", "Управлять сотрудниками"),
    "staff.roles": ("Система", "Управлять ролями"),
}
ALL = frozenset(PERMISSIONS)
VIEW = {"analytics.view", "users.view", "users.history", "orders.view", "products.view", "support.view",
        "payments.view", "finance.view", "system.view"}

# slug: (name, description, color, permissions, limits)
BUILTIN: dict[str, tuple[str, str, str, set[str], dict[str, Any]]] = {
    "head_admin": ("Главный администратор", "Всё, кроме резервных копий", "#A78BFA", set(ALL - {"system.backups"}), {}),
    "admin": ("Администратор", "Магазин, заказы и финансы без управления командой", "#8B5CF6",
              set(ALL - {"system.backups", "staff.manage", "staff.roles", "refunds.approve"}),
              {"payment_confirm_max": 5000, "refund_max": 2000}),
    "orders_manager": ("Менеджер заказов", "Заказы, выдача, поддержка", "#22D3EE",
                       {"analytics.view", "users.view", "users.history", "orders.view", "orders.status", "orders.fulfill",
                        "orders.cancel", "orders.export", "payments.view", "support.view", "support.reply",
                        "support.close", "products.view"}, {}),
    "finance_manager": ("Финансовый менеджер", "Платежи, возвраты, отчёты", "#22C55E",
                        {"analytics.view", "users.view", "users.history", "orders.view", "payments.view",
                         "payments.confirm", "refunds.create", "finance.view", "finance.export", "orders.export"},
                        {"payment_confirm_max": 10000, "refund_max": 5000}),
    "catalog_manager": ("Менеджер товаров", "Каталог, цены, остатки, промокоды", "#F59E0B",
                        {"analytics.view", "products.view", "products.edit", "products.price", "products.stock",
                         "products.import", "promo.manage", "products.delete"}, {"price_change_pct_max": 50, "bulk_max": 200}),
    "support": ("Оператор поддержки", "Обращения, просмотр заказов и пользователей", "#9494A8",
                {"users.view", "users.history", "orders.view", "support.view", "support.reply", "support.close"}, {}),
    "analyst": ("Аналитик", "Только отчёты и статистика", "#67E8F9",
                {"analytics.view", "finance.view", "finance.export", "orders.view", "orders.export", "products.view"}, {}),
    "viewer": ("Наблюдатель", "Только просмотр", "#64748B", set(VIEW - {"finance.view"}), {}),
}
LIMIT_KEYS = ("payment_confirm_max", "refund_max", "price_change_pct_max", "bulk_max")


async def ensure_builtin_roles(session: AsyncSession) -> None:
    existing = set((await session.scalars(select(Role.slug))).all())
    for slug, (name, desc, color, perms, limits) in BUILTIN.items():
        if slug not in existing:
            session.add(Role(slug=slug, name=name, description=desc, color=color, permissions=sorted(perms),
                             limits=limits, is_system=True))


async def get_role(session: AsyncSession, slug: str) -> Role | None:
    role = await session.scalar(select(Role).where(Role.slug == slug))
    if role is None and slug in BUILTIN:
        name, desc, color, perms, limits = BUILTIN[slug]
        role = Role(slug=slug, name=name, description=desc, color=color, permissions=sorted(perms), limits=limits,
                    is_system=True)
    return role


def account_active(account: AdminUser) -> bool:
    return account.is_active and (account.expires_at is None or account.expires_at > utcnow())


async def effective(session: AsyncSession, account: AdminUser) -> tuple[frozenset[str], dict[str, Any], Role | None]:
    if not account_active(account):
        return frozenset(), {}, None
    role = await get_role(session, account.role_slug)
    perms: set[str] = set()
    limits: dict[str, Any] = {}
    if role is not None and (role.expires_at is None or role.expires_at > utcnow()):
        perms = set(role.permissions or [])
        limits = dict(role.limits or {})
    perms |= set(account.extra_permissions or [])
    perms -= set(account.denied_permissions or [])
    return frozenset(p for p in perms if p in ALL), limits, role


async def account_has(session: AsyncSession, account: AdminUser, perm: str | None) -> bool:
    perms, _, _ = await effective(session, account)
    return bool(perms) and (perm is None or perm in perms)


def within_limit(limits: dict[str, Any], key: str, value: Decimal | float | int) -> bool:
    raw = limits.get(key)
    if raw in (None, ""):
        return True
    try:
        return Decimal(str(value)) <= Decimal(str(raw))
    except Exception:  # noqa: BLE001
        return False


def clean_limits(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k in LIMIT_KEYS:
        v = raw.get(k)
        if v in (None, ""):
            continue
        d = Decimal(str(v))
        if d < 0:
            raise ValueError(f"{k}: лимит не может быть отрицательным")
        out[k] = float(d)
    return out


def limits_not_looser(child: dict[str, Any], parent: dict[str, Any]) -> bool:
    """A non-owner can't grant limits looser than their own."""
    for k in LIMIT_KEYS:
        if parent.get(k) is None:
            continue
        if child.get(k) is None or Decimal(str(child[k])) > Decimal(str(parent[k])):
            return False
    return True

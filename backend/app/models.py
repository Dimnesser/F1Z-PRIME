from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

Money = Numeric(12, 2)


def _enum(e: type[enum.Enum], name: str) -> Enum:
    return Enum(e, name=name, values_callable=lambda x: [m.value for m in x], native_enum=False, length=32)


class ProductStatus(str, enum.Enum):
    active = "active"
    hidden = "hidden"
    archived = "archived"


class PremiumStatus(str, enum.Enum):
    available = "available"
    reserved = "reserved"
    sold = "sold"
    hidden = "hidden"


class OrderStatus(str, enum.Enum):
    pending = "pending"
    paid = "paid"
    processing = "processing"
    completed = "completed"
    cancelled = "cancelled"
    expired = "expired"
    refunded = "refunded"


class PaymentKind(str, enum.Enum):
    order = "order"
    topup = "topup"


class PaymentMethod(str, enum.Enum):
    balance = "balance"
    stars = "stars"
    manual = "manual"
    test = "test"


class PaymentStatus(str, enum.Enum):
    pending = "pending"
    awaiting_confirmation = "awaiting_confirmation"
    confirmed = "confirmed"
    rejected = "rejected"
    cancelled = "cancelled"


class TxType(str, enum.Enum):
    topup = "topup"
    purchase = "purchase"
    refund = "refund"
    admin_adjust = "admin_adjust"


class TicketStatus(str, enum.Enum):
    open = "open"
    answered = "answered"
    closed = "closed"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("balance >= 0", name="ck_users_balance_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[str | None] = mapped_column(String(64), index=True)
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    language_code: Mapped[str | None] = mapped_column(String(8))
    photo_url: Mapped[str | None] = mapped_column(String(512))
    balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0", nullable=False)
    total_spent: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0", nullable=False)
    orders_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    orders: Mapped[list[Order]] = relationship(back_populates="user")


class Country(TimestampMixin, Base):
    __tablename__ = "countries"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(2), unique=True, nullable=False)  # ISO alpha-2
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    flag: Mapped[str] = mapped_column(String(16), nullable=False)
    dial_code: Mapped[str] = mapped_column(String(8), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    products: Mapped[list[Product]] = relationship(back_populates="country")
    premium_numbers: Mapped[list[PremiumNumber]] = relationship(back_populates="country")


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_products_price_positive"),
        CheckConstraint("stock >= 0", name="ck_products_stock_non_negative"),
        CheckConstraint("sale_price IS NULL OR sale_price > 0", name="ck_products_sale_price_positive"),
        CheckConstraint("price_usd IS NULL OR price_usd > 0", name="ck_products_price_usd_positive"),
        CheckConstraint("price_stars IS NULL OR price_stars > 0", name="ck_products_price_stars_positive"),
        Index("ix_products_status_category", "status", "category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="numbers", server_default="numbers", nullable=False)
    country_id: Mapped[int | None] = mapped_column(ForeignKey("countries.id", ondelete="SET NULL"), index=True)
    price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    stock: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    status: Mapped[ProductStatus] = mapped_column(
        _enum(ProductStatus, "product_status"), default=ProductStatus.active, nullable=False
    )
    is_popular: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    # Text shown to the buyer after payment (instructions, voucher format...). Never secrets/auth codes.
    delivery_note: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    # auto: delivered by the system after confirmed payment; manual: operator task; review: manual check first
    fulfillment_mode: Mapped[str] = mapped_column(String(16), default="manual", server_default="manual", nullable=False)
    # stock is the count of available encrypted inventory units (license keys, vouchers...)
    uses_inventory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    uses_phone_inventory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # promotional price (shown crossed out against `price`), optionally until sale_ends_at
    sale_price: Mapped[Decimal | None] = mapped_column(Money)
    sale_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, server_default="{}", nullable=False)
    # sale window: outside it the product is hidden from the catalog and can't be ordered
    available_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    available_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_per_order: Mapped[int | None] = mapped_column(Integer)
    max_per_user: Mapped[int | None] = mapped_column(Integer)  # lifetime, paid + pending orders
    # prices per payment currency, set by staff (never converted by an exchange rate):
    # price (UAH) — balance / card transfer; price_stars — Telegram Stars invoice; price_usd — shown for reference
    price_usd: Mapped[Decimal | None] = mapped_column(Money)
    price_stars: Mapped[int | None] = mapped_column(Integer)
    stars_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    country: Mapped[Country | None] = relationship(back_populates="products", lazy="joined")

    def sale_active(self, now: datetime) -> bool:
        return self.sale_price is not None and (self.sale_ends_at is None or self.sale_ends_at > now)

    def effective_price(self, now: datetime) -> Decimal:
        return self.sale_price if self.sale_active(now) else self.price  # type: ignore[return-value]

    @property
    def instant(self) -> bool:
        """Delivered automatically right after payment: only with a confirmed stock (uploaded units or a counter
        staff set) and the automatic mode. Manual products are never advertised as instant."""
        return self.fulfillment_mode == "auto" and self.stock > 0 and (
            self.uses_inventory or self.uses_phone_inventory or bool(self.delivery_note.strip()))

    @property
    def price_now(self) -> Decimal:
        from app.services.common import utcnow

        return self.effective_price(utcnow())

    @property
    def price_old(self) -> Decimal | None:
        from app.services.common import utcnow

        return self.price if self.sale_active(utcnow()) else None

    def on_sale_window(self, now: datetime) -> bool:
        return (self.available_from is None or self.available_from <= now) and (
            self.available_until is None or self.available_until > now
        )


class PremiumNumber(TimestampMixin, Base):
    __tablename__ = "premium_numbers"
    __table_args__ = (CheckConstraint("price > 0", name="ck_premium_price_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    country_id: Mapped[int | None] = mapped_column(ForeignKey("countries.id", ondelete="SET NULL"), index=True)
    number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)  # full number, hidden until sold
    display_mask: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[str] = mapped_column(String(16), default="premium", server_default="premium", nullable=False)
    title: Mapped[str] = mapped_column(String(64), default="PREMIUM NUMBER", server_default="PREMIUM NUMBER")
    description: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    status: Mapped[PremiumStatus] = mapped_column(
        _enum(PremiumStatus, "premium_status"), default=PremiumStatus.available, index=True, nullable=False
    )

    country: Mapped[Country | None] = relationship(back_populates="premium_numbers", lazy="joined")


class Order(TimestampMixin, Base):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_orders_user_idempotency"),
        CheckConstraint("quantity > 0", name="ck_orders_quantity_positive"),
        Index("ix_orders_status_created", "status", "created_at"),
        Index("ix_orders_paid_at", "paid_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    premium_number_id: Mapped[int | None] = mapped_column(
        ForeignKey("premium_numbers.id", ondelete="SET NULL"), index=True
    )
    item_title: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Money, nullable=False)
    total: Mapped[Decimal] = mapped_column(Money, nullable=False)
    status: Mapped[OrderStatus] = mapped_column(
        _enum(OrderStatus, "order_status"), default=OrderStatus.pending, nullable=False
    )
    payment_method: Mapped[str | None] = mapped_column(String(16))
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False)
    delivery_data: Mapped[str | None] = mapped_column(Text)
    admin_note: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    public_id: Mapped[str | None] = mapped_column(String(20), unique=True)
    currency: Mapped[str] = mapped_column(String(8), default="UAH", server_default="UAH", nullable=False)
    # fulfillment after payment: pending / processing / delivered / manual / review / failed (NULL before payment)
    fulfillment_status: Mapped[str | None] = mapped_column(String(16), index=True)
    fulfillment_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    fulfillment_error: Mapped[str | None] = mapped_column(String(500))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0", nullable=False)
    promo_code: Mapped[str | None] = mapped_column(String(32))
    # Stars amount fixed when the order is created (product price_stars × qty, minus the promo share)
    stars_total: Mapped[int | None] = mapped_column(Integer)
    usd_total: Mapped[Decimal | None] = mapped_column(Money)

    user: Mapped[User] = relationship(back_populates="orders", lazy="joined")
    product: Mapped[Product | None] = relationship(lazy="joined")
    premium_number: Mapped[PremiumNumber | None] = relationship(lazy="joined")

    @property
    def stage(self) -> str:
        from app.services.orders import order_stage

        return order_stage(self)


class Payment(TimestampMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payments_amount_positive"),
        Index("ix_payments_status_created", "status", "created_at"),
        Index("ix_payments_created_at", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    kind: Mapped[PaymentKind] = mapped_column(_enum(PaymentKind, "payment_kind"), nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(_enum(PaymentMethod, "payment_method"), nullable=False)
    status: Mapped[PaymentStatus] = mapped_column(
        _enum(PaymentStatus, "payment_status"), default=PaymentStatus.pending, nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    stars_amount: Mapped[int | None] = mapped_column(Integer)
    payload: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    # Unique id from the payment provider (telegram_payment_charge_id) — prevents double processing.
    external_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    is_test: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    user_comment: Mapped[str | None] = mapped_column(Text)
    admin_comment: Mapped[str | None] = mapped_column(Text)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")
    order: Mapped[Order | None] = relationship(lazy="joined")


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    type: Mapped[TxType] = mapped_column(_enum(TxType, "tx_type"), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    balance_after: Mapped[Decimal] = mapped_column(Money, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SupportTicket(TimestampMixin, Base):
    __tablename__ = "support_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[TicketStatus] = mapped_column(
        _enum(TicketStatus, "ticket_status"), default=TicketStatus.open, index=True, nullable=False
    )
    assigned_to: Mapped[str | None] = mapped_column(String(64), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    category: Mapped[str] = mapped_column(String(32), default="general", server_default="general", nullable=False)
    priority: Mapped[str] = mapped_column(String(16), default="normal", server_default="normal", nullable=False)

    user: Mapped[User] = relationship(lazy="joined")
    messages: Mapped[list[SupportMessage]] = relationship(
        back_populates="ticket", order_by="SupportMessage.id", cascade="all, delete-orphan"
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(
        ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ticket: Mapped[SupportTicket] = relationship(back_populates="messages")


class AdminAction(Base):
    __tablename__ = "admin_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AdminRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    support = "support"


class AdminUser(TimestampMixin, Base):
    """Additional admin-panel accounts. The account from ADMIN_USERNAME/.env is always the owner."""

    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # NULL: Telegram-only account (invited by Telegram ID, signs in from the Mini App)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # legacy column (pre-RBAC); the effective role is role_slug
    role: Mapped[AdminRole] = mapped_column(_enum(AdminRole, "admin_role"), default=AdminRole.support, nullable=False)
    role_slug: Mapped[str] = mapped_column(String(32), default="support", nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(64))
    telegram_username: Mapped[str | None] = mapped_column(String(64))
    extra_permissions: Mapped[list[str] | None] = mapped_column(JSON)
    denied_permissions: Mapped[list[str] | None] = mapped_column(JSON)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    note: Mapped[str | None] = mapped_column(String(255))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    # Optional link to a Telegram account: lets this person open the admin panel from the Mini App.
    telegram_id: Mapped[int | None] = mapped_column(BigInteger, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class OrderEvent(Base):
    """Order status history (who changed what and when)."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(32))
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    actor: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Category(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(64), nullable=False)
    icon: Mapped[str] = mapped_column(String(32), default="box", server_default="box", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class NotificationOutbox(Base):
    """Telegram notifications that failed to send; retried by the background worker."""

    __tablename__ = "notification_outbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", index=True, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    last_error: Mapped[str] = mapped_column(String(255), default="", server_default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InventoryItem(Base):
    """One deliverable unit (license key, voucher code...). The secret is stored encrypted (AES-GCM)."""

    __tablename__ = "inventory_items"
    __table_args__ = (
        UniqueConstraint("product_id", "fingerprint", name="uq_inventory_product_fingerprint"),
        Index("ix_inventory_product_status", "product_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    secret_enc: Mapped[str] = mapped_column(Text, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)  # HMAC of the secret: duplicate guard
    label: Mapped[str] = mapped_column(String(64), default="", nullable=False)  # masked preview for admins
    status: Mapped[str] = mapped_column(String(16), default="available", server_default="available", nullable=False)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    batch: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StockMovement(Base):
    """History of every stock change (reserve, release, sale, manual adjustment, import)."""

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    stock_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    note: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    actor: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    order_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class Job(Base):
    """Durable background job (survives restarts): retries with exponential backoff, dead-letter after max attempts."""

    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_run_at", "status", "run_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="pending", server_default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=6, server_default="6", nullable=False)
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))
    dedupe_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TaskRun(Base):
    """Heartbeat of periodic worker tasks (shown on the automation/system pages)."""

    __tablename__ = "task_runs"

    name: Mapped[str] = mapped_column(String(48), primary_key=True)
    last_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(500))
    last_duration_ms: Mapped[int | None] = mapped_column(Integer)
    runs: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)


class Incident(Base):
    """Something that needs a human: payment mismatch, failed delivery, stuck order, dead job..."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(12), default="warning", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="open", server_default="open", index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    order_id: Mapped[int | None] = mapped_column(Integer, index=True)
    payment_id: Mapped[int | None] = mapped_column(Integer)
    dedupe_key: Mapped[str | None] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[str | None] = mapped_column(String(64))


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True, nullable=False)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    amount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    # balance: back to store balance; stars: Bot API refundStarPayment; manual: operator returns money outside
    method: Mapped[str] = mapped_column(String(16), nullable=False)
    # requested -> processing -> succeeded | failed ; manual_pending -> succeeded ; rejected
    status: Mapped[str] = mapped_column(String(16), default="requested", nullable=False)
    reason: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(64))
    provider_ref: Mapped[str | None] = mapped_column(String(255))
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationTemplate(Base):
    """Editable Telegram message templates. Variables like {order_id} are HTML-escaped on render."""

    __tablename__ = "notification_templates"

    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    button_text: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Role(TimestampMixin, Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    color: Mapped[str] = mapped_column(String(16), default="#8B5CF6", nullable=False)
    permissions: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    # payment_confirm_max, refund_max (money), price_change_pct_max (%), bulk_max (items); null = no limit
    limits: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64))


class ApprovalRequest(Base):
    """Two-person rule: an operation above the requester's limit waits for the owner / an approver."""

    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # refund | payment_confirm
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    amount: Mapped[Decimal | None] = mapped_column(Money)
    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True, nullable=False)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    decided_by: Mapped[str | None] = mapped_column(String(64))
    decision_note: Mapped[str | None] = mapped_column(String(255))
    result: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class StaffNotification(Base):
    """In-panel inbox for staff (assignments, approvals, permission changes, automation errors)."""

    __tablename__ = "staff_notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient: Mapped[str] = mapped_column(String(64), nullable=False)  # owner | acc:<id> | tg:<telegram id>
    kind: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    link: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminPrefs(Base):
    __tablename__ = "admin_prefs"

    owner_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PriceHistory(Base):
    __tablename__ = "price_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True, nullable=False)
    field: Mapped[str] = mapped_column(String(16), nullable=False)  # price | sale_price
    old_value: Mapped[Decimal | None] = mapped_column(Money)
    new_value: Mapped[Decimal | None] = mapped_column(Money)
    actor: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PromoCode(Base):
    """Discount code. Validated and applied only on the server, under a row lock (usage limits are exact)."""

    __tablename__ = "promo_codes"
    __table_args__ = (
        CheckConstraint("value > 0", name="ck_promo_value_positive"),
        CheckConstraint("used_count >= 0", name="ck_promo_used_non_negative"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # percent | fixed
    value: Mapped[Decimal] = mapped_column(Money, nullable=False)
    min_total: Mapped[Decimal | None] = mapped_column(Money)
    max_discount: Mapped[Decimal | None] = mapped_column(Money)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    max_uses_per_user: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    used_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    product_ids: Mapped[list[int]] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    categories: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    first_order_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    note: Mapped[str] = mapped_column(String(255), default="", server_default="", nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PromoRedemption(Base):
    __tablename__ = "promo_redemptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    promo_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), unique=True, nullable=False)
    discount: Mapped[Decimal] = mapped_column(Money, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AutomationRule(Base):
    """WHEN <trigger> IF <conditions> THEN <actions>. Declarative JSON, evaluated by a whitelist engine (no eval)."""

    __tablename__ = "automation_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    trigger: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    conditions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    match: Mapped[str] = mapped_column(String(4), default="all", server_default="all", nullable=False)  # all | any
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, server_default="100", nullable=False)
    runs: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    matches: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    failures: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    created_by: Mapped[str] = mapped_column(String(64), nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class RuleRun(Base):
    __tablename__ = "rule_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_id: Mapped[int] = mapped_column(ForeignKey("automation_rules.id", ondelete="CASCADE"), index=True, nullable=False)
    event: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer)
    matched: Mapped[bool] = mapped_column(Boolean, nullable=False)
    dry_run: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True, nullable=False)


class PhoneInventory(Base):
    """One real phone number in stock. Country is auto-detected from the E.164 number (libphonenumber).

    Stock per country/product is derived by counting AVAILABLE rows — never stored as an independent counter.
    No Telegram auth codes or session files are stored here; this holds only the sellable phone number itself.
    """

    __tablename__ = "phone_inventory"
    __table_args__ = (
        UniqueConstraint("phone_e164", name="uq_phone_inventory_e164"),
        Index("ix_phone_inventory_product_status", "product_id", "status"),
        Index("ix_phone_inventory_country_status", "country_iso2", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    phone_e164: Mapped[str] = mapped_column(String(24), nullable=False)
    country_iso2: Mapped[str] = mapped_column(String(2), nullable=False)
    country_name: Mapped[str] = mapped_column(String(64), default="", server_default="", nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(10), default="AVAILABLE", server_default="AVAILABLE", nullable=False)
    reserved_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    sold_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    batch: Mapped[str | None] = mapped_column(String(64))
    added_by: Mapped[str] = mapped_column(String(64), default="", server_default="", nullable=False)
    note: Mapped[str] = mapped_column(String(255), default="", server_default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PhoneVerification(Base):
    """Scaffold for a future, authorised number-ownership confirmation flow (mock provider only for now).

    This never reads Telegram login codes or .session files. A real provider can be plugged in later only
    where a documented, authorised ownership-confirmation API exists.
    """

    __tablename__ = "phone_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False)
    phone_id: Mapped[int | None] = mapped_column(ForeignKey("phone_inventory.id", ondelete="SET NULL"))
    provider: Mapped[str] = mapped_column(String(32), default="mock", server_default="mock", nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="WAITING", server_default="WAITING", index=True, nullable=False)
    code_masked: Mapped[str | None] = mapped_column(String(32))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    events: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

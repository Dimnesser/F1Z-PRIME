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

    country: Mapped[Country | None] = relationship(back_populates="products", lazy="joined")


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

    user: Mapped[User] = relationship(back_populates="orders", lazy="joined")
    product: Mapped[Product | None] = relationship(lazy="joined")
    premium_number: Mapped[PremiumNumber | None] = relationship(lazy="joined")


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
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[AdminRole] = mapped_column(_enum(AdminRole, "admin_role"), default=AdminRole.support, nullable=False)
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

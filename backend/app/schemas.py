from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, PlainSerializer, field_validator

from app.models import OrderStatus, PaymentMethod, PremiumStatus, ProductStatus, TicketStatus

Money = Annotated[Decimal, PlainSerializer(lambda v: float(v), return_type=float, when_used="json")]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ public


class CountryOut(ORM):
    id: int
    code: str
    name: str
    flag: str
    dial_code: str
    sort_order: int
    is_active: bool


class CountryCatalogOut(CountryOut):
    product_id: int | None = None
    price: Money | None = None
    stock: int = 0


class ProductOut(ORM):
    id: int
    title: str
    description: str
    category: str
    # current price (the sale price while a sale is active); old_price is shown crossed out
    price: Money = Field(validation_alias=AliasChoices("price_now", "price"))
    old_price: Money | None = Field(default=None, validation_alias="price_old")
    stock: int
    is_popular: bool
    country: CountryOut | None = None
    tags: list[str] = []
    attributes: dict[str, str] = {}
    max_per_order: int | None = None


class PremiumNumberOut(ORM):
    id: int
    title: str
    tier: str
    display_mask: str
    description: str
    price: Money
    status: PremiumStatus
    country: CountryOut | None = None


class UserOut(ORM):
    id: int
    telegram_id: int
    username: str | None
    first_name: str | None
    last_name: str | None
    photo_url: str | None
    balance: Money
    total_spent: Money
    orders_count: int
    created_at: datetime


class TransactionOut(ORM):
    id: int
    type: str
    amount: Money
    balance_after: Money
    description: str
    order_id: int | None
    created_at: datetime


class PaymentOut(ORM):
    id: int
    kind: str
    method: str
    status: str
    amount: Money
    stars_amount: int | None
    is_test: bool
    order_id: int | None
    created_at: datetime
    confirmed_at: datetime | None


class OrderOut(ORM):
    id: int
    item_title: str
    quantity: int
    unit_price: Money
    total: Money
    status: OrderStatus
    payment_method: str | None
    delivery_data: str | None
    expires_at: datetime | None
    paid_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    product_id: int | None
    premium_number_id: int | None
    public_id: str | None = None
    fulfillment_status: str | None = None
    stage: str = ""
    discount: Money = Decimal("0")
    promo_code: str | None = None


class OrderDetailOut(OrderOut):
    payments: list[PaymentOut] = []
    delivery_note: str | None = None
    # decrypted inventory units (keys/vouchers) — only after the order is delivered
    delivered_items: list[str] = []
    support_ticket_id: int | None = None


class OrderCreate(BaseModel):
    product_id: int | None = Field(default=None, gt=0)
    premium_number_id: int | None = Field(default=None, gt=0)
    quantity: int = Field(default=1, ge=1, le=10)
    idempotency_key: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    promo_code: str | None = Field(default=None, max_length=32)


class PayRequest(BaseModel):
    method: PaymentMethod


class PayResponse(BaseModel):
    payment: PaymentOut
    order: OrderOut | None = None
    invoice_link: str | None = None
    instructions: str | None = None


class TopupRequest(BaseModel):
    amount: Decimal = Field(gt=0, le=1_000_000, decimal_places=2)
    method: PaymentMethod


class ManualSubmit(BaseModel):
    comment: str = Field(default="", max_length=500)


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=160)
    text: str = Field(min_length=2, max_length=4000)
    category: str = Field(default="general", pattern=r"^[a-z_]{2,32}$")


class OrderSupportCreate(BaseModel):
    category: str = Field(pattern=r"^[a-z_]{2,32}$")
    text: str = Field(default="", max_length=4000)


class MessageCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class SupportMessageOut(ORM):
    id: int
    is_admin: bool
    text: str
    created_at: datetime


class TicketOut(ORM):
    id: int
    subject: str
    status: TicketStatus
    created_at: datetime
    updated_at: datetime
    order_id: int | None = None
    category: str = "general"
    priority: str = "normal"


class TicketDetailOut(TicketOut):
    messages: list[SupportMessageOut]


# ------------------------------------------------------------------- admin


class AdminLogin(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class AdminUserOut(UserOut):
    is_blocked: bool
    language_code: str | None
    last_seen_at: datetime | None


class BalanceAdjust(BaseModel):
    amount: Decimal = Field(decimal_places=2)
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("amount")
    @classmethod
    def _non_zero(cls, v: Decimal) -> Decimal:
        if v == 0:
            raise ValueError("amount must not be zero")
        return v


class UserPatch(BaseModel):
    is_blocked: bool | None = None


class CountryIn(BaseModel):
    code: str = Field(min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    name: str = Field(min_length=2, max_length=64)
    flag: str = Field(min_length=1, max_length=16)
    dial_code: str = Field(pattern=r"^\+\d{1,4}$")
    sort_order: int = Field(default=100, ge=0, le=10000)
    is_active: bool = True

    @field_validator("code")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.upper()


class CountryPatch(BaseModel):
    code: str | None = Field(default=None, min_length=2, max_length=2, pattern=r"^[A-Za-z]{2}$")
    name: str | None = Field(default=None, min_length=2, max_length=64)
    flag: str | None = Field(default=None, min_length=1, max_length=16)
    dial_code: str | None = Field(default=None, pattern=r"^\+\d{1,4}$")
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class ProductIn(BaseModel):
    title: str = Field(min_length=2, max_length=128)
    description: str = Field(default="", max_length=4000)
    category: str = Field(default="numbers", min_length=2, max_length=32, pattern=r"^[a-z0-9_]+$")
    country_id: int | None = None
    price: Decimal = Field(gt=0, le=1_000_000, decimal_places=2)
    stock: int = Field(default=0, ge=0, le=1_000_000)
    status: ProductStatus = ProductStatus.active
    is_popular: bool = False
    sort_order: int = Field(default=100, ge=0, le=10000)
    delivery_note: str = Field(default="", max_length=4000)
    fulfillment_mode: Literal["auto", "manual", "review"] = "manual"
    uses_inventory: bool = False
    sale_price: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=2)
    sale_ends_at: datetime | None = None
    tags: list[Annotated[str, Field(min_length=1, max_length=32)]] = Field(default_factory=list, max_length=20)
    attributes: dict[str, Annotated[str, Field(max_length=200)]] = Field(default_factory=dict, max_length=30)
    available_from: datetime | None = None
    available_until: datetime | None = None
    max_per_order: int | None = Field(default=None, ge=1, le=10)
    max_per_user: int | None = Field(default=None, ge=1, le=10000)


class ProductPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=128)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, min_length=2, max_length=32, pattern=r"^[a-z0-9_]+$")
    country_id: int | None = None
    price: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=2)
    stock: int | None = Field(default=None, ge=0, le=1_000_000)
    status: ProductStatus | None = None
    is_popular: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    delivery_note: str | None = Field(default=None, max_length=4000)
    fulfillment_mode: Literal["auto", "manual", "review"] | None = None
    uses_inventory: bool | None = None
    stock_reason: str | None = Field(default=None, max_length=200)  # required when stock changes
    sale_price: Decimal | None = Field(default=None, gt=0, le=1_000_000, decimal_places=2)
    sale_ends_at: datetime | None = None
    tags: list[Annotated[str, Field(min_length=1, max_length=32)]] | None = Field(default=None, max_length=20)
    attributes: dict[str, Annotated[str, Field(max_length=200)]] | None = Field(default=None, max_length=30)
    available_from: datetime | None = None
    available_until: datetime | None = None
    max_per_order: int | None = Field(default=None, ge=1, le=10)
    max_per_user: int | None = Field(default=None, ge=1, le=10000)


class AdminProductOut(ProductOut):
    price: Money  # base price; the public price may be the sale price
    old_price: Money | None = None
    sale_price: Money | None = None
    sale_ends_at: datetime | None = None
    available_from: datetime | None = None
    available_until: datetime | None = None
    max_per_user: int | None = None
    status: ProductStatus
    fulfillment_mode: str = "manual"
    uses_inventory: bool = False
    sort_order: int
    country_id: int | None
    delivery_note: str
    created_at: datetime
    updated_at: datetime


class PremiumIn(BaseModel):
    country_id: int | None = None
    number: str = Field(min_length=5, max_length=32, pattern=r"^\+?[\d\s\-()]+$")
    display_mask: str | None = Field(default=None, max_length=64)
    tier: str = Field(default="premium", pattern=r"^(premium|gold|platinum|vip)$")
    title: str = Field(default="PREMIUM NUMBER", min_length=2, max_length=64)
    description: str = Field(default="", max_length=2000)
    price: Decimal = Field(gt=0, le=10_000_000, decimal_places=2)
    status: PremiumStatus = PremiumStatus.available


class PremiumPatch(BaseModel):
    country_id: int | None = None
    number: str | None = Field(default=None, min_length=5, max_length=32, pattern=r"^\+?[\d\s\-()]+$")
    display_mask: str | None = Field(default=None, max_length=64)
    tier: str | None = Field(default=None, pattern=r"^(premium|gold|platinum|vip)$")
    title: str | None = Field(default=None, min_length=2, max_length=64)
    description: str | None = Field(default=None, max_length=2000)
    price: Decimal | None = Field(default=None, gt=0, le=10_000_000, decimal_places=2)
    status: PremiumStatus | None = None


class AdminPremiumOut(PremiumNumberOut):
    number: str
    country_id: int | None
    created_at: datetime


class MaskPreviewIn(BaseModel):
    number: str = Field(min_length=3, max_length=32)
    dial_code: str = Field(default="", max_length=8)
    visible: str | None = Field(default=None, max_length=16)


class AdminOrderOut(OrderOut):
    user: UserOut
    admin_note: str | None
    idempotency_key: str


class OrderStatusChange(BaseModel):
    status: OrderStatus
    delivery_data: str | None = Field(default=None, max_length=4000)
    admin_note: str | None = Field(default=None, max_length=2000)


class AdminPaymentOut(PaymentOut):
    user: UserOut
    payload: str
    external_id: str | None
    user_comment: str | None
    admin_comment: str | None
    confirmed_by: str | None


class PaymentDecision(BaseModel):
    comment: str = Field(default="", max_length=500)


class AdminTicketOut(TicketOut):
    user: UserOut
    assigned_to: str | None = None


class AdminTicketDetailOut(AdminTicketOut):
    messages: list[SupportMessageOut]


class TicketStatusIn(BaseModel):
    status: TicketStatus


class SettingsUpdate(BaseModel):
    values: dict[str, Annotated[str, Field(max_length=4000)]]


class OrderEventOut(ORM):
    id: int
    from_status: str | None
    to_status: str
    actor: str
    note: str | None
    created_at: datetime


class ProductBulk(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    action: Literal["status", "price_set", "price_percent", "price_delta", "stock_set", "stock_delta", "category",
                    "sale_percent", "sale_clear", "tag_add", "tag_remove"]
    value: str = Field(max_length=64)


class ProductImport(BaseModel):
    csv: str = Field(min_length=1, max_length=2_000_000)
    dry_run: bool = False


class CategoryIn(BaseModel):
    slug: str = Field(min_length=2, max_length=32, pattern=r"^[a-z0-9_]+$")
    title: str = Field(min_length=2, max_length=64)
    icon: str = Field(default="box", pattern=r"^[a-z\-]{2,32}$")
    sort_order: int = Field(default=100, ge=0, le=10000)
    is_active: bool = True

    @field_validator("slug")
    @classmethod
    def _not_reserved(cls, v: str) -> str:
        if v == "premium":
            raise ValueError("slug 'premium' is reserved for premium numbers")
        return v


class CategoryPatch(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=64)
    icon: str | None = Field(default=None, pattern=r"^[a-z\-]{2,32}$")
    sort_order: int | None = Field(default=None, ge=0, le=10000)
    is_active: bool | None = None


class CategoryOut(ORM):
    id: int
    slug: str
    title: str
    icon: str
    sort_order: int
    is_active: bool


class AdminAccountIn(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=10, max_length=128)
    role: Literal["admin", "support"] = "support"
    telegram_id: int | None = Field(default=None, gt=0, lt=10**15)


class AdminAccountPatch(BaseModel):
    role: Literal["admin", "support"] | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=128)
    telegram_id: int | None = Field(default=None, ge=0, lt=10**15)  # 0 = unlink


class AdminAccountOut(ORM):
    id: int
    username: str
    role: str
    telegram_id: int | None = None
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime


class TicketAssign(BaseModel):
    assigned_to: str | None = Field(default=None, max_length=64)

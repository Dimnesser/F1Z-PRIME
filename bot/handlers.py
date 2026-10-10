from __future__ import annotations

import html
import logging

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    Message,
    PreCheckoutQuery,
    User as TgUser,
)
from sqlalchemy import func, select

from app.db import session_factory
from app.models import (
    Order,
    PaymentMethod,
    PremiumNumber,
    PremiumStatus,
    Product,
    ProductStatus,
    SupportMessage,
    SupportTicket,
    TicketStatus,
    User,
)
from app.security import TelegramUser
from app.services import fulfillment
from app.services import orders as order_service
from app.services import payments as payment_service
from app.services import telegram as tg_api
from app.services.common import ServiceError
from bot.keyboards import back, main_menu, menu_row, rows, webapp_button

log = logging.getLogger("f1z.bot")
router = Router(name="main")

WELCOME = (
    "🚀 <b>Добро пожаловать в F1Z PRIME!</b>\n\n"
    "Премиальный магазин цифровых товаров.\n\n"
    "🌍 Номера 8 стран · 💎 Красивые номера · ⚡ Быстрая выдача\n"
    "🔒 Оплата Telegram Stars и проверенные платежи\n\n"
    "Выберите раздел 👇"
)


class SupportForm(StatesGroup):
    waiting_text = State()


def _tg(u: TgUser) -> TelegramUser:
    return TelegramUser(
        id=u.id, first_name=u.first_name, last_name=u.last_name, username=u.username, language_code=u.language_code
    )


def esc(v: object) -> str:
    return html.escape(str(v))


def fmt_money(v: object) -> str:
    d = float(v)  # type: ignore[arg-type]
    return f"{d:,.0f}".replace(",", " ") if d == int(d) else f"{d:,.2f}".replace(",", " ")


async def _edit_or_send(event: Message | CallbackQuery, text: str, markup) -> None:
    if isinstance(event, CallbackQuery):
        await event.answer()
        if event.message is not None:
            try:
                await event.message.edit_text(text, reply_markup=markup)  # type: ignore[union-attr]
                return
            except Exception:  # noqa: BLE001 - message can be non-editable (e.g. old/invoice)
                pass
            await event.message.answer(text, reply_markup=markup)
        return
    await event.answer(text, reply_markup=markup)


# --------------------------------------------------------------- start/menu


@router.message(CommandStart())
async def cmd_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    if message.from_user:
        async with session_factory()() as session:
            await order_service.upsert_user(session, _tg(message.from_user))
            await session.commit()
    await message.answer(WELCOME, reply_markup=main_menu())


@router.message(Command("menu"))
@router.callback_query(F.data == "menu")
async def show_menu(event: Message | CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await _edit_or_send(event, WELCOME, main_menu())


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    await message.answer(
        "ℹ️ <b>Команды</b>\n/start — главное меню\n/catalog — каталог\n/premium — красивые номера\n"
        "/profile — профиль\n/orders — мои покупки\n/support — поддержка",
        reply_markup=rows(menu_row()),
    )


# ------------------------------------------------------------------ catalog


@router.message(Command("catalog"))
@router.callback_query(F.data == "catalog")
async def show_catalog(event: Message | CallbackQuery) -> None:
    async with session_factory()() as session:
        products = (
            await session.scalars(
                select(Product)
                .where(Product.status == ProductStatus.active)
                .order_by(Product.sort_order, Product.id)
                .limit(40)
            )
        ).all()
    if not products:
        await _edit_or_send(event, "🛍 Каталог пока пуст. Загляните позже!", rows(menu_row()))
        return
    lines = ["🛍 <b>Каталог F1Z PRIME</b>\n"]
    buttons = []
    for p in products:
        flag = p.country.flag if p.country else "📦"
        stock = f"{p.stock} шт." if p.stock else "нет в наличии"
        code = f" ({p.country.dial_code})" if p.country else ""
        lines.append(f"{flag} <b>{esc(p.title)}</b>{esc(code)} — {fmt_money(p.price)} грн · {stock}")
        buttons.append(
            [InlineKeyboardButton(text=f"{flag} {p.title} — {fmt_money(p.price)} грн", callback_data=f"product:{p.id}")]
        )
    await _edit_or_send(
        event, "\n".join(lines), rows(*buttons, [webapp_button("🚀 Открыть в магазине", "catalog")], menu_row())
    )


@router.callback_query(F.data.startswith("product:"))
async def show_product(cb: CallbackQuery) -> None:
    pid = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    async with session_factory()() as session:
        p = await session.get(Product, pid)
    if p is None or p.status != ProductStatus.active:
        await cb.answer("Товар недоступен", show_alert=True)
        return
    country = f"{p.country.flag} {esc(p.country.name)} ({esc(p.country.dial_code)})\n" if p.country else ""
    text = (
        f"<b>{esc(p.title)}</b>\n{country}\n{esc(p.description)}\n\n"
        f"💰 Цена: <b>{fmt_money(p.price)} грн</b>\n📦 В наличии: <b>{p.stock}</b>"
    )
    buy = []
    if p.stock > 0:
        buy = [
            InlineKeyboardButton(text="💳 Купить с баланса", callback_data=f"buy:p:{p.id}:balance"),
            InlineKeyboardButton(text="⭐ Telegram Stars", callback_data=f"buy:p:{p.id}:stars"),
        ]
    await _edit_or_send(
        cb, text, rows(buy, [webapp_button("🚀 Открыть в магазине", f"product/{p.id}")], back("catalog"), menu_row())
    )


# ------------------------------------------------------------------ premium


@router.message(Command("premium"))
@router.callback_query(F.data == "premium")
async def show_premium(event: Message | CallbackQuery) -> None:
    async with session_factory()() as session:
        items = (
            await session.scalars(
                select(PremiumNumber)
                .where(PremiumNumber.status == PremiumStatus.available)
                .order_by(PremiumNumber.price.desc())
                .limit(30)
            )
        ).all()
    if not items:
        await _edit_or_send(event, "💎 Красивых номеров сейчас нет в наличии.", rows(menu_row()))
        return
    lines = ["💎 <b>Красивые номера</b>\n"]
    buttons = []
    for n in items:
        flag = n.country.flag if n.country else "🌐"
        lines.append(f"{flag} <code>{esc(n.display_mask)}</code> — {fmt_money(n.price)} грн · {esc(n.tier.upper())}")
        buttons.append(
            [InlineKeyboardButton(text=f"{flag} {n.display_mask} — {fmt_money(n.price)} грн", callback_data=f"pn:{n.id}")]
        )
    await _edit_or_send(
        event, "\n".join(lines), rows(*buttons, [webapp_button("🚀 Открыть в магазине", "numbers")], menu_row())
    )


@router.callback_query(F.data.startswith("pn:"))
async def show_premium_number(cb: CallbackQuery) -> None:
    nid = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    async with session_factory()() as session:
        n = await session.get(PremiumNumber, nid)
    if n is None or n.status != PremiumStatus.available:
        await cb.answer("Номер уже недоступен", show_alert=True)
        return
    flag = n.country.flag if n.country else "🌐"
    text = (
        f"💎 <b>{esc(n.title)}</b>\n\n{flag} <code>{esc(n.display_mask)}</code>\n"
        f"💰 <b>{fmt_money(n.price)} грн</b>\n📦 В наличии\n\n{esc(n.description)}"
    )
    await _edit_or_send(
        cb,
        text,
        rows(
            [
                InlineKeyboardButton(text="💳 Купить с баланса", callback_data=f"buy:n:{n.id}:balance"),
                InlineKeyboardButton(text="⭐ Telegram Stars", callback_data=f"buy:n:{n.id}:stars"),
            ],
            back("premium"),
            menu_row(),
        ),
    )


# --------------------------------------------------------------------- buy


@router.callback_query(F.data.startswith("buy:"))
async def buy(cb: CallbackQuery) -> None:
    _, kind, raw_id, method_raw = cb.data.split(":")  # type: ignore[union-attr]
    item_id = int(raw_id)
    method = PaymentMethod(method_raw)
    if method not in (PaymentMethod.balance, PaymentMethod.stars):
        await cb.answer("Способ оплаты недоступен", show_alert=True)
        return
    msg_id = cb.message.message_id if cb.message else 0
    key = f"bot_{cb.from_user.id}_{msg_id}_{kind}{item_id}_{method.value}"
    async with session_factory()() as session:
        try:
            user = await order_service.upsert_user(session, _tg(cb.from_user))
            order, _created = await order_service.create_order(
                session,
                user,
                idempotency_key=key[:64],
                product_id=item_id if kind == "p" else None,
                premium_number_id=item_id if kind == "n" else None,
            )
            result = await payment_service.start_order_payment(session, user, order.id, method)
            await session.commit()
        except ServiceError as exc:
            await session.rollback()
            await cb.answer(exc.message, show_alert=True)
            return
        order = await session.get(Order, order.id, populate_existing=True)  # type: ignore[assignment]
    if method == PaymentMethod.stars and result.invoice_link:
        await _edit_or_send(
            cb,
            f"🧾 <b>Заказ #{order.id}</b>\n{esc(order.item_title)}\n\n"
            f"Сумма: <b>{fmt_money(order.total)} грн</b> = ⭐ <b>{result.payment.stars_amount}</b>\n"
            "Нажмите кнопку ниже, чтобы оплатить. Заказ резервируется на 30 минут.",
            rows(
                [InlineKeyboardButton(text=f"⭐ Оплатить {result.payment.stars_amount} Stars", url=result.invoice_link)],
                [InlineKeyboardButton(text="📦 Мои покупки", callback_data="orders")],
                menu_row(),
            ),
        )
        return
    if order.status.value == "paid":
        await fulfillment.run_now(order.id)  # instant delivery; the worker job is the durable fallback
        async with session_factory()() as session:
            order = await session.get(Order, order.id) or order  # type: ignore[assignment]
    await _edit_or_send(cb, _order_text(order, paid_now=True), rows([_orders_btn()], menu_row()))


def _orders_btn() -> InlineKeyboardButton:
    return InlineKeyboardButton(text="📦 Мои покупки", callback_data="orders")


def _order_text(order: Order, paid_now: bool = False) -> str:
    head = "✅ <b>Оплата прошла успешно!</b>\n\n" if paid_now else ""
    text = (
        f"{head}🧾 <b>Заказ {order.public_id or f'#{order.id}'}</b>\n{esc(order.item_title)} × {order.quantity}\n"
        f"Сумма: <b>{fmt_money(order.total)} грн</b>\n"
        f"Статус: <b>{order_service.STATUS_LABELS[order.status]}</b>\n"
        f"Дата: {order.created_at:%d.%m.%Y %H:%M}"
    )
    if order.delivery_data:
        text += f"\n\n📬 <b>Выдача:</b>\n<code>{esc(order.delivery_data)}</code>"
    return text


# ----------------------------------------------------------------- profile


async def _get_user(tg_user: TgUser) -> User:
    async with session_factory()() as session:
        user = await order_service.upsert_user(session, _tg(tg_user))
        await session.commit()
        return user


@router.message(Command("profile"))
@router.callback_query(F.data == "profile")
async def show_profile(event: Message | CallbackQuery) -> None:
    if event.from_user is None:
        return
    user = await _get_user(event.from_user)
    text = (
        "👤 <b>Профиль</b>\n\n"
        f"🆔 Telegram ID: <code>{user.telegram_id}</code>\n"
        f"👋 Имя: {esc(user.first_name or '-')}\n"
        f"🔗 Username: @{esc(user.username or '-')}\n"
        f"📅 С нами с: {user.created_at:%d.%m.%Y}\n\n"
        f"💳 Баланс: <b>{fmt_money(user.balance)} грн</b>\n"
        f"🛒 Покупок: <b>{user.orders_count}</b> на {fmt_money(user.total_spent)} грн"
    )
    await _edit_or_send(
        event,
        text,
        rows(
            [InlineKeyboardButton(text="➕ Пополнить баланс (Stars)", callback_data="topup")],
            [webapp_button("🚀 Профиль в магазине", "profile")],
            menu_row(),
        ),
    )


@router.callback_query(F.data == "topup")
async def topup_menu(cb: CallbackQuery) -> None:
    amounts = [100, 250, 500, 1000]
    await _edit_or_send(
        cb,
        "➕ <b>Пополнение баланса через Telegram Stars</b>\n\nВыберите сумму:",
        rows(
            [InlineKeyboardButton(text=f"{a} грн", callback_data=f"topup:{a}") for a in amounts[:2]],
            [InlineKeyboardButton(text=f"{a} грн", callback_data=f"topup:{a}") for a in amounts[2:]],
            back("profile"),
        ),
    )


@router.callback_query(F.data.startswith("topup:"))
async def topup_amount(cb: CallbackQuery) -> None:
    amount = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    if amount not in (100, 250, 500, 1000):
        await cb.answer("Неверная сумма", show_alert=True)
        return
    async with session_factory()() as session:
        try:
            user = await order_service.upsert_user(session, _tg(cb.from_user))
            result = await payment_service.start_topup(session, user, amount, PaymentMethod.stars)  # type: ignore[arg-type]
            await session.commit()
        except ServiceError as exc:
            await session.rollback()
            await cb.answer(exc.message, show_alert=True)
            return
    await _edit_or_send(
        cb,
        f"🧾 Пополнение на <b>{amount} грн</b> = ⭐ <b>{result.payment.stars_amount}</b>",
        rows(
            [InlineKeyboardButton(text=f"⭐ Оплатить {result.payment.stars_amount} Stars", url=result.invoice_link or "")],
            back("profile"),
        ),
    )


# ------------------------------------------------------------------ orders


@router.message(Command("orders"))
@router.callback_query(F.data == "orders")
async def show_orders(event: Message | CallbackQuery) -> None:
    if event.from_user is None:
        return
    user = await _get_user(event.from_user)
    async with session_factory()() as session:
        orders = (
            await session.scalars(select(Order).where(Order.user_id == user.id).order_by(Order.id.desc()).limit(10))
        ).unique().all()
    if not orders:
        await _edit_or_send(
            event, "📦 У вас пока нет покупок.", rows([InlineKeyboardButton(text="🛍 Каталог", callback_data="catalog")], menu_row())
        )
        return
    lines = ["📦 <b>Мои покупки</b>\n"]
    buttons = []
    for o in orders:
        status = order_service.STATUS_LABELS[o.status]
        lines.append(f"#{o.id} · {esc(o.item_title)} · {fmt_money(o.total)} грн · <i>{status}</i>")
        buttons.append([InlineKeyboardButton(text=f"#{o.id} · {status}", callback_data=f"order:{o.id}")])
    await _edit_or_send(event, "\n".join(lines), rows(*buttons, menu_row()))


@router.callback_query(F.data.startswith("order:"))
async def show_order(cb: CallbackQuery) -> None:
    oid = int(cb.data.split(":")[1])  # type: ignore[union-attr]
    user = await _get_user(cb.from_user)
    async with session_factory()() as session:
        order = await session.get(Order, oid)
    if order is None or order.user_id != user.id:
        await cb.answer("Заказ не найден", show_alert=True)
        return
    await _edit_or_send(cb, _order_text(order), rows(back("orders"), menu_row()))


# ----------------------------------------------------------------- support


@router.message(Command("support"))
@router.callback_query(F.data == "support")
async def show_support(event: Message | CallbackQuery) -> None:
    if event.from_user is None:
        return
    user = await _get_user(event.from_user)
    async with session_factory()() as session:
        tickets = (
            await session.scalars(
                select(SupportTicket).where(SupportTicket.user_id == user.id).order_by(SupportTicket.id.desc()).limit(5)
            )
        ).unique().all()
    labels = {TicketStatus.open: "🟡 открыто", TicketStatus.answered: "🟢 есть ответ", TicketStatus.closed: "⚪ закрыто"}
    lines = ["🆘 <b>Поддержка F1Z PRIME</b>\n", "Опишите проблему — администратор ответит прямо в этот чат."]
    if tickets:
        lines.append("\n<b>Ваши обращения:</b>")
        lines += [f"#{t.id} {esc(t.subject)} — {labels[t.status]}" for t in tickets]
    await _edit_or_send(
        event,
        "\n".join(lines),
        rows(
            [InlineKeyboardButton(text="✍️ Написать в поддержку", callback_data="ticket:new")],
            [webapp_button("🚀 Обращения в магазине", "support")],
            menu_row(),
        ),
    )


@router.callback_query(F.data == "ticket:new")
async def ticket_new(cb: CallbackQuery, state: FSMContext) -> None:
    await state.set_state(SupportForm.waiting_text)
    await _edit_or_send(
        cb, "✍️ Напишите ваше сообщение одним текстом (до 4000 символов).", rows(back("support", "✖️ Отмена"))
    )


@router.message(SupportForm.waiting_text, F.text)
async def ticket_text(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if len(text) < 2:
        await message.answer("Сообщение слишком короткое, попробуйте ещё раз.")
        return
    await state.clear()
    user = await _get_user(message.from_user)  # type: ignore[arg-type]
    async with session_factory()() as session:
        open_count = await session.scalar(
            select(func.count(SupportTicket.id)).where(
                SupportTicket.user_id == user.id, SupportTicket.status != TicketStatus.closed
            )
        )
        if (open_count or 0) >= 5:
            await message.answer("У вас слишком много открытых обращений. Дождитесь ответа.", reply_markup=rows(menu_row()))
            return
        subject = text.split("\n")[0][:60]
        ticket = SupportTicket(user_id=user.id, subject=subject if len(subject) >= 3 else "Обращение из бота")
        ticket.messages.append(SupportMessage(is_admin=False, text=text[:4000]))
        session.add(ticket)
        await session.commit()
        ticket_id = ticket.id
    await message.answer(
        f"✅ Обращение #{ticket_id} создано. Мы ответим в ближайшее время!", reply_markup=rows(menu_row())
    )
    await tg_api.notify_admins(f"🆘 Новое обращение #{ticket_id} (бот) от {user.telegram_id}:\n{esc(text[:500])}", kind="tickets")


# ---------------------------------------------------------- Telegram Stars


@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery) -> None:
    async with session_factory()() as session:
        error = await payment_service.validate_precheckout(
            session, query.invoice_payload, query.total_amount, query.currency, query.from_user.id
        )
    if error:
        await query.answer(ok=False, error_message=error)
    else:
        await query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message) -> None:
    sp = message.successful_payment
    assert sp is not None and message.from_user is not None
    async with session_factory()() as session:
        payment, new = await payment_service.process_stars_payment(
            session, sp.invoice_payload, sp.telegram_payment_charge_id, sp.total_amount, sp.currency, message.from_user.id
        )
        await session.commit()
        order = await session.get(Order, payment.order_id, populate_existing=True) if payment and payment.order_id else None
    if payment is None:
        await message.answer("⚠️ Платёж получен, но не найден счёт. Напишите в поддержку — мы всё проверим.")
        return
    if not new:
        if payment.status.value != "confirmed":
            await message.answer("⚠️ Платёж требует проверки администратором. Мы свяжемся с вами.")
        return
    if order is not None:
        if order.status.value == "paid":
            await fulfillment.run_now(order.id)
            async with session_factory()() as session:
                order = await session.get(Order, order.id) or order
        await message.answer(_order_text(order, paid_now=True), reply_markup=rows([_orders_btn()], menu_row()))
    else:
        await message.answer(
            f"✅ Баланс пополнен на <b>{fmt_money(payment.amount)} грн</b>", reply_markup=rows(menu_row())
        )
    if order is None:  # sales are announced by the order pipeline (staff_new_sale); top-ups here
        await tg_api.notify_admins(f"⭐ Пополнение Stars #{payment.id}: {payment.amount} грн ({payment.stars_amount} XTR)", kind="payments")


@router.message()
async def fallback(message: Message) -> None:
    await message.answer("Не понял команду 🤔 Воспользуйтесь меню:", reply_markup=main_menu())

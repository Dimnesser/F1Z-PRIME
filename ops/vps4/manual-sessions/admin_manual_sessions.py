"""Manual .session uploads for «Рандом аккаунт 2015–2019» and for premium numbers.

These sessions never enter the «номер + код» phone stock: they are recorded in `manual_sessions`, which the
periodic stock scanner skips. Each upload is verified online (authorized, sole device, owner's phone) first.

* Accounts: the session becomes an encrypted account unit of the accounts product; the product is switched to
  automatic account delivery, so after payment the bot sends the number, .session, 2FA and a «Получить код» button.
* Premium numbers: the session is bound to one premium number (phones must match). An operator sends it to the
  buyer from the order card («Выдать аккаунт»), which also completes the order.

The 2FA password travels in the `X-Account-2FA` header (URL-encoded), never in the URL, so it stays out of access
logs; it is stored only encrypted.
"""
from __future__ import annotations

import html
import json
from urllib.parse import unquote

from fastapi import Header
from sqlalchemy import select

from app.api.admin_files import (
    FORMAT_EXTENSIONS, ClientDisconnect, Path, Query, Request, SessionDep, UploadFormat, _storage_error, asyncio,
    get_settings, lock_filename, log, log_admin, router, staged_file, validate_filename, validate_size,
)
from app.api.deps import perm as P
from app.models import ManualSession, Order, OrderStatus, PremiumNumber, PremiumStatus, Product, SessionAccount
from app.services import account_delivery, crypto, inventory, telegram
from app.services.common import ServiceError, lock, utcnow

SESSION_FORMATS = (UploadFormat.telethon, UploadFormat.pyrogram)
ACCOUNT_DESCRIPTION = (
    "Telegram-аккаунт с датой регистрации 2015–2019 (случайный). Сразу после подтверждения оплаты бот пришлёт "
    "номер, файл .session и пароль 2FA (если он есть), а кнопка «Получить код» покажет код входа."
)
ACCOUNT_NOTE = "После оплаты бот автоматически пришлёт данные аккаунта в личный чат."


def _two_fa(raw: str | None) -> str | None:
    if not raw:
        return None
    value = unquote(raw).strip()
    if not value:
        return None
    if len(value) > 128 or any(ord(c) < 32 for c in value):
        raise ServiceError("Некорректный пароль 2FA (до 128 символов, без управляющих символов).", 422, "two_fa_invalid")
    return value


def _mask(phone: str) -> str:
    return phone[:-4] + "****" if len(phone) > 6 else "****"


async def _receive(request: Request, session, filename: str, fmt: UploadFormat) -> tuple[str, Path]:  # noqa: ANN001
    """Stream the body into the sessions directory (same limits as /files/upload); returns name and path."""
    if fmt not in SESSION_FORMATS:
        raise ServiceError("Загрузите файл .session (Telethon или Pyrogram).", 422, "session_format")
    name = validate_filename(filename, FORMAT_EXTENSIONS[fmt])
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/octet-stream":
        raise ServiceError("Отправьте содержимое файла с Content-Type: application/octet-stream.", 415)
    await lock_filename(session, name)
    size = 0
    try:
        with staged_file(Path(get_settings().sessions_dir), name) as (temporary, _):
            async for chunk in request.stream():
                if not chunk:
                    continue
                size += len(chunk)
                validate_size(size)
                await asyncio.to_thread(temporary.write, chunk)
            validate_size(size)
    except ClientDisconnect as exc:
        raise ServiceError("Соединение прервано. Повторите загрузку.", 400, "upload_disconnected") from exc
    except OSError as exc:
        log.warning("Manual session storage failure (%s, errno=%s)", type(exc).__name__, exc.errno)
        raise _storage_error(exc) from exc
    return name, Path(get_settings().sessions_dir) / name


async def _verify(session, name: str, fmt: UploadFormat) -> dict:  # noqa: ANN001
    from app.services import session_registry

    await asyncio.to_thread(session_registry.normalize_session, name, fmt.value)
    account, _key = await session_registry.verify_identity(name)
    phone = account["phone_e164"]
    if await session.scalar(select(SessionAccount.id).where(SessionAccount.phone_e164 == phone,
                                                            SessionAccount.retired_at.is_(None))):
        raise ServiceError("Этот номер уже продаётся как «номер + код». Сначала уберите его оттуда.", 409,
                           "session_in_phone_stock")
    if await session.scalar(select(ManualSession.id).where(ManualSession.phone_e164 == phone)):
        raise ServiceError("Сессия этого аккаунта уже загружена.", 409, "manual_session_exists")
    return account


async def _accounts_product(session) -> Product:  # noqa: ANN001
    product = await session.scalar(select(Product).where(Product.category == "accounts")
                                   .order_by(Product.id).limit(1).with_for_update())
    if product is None:
        raise ServiceError("Товар «Рандом аккаунт 2015–2019» не найден.", 404, "accounts_product_missing")
    if product.uses_phone_inventory:
        raise ServiceError("Товар аккаунтов привязан к складу номеров. Проверьте его настройки.", 409)
    if not (account_delivery.enabled(product) and product.uses_inventory and product.fulfillment_mode == "auto"):
        # Switch the manual product to automatic account delivery; stock becomes the count of real units.
        product.uses_inventory = True
        product.fulfillment_mode = "auto"
        product.attributes = {**(product.attributes or {}), "delivery_kind": account_delivery.KIND}
        if "не передаёт данные входа" in (product.description or ""):
            product.description = ACCOUNT_DESCRIPTION
        product.delivery_note = ACCOUNT_NOTE
        product.stock = await inventory.available_count(session, product.id)
    return product


@router.post("/manual-sessions/accounts", status_code=201)
async def upload_account_session(
    request: Request, admin: P("products.stock"), session: SessionDep,
    filename: str = Query(...), format: UploadFormat = Query(UploadFormat.telethon),
    two_fa: str | None = Header(default=None, alias="X-Account-2FA"),
) -> dict:
    password = _two_fa(two_fa)
    name, path = await _receive(request, session, filename, format)
    try:
        account = await _verify(session, name, format)
        product = await _accounts_product(session)
        unit = {"phone": account["phone_e164"], "session_file": name}
        if password:
            unit["two_fa"] = password
        result = await inventory.add_units(session, product, [json.dumps(unit, ensure_ascii=False)],
                                           actor=str(admin), batch="manual-session")
        if result["added"] != 1:
            if result["duplicates"]:
                raise ServiceError("Этот аккаунт уже есть на складе.", 409, "account_duplicate")
            raise ServiceError("Не удалось добавить аккаунт: проверьте файл и имя .session.", 422, "account_data_invalid")
        session.add(ManualSession(filename=name, purpose="account", phone_e164=account["phone_e164"],
                                  product_id=product.id, added_by=str(admin.key)[:128]))
        log_admin(session, str(admin), "manual_session_upload", "product", product.id, filename=name, purpose="account")
        await session.commit()
    except BaseException:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise
    return {"filename": name, "phone": _mask(account["phone_e164"]), "country": account.get("country_name"),
            "two_fa": bool(password), "stock": product.stock, "product_id": product.id}


@router.post("/premium-numbers/{number_id}/session", status_code=201)
async def upload_premium_session(
    number_id: int, request: Request, admin: P("products.edit"), session: SessionDep,
    filename: str = Query(...), format: UploadFormat = Query(UploadFormat.telethon),
    two_fa: str | None = Header(default=None, alias="X-Account-2FA"),
) -> dict:
    password = _two_fa(two_fa)
    number = await lock(session, PremiumNumber, number_id)
    if number is None:
        raise ServiceError("Номер не найден.", 404)
    if number.status == PremiumStatus.sold:
        raise ServiceError("Номер уже продан.", 409, "premium_sold")
    if await session.scalar(select(ManualSession.id).where(ManualSession.premium_number_id == number_id)):
        raise ServiceError("К номеру уже привязана сессия. Удалите её, чтобы загрузить другую.", 409, "premium_session_exists")
    name, path = await _receive(request, session, filename, format)
    try:
        account = await _verify(session, name, format)
        if account["phone_e164"] != number.number:
            raise ServiceError("Сессия принадлежит другому номеру, а не этому красивому номеру.", 422, "premium_phone_mismatch")
        session.add(ManualSession(filename=name, purpose="premium", phone_e164=account["phone_e164"],
                                  premium_number_id=number.id, two_fa_enc=crypto.encrypt(password) if password else None,
                                  added_by=str(admin.key)[:128]))
        log_admin(session, str(admin), "manual_session_upload", "premium_number", number.id, filename=name, purpose="premium")
        await session.commit()
    except BaseException:
        await session.rollback()
        path.unlink(missing_ok=True)
        raise
    return {"filename": name, "premium_number_id": number.id, "two_fa": bool(password)}


def _premium_view(row: ManualSession) -> dict:
    return {"premium_number_id": row.premium_number_id, "filename": row.filename, "two_fa": bool(row.two_fa_enc),
            "delivered_order_id": row.delivered_order_id,
            "delivered_at": row.delivered_at.isoformat() if row.delivered_at else None,
            "created_at": row.created_at.isoformat() if row.created_at else None}


@router.get("/premium-sessions")
async def list_premium_sessions(admin: P("products.view"), session: SessionDep) -> list[dict]:
    rows = (await session.scalars(select(ManualSession).where(ManualSession.purpose == "premium")
                                  .order_by(ManualSession.id))).all()
    return [_premium_view(r) for r in rows]


@router.delete("/premium-numbers/{number_id}/session")
async def delete_premium_session(number_id: int, admin: P("products.edit"), session: SessionDep) -> dict:
    row = await session.scalar(select(ManualSession).where(ManualSession.premium_number_id == number_id)
                               .with_for_update())
    if row is None:
        raise ServiceError("К номеру не привязана сессия.", 404)
    if row.delivered_at:
        raise ServiceError("Сессия уже выдана покупателю и не удаляется.", 409, "premium_session_delivered")
    await lock_filename(session, row.filename)
    filename = row.filename
    await session.delete(row)
    log_admin(session, str(admin), "manual_session_delete", "premium_number", number_id, filename=filename)
    await session.commit()
    (Path(get_settings().sessions_dir) / validate_filename(filename)).unlink(missing_ok=True)
    return {"status": "deleted"}


@router.get("/orders/{order_id}/premium-account")
async def premium_account_state(order_id: int, admin: P("orders.view"), session: SessionDep) -> dict:
    order = await session.get(Order, order_id)
    if order is None or not order.premium_number_id:
        return {"available": False}
    row = await session.scalar(select(ManualSession).where(ManualSession.premium_number_id == order.premium_number_id))
    if row is None:
        return {"available": False}
    return {"available": True, **_premium_view(row),
            "can_send": order.status in (OrderStatus.paid, OrderStatus.processing, OrderStatus.completed)}


@router.post("/orders/{order_id}/premium-account")
async def send_premium_account(order_id: int, admin: P("orders.fulfill"), session: SessionDep) -> dict:
    from app.services import orders as order_service
    from app.services.session_downloads import session_path

    order = await lock(session, Order, order_id)
    if order is None or not order.premium_number_id:
        raise ServiceError("Заказ красивого номера не найден.", 404)
    if order.status not in (OrderStatus.paid, OrderStatus.processing, OrderStatus.completed):
        raise ServiceError("Аккаунт выдаётся только по оплаченному заказу.", 409, "order_not_paid")
    row = await session.scalar(select(ManualSession).where(ManualSession.premium_number_id == order.premium_number_id)
                               .with_for_update())
    if row is None:
        raise ServiceError("К этому номеру не загружена сессия.", 404, "premium_session_missing")
    if row.delivered_order_id not in (None, order.id):
        raise ServiceError("Эта сессия уже выдана по другому заказу.", 409, "premium_session_delivered")
    number = await session.get(PremiumNumber, order.premium_number_id)
    await lock_filename(session, row.filename)
    path = session_path(row.filename)
    chat_id = order.user.telegram_id
    password = crypto.decrypt(row.two_fa_enc) if row.two_fa_enc else None
    text = (f"🎁 <b>Ваш красивый номер · {html.escape(order.public_id or str(order.id))}</b>\n"
            f"{html.escape(order.item_title)}\n\n📱 Номер: <code>{html.escape(number.number if number else row.phone_e164)}</code>\n")
    if password:
        text += f"🔐 Пароль 2FA: <code>{html.escape(password)}</code>\n"
    text += ("\nФайл .session отправлен отдельным сообщением (клиенты с поддержкой Telethon). "
             "Храните файл и пароль в надёжном месте и проверьте активные сеансы после входа.")
    try:
        await telegram.send_document(chat_id, path, caption=f"{order.public_id or order.id} · Сессия")
        await telegram.call("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                                            "protect_content": True, "disable_web_page_preview": True}, timeout=15)
    except telegram.TelegramError:
        raise ServiceError("Telegram не принял сообщение: покупатель мог заблокировать бота. Повторите позже.", 502,
                           "premium_send_failed") from None
    row.delivered_order_id, row.delivered_at = order.id, utcnow()
    log_admin(session, str(admin), "premium_account_sent", "order", order.id)
    completed = order.status == OrderStatus.completed
    if not completed:
        await order_service.change_status(session, order.id, OrderStatus.completed,
                                          delivery_data=number.number if number else None, admin_note=None,
                                          actor=f"admin:{admin}")
    await session.commit()
    return {"status": "sent", "completed": True}

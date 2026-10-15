"""Where a session created by the sign-in wizard goes: phone stock (default), the accounts product, or one premium number.

Account / premium sessions are recorded in `manual_sessions` (never phone stock) exactly like manual uploads, and are
audited as `session_created_target` so the «register existing» recovery never moves them into phone stock.

`premium_new` adds a brand-new number to the premium-numbers base together with its session (premium base, like the
accounts base): the number row is only created once the session exists and no other device is logged in.
"""
from __future__ import annotations

import json
import re
from decimal import Decimal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from app.models import Country, ManualSession, PremiumNumber, PremiumStatus, Product, SessionAccount
from app.services import crypto, inventory, masks
from app.services.common import ServiceError, lock, log_admin
from app.services.file_storage import lock_filename

KINDS = ('stock', 'account', 'premium', 'premium_new')
PERMISSION = {'account': 'products.stock', 'premium': 'products.edit', 'premium_new': 'products.edit'}


class PremiumNew(BaseModel):
    price: Decimal = Field(gt=0, le=10_000_000, decimal_places=2)
    tier: str = Field(default='premium', pattern=r'^(premium|gold|platinum|vip)$')
    title: str = Field(default='PREMIUM NUMBER', min_length=1, max_length=64)
    display_mask: str | None = Field(default=None, max_length=64)
    description: str = Field(default='', max_length=2000)
    status: str = Field(default='available', pattern=r'^(available|hidden)$')


def _premium_new(data: dict | None) -> PremiumNew:
    try:
        item = PremiumNew.model_validate(data or {})
    except ValidationError:
        raise ServiceError('Укажите цену (больше 0) и уровень нового красивого номера.', 422, 'premium_new_invalid') from None
    if item.display_mask and item.display_mask.strip():
        item.display_mask = item.display_mask.strip()
        if not masks.validate_mask(item.display_mask):
            raise ServiceError('Маска должна скрывать минимум 2 цифры символами * и содержать только +, цифры, пробелы.',
                               422, 'premium_mask_invalid')
    else:
        item.display_mask = None
    return item


async def _premium_number_free(session, phone: str) -> None:  # noqa: ANN001
    if await session.scalar(select(PremiumNumber.id).where(PremiumNumber.number == '+' + _digits(phone))):
        raise ServiceError('Этот номер уже есть в базе красивых номеров — выберите его в списке.', 409,
                           'premium_number_exists')


def _digits(phone: str) -> str:
    return re.sub(r'[^0-9]', '', phone or '')


def _allowed(admin, kind: str) -> None:  # noqa: ANN001
    need = PERMISSION.get(kind)
    if need and not admin.can(need):
        raise ServiceError('Недостаточно прав для этого раздела.', 403, 'target_forbidden')


async def _phone_free(session, phone: str) -> None:  # noqa: ANN001
    phone = '+' + _digits(phone)
    if await session.scalar(select(ManualSession.id).where(ManualSession.phone_e164 == phone)):
        raise ServiceError('Сессия этого аккаунта уже загружена.', 409, 'manual_session_exists')
    if await session.scalar(select(SessionAccount.id).where(SessionAccount.phone_e164 == phone,
                                                            SessionAccount.retired_at.is_(None))):
        raise ServiceError('Этот номер уже продаётся как «номер + код». Сначала уберите его оттуда.', 409,
                           'session_in_phone_stock')


async def _premium(session, number_id: int | None, phone: str, *, for_update: bool) -> PremiumNumber:  # noqa: ANN001
    if not number_id:
        raise ServiceError('Выберите красивый номер.', 422, 'premium_number_required')
    number = await (lock(session, PremiumNumber, number_id) if for_update else session.get(PremiumNumber, number_id))
    if number is None:
        raise ServiceError('Номер не найден.', 404)
    if number.status == PremiumStatus.sold:
        raise ServiceError('Номер уже продан.', 409, 'premium_sold')
    if await session.scalar(select(ManualSession.id).where(ManualSession.premium_number_id == number.id)):
        raise ServiceError('К номеру уже привязана сессия. Удалите её, чтобы создать новую.', 409, 'premium_session_exists')
    if _digits(phone) != _digits(number.number):
        raise ServiceError('Номер входа не совпадает с выбранным красивым номером.', 422, 'premium_phone_mismatch')
    return number


async def check(session, admin, kind: str, premium_number_id: int | None, phone: str,  # noqa: ANN001
                premium_new: dict | None = None) -> dict:
    """Validate the destination before a login code is requested."""
    if kind not in KINDS:
        raise ServiceError('Неизвестный раздел для сессии.', 422)
    _allowed(admin, kind)
    if kind == 'stock':
        return {'kind': 'stock'}
    await _phone_free(session, phone)
    if kind == 'account':
        if await session.scalar(select(Product.id).where(Product.category == 'accounts').limit(1)) is None:
            raise ServiceError('Товар «Рандом аккаунт 2015–2019» не найден.', 404, 'accounts_product_missing')
        return {'kind': 'account'}
    if kind == 'premium_new':
        item = _premium_new(premium_new)
        await _premium_number_free(session, phone)
        return {'kind': 'premium_new', 'premium': item.model_dump(mode='json')}
    number = await _premium(session, premium_number_id, phone, for_update=False)
    return {'kind': 'premium', 'premium_number_id': number.id}


async def register(session, admin, target: dict, filename: str, account: dict, two_fa: str | None) -> dict:  # noqa: ANN001
    """Record a freshly created, device-checked session in its destination (caller commits)."""
    from app.api.admin_manual_sessions import _accounts_product

    kind = target.get('kind')
    _allowed(admin, kind)
    await lock_filename(session, filename)
    phone = account['phone_e164']
    await _phone_free(session, phone)
    if kind == 'account':
        product = await _accounts_product(session)
        unit = {'phone': phone, 'session_file': filename}
        if two_fa:
            unit['two_fa'] = two_fa
        added = await inventory.add_units(session, product, [json.dumps(unit, ensure_ascii=False)],
                                          actor=str(admin), batch='session-wizard')
        if added['added'] != 1:
            raise ServiceError('Этот аккаунт уже есть на складе.', 409, 'account_duplicate')
        session.add(ManualSession(filename=filename, purpose='account', phone_e164=phone, product_id=product.id,
                                  added_by=str(admin.key)[:128]))
        log_admin(session, str(admin), 'session_created_target', 'product', product.id, filename=filename, purpose='account')
        return {'kind': 'account', 'stock': product.stock, 'two_fa': bool(two_fa)}
    if kind == 'premium':
        number = await _premium(session, target.get('premium_number_id'), phone, for_update=True)
        session.add(ManualSession(filename=filename, purpose='premium', phone_e164=phone, premium_number_id=number.id,
                                  two_fa_enc=crypto.encrypt(two_fa) if two_fa else None, added_by=str(admin.key)[:128]))
        log_admin(session, str(admin), 'session_created_target', 'premium_number', number.id, filename=filename,
                  purpose='premium')
        return {'kind': 'premium', 'premium_number_id': number.id, 'two_fa': bool(two_fa)}
    if kind == 'premium_new':
        item = _premium_new(target.get('premium'))
        number = '+' + _digits(phone)
        await _premium_number_free(session, number)
        country = await session.scalar(select(Country).where(Country.code == account.get('country_iso2'))) \
            if account.get('country_iso2') else None
        row = PremiumNumber(number=number, country_id=country.id if country else None,
                            display_mask=item.display_mask or masks.auto_mask(number, country.dial_code if country else ''),
                            tier=item.tier, title=item.title, description=item.description, price=item.price,
                            status=PremiumStatus(item.status))
        session.add(row)
        await session.flush()
        session.add(ManualSession(filename=filename, purpose='premium', phone_e164=phone, premium_number_id=row.id,
                                  two_fa_enc=crypto.encrypt(two_fa) if two_fa else None, added_by=str(admin.key)[:128]))
        # never write the full number into the audit log
        log_admin(session, str(admin), 'session_created_target', 'premium_number', row.id, filename=filename,
                  purpose='premium_new', mask=row.display_mask, price=str(row.price))
        return {'kind': 'premium', 'premium_number_id': row.id, 'created': True, 'two_fa': bool(two_fa)}
    raise ServiceError('Неизвестный раздел для сессии.', 422)

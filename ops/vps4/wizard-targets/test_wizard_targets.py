"""Session wizard destinations: accounts 2015–2019 and premium numbers never enter phone stock, and a session is only
saved once no other device is logged in."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from telethon import errors
from telethon.sessions import MemorySession
from telethon.tl.types import User

from app.config import get_settings
from app.db import session_factory
from app.models import AdminAction, InventoryItem, ManualSession, PremiumNumber, Product, SessionAccount
from app.services import session_wizard

STATE = {'others': [], 'password': None}


class FakeClient:
    def __init__(self):
        self.session = MemorySession()
        self.phone = None

    async def connect(self):
        return None

    async def send_code_request(self, phone):
        self.phone = phone
        return SimpleNamespace(phone_code_hash='hash', type=type('SentCodeTypeSms', (), {'length': 5})(),
                               next_type=None, timeout=None)

    async def sign_in(self, phone=None, code=None, phone_code_hash=None, password=None):
        if code is not None and STATE['password']:
            raise errors.SessionPasswordNeededError(request=None)
        if password is not None and password != STATE['password']:
            raise errors.PasswordHashInvalidError(request=None)

    async def get_me(self):
        return User(id=424242, phone=self.phone.lstrip('+'), bot=False, access_hash=1)

    async def __call__(self, request):
        assert type(request).__name__ == 'GetAuthorizationsRequest'
        auths = [SimpleNamespace(current=True, device_model='F1Z', app_name='Session Manager')]
        auths += [SimpleNamespace(current=False, device_model=d, app_name='Telegram Android') for d in STATE['others']]
        return SimpleNamespace(authorizations=auths)

    async def log_out(self):
        return True

    async def disconnect(self):
        return None


@pytest.fixture
def wizard(monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))
    manager = session_wizard.manager
    monkeypatch.setattr(manager, 'client_factory', FakeClient)
    monkeypatch.setattr(manager, 'flows', {})
    monkeypatch.setattr(manager, 'starts', type(manager.starts)(manager.starts.default_factory))
    monkeypatch.setattr(manager, 'phone_wait', {})
    STATE.update(others=[], password=None)
    return tmp_path


async def test_account_target_goes_to_accounts_stock_with_two_fa(client, admin_headers, wizard):
    STATE['password'] = 'pa55'
    r = await client.post('/api/admin/telegram-sessions', json={'phone': '+380501234567', 'target': 'account'},
                          headers=admin_headers)
    assert r.status_code == 201, r.text
    flow = r.json()
    assert flow['target']['kind'] == 'account'
    r = await client.post(f"/api/admin/telegram-sessions/{flow['id']}/code", json={'code': '12345'}, headers=admin_headers)
    assert r.json()['stage'] == 'password'
    r = await client.post(f"/api/admin/telegram-sessions/{flow['id']}/password", json={'password': 'pa55'},
                          headers=admin_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['stage'] == 'done' and body['registered'] and body['target_result']['kind'] == 'account'
    assert body['target_result']['two_fa'] is True
    assert (wizard / '380501234567.session').exists()
    async with session_factory()() as db:
        row = await db.scalar(select(ManualSession).where(ManualSession.filename == '380501234567.session'))
        assert row.purpose == 'account'
        product = await db.get(Product, row.product_id)
        assert product.category == 'accounts' and product.fulfillment_mode == 'auto'
        assert await db.scalar(select(func.count()).select_from(InventoryItem)
                               .where(InventoryItem.product_id == product.id)) == 1
        assert await db.scalar(select(SessionAccount.id).where(SessionAccount.phone_e164 == '+380501234567')) is None
        actions = (await db.scalars(select(AdminAction.action).where(AdminAction.action.like('session_created%')))).all()
        assert 'session_created' not in actions and 'session_created_target' in actions


async def test_premium_target_waits_for_other_devices(client, admin_headers, wizard):
    r = await client.post('/api/admin/premium-numbers', json={
        'country_id': None, 'number': '+380671234567', 'display_mask': None, 'tier': 'premium',
        'title': 'PREMIUM NUMBER', 'description': '', 'price': '100', 'status': 'available'}, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    number_id = r.json()['id']
    async with session_factory()() as db:
        number = (await db.get(PremiumNumber, number_id)).number
    bad = await client.post('/api/admin/telegram-sessions', json={
        'phone': '+380509999999', 'target': 'premium', 'premium_number_id': number_id}, headers=admin_headers)
    assert bad.status_code == 422
    STATE['others'] = ['Pixel 7']
    r = await client.post('/api/admin/telegram-sessions', json={
        'phone': number, 'target': 'premium', 'premium_number_id': number_id}, headers=admin_headers)
    assert r.status_code == 201, r.text
    flow_id = r.json()['id']
    r = await client.post(f'/api/admin/telegram-sessions/{flow_id}/code', json={'code': '12345'}, headers=admin_headers)
    body = r.json()
    assert body['stage'] == 'devices' and body['other_devices'] == ['Pixel 7 · Telegram Android']
    assert not list(wizard.iterdir())  # nothing saved while another device is logged in
    r = await client.post(f'/api/admin/telegram-sessions/{flow_id}/recheck', headers=admin_headers)
    assert r.json()['stage'] == 'devices'
    STATE['others'] = []
    r = await client.post(f'/api/admin/telegram-sessions/{flow_id}/recheck', headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()['stage'] == 'done' and r.json()['target_result']['premium_number_id'] == number_id
    listed = (await client.get('/api/admin/premium-sessions', headers=admin_headers)).json()
    assert [s['premium_number_id'] for s in listed] == [number_id]
    async with session_factory()() as db:
        assert await db.scalar(select(SessionAccount.id).where(SessionAccount.phone_e164 == number)) is None


async def test_unknown_target_rejected(client, admin_headers, wizard):
    r = await client.post('/api/admin/telegram-sessions', json={'phone': '+380501234567', 'target': 'other'},
                          headers=admin_headers)
    assert r.status_code == 422

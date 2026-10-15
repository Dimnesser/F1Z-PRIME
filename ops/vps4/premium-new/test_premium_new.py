"""New premium number via the session wizard: the number is added to the premium base together with its session."""
from __future__ import annotations

from sqlalchemy import select

from app.db import session_factory
from app.models import ManualSession, PremiumNumber, SessionAccount
from tests.test_wizard_targets import STATE, wizard  # noqa: F401  (fixture)

NEW = {'price': '750', 'tier': 'gold', 'title': 'GOLD NUMBER', 'display_mask': None, 'description': '', 'status': 'available'}


async def test_new_premium_number_created_with_session(client, admin_headers, wizard):  # noqa: F811
    STATE['password'] = 'gold2fa'
    r = await client.post('/api/admin/telegram-sessions', json={
        'phone': '+380 67 777 77 77', 'target': 'premium_new', 'premium_new': NEW}, headers=admin_headers)
    assert r.status_code == 201, r.text
    flow_id = r.json()['id']
    async with session_factory()() as db:
        assert await db.scalar(select(PremiumNumber.id).where(PremiumNumber.number == '+380677777777')) is None
    r = await client.post(f'/api/admin/telegram-sessions/{flow_id}/code', json={'code': '12345'}, headers=admin_headers)
    assert r.json()['stage'] == 'password'
    r = await client.post(f'/api/admin/telegram-sessions/{flow_id}/password', json={'password': 'gold2fa'},
                          headers=admin_headers)
    assert r.status_code == 200, r.text
    result = r.json()['target_result']
    assert result['kind'] == 'premium' and result['created'] is True and result['two_fa'] is True
    async with session_factory()() as db:
        number = await db.get(PremiumNumber, result['premium_number_id'])
        assert number.number == '+380677777777' and number.tier == 'gold' and float(number.price) == 750
        assert number.status.value == 'available' and '*' in number.display_mask
        row = await db.scalar(select(ManualSession).where(ManualSession.premium_number_id == number.id))
        assert row.purpose == 'premium' and row.two_fa_enc
        assert await db.scalar(select(SessionAccount.id).where(SessionAccount.phone_e164 == '+380677777777')) is None
    listed = (await client.get('/api/admin/premium-sessions', headers=admin_headers)).json()
    assert result['premium_number_id'] in [s['premium_number_id'] for s in listed]


async def test_new_premium_number_rules(client, admin_headers, wizard):  # noqa: F811
    bad = await client.post('/api/admin/telegram-sessions', json={
        'phone': '+380671112233', 'target': 'premium_new', 'premium_new': {**NEW, 'price': '0'}}, headers=admin_headers)
    assert bad.status_code == 422
    r = await client.post('/api/admin/premium-numbers', json={
        'country_id': None, 'number': '+380671112233', 'display_mask': None, 'tier': 'premium',
        'title': 'PREMIUM NUMBER', 'description': '', 'price': '100', 'status': 'available'}, headers=admin_headers)
    assert r.status_code in (200, 201), r.text
    dup = await client.post('/api/admin/telegram-sessions', json={
        'phone': '+380671112233', 'target': 'premium_new', 'premium_new': NEW}, headers=admin_headers)
    assert dup.status_code == 409

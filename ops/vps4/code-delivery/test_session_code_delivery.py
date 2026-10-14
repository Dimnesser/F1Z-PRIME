"""Login-code delivery channel, resend and FloodWait handling of the session wizard."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from telethon import errors, types

from app.services.session_registry import describe
from app.services.session_wizard import delivery_medium, manager
from tests.test_session_wizard import BASE, PHONE, FakeClient, start, wizard  # noqa: F401


class ChannelClient(FakeClient):
    def __init__(self, sent_type, next_type=None, timeout=None):
        super().__init__()
        self.sent_type, self.next_type, self.timeout = sent_type, next_type, timeout
        self.resent = []
        self.resend_failure = None

    async def send_code_request(self, phone):
        self.phone = phone
        self.calls.append('send_code')
        if self.failure:
            raise self.failure
        return SimpleNamespace(phone_code_hash='private-code-hash', type=self.sent_type,
                               next_type=self.next_type, timeout=self.timeout)

    async def __call__(self, request):
        self.resent.append((request.phone_number, request.phone_code_hash))
        if self.resend_failure:
            raise self.resend_failure
        return types.auth.SentCode(type=types.auth.SentCodeTypeSms(length=5), phone_code_hash='second-hash')


def use(monkeypatch, fake):
    monkeypatch.setattr(manager, 'client_factory', lambda: fake)
    return fake


@pytest.mark.parametrize('code_type, expected', [
    (types.auth.SentCodeTypeApp(length=5), 'app'),
    (types.auth.SentCodeTypeSms(length=5), 'sms'),
    (types.auth.SentCodeTypeFirebaseSms(length=5), 'sms'),
    (types.auth.SentCodeTypeCall(length=5), 'call'),
    (types.auth.SentCodeTypeEmailCode(email_pattern='a***@x', length=6), 'email'),
    (types.auth.SentCodeTypeSetUpEmailRequired(), 'email_setup'),
    (types.auth.CodeTypeSms(), 'sms'),
    (types.auth.CodeTypeFragmentSms(), 'fragment'),
    (None, 'unknown'),
])
def test_delivery_medium_mapping(code_type, expected):
    assert delivery_medium(code_type) == expected


async def test_app_delivery_is_reported_without_exposing_hash(client, admin_headers, wizard):
    flow = await start(client, admin_headers)
    assert flow['delivery_medium'] == 'app' and flow['delivery'] == 'telegram' and flow['code_length'] == 5
    assert 'private-code-hash' not in str(flow)


async def test_sms_delivery_is_reported(client, admin_headers, wizard, monkeypatch):
    use(monkeypatch, ChannelClient(types.auth.SentCodeTypeSms(length=5)))
    flow = await start(client, admin_headers)
    assert flow['delivery_medium'] == 'sms' and flow['delivery'] == 'sms'
    assert flow['next_delivery_medium'] is None


async def test_email_setup_required_fails_fast_instead_of_waiting(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeSetUpEmailRequired()))
    response = await client.post(BASE, headers=admin_headers, json={'phone': PHONE})
    assert response.status_code == 409 and 'почту' in response.text
    assert not manager.flows and not fake.connected


async def test_resend_switches_app_code_to_sms(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeApp(length=5), types.auth.CodeTypeSms(), 0))
    flow = await start(client, admin_headers)
    assert flow['delivery_medium'] == 'app' and flow['next_delivery_medium'] == 'sms' and flow['resend_in'] == 0
    r = await client.post(f"{BASE}/{flow['id']}/resend", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()['delivery_medium'] == 'sms' and 'second-hash' not in r.text
    assert fake.resent == [(PHONE, 'private-code-hash')]
    assert manager.flows[flow['id']].code_hash == 'second-hash'


async def test_resend_respects_telegram_timeout(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeApp(length=5), types.auth.CodeTypeSms(), 60))
    flow = await start(client, admin_headers)
    assert 55 <= flow['resend_in'] <= 60
    r = await client.post(f"{BASE}/{flow['id']}/resend", headers=admin_headers)
    assert r.status_code == 429 and not fake.resent


async def test_resend_without_alternative_is_rejected(client, admin_headers, wizard):
    flow = await start(client, admin_headers)
    r = await client.post(f"{BASE}/{flow['id']}/resend", headers=admin_headers)
    assert r.status_code == 409 and flow['id'] in manager.flows


async def test_resend_floodwait_keeps_flow_and_reports_seconds(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeApp(length=5), types.auth.CodeTypeSms(), 0))
    flow = await start(client, admin_headers)
    fake.resend_failure = errors.FloodWaitError(request=None, capture=90)
    r = await client.post(f"{BASE}/{flow['id']}/resend", headers=admin_headers)
    assert r.status_code == 429 and 'ограничил отправку кодов на этот номер' in r.text and '90 секунд' in r.text
    assert flow['id'] in manager.flows


async def test_floodwait_on_send_code_has_clear_message(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeApp(length=5)))
    fake.failure = errors.FloodWaitError(request=None, capture=300)
    r = await client.post(BASE, headers=admin_headers, json={'phone': PHONE})
    assert r.status_code == 429
    assert 'Telegram временно ограничил отправку кодов на этот номер, повторите через 300 секунд' in r.text


async def test_phone_number_flood_is_reported(client, admin_headers, wizard, monkeypatch):
    fake = use(monkeypatch, ChannelClient(types.auth.SentCodeTypeApp(length=5)))
    fake.failure = errors.PhoneNumberFloodError(request=None)
    r = await client.post(BASE, headers=admin_headers, json={'phone': PHONE})
    assert r.status_code == 429 and 'ограничил отправку кодов' in r.text and not manager.flows


async def test_ukrainian_number_after_get_me_maps_to_ukraine():
    account = describe('+380501234567', 123)
    assert account['country_iso2'] == 'UA' and account['phone_e164'] == '+380501234567'


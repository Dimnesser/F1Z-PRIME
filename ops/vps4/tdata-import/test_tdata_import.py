"""TData zip → Telethon .session: format parsing, and uploads registered as phone stock like .session files."""
from __future__ import annotations

import os
import sqlite3
import zipfile

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import session_factory
from app.models import SessionAccount
from app.services import session_registry, tdata_import
from app.services.common import ServiceError
from tests.tdata_factory import build

UPLOAD = '/api/admin/files/upload'


def test_extracts_auth_key_and_dc(tmp_path):
    key = os.urandom(256)
    path = tmp_path / 'acc_tdata.zip'
    path.write_bytes(build(user_id=7000000123, dc_id=4, auth_key=key))
    assert tdata_import.extract(path) == (7000000123, 4, key)
    session_file = tmp_path / 'acc.session'
    session_file.write_bytes(tdata_import.to_session_bytes(path))
    with sqlite3.connect(session_file) as db:
        dc, address, port, auth = db.execute('select dc_id, server_address, port, auth_key from sessions').fetchone()
    assert (dc, port, bytes(auth)) == (4, 443, key) and address
    assert tdata_import.session_name('265874144_tdata.zip') == '265874144_tdata.session'


def test_rejects_broken_archives(tmp_path):
    bad = tmp_path / 'bad.zip'
    bad.write_bytes(b'not a zip')
    with pytest.raises(tdata_import.TDataError):
        tdata_import.extract(bad)
    with pytest.raises(tdata_import.TDataError):
        tdata_import._tdf(b'TDF$' + bytes(40))  # checksum mismatch
    with zipfile.ZipFile(tmp_path / 'empty.zip', 'w') as archive:
        archive.writestr('tdata/readme.txt', 'x')
    with pytest.raises(tdata_import.TDataError) as error:
        tdata_import.extract(tmp_path / 'empty.zip')
    assert error.value.code == tdata_import.NOT_TDATA


async def _upload(client, headers, name, content):
    return await client.post(f'{UPLOAD}?format=tdata&filename={name}', content=content,
                             headers={**headers, 'Content-Type': 'application/octet-stream'})


async def test_tdata_upload_goes_to_phone_stock(client, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))
    registered = []

    async def verify_identity(filename):
        assert filename == 'ua_tdata.session' and (tmp_path / filename).exists()
        return session_registry.describe('+380931112233', 7000000001), 'key'

    async def register(db, filename, account, actor, expected_key=None):
        registered.append((filename, account['phone_e164'], expected_key))

    monkeypatch.setattr(session_registry, 'verify_identity', verify_identity)
    monkeypatch.setattr(session_registry, 'register', register)
    r = await _upload(client, admin_headers, 'ua_tdata.zip', build())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body['session_filename'] == 'ua_tdata.session' and body['phone'] == '+380931112233'
    assert registered == [('ua_tdata.session', '+380931112233', 'key')]
    assert sorted(p.name for p in tmp_path.iterdir()) == ['ua_tdata.session', 'ua_tdata.zip']


async def test_tdata_that_cannot_be_sold_is_kept_with_reason(client, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))

    async def verify_identity(filename):
        raise ServiceError('На аккаунте есть другие устройства. Продажа заблокирована.', 409, 'handoff_existing_devices')

    monkeypatch.setattr(session_registry, 'verify_identity', verify_identity)
    r = await _upload(client, admin_headers, 'x_tdata.zip', build())
    assert r.status_code == 201, r.text
    body = r.json()
    assert 'session_filename' not in body and 'другие устройства' in body['warning']
    assert [p.name for p in tmp_path.iterdir()] == ['x_tdata.zip']  # no unverified session left behind
    async with session_factory()() as db:
        assert await db.scalar(select(SessionAccount.id).where(SessionAccount.filename == 'x_tdata.session')) is None


async def test_non_tdata_zip_is_saved_as_before(client, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))
    with zipfile.ZipFile(tmp_path.parent / 'plain.zip', 'w') as archive:
        archive.writestr('tdata/test-data', 'sample archive data')
    content = (tmp_path.parent / 'plain.zip').read_bytes()
    r = await _upload(client, admin_headers, 'plain.zip', content)
    assert r.status_code == 201, r.text
    assert r.json() == {'filename': 'plain.zip', 'format': 'tdata', 'size': len(content), 'warning': None}

"""TData zip → Telethon .session: format parsing, and uploads registered as phone stock like .session files."""
from __future__ import annotations

import os
import sqlite3

import pytest
from sqlalchemy import select

from app.config import get_settings
from app.db import session_factory
from app.models import PhoneInventory, SessionAccount
from app.services import session_registry, tdata_import
from tests.tdata_factory import build


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
    import zipfile
    with zipfile.ZipFile(tmp_path / 'empty.zip', 'w') as archive:
        archive.writestr('tdata/readme.txt', 'x')
    with pytest.raises(tdata_import.TDataError):
        tdata_import.extract(tmp_path / 'empty.zip')


async def test_tdata_upload_goes_to_phone_stock(client, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))

    async def verify_identity(filename):
        assert filename == 'ua_tdata.session' and (tmp_path / filename).exists()
        return session_registry.describe('+380931112233', 7000000001), 'key'

    registered = []

    async def register(db, filename, account, actor, expected_key=None):
        registered.append((filename, account['phone_e164'], expected_key))

    monkeypatch.setattr(session_registry, 'verify_identity', verify_identity)
    monkeypatch.setattr(session_registry, 'register', register)
    r = await client.post('/api/admin/files/upload?format=tdata&filename=ua_tdata.zip', content=build(),
                          headers={**admin_headers, 'Content-Type': 'application/octet-stream'})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body['session_filename'] == 'ua_tdata.session' and body['phone'] == '+380931112233'
    assert registered == [('ua_tdata.session', '+380931112233', 'key')]
    assert (tmp_path / 'ua_tdata.zip').exists() and (tmp_path / 'ua_tdata.session').exists()


async def test_tdata_upload_failure_leaves_no_files(client, admin_headers, monkeypatch, tmp_path):
    monkeypatch.setattr(get_settings(), 'sessions_dir', str(tmp_path))

    async def verify_identity(filename):
        from app.services.common import ServiceError
        raise ServiceError('На аккаунте есть другие устройства. Продажа заблокирована.', 409, 'handoff_existing_devices')

    monkeypatch.setattr(session_registry, 'verify_identity', verify_identity)
    r = await client.post('/api/admin/files/upload?format=tdata&filename=x_tdata.zip', content=build(),
                          headers={**admin_headers, 'Content-Type': 'application/octet-stream'})
    assert r.status_code == 409
    assert not list(tmp_path.iterdir())
    async with session_factory()() as db:
        assert await db.scalar(select(SessionAccount.id).where(SessionAccount.filename == 'x_tdata.session')) is None
        assert await db.scalar(select(PhoneInventory.id).where(PhoneInventory.phone_e164 == '+380931112233')) is None

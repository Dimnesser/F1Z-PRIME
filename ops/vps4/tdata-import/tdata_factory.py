"""Build a Telegram Desktop tdata zip (test fixture), mirroring the TDesktop local-storage encryption."""
from __future__ import annotations

import hashlib
import io
import os
import struct
import zipfile

from telethon.crypto import AES

from app.services.tdata_import import _aes_old_mtp, _data_name_key, _passcode_key


def _qba(data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + data


def _tdf(payload: bytes, version: int = 4005000) -> bytes:
    v = struct.pack('<i', version)
    return b'TDF$' + v + payload + hashlib.md5(payload + struct.pack('<i', len(payload)) + v + b'TDF$').digest()


def _encrypt_local(data: bytes, key: bytes) -> bytes:
    body = struct.pack('<I', len(data) + 4) + data
    body += os.urandom((-len(body)) % 16)
    msg_key = hashlib.sha1(body).digest()[:16]
    aes_key, aes_iv = _aes_old_mtp(key, msg_key)
    return msg_key + AES.encrypt_ige(body, aes_key, aes_iv)


def build(user_id: int = 7000000001, dc_id: int = 2, auth_key: bytes | None = None, folder: str = 'tdata') -> bytes:
    auth_key = auth_key or os.urandom(256)
    salt, local_key = os.urandom(32), os.urandom(256)
    key_datas = _tdf(_qba(salt) + _qba(_encrypt_local(local_key, _passcode_key(salt)))
                     + _qba(_encrypt_local(struct.pack('>ii', 1, 0), local_key)))
    serialized = struct.pack('>iiQi', -1, -1, user_id, dc_id) + struct.pack('>i', 1) + struct.pack('>i', dc_id) + auth_key
    serialized += struct.pack('>i', 0)  # keys to destroy
    mtp = _tdf(_qba(_encrypt_local(struct.pack('>i', 0x4B) + _qba(serialized), local_key)))
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr(f'{folder}/key_datas', key_datas)
        archive.writestr(f'{folder}/{_data_name_key("data")}s', mtp)
        archive.writestr(f'{folder}/{_data_name_key("data")}/maps', _tdf(b'\x00' * 8))
    return buffer.getvalue()

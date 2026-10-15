"""Telegram Desktop `tdata` (zip) → Telethon .session, so TData uploads can be sold like .session files.

Reads only what is needed for the MTProto authorization of the first account, following the Telegram Desktop
local-storage format (`key_datas` + `<dataNameKey>s`): TDF$ container → QDataStream (big-endian) fields → local AES-IGE
encryption keyed via PBKDF2-HMAC-SHA512. Uses Telethon's own AES-IGE and AuthKey/SQLiteSession and hashlib; no custom
binary handlers. A passcode-protected TData (local password) is reported as unsupported instead of guessing.
"""
from __future__ import annotations

import hashlib
import struct
import tempfile
import zipfile
from pathlib import Path

from app.services.common import ServiceError

MAX_ENTRY = 2 * 1024 * 1024
MTP_AUTHORIZATION = 0x4B  # dbiMtpAuthorization
WIDE_IDS_TAG = -1  # kWideIdsTag (64-bit user id follows)
DC_IPV4 = {1: '149.154.175.53', 2: '149.154.167.51', 3: '149.154.175.100', 4: '149.154.167.91', 5: '91.108.56.130'}


class TDataError(ServiceError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 422, 'tdata_invalid')


class _Stream:
    """Minimal QDataStream reader (big-endian)."""

    def __init__(self, data: bytes) -> None:
        self.data, self.pos = data, 0

    def raw(self, size: int) -> bytes:
        if size < 0 or self.pos + size > len(self.data):
            raise TDataError('Повреждённый файл TData.')
        chunk = self.data[self.pos:self.pos + size]
        self.pos += size
        return chunk

    def int32(self) -> int:
        return struct.unpack('>i', self.raw(4))[0]

    def uint64(self) -> int:
        return struct.unpack('>Q', self.raw(8))[0]

    def bytearray(self) -> bytes:
        size = struct.unpack('>I', self.raw(4))[0]
        return b'' if size == 0xFFFFFFFF else self.raw(size)


def _tdf(blob: bytes) -> bytes:
    """`TDF$` | version (int32 LE) | payload | md5(payload + len LE + version LE + 'TDF$')."""
    if len(blob) < 24 or blob[:4] != b'TDF$':
        raise TDataError('Это не файл Telegram Desktop (нет заголовка TDF$).')
    version, payload, digest = blob[4:8], blob[8:-16], blob[-16:]
    check = hashlib.md5(payload + struct.pack('<i', len(payload)) + version + b'TDF$').digest()
    if check != digest:
        raise TDataError('Файл TData повреждён (не совпадает контрольная сумма).')
    return payload


def _passcode_key(salt: bytes, passcode: bytes = b'') -> bytes:
    iterations = 1 if not passcode else 100000
    digest = hashlib.sha512(salt + passcode + salt).digest()
    return hashlib.pbkdf2_hmac('sha512', digest, salt, iterations, 256)


def _aes_old_mtp(key: bytes, msg_key: bytes) -> tuple[bytes, bytes]:
    x = 8  # decryption direction
    a = hashlib.sha1(msg_key + key[x:x + 32]).digest()
    b = hashlib.sha1(key[32 + x:48 + x] + msg_key + key[48 + x:64 + x]).digest()
    c = hashlib.sha1(key[64 + x:96 + x] + msg_key).digest()
    d = hashlib.sha1(msg_key + key[96 + x:128 + x]).digest()
    return a[:8] + b[8:20] + c[4:16], a[8:20] + b[:8] + c[16:20] + d[:8]


def _decrypt_local(encrypted: bytes, key: bytes) -> bytes:
    from telethon.crypto import AES

    if len(encrypted) <= 16 or (len(encrypted) - 16) % 16:
        raise TDataError('Повреждённый файл TData.')
    msg_key = encrypted[:16]
    aes_key, aes_iv = _aes_old_mtp(key, msg_key)
    decrypted = AES.decrypt_ige(encrypted[16:], aes_key, aes_iv)
    if hashlib.sha1(decrypted).digest()[:16] != msg_key:
        raise TDataError('TData защищена локальным паролем (код-пароль Telegram Desktop) или повреждена. '
                         'Снимите код-пароль в Telegram Desktop и выгрузите tdata заново.')
    size = struct.unpack('<I', decrypted[:4])[0]
    if size < 4 or size > len(decrypted):
        raise TDataError('Повреждённый файл TData.')
    return decrypted[4:size]


def _data_name_key(name: str) -> str:
    digest = hashlib.md5(name.encode()).digest()[:8]
    return ''.join('0123456789ABCDEF'[b & 0x0F] + '0123456789ABCDEF'[b >> 4] for b in digest)


def _read_zip(path: Path) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    try:
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir() or info.file_size > MAX_ENTRY or len(files) > 400:
                    continue
                parts = [p for p in info.filename.replace('\\', '/').split('/') if p]
                if not parts or '..' in parts:
                    continue
                # keep the path relative to the tdata folder, wherever it sits in the archive
                if 'tdata' in parts:
                    parts = parts[parts.index('tdata') + 1:]
                files['/'.join(parts)] = archive.read(info)
    except zipfile.BadZipFile:
        raise TDataError('Архив TData повреждён или это не zip.') from None
    return files


def extract(path: Path) -> tuple[int, int, bytes]:
    """Return (user_id, main_dc_id, auth_key) of the first account in a tdata zip."""
    files = _read_zip(path)
    key_datas = next((files[k] for k in ('key_datas', 'key_data') if k in files), None)
    if key_datas is None:
        raise TDataError('В архиве нет tdata/key_datas. Заархивируйте папку tdata целиком.')
    stream = _Stream(_tdf(key_datas))
    salt, key_encrypted, info_encrypted = stream.bytearray(), stream.bytearray(), stream.bytearray()
    local_key = _Stream(_decrypt_local(key_encrypted, _passcode_key(salt))).raw(256)
    info = _Stream(_decrypt_local(info_encrypted, local_key))
    count = info.int32()
    indices = [info.int32() for _ in range(max(0, min(count, 3)))] or [0]
    name = 'data' if indices[0] == 0 else f'data#{indices[0] + 1}'
    base = _data_name_key(name)
    mtp = next((files[base + s] for s in ('s', '1', '0') if base + s in files), None)
    if mtp is None:
        raise TDataError('В архиве нет файла авторизации аккаунта (например, D877F783D5D3EF8Cs).')
    block = _Stream(_decrypt_local(_Stream(_tdf(mtp)).bytearray(), local_key))
    if block.int32() != MTP_AUTHORIZATION:
        raise TDataError('В TData нет авторизации Telegram.')
    data = _Stream(block.bytearray())
    user_id, main_dc = data.int32(), data.int32()
    if user_id == WIDE_IDS_TAG and main_dc == WIDE_IDS_TAG:
        user_id, main_dc = data.uint64(), data.int32()
    keys = {}
    for _ in range(max(0, min(data.int32(), 10))):
        dc_id = data.int32()
        keys[dc_id] = data.raw(256)
    if main_dc not in keys or main_dc not in DC_IPV4:
        raise TDataError('В TData нет ключа авторизации основного дата-центра.')
    return user_id, main_dc, keys[main_dc]


def to_session_bytes(path: Path) -> bytes:
    """Build a Telethon SQLite .session (auth key + DC) from a tdata zip."""
    from telethon.crypto import AuthKey
    from telethon.sessions import SQLiteSession

    _user_id, dc_id, auth_key = extract(path)
    with tempfile.TemporaryDirectory(prefix='f1z-tdata-') as temporary:
        base = Path(temporary) / 'converted'
        session = SQLiteSession(str(base))
        try:
            session.set_dc(dc_id, DC_IPV4[dc_id], 443)
            session.auth_key = AuthKey(data=auth_key)
            session.save()
        finally:
            session.close()
        return base.with_suffix('.session').read_bytes()


def session_name(zip_name: str) -> str:
    return (zip_name[:-4] if zip_name.lower().endswith('.zip') else zip_name) + '.session'


__all__ = ['TDataError', 'extract', 'session_name', 'to_session_bytes']

"""Encryption of deliverable secrets (license keys, voucher codes) at rest.

AES-256-GCM with a random nonce. The key comes from INVENTORY_KEY (base64, 32 bytes) or is derived from
SECRET_KEY with HKDF. Changing the key makes stored secrets unreadable — set INVENTORY_KEY once and keep it.
Secrets are never logged; admins only see a masked label.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
from functools import lru_cache

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.config import get_settings

PREFIX = "v1:"


@lru_cache
def _keys(material: str, explicit: str) -> tuple[bytes, bytes]:
    if explicit:
        root = base64.b64decode(explicit)
        if len(root) != 32:
            raise ValueError("INVENTORY_KEY must be 32 bytes (base64)")
    else:
        root = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"f1z-prime", info=b"inventory-root").derive(
            material.encode()
        )
    enc = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"inventory-enc").derive(root)
    mac = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"inventory-fingerprint").derive(root)
    return enc, mac


def _current() -> tuple[bytes, bytes]:
    s = get_settings()
    return _keys(s.secret_key, s.inventory_key)


def normalize(secret: str) -> str:
    return secret.strip()


def encrypt(secret: str) -> str:
    enc, _ = _current()
    nonce = os.urandom(12)
    ct = AESGCM(enc).encrypt(nonce, normalize(secret).encode(), b"f1z-inventory")
    return PREFIX + base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    if not token.startswith(PREFIX):
        raise ValueError("unknown secret format")
    enc, _ = _current()
    raw = base64.b64decode(token[len(PREFIX):])
    return AESGCM(enc).decrypt(raw[:12], raw[12:], b"f1z-inventory").decode()


def fingerprint(secret: str) -> str:
    """Keyed hash used to reject duplicate units without storing the secret in clear."""
    _, mac = _current()
    return hmac.new(mac, normalize(secret).encode(), hashlib.sha256).hexdigest()


def mask(secret: str) -> str:
    s = normalize(secret)
    if len(s) <= 6:
        return "•" * len(s)
    return f"{s[:2]}{'•' * min(8, len(s) - 6)}{s[-4:]}"

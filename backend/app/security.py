"""Telegram WebApp initData validation and admin authentication."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl

import jwt


class InitDataError(Exception):
    pass


@dataclass(slots=True)
class TelegramUser:
    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None
    photo_url: str | None = None


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int, now: float | None = None) -> TelegramUser:
    """Validate Telegram.WebApp.initData according to the official algorithm.

    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    if not init_data or not bot_token:
        raise InitDataError("initData is missing")
    if len(init_data) > 4096:
        raise InitDataError("initData is too long")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as exc:
        raise InitDataError("initData is malformed") from exc
    data = dict(pairs)
    received_hash = data.pop("hash", None)
    if not received_hash:
        raise InitDataError("hash is missing")
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calculated, received_hash):
        raise InitDataError("invalid signature")
    try:
        auth_date = int(data.get("auth_date", "0"))
    except ValueError as exc:
        raise InitDataError("bad auth_date") from exc
    now = time.time() if now is None else now
    if auth_date <= 0 or now - auth_date > max_age_seconds:
        raise InitDataError("initData expired")
    if auth_date - now > 60:
        raise InitDataError("auth_date is in the future")
    try:
        raw_user: dict[str, Any] = json.loads(data["user"])
        return TelegramUser(
            id=int(raw_user["id"]),
            first_name=raw_user.get("first_name"),
            last_name=raw_user.get("last_name"),
            username=raw_user.get("username"),
            language_code=raw_user.get("language_code"),
            photo_url=raw_user.get("photo_url"),
        )
    except (KeyError, ValueError, TypeError) as exc:
        raise InitDataError("user is missing") from exc


def sign_init_data(fields: dict[str, str], bot_token: str) -> str:
    """Build a correctly signed initData string (used by tests and local tooling)."""
    from urllib.parse import urlencode

    check_string = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    digest = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": digest})


# ---------------------------------------------------------------- admin auth

PBKDF2_ITERATIONS = 390_000


def hash_password(password: str, iterations: int = PBKDF2_ITERATIONS) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return "pbkdf2_sha256${}${}${}".format(
        iterations, base64.b64encode(salt).decode(), base64.b64encode(digest).decode()
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algo, iterations, salt_b64, hash_b64 = encoded.split("$")
        if algo != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(iterations))
        return hmac.compare_digest(digest, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def check_admin_credentials(username: str, password: str, settings: Any) -> bool:
    user_ok = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    if settings.admin_password_hash:
        pass_ok = verify_password(password, settings.admin_password_hash)
    elif settings.admin_password:
        pass_ok = hmac.compare_digest(password.encode(), settings.admin_password.encode())
    else:
        pass_ok = False
    return user_ok and pass_ok


def create_admin_token(username: str, secret_key: str, ttl_hours: int) -> str:
    now = int(time.time())
    payload = {"sub": username, "role": "admin", "iat": now, "exp": now + ttl_hours * 3600}
    return jwt.encode(payload, secret_key, algorithm="HS256")


def decode_admin_token(token: str, secret_key: str) -> str | None:
    try:
        payload = jwt.decode(token, secret_key, algorithms=["HS256"], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    if payload.get("role") != "admin":
        return None
    return str(payload["sub"])

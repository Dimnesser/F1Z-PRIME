import time

import pytest

from app.config import Settings
from app.security import (
    InitDataError,
    create_admin_token,
    decode_admin_token,
    hash_password,
    validate_init_data,
    verify_password,
)
from tests.conftest import BOT_TOKEN, init_data_for


def test_valid_init_data():
    user = validate_init_data(init_data_for(42, "neo"), BOT_TOKEN, 3600)
    assert user.id == 42 and user.username == "neo"


def test_tampered_init_data_rejected():
    data = init_data_for(42).replace("42", "43", 1)
    with pytest.raises(InitDataError):
        validate_init_data(data, BOT_TOKEN, 3600)


def test_wrong_bot_token_rejected():
    with pytest.raises(InitDataError):
        validate_init_data(init_data_for(42, token="999:OTHER"), BOT_TOKEN, 3600)


def test_expired_init_data_rejected():
    old = int(time.time()) - 7200
    with pytest.raises(InitDataError, match="expired"):
        validate_init_data(init_data_for(42, auth_date=old), BOT_TOKEN, 3600)


def test_admin_token_roundtrip():
    token = create_admin_token("admin", "k" * 40, 1)
    assert decode_admin_token(token, "k" * 40) == "admin"
    assert decode_admin_token(token, "x" * 40) is None
    assert decode_admin_token("garbage", "k" * 40) is None


def test_password_hash():
    h = hash_password("hunter22", iterations=1000)
    assert verify_password("hunter22", h)
    assert not verify_password("hunter23", h)


def test_dev_mode_disabled_in_production():
    s = Settings(
        environment="production", dev_mode=True, bot_token="1:x", secret_key="s" * 40, admin_password="long-password-1"
    )
    assert s.dev_mode is False


def test_production_requires_secret():
    with pytest.raises(ValueError):
        Settings(environment="production", bot_token="1:x", secret_key="change-me", admin_password="long-password-1")

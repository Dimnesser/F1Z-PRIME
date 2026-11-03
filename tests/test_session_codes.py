"""Unit tests for login-code extraction helpers (no live Telethon)."""
from pathlib import Path

import pytest

from app.services.session_codes import extract_code, resolve_session_path
from app.services.common import ServiceError


def test_extract_code_prefers_worded_match():
    text = "Your login code is 12345. Do not share it."
    assert extract_code(text) == "12345"


def test_extract_code_six_digits_russian():
    text = "Код для входа в Telegram: 987654"
    assert extract_code(text) == "987654"


def test_extract_code_fallback_last_token():
    assert extract_code("misc 11111 then 222222") == "222222"


def test_extract_code_empty():
    assert extract_code(None) is None
    assert extract_code("") is None
    assert extract_code("no digits here") is None


def test_resolve_session_path_from_phone():
    base = Path("/srv/sessions")
    assert resolve_session_path("+380501112233", base) == base / "380501112233.session"
    assert resolve_session_path("380501112233", base) == base / "380501112233.session"


def test_resolve_session_path_relative_name():
    base = Path("/srv/sessions")
    assert resolve_session_path("acc_1.session", base) == base / "acc_1.session"
    assert resolve_session_path("acc_1", base) == base / "acc_1.session"


def test_resolve_session_path_absolute():
    p = Path("/secure/store/foo.session")
    assert resolve_session_path(str(p), Path("/srv/sessions")) == p


def test_resolve_session_path_empty():
    with pytest.raises(ServiceError) as exc:
        resolve_session_path("   ", Path("/srv/sessions"))
    assert exc.value.code == "session_missing"

from __future__ import annotations

import os
import subprocess
import sys
import time
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://f1z:f1z@localhost:5432/f1z_test")
BOT_TOKEN = "123456:TEST-TOKEN-for-f1z"

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": TEST_DB,
        "BOT_TOKEN": BOT_TOKEN,
        "WEBAPP_URL": "https://shop.example.com",
        "DEV_MODE": "false",
        "ADMIN_USERNAME": "admin",
        "ADMIN_PASSWORD": "super-secret-pass",
        "SECRET_KEY": "test-secret-key-test-secret-key-0123456789",
        "RUN_BACKGROUND_TASKS": "false",
        "ADMIN_TELEGRAM_IDS": "999",
    }
)

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import dispose_engine, session_factory  # noqa: E402
from app.security import sign_init_data  # noqa: E402

TABLES = [
    "inventory_items", "stock_movements", "jobs", "task_runs", "incidents", "refunds", "notification_templates",
    "approval_requests", "staff_notifications", "admin_prefs", "roles",
    "order_events", "notification_outbox", "admin_users", "categories",
    "admin_actions", "support_messages", "support_tickets", "balance_transactions", "payments",
    "orders", "premium_numbers", "products", "countries", "users", "settings",
]


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> None:
    """Fresh schema built by Alembic migrations (verifies that migrations apply)."""
    import asyncio

    from sqlalchemy.ext.asyncio import create_async_engine

    async def reset() -> None:
        engine = create_async_engine(TEST_DB)
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA public CASCADE"))
            await conn.execute(text("CREATE SCHEMA public"))
        await engine.dispose()

    asyncio.run(reset())
    env = {**os.environ, "PYTHONPATH": str(ROOT / "backend")}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT / "backend", env=env, check=True,
        capture_output=True,
    )


@pytest.fixture(autouse=True)
async def clean_db():
    from app.seed import seed

    get_settings.cache_clear()
    async with session_factory()() as session:
        await session.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
        await session.commit()
    await seed(demo=True)
    from app.api import admin as admin_api
    from app.api import deps

    deps._admin_writes.clear()  # rate-limit windows are per process; each test starts fresh
    admin_api._login_attempts.clear()
    yield
    await dispose_engine()
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def telegram_calls(monkeypatch):
    """Never talk to the real Telegram API in tests; record calls instead."""
    from app.services import telegram

    calls: list[tuple[str, dict]] = []

    async def fake_call(method: str, payload: dict, timeout: float = 10.0):
        calls.append((method, payload))
        if method == "createInvoiceLink":
            return f"https://t.me/$invoice_{payload['payload']}"
        return True

    monkeypatch.setattr(telegram, "call", fake_call)
    return calls


@pytest.fixture
async def client():
    from app.main import create_app

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def init_data_for(user_id: int = 5550001, username: str = "buyer", auth_date: int | None = None, token: str = BOT_TOKEN) -> str:
    fields = {
        "query_id": "AAH-test",
        "user": json.dumps({"id": user_id, "first_name": "Иван", "username": username, "language_code": "ru"},
                           separators=(",", ":"), ensure_ascii=False),
        "auth_date": str(auth_date or int(time.time())),
    }
    return sign_init_data(fields, token)


@pytest.fixture
def user_headers() -> dict[str, str]:
    return {"Authorization": f"tma {init_data_for()}"}


@pytest.fixture
async def admin_headers(client) -> dict[str, str]:
    r = await client.post("/api/admin/login", json={"username": "admin", "password": "super-secret-pass"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}

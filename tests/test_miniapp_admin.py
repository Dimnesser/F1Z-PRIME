"""Admin panel inside the Telegram Mini App: role from signed initData, short-lived token exchange."""
from __future__ import annotations

import time

from tests.conftest import init_data_for

OWNER_ID = 5102543442  # default OWNER_TELEGRAM_ID
ENV_ADMIN_ID = 999  # ADMIN_TELEGRAM_IDS in tests


def tma(user_id: int, username: str = "someone", **kw) -> dict[str, str]:
    return {"Authorization": f"tma {init_data_for(user_id, username=username, **kw)}"}


async def test_regular_user_has_no_button_and_no_access(client, user_headers):
    r = await client.get("/api/me/admin-access", headers=user_headers)
    assert r.json() == {"allowed": False, "role": None}
    r = await client.post("/api/admin/telegram-login", headers=user_headers)
    assert r.status_code == 403
    # Mini App credentials are never accepted by admin APIs directly
    assert (await client.get("/api/admin/dashboard", headers=user_headers)).status_code == 401
    assert (await client.get("/api/admin/users", headers=user_headers)).status_code == 401


async def test_owner_and_env_admin_get_access(client):
    r = await client.get("/api/me/admin-access", headers=tma(OWNER_ID, "boss"))
    assert r.json() == {"allowed": True, "role": "owner"}
    r = await client.get("/api/me/admin-access", headers=tma(ENV_ADMIN_ID, "helper"))
    assert r.json() == {"allowed": True, "role": "admin"}


async def test_token_exchange_and_admin_api(client):
    r = await client.post("/api/admin/telegram-login", headers=tma(OWNER_ID, "boss"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "owner" and body["username"] == "tg:boss" and body["expires_in"] <= 3600
    headers = {"Authorization": f"Bearer {body['token']}"}
    me = (await client.get("/api/admin/me", headers=headers)).json()
    assert me["role"] == "owner" and me["username"] == "tg:boss"
    assert (await client.get("/api/admin/dashboard", headers=headers)).status_code == 200
    assert (await client.get("/api/admin/accounts", headers=headers)).status_code == 200  # owner-only
    actions = (await client.get("/api/admin/actions?entity=admin", headers=headers)).json()
    assert actions[0]["action"] == "login_telegram" and actions[0]["admin"] == "tg:boss"


async def test_env_admin_is_not_owner(client):
    token = (await client.post("/api/admin/telegram-login", headers=tma(ENV_ADMIN_ID, "helper"))).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/admin/products", headers=headers)).status_code == 200
    assert (await client.get("/api/admin/accounts", headers=headers)).status_code == 403


async def test_bad_or_expired_init_data_rejected(client):
    assert (await client.post("/api/admin/telegram-login")).status_code == 401
    forged = {"Authorization": "tma " + init_data_for(OWNER_ID, token="999:OTHER-BOT")}
    assert (await client.post("/api/admin/telegram-login", headers=forged)).status_code == 401
    old = tma(OWNER_ID, auth_date=int(time.time()) - 3 * 86400)
    assert (await client.post("/api/admin/telegram-login", headers=old)).status_code == 401


async def test_revoked_access_cuts_existing_session(client, admin_headers, monkeypatch):
    # a staff account linked to a Telegram id gets access; deactivating it revokes the live token
    r = await client.post("/api/admin/accounts", json={"username": "manager", "password": "manager-pass-1",
                                                       "role": "admin", "telegram_id": 4242}, headers=admin_headers)
    assert r.status_code == 201 and r.json()["telegram_id"] == 4242
    acc = r.json()["id"]
    assert (await client.get("/api/me/admin-access", headers=tma(4242, "mgr"))).json()["allowed"] is True
    token = (await client.post("/api/admin/telegram-login", headers=tma(4242, "mgr"))).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert (await client.get("/api/admin/orders", headers=headers)).status_code == 200
    await client.patch(f"/api/admin/accounts/{acc}", json={"is_active": False}, headers=admin_headers)
    assert (await client.get("/api/admin/orders", headers=headers)).status_code == 401
    assert (await client.get("/api/me/admin-access", headers=tma(4242, "mgr"))).json()["allowed"] is False


async def test_support_role_cannot_enter_from_miniapp(client, admin_headers):
    await client.post("/api/admin/accounts", json={"username": "agent", "password": "agent-pass-123",
                                                   "role": "support", "telegram_id": 777}, headers=admin_headers)
    assert (await client.get("/api/me/admin-access", headers=tma(777, "agent"))).json()["allowed"] is False
    assert (await client.post("/api/admin/telegram-login", headers=tma(777, "agent"))).status_code == 403


async def test_telegram_id_unique_across_accounts(client, admin_headers):
    body = {"username": "first", "password": "first-pass-123", "role": "admin", "telegram_id": 31337}
    assert (await client.post("/api/admin/accounts", json=body, headers=admin_headers)).status_code == 201
    body |= {"username": "second"}
    assert (await client.post("/api/admin/accounts", json=body, headers=admin_headers)).status_code == 409

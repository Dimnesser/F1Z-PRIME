"""Team management and RBAC: every check is enforced by the server on direct HTTP calls."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select

from app.db import session_factory
from app.models import AdminAction
from app.services.common import utcnow
from tests.conftest import init_data_for

OWNER_ID = 5102543442


def tma(uid: int, name: str = "staff") -> dict[str, str]:
    return {"Authorization": f"tma {init_data_for(uid, username=name)}"}


async def _login(client, username: str, password: str) -> dict[str, str]:
    r = await client.post("/api/admin/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


async def _account(client, admin_headers, username: str, role: str, **extra) -> dict:
    body = {"username": username, "password": f"{username}-pass-123", "role": role, **extra}
    r = await client.post("/api/admin/accounts", json=body, headers=admin_headers)
    assert r.status_code == 201, r.text
    return r.json()


async def test_add_test_admin_by_telegram_id_without_sending_invites(client, admin_headers, telegram_calls):
    r = await client.post("/api/admin/accounts", json={"telegram_id": 800001, "role": "orders_manager",
                                                       "display_name": "Тестовый менеджер"}, headers=admin_headers)
    assert r.status_code == 201, r.text
    assert r.json()["username"] == "tg800001" and r.json()["has_password"] is False
    # no Telegram message is sent to the invited person (the invite is an in-panel notification only)
    assert not [p for m, p in telegram_calls if p.get("chat_id") == 800001]
    # the Mini App button appears for them automatically, with their role's permissions only
    assert (await client.get("/api/me/admin-access", headers=tma(800001))).json() == {"allowed": True, "role": "orders_manager"}
    token = (await client.post("/api/admin/telegram-login", headers=tma(800001))).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/api/admin/me", headers=h)).json()
    assert "orders.fulfill" in me["permissions"] and "finance.view" not in me["permissions"]
    # the owner keeps full access
    assert (await client.get("/api/me/admin-access", headers=tma(OWNER_ID, "boss"))).json()["role"] == "owner"
    owner = {"Authorization": f"Bearer {(await client.post('/api/admin/telegram-login', headers=tma(OWNER_ID, 'boss'))).json()['token']}"}
    assert (await client.get("/api/admin/accounts", headers=owner)).status_code == 200


async def test_direct_http_bypass_is_rejected(client, admin_headers):
    await _account(client, admin_headers, "agent1", "support")
    h = await _login(client, "agent1", "agent1-pass-123")
    forbidden = [
        ("GET", "/api/admin/finance/summary", None),
        ("GET", "/api/admin/payments", None),
        ("POST", "/api/admin/products", {"title": "x", "price": "1"}),
        ("PUT", "/api/admin/settings", {"values": {"stars_enabled": "false"}}),
        ("GET", "/api/admin/accounts", None),
        ("POST", "/api/admin/accounts", {"username": "evil", "password": "evil-pass-123", "role": "head_admin"}),
        ("POST", "/api/admin/roles", {"slug": "evil", "name": "Evil", "permissions": ["staff.manage"]}),
        ("GET", "/api/admin/system/backups", None),
        ("GET", "/api/admin/system/backups/x.json.gz", None),
        ("POST", "/api/admin/orders/1/refund", {"method": "balance", "reason": "steal"}),
        ("POST", "/api/admin/approvals/1/decide", {"approve": True}),
        ("GET", "/api/admin/actions", None),
        ("POST", "/api/admin/automation/tasks/backup/run", None),
    ]
    for method, url, body in forbidden:
        r = await client.request(method, url, json=body, headers=h)
        assert r.status_code == 403, (method, url, r.status_code, r.text)


async def test_no_self_escalation_and_no_wider_grants(client, admin_headers):
    # a team lead who can manage staff but has no finance rights
    r = await client.post("/api/admin/roles", json={
        "slug": "team_lead", "name": "Тимлид", "permissions": ["staff.manage", "staff.roles", "orders.view", "support.view"],
    }, headers=admin_headers)
    assert r.status_code == 201, r.text
    lead = await _account(client, admin_headers, "lead", "team_lead")
    h = await _login(client, "lead", "lead-pass-123")
    # cannot change own account or own role
    assert (await client.patch(f"/api/admin/accounts/{lead['id']}", json={"role": "head_admin"}, headers=h)).status_code == 403
    assert (await client.patch(f"/api/admin/accounts/{lead['id']}", json={"extra_permissions": ["finance.view"]},
                               headers=h)).status_code == 403
    role_id = r.json()["id"]
    assert (await client.patch(f"/api/admin/roles/{role_id}", json={"permissions": ["finance.view"], "version": 1},
                               headers=h)).status_code == 403
    # cannot grant rights they don't hold, to others or via new roles
    assert (await client.post("/api/admin/accounts", json={"username": "fin", "password": "fin-pass-1234", "role": "finance_manager"},
                              headers=h)).status_code == 403
    assert (await client.post("/api/admin/roles", json={"slug": "sneaky", "name": "Sneaky", "permissions": ["finance.view"]},
                              headers=h)).status_code == 403
    # can add someone with a subset of their own rights
    r = await client.post("/api/admin/roles", json={"slug": "watcher", "name": "Смотритель", "permissions": ["orders.view"]},
                          headers=h)
    assert r.status_code == 201
    assert (await client.post("/api/admin/accounts", json={"username": "watch1", "password": "watch1-pass-1", "role": "watcher"},
                              headers=h)).status_code == 201
    # cannot touch the owner: the owner's Telegram id can't be attached to any account
    assert (await client.post("/api/admin/accounts", json={"telegram_id": OWNER_ID, "role": "watcher"},
                              headers=h)).status_code == 409


async def test_custom_role_denied_permission_and_expiry(client, admin_headers):
    r = await client.post("/api/admin/roles", json={"slug": "night_shift", "name": "Ночная смена", "color": "#22D3EE",
                                                    "permissions": ["orders.view", "support.view", "support.reply"]},
                          headers=admin_headers)
    assert r.status_code == 201
    acc = await _account(client, admin_headers, "night", "night_shift", denied_permissions=["support.reply"])
    assert "support.reply" not in acc["effective_permissions"] and "orders.view" in acc["effective_permissions"]
    h = await _login(client, "night", "night-pass-123")
    assert (await client.get("/api/admin/orders", headers=h)).status_code == 200
    # temporary access ends at the expiry time
    past = (utcnow() - timedelta(minutes=1)).isoformat()
    await client.patch(f"/api/admin/accounts/{acc['id']}", json={"expires_at": past}, headers=admin_headers)
    assert (await client.get("/api/admin/orders", headers=h)).status_code in (401, 403)
    # copy keeps permissions; system roles can't be deleted
    roles = (await client.get("/api/admin/roles", headers=admin_headers)).json()
    sys_role = next(x for x in roles if x["slug"] == "support")
    assert (await client.delete(f"/api/admin/roles/{sys_role['id']}", headers=admin_headers)).status_code == 409
    copy = (await client.post(f"/api/admin/roles/{sys_role['id']}/copy", headers=admin_headers)).json()
    assert copy["permissions"] == sys_role["permissions"] and copy["is_system"] is False


async def test_role_change_applies_immediately_and_version_conflict(client, admin_headers):
    r = await client.post("/api/admin/roles", json={"slug": "temp", "name": "Временная", "permissions": ["orders.view"]},
                          headers=admin_headers)
    role = r.json()
    await _account(client, admin_headers, "tmp1", "temp")
    h = await _login(client, "tmp1", "tmp1-pass-123")
    assert (await client.get("/api/admin/support/tickets", headers=h)).status_code == 403
    r = await client.patch(f"/api/admin/roles/{role['id']}", json={"permissions": ["orders.view", "support.view"],
                                                                   "version": role["version"]}, headers=admin_headers)
    assert r.status_code == 200
    assert (await client.get("/api/admin/support/tickets", headers=h)).status_code == 200  # same token, new rights
    # a second editor with the stale version is refused
    r = await client.patch(f"/api/admin/roles/{role['id']}", json={"name": "Другое имя", "version": role["version"]},
                           headers=admin_headers)
    assert r.status_code == 409


async def test_suspend_and_revoke_sessions(client, admin_headers):
    acc = await _account(client, admin_headers, "temp2", "support")
    h = await _login(client, "temp2", "temp2-pass-123")
    assert (await client.get("/api/admin/support/tickets", headers=h)).status_code == 200
    assert (await client.post(f"/api/admin/accounts/{acc['id']}/revoke-sessions", headers=admin_headers)).status_code == 200
    assert (await client.get("/api/admin/support/tickets", headers=h)).status_code == 401
    h = await _login(client, "temp2", "temp2-pass-123")
    await client.patch(f"/api/admin/accounts/{acc['id']}", json={"is_active": False}, headers=admin_headers)
    assert (await client.get("/api/admin/support/tickets", headers=h)).status_code == 401
    r = await client.post("/api/admin/login", json={"username": "temp2", "password": "temp2-pass-123"})
    assert r.status_code in (401, 403)
    await client.patch(f"/api/admin/accounts/{acc['id']}", json={"is_active": True}, headers=admin_headers)
    await _login(client, "temp2", "temp2-pass-123")


async def test_payment_limit_requires_second_person(client, admin_headers, user_headers):
    # a finance manager may confirm transfers only up to 50 UAH; larger ones need another person's approval
    r = await client.post("/api/admin/roles", json={"slug": "fin_small", "name": "Финансы (малые суммы)",
                                                    "permissions": ["payments.view", "payments.confirm", "orders.view"],
                                                    "limits": {"payment_confirm_max": 50}}, headers=admin_headers)
    assert r.status_code == 201, r.text
    await _account(client, admin_headers, "fin1", "fin_small")
    h = await _login(client, "fin1", "fin1-pass-123")
    pid = (await client.get("/api/products")).json()[0]["id"]  # 60 UAH
    order = (await client.post("/api/orders", json={"product_id": pid, "idempotency_key": "limit-0001"}, headers=user_headers)).json()
    pay = (await client.post(f"/api/orders/{order['id']}/pay", json={"method": "manual"}, headers=user_headers)).json()["payment"]
    await client.post(f"/api/payments/{pay['id']}/submit", json={"comment": "оплачено"}, headers=user_headers)
    r = await client.post(f"/api/admin/payments/{pay['id']}/confirm", json={}, headers=h)
    assert r.status_code == 202 and r.json()["status"] == "approval_required"
    req_id = r.json()["approval_id"]
    assert (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()["status"] == "pending"
    # the requester can't approve (no right, and never their own request)
    assert (await client.post(f"/api/admin/approvals/{req_id}/decide", json={"approve": True}, headers=h)).status_code == 403
    r = await client.post(f"/api/admin/approvals/{req_id}/decide", json={"approve": True}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "approved", r.text
    assert (await client.get(f"/api/orders/{order['id']}", headers=user_headers)).json()["status"] != "pending"


async def test_audit_log_has_no_secrets(client, admin_headers):
    acc = await _account(client, admin_headers, "audited", "support")
    await client.patch(f"/api/admin/accounts/{acc['id']}", json={"password": "new-secret-pass-99"}, headers=admin_headers)
    async with session_factory()() as s:
        rows = (await s.scalars(select(AdminAction).where(AdminAction.entity == "admin_account"))).all()
    blob = str([r.details for r in rows])
    assert "audited-pass-123" not in blob and "new-secret-pass-99" not in blob
    assert (await client.get("/api/admin/actions/export.csv", headers=admin_headers)).status_code == 200


async def test_backup_download_owner_only(client, admin_headers):
    await _account(client, admin_headers, "head", "head_admin")
    h = await _login(client, "head", "head-pass-123")
    assert (await client.get("/api/admin/system/backups", headers=h)).status_code == 403  # head_admin has no backups right
    r = await client.post("/api/admin/roles", json={"slug": "ops", "name": "Ops", "permissions": ["system.backups", "system.view"]},
                          headers=admin_headers)
    await _account(client, admin_headers, "ops1", "ops")
    h = await _login(client, "ops1", "ops1-pass-123")
    assert (await client.get("/api/admin/system/backups", headers=h)).status_code == 200
    assert (await client.get("/api/admin/system/backups/any.json.gz", headers=h)).status_code == 403  # owner only
    assert r.status_code == 201

#!/usr/bin/env python3
"""Session wizard destinations (phone stock / accounts 2015–2019 / premium number) + new admin tabs for vps4.

Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'wizard_targets.py': 'backend/app/services/wizard_targets.py',
    'AccountsTab.tsx': 'admin/src/components/files/AccountsTab.tsx',
    'PremiumSessionsTab.tsx': 'admin/src/components/files/PremiumSessionsTab.tsx',
    'test_wizard_targets.py': 'tests/test_wizard_targets.py',
}

RECHECK = '''
    async def _other_devices(self, flow: Flow) -> list[str]:
        """Other logged-in devices of the account (the new session itself is `current`)."""
        result = await asyncio.wait_for(flow.client(functions.account.GetAuthorizationsRequest()), timeout=15)
        return [f'{a.device_model or "Устройство"} · {a.app_name or "Telegram"}'.strip()
                for a in result.authorizations if not a.current]

    async def recheck(self, flow_id: str, owner: str) -> dict:
        """Account / premium destinations: save the file only once no other device is logged in."""
        flow = self.owned(flow_id, owner)
        async with flow.lock:
            if self.flows.get(flow.id) is not flow or flow.expires <= self.clock():
                await self._drop(flow)
                raise ServiceError('Время входа истекло. Начните заново.', 410)
            if flow.stage == 'done':
                return self.view(flow)
            if flow.stage != 'devices' or flow.me is None:
                raise ServiceError('Этот шаг уже завершён. Обновите страницу.', 409)
            try:
                flow.other_devices = await self._other_devices(flow)
                if flow.other_devices:
                    return self.view(flow)
                me = flow.me
                filename = flow.phone[1:] + '.session'
                account = describe(str(me.phone), int(me.id))
                self._publish(flow, me, filename)
                flow.filename = filename
                flow.account = account
                flow.stage = 'done'
                flow.phone = ''
                result = self.view(flow)
                result['newly_created'] = True
                return result
            except ServiceError:
                raise
            except asyncio.CancelledError:
                await self._drop(flow)
                raise
            except Exception as exc:
                phone = flow.phone
                await self._drop(flow)
                self._raise_safe(exc, phone)

    async def cancel(self, flow_id: str, owner: str) -> None:'''

DEVICES_GATE = '''                if flow.target.get('kind', 'stock') != 'stock':
                    # Accounts / premium numbers are handed to buyers: never save a session while another
                    # device is still logged in (a fresh session cannot terminate the others itself).
                    flow.me = me
                    flow.other_devices = await self._other_devices(flow)
                    if flow.other_devices:
                        flow.stage = 'devices'
                        return self.view(flow)
                filename = flow.phone[1:] + '.session'
                account = describe(str(me.phone), int(me.id))
'''

API_START = '''async def start(body: PhoneInput, admin: P('products.import'), session: SessionDep) -> dict:
    from app.services import wizard_targets

    target = await wizard_targets.check(session, admin, body.target, body.premium_number_id, body.phone)
    await session.rollback()
    return await manager.start(admin.key, body.phone, target)
'''

API_REGISTER = '''    return await _register(flow_id, await manager.confirm(flow_id, admin.key, value, stage), admin, session)


async def _register(flow_id: str, result: dict, admin, session) -> dict:
    from app.services import wizard_targets

    flow = manager.flows.get(flow_id)
    target = dict(flow.target) if flow is not None else {}
    two_fa = flow.two_fa if flow is not None else None
    stock = target.get('kind', 'stock') == 'stock'
    newly_created = result.pop('newly_created', False)
    if newly_created and result.get('account') and result['stage'] == 'done':
        try:
            # The file and DB registration are one observable operation. An
            # unregistered, authenticated file must never remain on disk.
            if stock:
                await register(session, result['filename'], result['account'], admin.key)
                log_admin(session, str(admin), 'session_created', 'file', None, filename=result['filename'], format='telethon')
            else:
                result['target_result'] = await wizard_targets.register(
                    session, admin, target, result['filename'], result['account'], two_fa)
            await session.commit()
        except ServiceError:
            await session.rollback()
            await manager.abort_registration(flow_id, admin.key)
            raise
        except Exception:'''

API_OLD_HEAD = '''    result = await manager.confirm(flow_id, admin.key, value, stage)
    newly_created = result.pop('newly_created', False)
    if newly_created and result.get('account') and result['stage'] == 'done':
        try:
            # The file and DB registration are one observable operation. An
            # unregistered, authenticated file must never remain on disk.
            await register(session, result['filename'], result['account'], admin.key)
            log_admin(session, str(admin), 'session_created', 'file', None, filename=result['filename'], format='telethon')
            await session.commit()
        except Exception:'''

API_RECHECK = '''@router.post('/telegram-sessions/{flow_id}/recheck')
async def recheck(flow_id: str, admin: P('products.import'), session: SessionDep) -> dict:
    return await _register(flow_id, await manager.recheck(flow_id, admin.key), admin, session)


@router.post('/telegram-sessions/{flow_id}/resend')'''

UI_CONSTS = '''export type WizardTarget = { kind: 'account' } | { kind: 'premium'; premiumNumberId: number; phone: string }
const TARGET_NAME: Record<string, string> = { stock: 'Создать .session', account: 'Аккаунты 2015–2019', premium: 'Красивые номера' }
const TARGET_INTRO: Record<string, string> = {
  account: 'Сессия попадёт на склад «Рандом аккаунт 2015–2019»: после оплаты бот сам выдаст номер, .session, 2FA и кнопку «Получить код».',
  premium: 'Сессия привяжется к выбранному красивому номеру; после оплаты выдайте её из карточки заказа.',
}
const TARGET_DONE: Record<string, string> = {
  stock: 'Номер добавлен в базу админки',
  account: 'Аккаунт добавлен на склад «Рандом аккаунт 2015–2019» — бот выдаст его автоматически после оплаты',
  premium: 'Сессия привязана к красивому номеру — после оплаты выдайте её из карточки заказа',
}

export function SessionWizard({ onSaved, target }: { onSaved: () => void; target?: WizardTarget }) {'''

UI_DEVICES = '''          {flow?.stage === 'devices' && <div role="status" className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm"><p className="font-semibold">Аккаунт ещё открыт на другом устройстве</p><ul className="list-disc pl-5 text-muted">{(flow.other_devices ?? []).map((d, i) => <li key={`${i}:${d}`}>{d}</li>)}</ul><p className="text-muted">На этом устройстве откройте Telegram → Настройки → Выйти (новая сессия сама завершить их не может), затем нажмите «Проверить снова». Пока это не сделано, файл не сохраняется.</p></div>}
          {!flow && target && <p className="text-sm text-muted">{TARGET_INTRO[target.kind]}</p>}
          {flow && flow.stage !== 'done' && (flow.target?.kind ?? 'stock') !== (target?.kind ?? 'stock') && <p className="text-sm text-warning">Сейчас открыт вход для раздела «{TARGET_NAME[flow.target?.kind ?? 'stock']}». Завершите его там или отмените.</p>}
          {!flow && <Field label="Номер Telegram"'''

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/services/session_wizard.py': [
        ('    registered: bool = False\n',
         '    registered: bool = False\n'
         '    target: dict = field(default_factory=dict, repr=False)\n'
         '    two_fa: str | None = field(default=None, repr=False)\n'
         '    me: Any = field(default=None, repr=False)\n'
         '    other_devices: list = field(default_factory=list)\n'),
        ("            'registered': flow.registered,\n",
         "            'registered': flow.registered,\n"
         "            'target': {'kind': flow.target.get('kind', 'stock'), 'premium_number_id': flow.target.get('premium_number_id')},\n"
         "            'other_devices': list(flow.other_devices),\n"
         "            'two_fa': bool(flow.two_fa),\n"),
        ("        client, flow.client = flow.client, None\n        flow.code_hash = ''\n",
         "        client, flow.client = flow.client, None\n        flow.code_hash = ''\n"
         "        flow.two_fa = None\n        flow.me = None\n"),
        ('    async def start(self, owner: str, phone: str) -> dict:\n',
         '    async def start(self, owner: str, phone: str, target: dict | None = None) -> dict:\n'),
        ('            flow = Flow(secrets.token_urlsafe(24), owner, phone, now + TTL, client=client)\n',
         '            flow = Flow(secrets.token_urlsafe(24), owner, phone, now + TTL, client=client)\n'
         '            flow.target = dict(target or {})\n'),
        ('                    await asyncio.wait_for(flow.client.sign_in(password=value), timeout=25)\n',
         '                    await asyncio.wait_for(flow.client.sign_in(password=value), timeout=25)\n'
         '                    flow.two_fa = value\n'),
        ("                filename = flow.phone[1:] + '.session'\n                account = describe(str(me.phone), int(me.id))\n",
         DEVICES_GATE),
        ('\n    async def cancel(self, flow_id: str, owner: str) -> None:', RECHECK),
    ],
    'backend/app/api/admin_sessions.py': [
        ('class PhoneInput(BaseModel):\n    phone: str = Field(min_length=7, max_length=32)\n',
         'class PhoneInput(BaseModel):\n    phone: str = Field(min_length=7, max_length=32)\n'
         "    target: str = Field(default='stock', pattern=r'^(stock|account|premium)$')\n"
         '    premium_number_id: int | None = None\n'),
        ("async def start(body: PhoneInput, admin: P('products.import')) -> dict:\n"
         '    return await manager.start(admin.key, body.phone)\n', API_START),
        (API_OLD_HEAD, API_REGISTER),
        ("        if result.get('delivery_medium') == 'app':\n",
         "        if result.get('delivery_medium') == 'app' and stock:\n"),
        ("@router.post('/telegram-sessions/{flow_id}/resend')", API_RECHECK),
    ],
    'admin/src/components/files/SessionWizard.tsx': [
        ("stage: 'connecting' | 'code' | 'password' | 'done';", "stage: 'connecting' | 'code' | 'password' | 'devices' | 'done';"),
        ('warning?: string; registered?: boolean;',
         'warning?: string; registered?: boolean; target?: { kind: string; premium_number_id?: number | null } | null; '
         'other_devices?: string[]; two_fa?: boolean;'),
        ('export function SessionWizard({ onSaved }: { onSaved: () => void }) {', UI_CONSTS),
        ("  const [phone, setPhone] = useState('')\n",
         "  const [phone, setPhone] = useState(target?.kind === 'premium' ? target.phone : '')\n"),
        ("{ method: 'POST', body: { phone } }",
         "{ method: 'POST', body: { phone, target: target?.kind ?? 'stock', "
         "premium_number_id: target?.kind === 'premium' ? target.premiumNumberId : null } }"),
        ("      else if (flow.stage === 'code' || flow.stage === 'password') {",
         "      else if (flow.stage === 'devices') adopt(await api<Flow>(`/telegram-sessions/${flow.id}/recheck`, { method: 'POST' }))\n"
         "      else if (flow.stage === 'code' || flow.stage === 'password') {"),
        ('{flow.account && flow.registered !== false && <p className="mt-2 text-sm text-success">Номер добавлен в базу админки</p>}',
         '{flow.account && flow.registered !== false && <p className="mt-2 text-sm text-success">'
         "{TARGET_DONE[flow.target?.kind ?? 'stock'] ?? TARGET_DONE.stock}</p>}"),
        ('<p className="mt-2 text-sm text-muted">Файл уже доступен в списке ниже. Создание сессии не публикует аккаунт в магазине.</p>',
         "{(flow.target?.kind ?? 'stock') === 'stock' && <p className=\"mt-2 text-sm text-muted\">Файл уже доступен в списке ниже. "
         'Создание сессии не публикует аккаунт в магазине.</p>}'),
        ('          {!flow && <Field label="Номер Telegram"', UI_DEVICES),
        ('onChange={(e) => setPhone(e.target.value)} required disabled={busy} />',
         "onChange={(e) => setPhone(e.target.value)} required disabled={busy} readOnly={target?.kind === 'premium'} />"),
        ("flow.stage === 'password' ? 'Подтвердить пароль' : 'Создать .session'",
         "flow.stage === 'password' ? 'Подтвердить пароль' : flow.stage === 'devices' ? 'Проверить снова' : 'Создать .session'"),
    ],
    'admin/src/pages/Files.tsx': [
        ("import { AccountSessionsUpload } from '../components/files/AccountSessionsUpload'\n",
         "import { AccountsTab } from '../components/files/AccountsTab'\n"
         "import { PremiumSessionsTab } from '../components/files/PremiumSessionsTab'\n"),
        ("  const tab = raw === 'upload' || raw === 'accounts' ? raw : 'create'\n",
         "  const tab = raw === 'upload' || raw === 'accounts' || raw === 'premium' ? raw : 'create'\n"),
        ("{ value: 'accounts', label: 'Аккаунты 2015–2019' }]}",
         "{ value: 'accounts', label: 'Аккаунты 2015–2019' }, { value: 'premium', label: 'Красивые номера' }]}"),
        ("        : tab === 'accounts' ? <AccountSessionsUpload onSaved={() => setRevision((n) => n + 1)} />\n",
         "        : tab === 'accounts' ? <AccountsTab onSaved={() => setRevision((n) => n + 1)} />\n"
         "        : tab === 'premium' ? <PremiumSessionsTab onSaved={() => setRevision((n) => n + 1)} />\n"),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['wizard_targets.py']).exists():
        print('ALREADY_PATCHED')
        return 0
    if not (root / 'backend/app/api/admin_manual_sessions.py').exists():
        print('MANUAL_SESSIONS_MISSING')
        return 1
    patched: dict[str, str] = {}
    for rel, edits in EDITS.items():
        text = (root / rel).read_text(encoding='utf-8')
        for old, new in edits:
            count = text.count(old)
            if count != 1:
                print(f'ANCHOR_MISMATCH {rel}: found {count}x: {old[:80]!r}')
                return 1
            text = text.replace(old, new, 1)
        patched[rel] = text
    if check_only:
        print('ANCHORS_OK')
        return 0
    for rel, text in patched.items():
        (root / rel).write_text(text, encoding='utf-8')
    for src, dst in NEW_FILES.items():
        shutil.copyfile(HERE / src, root / dst)
    print('PATCH_APPLIED', ' '.join(patched), ' '.join(NEW_FILES.values()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

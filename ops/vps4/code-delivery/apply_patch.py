#!/usr/bin/env python3
"""Login-code delivery fix for the session wizard deployed on vps4 (/opt/f1z-prime).

The wizard source lives only on the server, so this script patches it in place by exact
anchors. All anchors are checked before anything is written; a missing anchor aborts the
whole patch with no changes. Re-running on a patched tree is a no-op.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
MARKER = 'def delivery_medium('

WIZARD = 'backend/app/services/session_wizard.py'
API = 'backend/app/api/admin_sessions.py'
UI = 'admin/src/components/files/SessionWizard.tsx'
TEST = 'tests/test_session_code_delivery.py'

MEDIUM_FUNC = '''MAX_ATTEMPTS = 3
EMAIL_SETUP_MESSAGE = ('Telegram требует сначала привязать почту для входа на этот номер, поэтому код не отправлен. '
                       'Откройте официальное приложение Telegram на устройстве с этим аккаунтом, добавьте почту для входа '
                       'в настройках конфиденциальности и повторите.')
# Channel names the existing UI already understands, for clients that only read `delivery`.
LEGACY_DELIVERY = {'app': 'telegram', 'sms': 'sms', 'call': 'call', 'email': 'email', 'fragment': 'sms'}


def delivery_medium(code_type: Any) -> str:
    """Map auth.SentCode.type / next_type to a channel shown to the admin.

    SentCodeTypeApp means Telegram sent the code to the official app on the account's
    other devices (chat "Telegram" / service notifications), not by SMS.
    """
    name = type(code_type).__name__ if code_type is not None else ''
    if name == 'SentCodeTypeSetUpEmailRequired':
        return 'email_setup'
    if 'App' in name:
        return 'app'
    if 'Fragment' in name:
        return 'fragment'
    if 'Sms' in name:
        return 'sms'
    if 'Call' in name:
        return 'call'
    if 'Email' in name:
        return 'email'
    return 'unknown'
'''

FLOOD_OLD = "            raise ServiceError(f'Telegram ограничил запросы. Повторите через {wait} сек.', 429) from None\n"
FLOOD_NEW = """            raise ServiceError(flood_message(wait), 429) from None
        if isinstance(exc, errors.PhoneNumberFloodError):
            raise ServiceError('Telegram временно ограничил отправку кодов на этот номер из-за частых попыток. '
                               'Повторите позже.', 429) from None
"""

RESEND_METHOD = '''

    def _apply_sent(self, flow: Flow, sent: Any) -> None:
        """Keep phone_code_hash server-side and record how Telegram delivered the code."""
        code_type = getattr(sent, 'type', None)
        flow.code_hash = sent.phone_code_hash
        flow.delivery_medium = delivery_medium(code_type)
        flow.delivery = LEGACY_DELIVERY.get(flow.delivery_medium, 'telegram')
        length = getattr(code_type, 'length', None)
        flow.code_length = length if isinstance(length, int) else None
        next_type = getattr(sent, 'next_type', None)
        flow.next_medium = delivery_medium(next_type) if next_type is not None else None
        timeout = getattr(sent, 'timeout', None)
        flow.resend_at = self.clock() + (timeout if isinstance(timeout, int) and timeout > 0 else 0)
        log.info('Telegram login code sent via %s (next: %s)', type(code_type).__name__, flow.next_medium)

    async def resend(self, flow_id: str, owner: str) -> dict:
        """auth.resendCode: ask Telegram for the next channel (e.g. SMS after the app)."""
        flow = self.owned(flow_id, owner)
        async with flow.lock:
            if self.flows.get(flow.id) is not flow or flow.expires <= self.clock():
                await self._drop(flow)
                raise ServiceError('Время входа истекло. Начните заново.', 410)
            if flow.stage != 'code':
                raise ServiceError('Этот шаг уже завершён. Обновите страницу.', 409)
            if not flow.next_medium:
                raise ServiceError('Telegram не предлагает другой способ отправки кода для этого номера.', 409)
            wait = int(flow.resend_at - self.clock())
            if wait > 0:
                raise ServiceError(f'Другой способ отправки станет доступен через {wait} секунд.', 429)
            try:
                sent = await asyncio.wait_for(flow.client(functions.auth.ResendCodeRequest(
                    phone_number=flow.phone, phone_code_hash=flow.code_hash)), timeout=25)
                if not getattr(sent, 'phone_code_hash', None):
                    raise ServiceError('Telegram не выдал код для входа. Повторите позже.', 503)
                self._apply_sent(flow, sent)
                if flow.delivery_medium == 'email_setup':
                    raise ServiceError(EMAIL_SETUP_MESSAGE, 409)
                return self.view(flow)
            except errors.FloodWaitError as exc:
                wait = max(1, int(exc.seconds))
                flow.resend_at = self.clock() + wait
                raise ServiceError(flood_message(wait), 429) from None
            except errors.SendCodeUnavailableError:
                flow.next_medium = None
                raise ServiceError('Telegram больше не может отправить код другим способом. '
                                   'Введите уже полученный код или начните вход позже.', 409) from None
            except asyncio.CancelledError:
                await self._drop(flow)
                raise
            except Exception as exc:
                phone = flow.phone
                await self._drop(flow)
                self._raise_safe(exc, phone)


def flood_message(wait: int) -> str:
    return f'Telegram временно ограничил отправку кодов на этот номер, повторите через {wait} секунд.'


manager = SessionWizard()'''

UI_CONSTS = '''const MEDIUM_HINT: Record<string, string> = {
  app: 'Код отправлен в официальное приложение Telegram на ваших других устройствах (в чат «Служебные уведомления» / Telegram).',
  sms: 'Код отправлен по SMS.',
  call: 'Telegram передаст код звонком.',
  email: 'Код отправлен на почту для входа, привязанную к аккаунту.',
  fragment: 'Код отправлен через Fragment (анонимный номер).',
}
const NEXT_LABEL: Record<string, string> = { sms: 'по SMS', call: 'звонком', app: 'в приложение Telegram', email: 'на почту', fragment: 'через Fragment' }

export function SessionWizard('''

UI_HINT_OLD = '{DELIVERY[flow.delivery] ?? DELIVERY.telegram} {flow.phone_hint}</p>'
UI_HINT_NEW = (
    "{MEDIUM_HINT[flow.delivery_medium ?? ''] ?? DELIVERY[flow.delivery] ?? DELIVERY.telegram} {flow.phone_hint}</p>"
    "{flow.delivery_medium === 'app' && <p className=\"text-xs text-muted\">Откройте Telegram на телефоне или ПК, где этот номер уже авторизован. SMS в этом случае не приходит.</p>}"
    "{flow.next_delivery_medium && <p className=\"text-xs text-muted\">Не пришёл код? {resendIn > 0"
    " ? `Отправить ${NEXT_LABEL[flow.next_delivery_medium] ?? 'другим способом'} можно через ${resendIn} сек.`"
    " : <button type=\"button\" className=\"font-semibold text-primary-soft underline disabled:opacity-50\" onClick={() => { void resend() }} disabled={busy}>"
    "Отправить код {NEXT_LABEL[flow.next_delivery_medium] ?? 'другим способом'}</button>}</p>}"
)

UI_RESEND = '''  const resend = async () => {
    if (!flow || busy) return
    setBusy(true); setError(null)
    try { adopt(await api<Flow>(`/telegram-sessions/${flow.id}/resend`, { method: 'POST' })) }
    catch (e) {
      if (mounted.current) {
        setError(errMsg(e))
        if (e instanceof ApiError && [404, 409, 410, 502, 503, 504].includes(e.status)) await refresh()
      }
    } finally { if (mounted.current) setBusy(false) }
  }
  const cancel = async () => {'''

EDITS: dict[str, list[tuple[str, str]]] = {
    WIZARD: [
        ('from telethon import TelegramClient, errors\n', 'from telethon import TelegramClient, errors, functions\n'),
        ('MAX_ATTEMPTS = 3\n', MEDIUM_FUNC),
        ("    delivery: str = 'telegram'\n",
         "    delivery: str = 'telegram'\n    delivery_medium: str = 'unknown'\n    next_medium: str | None = None\n"
         "    resend_at: float = 0.0\n    code_length: int | None = None\n"),
        ("            'delivery': flow.delivery, 'attempts_left': max(0, MAX_ATTEMPTS - flow.attempts),\n",
         "            'delivery': flow.delivery, 'attempts_left': max(0, MAX_ATTEMPTS - flow.attempts),\n"
         "            'delivery_medium': flow.delivery_medium, 'code_length': flow.code_length,\n"
         "            'next_delivery_medium': flow.next_medium, 'resend_in': max(0, int(flow.resend_at - self.clock())),\n"),
        ("                flow.code_hash = sent.phone_code_hash\n"
         "                name = type(getattr(sent, 'type', None)).__name__.lower()\n"
         "                flow.delivery = 'sms' if 'sms' in name else 'call' if 'call' in name else 'email' if 'email' in name else 'telegram'\n",
         "                self._apply_sent(flow, sent)\n"
         "                if flow.delivery_medium == 'email_setup':\n"
         "                    raise ServiceError(EMAIL_SETUP_MESSAGE, 409)\n"),
        (FLOOD_OLD, FLOOD_NEW),
        ('\n\n\nmanager = SessionWizard()', RESEND_METHOD),
    ],
    API: [
        ("@router.delete('/telegram-sessions/{flow_id}')",
         "@router.post('/telegram-sessions/{flow_id}/resend')\n"
         "async def resend(flow_id: str, admin: P('products.import')) -> dict:\n"
         "    return await manager.resend(flow_id, admin.key)\n\n\n"
         "@router.delete('/telegram-sessions/{flow_id}')"),
    ],
    UI: [
        ('delivery: string; ',
         'delivery: string; delivery_medium?: string; code_length?: number | null; '
         'next_delivery_medium?: string | null; resend_in?: number; '),
        ('export function SessionWizard(', UI_CONSTS),
        ('  const [remaining, setRemaining] = useState(0)\n',
         '  const [remaining, setRemaining] = useState(0)\n  const [resendIn, setResendIn] = useState(0)\n'),
        ('setFlow(status.active); setRemaining(status.active?.expires_in ?? 0)',
         'setFlow(status.active); setRemaining(status.active?.expires_in ?? 0); setResendIn(status.active?.resend_in ?? 0)'),
        ('const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)',
         'const timer = window.setInterval(() => { setRemaining((value) => Math.max(0, value - 1)); '
         'setResendIn((value) => Math.max(0, value - 1)) }, 1000)'),
        ('setFlow(next); setRemaining(next.expires_in)',
         'setFlow(next); setRemaining(next.expires_in); setResendIn(next.resend_in ?? 0)'),
        ('  const cancel = async () => {', UI_RESEND),
        (UI_HINT_OLD, UI_HINT_NEW),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if MARKER in (root / WIZARD).read_text(encoding='utf-8'):
        print('ALREADY_PATCHED')
        return 0
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
    shutil.copyfile(HERE / 'test_session_code_delivery.py', root / TEST)
    print('PATCH_APPLIED', ' '.join(patched), TEST)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

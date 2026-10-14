#!/usr/bin/env python3
"""Phone-code stock health for vps4 (/opt/f1z-prime). Anchored, all-or-nothing, re-runnable.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
MODULE = 'backend/app/services/stock_health.py'
TEST = 'tests/test_stock_health.py'

APP_WARNING = (
    "        if result.get('delivery_medium') == 'app':\n"
    "            # The code went to another logged-in device: until that device logs out the number is not\n"
    "            # sellable (stock_health holds it and returns it to sale automatically once the account is clean).\n"
    "            result['warning'] = ('Код пришёл в приложение на другом устройстве, значит этот аккаунт ещё открыт '\n"
    "                                 'там. Пока вы не выйдете из аккаунта на том устройстве (Настройки → Выйти), '\n"
    "                                 'номер не будет продаваться. После выхода он вернётся в продажу автоматически.')\n"
)

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/worker.py': [
        ('PERIODIC: list[tuple[str, int, Callable[[], Awaitable[str]]]] = [\n',
         'async def _stock_health() -> str:\n'
         '    from app.services import stock_health\n\n'
         '    return await stock_health.check()\n\n\n'
         'PERIODIC: list[tuple[str, int, Callable[[], Awaitable[str]]]] = [\n'),
        ("    ('phone_refund_rechecks', 300, phone_refund_restock.retry_blocked),\n",
         "    ('phone_refund_rechecks', 300, phone_refund_restock.retry_blocked),\n"
         "    ('phone_stock_health', 60, _stock_health),\n"),
    ],
    'backend/app/services/phone_delivery.py': [
        ('            except ServiceError as exc:\n'
         '                await account_delivery.alert(session, order, "phone_handoff_prepare_failed",\n',
         '            except ServiceError as exc:\n'
         '                from app.services import stock_health\n\n'
         '                # Unsellable account (other devices, revoked session) and nothing sent yet:\n'
         '                # refund at once and hold the number instead of leaving the order in «sending».\n'
         '                if await stock_health.fail_sale(session, order, rows, row, exc):\n'
         '                    await session.commit()\n'
         '                    return\n'
         '                await account_delivery.alert(session, order, "phone_handoff_prepare_failed",\n'),
    ],
    'backend/app/api/admin_sessions.py': [
        ("        result['registered'] = True\n", "        result['registered'] = True\n" + APP_WARNING),
    ],
    'frontend/src/pages/OrderDetail.tsx': [
        ("{o.phone_login_delivery && o.fulfillment_status === 'sending' && !o.phone_sent_at && (",
         "{o.status === 'processing' && o.phone_login_delivery && o.fulfillment_status === 'sending' && !o.phone_sent_at && ("),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / MODULE).exists():
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
    shutil.copyfile(HERE / 'stock_health.py', root / MODULE)
    shutil.copyfile(HERE / 'test_stock_health.py', root / TEST)
    print('PATCH_APPLIED', ' '.join(patched), MODULE, TEST)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

#!/usr/bin/env python3
"""Fully automatic premium-number delivery on vps4: a paid premium order whose number has a bound session is
delivered by the bot and completed by a periodic worker task — no admin action. Builds on the manual-sessions release.

Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'premium_delivery.py': 'backend/app/services/premium_delivery.py',
    'test_premium_auto_delivery.py': 'tests/test_premium_auto_delivery.py',
}

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/worker.py': [
        ('async def _stock_health() -> str:\n',
         'async def _premium_delivery() -> str:\n'
         '    from app.services import premium_delivery\n\n'
         '    return await premium_delivery.deliver_due()\n\n\n'
         'async def _stock_health() -> str:\n'),
        ("    ('phone_stock_health', 60, _stock_health),\n",
         "    ('phone_stock_health', 60, _stock_health),\n"
         "    ('premium_auto_deliver', 30, _premium_delivery),\n"),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['premium_delivery.py']).exists():
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

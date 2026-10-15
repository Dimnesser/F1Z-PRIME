#!/usr/bin/env python3
"""Remove the session wizard's own «3 code requests per 5 minutes per admin» limit (vps4).

Telegram's real limits (FloodWait / PHONE_NUMBER_FLOOD) are still reported with their exact wait time.
Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import sys

WIZARD = 'backend/app/services/session_wizard.py'
OLD = '''            hits = self.starts[owner]
            if len(hits) >= 3:
                raise ServiceError('Слишком много запросов кода. Подождите 5 минут.', 429)
'''
NEW = '''            hits = self.starts[owner]  # kept for metrics only: Telegram itself rate-limits code requests
'''


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    path = root / WIZARD
    text = path.read_text(encoding='utf-8')
    if NEW in text:
        print('ALREADY_PATCHED')
        return 0
    if text.count(OLD) != 1:
        print(f'ANCHOR_MISMATCH {WIZARD}: found {text.count(OLD)}x')
        return 1
    if '--check' in sys.argv[2:]:
        print('ANCHORS_OK')
        return 0
    path.write_text(text.replace(OLD, NEW, 1), encoding='utf-8')
    print('PATCH_APPLIED', WIZARD)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

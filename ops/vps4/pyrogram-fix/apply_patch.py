#!/usr/bin/env python3
"""Fix Pyrogram .session upload crash on vps4: the converted file is built in /tmp and `os.replace`d onto
/srv/sessions, which is a different filesystem → OSError «Invalid cross-device link» (HTTP 500).

Build the temporary converted file inside the sessions directory (same filesystem) so the atomic replace works.
Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import sys

TARGET = 'backend/app/services/session_registry.py'
OLD = "    with tempfile.TemporaryDirectory(prefix='f1z-pyrogram-') as temporary:\n"
NEW = "    with tempfile.TemporaryDirectory(prefix='f1z-pyrogram-', dir=path.parent) as temporary:\n"


def main() -> int:
    path = pathlib.Path(sys.argv[1]).resolve() / TARGET
    text = path.read_text(encoding='utf-8')
    if NEW in text:
        print('ALREADY_PATCHED')
        return 0
    if text.count(OLD) != 1:
        print(f'ANCHOR_MISMATCH {TARGET}: found {text.count(OLD)}x')
        return 1
    if '--check' in sys.argv[2:]:
        print('ANCHORS_OK')
        return 0
    path.write_text(text.replace(OLD, NEW, 1), encoding='utf-8')
    print('PATCH_APPLIED', TARGET)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

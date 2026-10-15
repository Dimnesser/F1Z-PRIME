#!/usr/bin/env python3
"""Mini App «Код для входа»: show the account password («Пароль: 67») right under «Получить код входа» (vps4).

Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import sys

CARD = 'frontend/src/components/LoginCodeCard.tsx'
MARKER = 'const ACCOUNT_PASSWORD'
EDITS = [
    ("import { Button } from './ui'\n",
     "import { Button } from './ui'\n\n"
     "// Two-step verification password set on the sold accounts (the same for every number).\n"
     "const ACCOUNT_PASSWORD = '67'\n"),
    ('  const [copied, setCopied] = useState(false)\n',
     '  const [copied, setCopied] = useState(false)\n'
     '  const [passwordCopied, setPasswordCopied] = useState(false)\n'),
    ('  const copyCode = async () => {\n',
     '  const copyPassword = async () => {\n'
     '    try {\n'
     '      await navigator.clipboard.writeText(ACCOUNT_PASSWORD)\n'
     '      setPasswordCopied(true)\n'
     '    } catch {\n'
     '      // the password is shown on screen and can be typed in\n'
     '    }\n'
     '  }\n\n'
     '  const copyCode = async () => {\n'),
    ('        <KeyRound className="h-4 w-4" aria-hidden /> Получить код входа\n      </Button>\n',
     '        <KeyRound className="h-4 w-4" aria-hidden /> Получить код входа\n      </Button>\n'
     '      <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-elevated px-3 py-2.5">\n'
     '        <span className="text-[13px]">🔐 Пароль: <b className="num select-text font-display text-[18px] tracking-widest">{ACCOUNT_PASSWORD}</b></span>\n'
     '        <button type="button" onClick={() => { void copyPassword() }}\n'
     '          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-primary">\n'
     '          <Copy className="h-4 w-4" aria-hidden /> {passwordCopied ? \'Скопировано\' : \'Скопировать\'}\n'
     '        </button>\n'
     '      </div>\n'
     '      <p className="mt-1.5 text-[11.5px] text-muted">Если Telegram после кода попросит пароль двухэтапной проверки — введите этот.</p>\n'),
]


def main() -> int:
    path = pathlib.Path(sys.argv[1]).resolve() / CARD
    text = path.read_text(encoding='utf-8')
    if MARKER in text:
        print('ALREADY_PATCHED')
        return 0
    for old, new in EDITS:
        if text.count(old) != 1:
            print(f'ANCHOR_MISMATCH {CARD}: found {text.count(old)}x: {old[:80]!r}')
            return 1
        text = text.replace(old, new, 1)
    if '--check' in sys.argv[2:]:
        print('ANCHORS_OK')
        return 0
    path.write_text(text, encoding='utf-8')
    print('PATCH_APPLIED', CARD)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

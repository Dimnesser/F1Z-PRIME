#!/usr/bin/env python3
"""New premium numbers created together with their session (premium base, like the accounts base). vps4.

Builds on wizard-targets. Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'wizard_targets.py': 'backend/app/services/wizard_targets.py',
    'PremiumSessionsTab.tsx': 'admin/src/components/files/PremiumSessionsTab.tsx',
    'PremiumNewNumber.tsx': 'admin/src/components/files/PremiumNewNumber.tsx',
    'test_premium_new.py': 'tests/test_premium_new.py',
}
# Files this patch replaces must still be the wizard-targets versions.
REPLACED = {
    'backend/app/services/wizard_targets.py': "KINDS = ('stock', 'account', 'premium')\n",
    'admin/src/components/files/PremiumSessionsTab.tsx': "const [mode, setMode] = useState<'create' | 'upload'>('create')",
}

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/api/admin_sessions.py': [
        ("    target: str = Field(default='stock', pattern=r'^(stock|account|premium)$')\n",
         "    target: str = Field(default='stock', pattern=r'^(stock|account|premium|premium_new)$')\n"
         '    premium_new: dict | None = None\n'),
        ('    target = await wizard_targets.check(session, admin, body.target, body.premium_number_id, body.phone)\n',
         '    target = await wizard_targets.check(session, admin, body.target, body.premium_number_id, body.phone,\n'
         '                                        body.premium_new)\n'),
    ],
    'admin/src/components/files/SessionWizard.tsx': [
        ("export type WizardTarget = { kind: 'account' } | { kind: 'premium'; premiumNumberId: number; phone: string }\n",
         'export type PremiumNewInput = { price: string; tier: string; title: string; display_mask: string | null; '
         'description: string; status: string }\n'
         "export type WizardTarget = { kind: 'account' } | { kind: 'premium'; premiumNumberId: number; phone: string }"
         " | { kind: 'premium_new'; premium: PremiumNewInput }\n"),
        ("account: 'Аккаунты 2015–2019', premium: 'Красивые номера' }",
         "account: 'Аккаунты 2015–2019', premium: 'Красивые номера', premium_new: 'Красивые номера' }"),
        ("  premium: 'Сессия привяжется к выбранному красивому номеру; после оплаты выдайте её из карточки заказа.',\n",
         "  premium: 'Сессия привяжется к выбранному красивому номеру; после оплаты выдайте её из карточки заказа.',\n"
         "  premium_new: 'Номер добавится в базу красивых номеров вместе с сессией сразу после входа.',\n"),
        ("  premium: 'Сессия привязана к красивому номеру — после оплаты выдайте её из карточки заказа',\n",
         "  premium: 'Сессия привязана к красивому номеру — после оплаты выдайте её из карточки заказа',\n"
         "  premium_new: 'Номер добавлен в базу красивых номеров вместе с сессией — он уже в магазине (если не скрыт)',\n"),
        ("premium_number_id: target?.kind === 'premium' ? target.premiumNumberId : null } }",
         "premium_number_id: target?.kind === 'premium' ? target.premiumNumberId : null, "
         "premium_new: target?.kind === 'premium_new' ? target.premium : null } }"),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    current = root / NEW_FILES['wizard_targets.py']
    if current.exists() and "'premium_new'" in current.read_text(encoding='utf-8'):
        print('ALREADY_PATCHED')
        return 0
    for rel, marker in REPLACED.items():
        if not (root / rel).exists() or marker not in (root / rel).read_text(encoding='utf-8'):
            print(f'BASE_MISMATCH {rel}')
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

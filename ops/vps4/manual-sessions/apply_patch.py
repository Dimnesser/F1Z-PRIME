#!/usr/bin/env python3
"""Manual .session uploads (accounts 2015–2019 + premium numbers) for vps4. Anchored, all-or-nothing, re-runnable.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'admin_manual_sessions.py': 'backend/app/api/admin_manual_sessions.py',
    '20261015_0019_manual_sessions.py': 'backend/migrations/versions/20261015_0019_manual_sessions.py',
    'AccountSessionsUpload.tsx': 'admin/src/components/files/AccountSessionsUpload.tsx',
    'PremiumSessionBox.tsx': 'admin/src/components/files/PremiumSessionBox.tsx',
    'PremiumAccountButton.tsx': 'admin/src/components/orders/PremiumAccountButton.tsx',
    'test_manual_sessions.py': 'tests/test_manual_sessions.py',
}

MODEL = '''

class ManualSession(Base):
    """Manually uploaded .session for the accounts product or one premium number; never part of phone stock."""

    __tablename__ = "manual_sessions"
    __table_args__ = (
        UniqueConstraint("filename", name="uq_manual_sessions_filename"),
        UniqueConstraint("premium_number_id", name="uq_manual_sessions_premium"),
        CheckConstraint("purpose IN ('account','premium')", name="ck_manual_sessions_purpose"),
        Index("ix_manual_sessions_phone", "phone_e164"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    purpose: Mapped[str] = mapped_column(String(16), nullable=False)
    phone_e164: Mapped[str] = mapped_column(String(24), nullable=False)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    premium_number_id: Mapped[int | None] = mapped_column(ForeignKey("premium_numbers.id", ondelete="CASCADE"))
    two_fa_enc: Mapped[str | None] = mapped_column(Text)
    added_by: Mapped[str] = mapped_column(String(128), default="", server_default="", nullable=False)
    delivered_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
'''

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/services/session_registry.py': [
        ('        known = set((await db.scalars(select(SessionAccount.filename))).all())\n',
         '        known = set((await db.scalars(select(SessionAccount.filename))).all())\n'
         '        from app.models import ManualSession\n\n'
         '        # Manually uploaded account / premium sessions are never phone stock.\n'
         '        known |= set((await db.scalars(select(ManualSession.filename))).all())\n'),
        ("        if await db.scalar(select(SessionAccount.id).where(SessionAccount.filename == payload['filename'])):\n",
         '        from app.models import ManualSession\n\n'
         "        if await db.scalar(select(ManualSession.id).where(ManualSession.filename == payload['filename'])):\n"
         '            return\n'
         "        if await db.scalar(select(SessionAccount.id).where(SessionAccount.filename == payload['filename'])):\n"),
    ],
    'admin/src/pages/Files.tsx': [
        ("import { SavedFiles } from '../components/files/SavedFiles'\n",
         "import { SavedFiles } from '../components/files/SavedFiles'\n"
         "import { AccountSessionsUpload } from '../components/files/AccountSessionsUpload'\n"),
        ("  const tab = params.get('tab') === 'upload' ? 'upload' : 'create'\n",
         "  const raw = params.get('tab')\n"
         "  const tab = raw === 'upload' || raw === 'accounts' ? raw : 'create'\n"),
        ("{ value: 'upload', label: 'Загрузить файл' }]}",
         "{ value: 'upload', label: 'Загрузить файл' }, { value: 'accounts', label: 'Аккаунты 2015–2019' }]}"),
        ("      {tab === 'create' ? <SessionWizard onSaved={() => setRevision((n) => n + 1)} /> : "
         "<FileUploadPanel onSaved={() => setRevision((n) => n + 1)} />}\n",
         "      {tab === 'create' ? <SessionWizard onSaved={() => setRevision((n) => n + 1)} />\n"
         "        : tab === 'accounts' ? <AccountSessionsUpload onSaved={() => setRevision((n) => n + 1)} />\n"
         "          : <FileUploadPanel onSaved={() => setRevision((n) => n + 1)} />}\n"),
    ],
    'admin/src/pages/Premium.tsx': [
        ("import { useApi } from '../lib/useApi'\n",
         "import { useApi } from '../lib/useApi'\n"
         "import { PremiumSessionBox } from '../components/files/PremiumSessionBox'\n"),
        ('            <Field label="Описание" className="sm:col-span-2">',
         "            {form.id && <PremiumSessionBox numberId={form.id} sold={form.status === 'sold'} />}\n"
         '            <Field label="Описание" className="sm:col-span-2">'),
    ],
    'admin/src/components/orders/OrderCard.tsx': [
        ("import { useApi } from '../../lib/useApi'\n",
         "import { useApi } from '../../lib/useApi'\n"
         "import { PremiumAccountButton } from './PremiumAccountButton'\n"),
        ('            {data.review && (',
         '            {o.premium_number_id && <PremiumAccountButton orderId={o.id} onDone={() => { reload(); onChanged?.() }} />}\n'
         '            {data.review && ('),
    ],
}
APPEND = {
    'backend/app/api/admin_files.py':
        '\n\n# Manual account / premium-number session uploads register on this router.\n'
        'from app.api import admin_manual_sessions  # noqa: E402,F401\n',
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['admin_manual_sessions.py']).exists():
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
    for rel, tail in APPEND.items():
        patched[rel] = (root / rel).read_text(encoding='utf-8').rstrip('\n') + '\n' + tail
    models = (root / 'backend/app/models.py').read_text(encoding='utf-8')
    if 'class ManualSession' in models:
        print('MODEL_EXISTS')
        return 1
    for name in ('CheckConstraint', 'UniqueConstraint', 'Index', 'String', 'Text', 'DateTime', 'ForeignKey', 'func'):
        if name not in models:
            print(f'MODELS_MISSING_IMPORT {name}')
            return 1
    patched['backend/app/models.py'] = models.rstrip('\n') + '\n' + MODEL
    versions = root / 'backend/migrations/versions'
    if any(p.name.split('_')[1:2] == ['0019'] for p in versions.glob('*.py')):
        print('MIGRATION_0019_EXISTS')
        return 1
    if not any(p.name.split('_')[1:2] == ['0018'] for p in versions.glob('*.py')):
        print('MIGRATION_0018_MISSING')
        return 1
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

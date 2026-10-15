#!/usr/bin/env python3
"""TData (.zip) uploads become sellable numbers: converted to a Telethon .session, verified online and registered in
phone stock exactly like a .session upload. Anything that cannot be sold is kept as a plain archive with the reason.

Anchored, all-or-nothing, re-runnable. Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
NEW_FILES = {
    'tdata_import.py': 'backend/app/services/tdata_import.py',
    'tdata_factory.py': 'tests/tdata_factory.py',
    'test_tdata_import.py': 'tests/test_tdata_import.py',
}

HELPER = '''    warning: str | None = None


class UploadedTData(UploadedFile):
    """A TData archive whose account was verified and put on sale as a .session."""

    session_filename: str
    phone: str


async def _tdata_to_stock(session, path: Path, admin) -> tuple[dict | None, str | None]:  # noqa: ANN001
    """Convert a tdata zip to <name>.session, verify it online and register it like a .session upload.

    Returns (sale info, None) on success, (None, reason) when the archive is kept but not sold,
    and (None, None) for archives that are not a Telegram Desktop folder (saved as before).
    """
    from app.services import session_registry, tdata_import

    try:
        data = await asyncio.to_thread(tdata_import.to_session_bytes, path)
    except tdata_import.TDataError as exc:
        return None, None if exc.code == tdata_import.NOT_TDATA else f"Архив сохранён, но номер не добавлен в продажу: {exc.message}"
    name = tdata_import.session_name(path.name)
    target = path.parent / name
    published = False
    try:
        validate_filename(name, FORMAT_EXTENSIONS[UploadFormat.telethon])
        await lock_filename(session, name)
        with staged_file(path.parent, name) as (temporary, _):
            await asyncio.to_thread(temporary.write, data)
        published = True
        account, key = await session_registry.verify_identity(name)
        async with session.begin_nested():
            await session_registry.register(session, name, account, admin.key, expected_key=key)
    except FileExistsError:
        return None, f"Архив сохранён, но сессия {name} уже существует — номер не добавлен повторно."
    except ServiceError as exc:
        if published:
            target.unlink(missing_ok=True)
        return None, f"Архив сохранён, но номер не добавлен в продажу: {exc.message}"
    except BaseException:
        if published:
            target.unlink(missing_ok=True)
        raise
    return {"session_filename": name, "phone": account["phone_e164"]}, None


def _storage_error'''

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/api/admin_files.py': [
        ('    warning: str | None = None\n\n\ndef _storage_error', HELPER),
        ('@router.post("/files/upload", response_model=UploadedFile, status_code=201)',
         '@router.post("/files/upload", response_model=UploadedTData | UploadedFile, status_code=201)'),
        ('    path = Path(get_settings().sessions_dir) / name\n    try:\n',
         '    path = Path(get_settings().sessions_dir) / name\n    converted: dict | None = None\n'
         '    tdata_warning: str | None = None\n    try:\n'),
        ('            await session_registry.register(session, name, account, admin.key, expected_key=key)\n'
         '        # Filenames and sizes only: file contents never enter the audit log.\n',
         '            await session_registry.register(session, name, account, admin.key, expected_key=key)\n'
         '        elif format == UploadFormat.tdata:\n'
         '            converted, tdata_warning = await _tdata_to_stock(session, path, admin)\n'
         '        # Filenames and sizes only: file contents never enter the audit log.\n'),
        ('    return UploadedFile(filename=name, format=format, size=size)\n',
         '    if converted:\n'
         '        return UploadedTData(filename=name, format=format, size=size, **converted)\n'
         '    return UploadedFile(filename=name, format=format, size=size, warning=tdata_warning)\n'),
    ],
    'admin/src/components/files/FileUploadPanel.tsx': [
        ('type UploadedFile = { filename: string; format: UploadFormat; size: number; warning: string | null }',
         'type UploadedFile = { filename: string; format: UploadFormat; size: number; warning: string | null; '
         'session_filename?: string; phone?: string }'),
        ("(status.file.format === 'telethon' || status.file.format === 'pyrogram') &&",
         "(status.file.format === 'telethon' || status.file.format === 'pyrogram' || !!status.file.session_filename) &&"),
        ("(status.file.format === 'tdata' || status.file.format === 'json') &&",
         "((status.file.format === 'tdata' && !status.file.session_filename && !status.file.warning) || status.file.format === 'json') &&"),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / NEW_FILES['tdata_import.py']).exists():
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
    for src, dst in NEW_FILES.items():
        shutil.copyfile(HERE / src, root / dst)
    print('PATCH_APPLIED', ' '.join(patched), ' '.join(NEW_FILES.values()))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

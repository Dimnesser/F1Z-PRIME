"""Logical backups: every table dumped to gzipped JSON in BACKUP_DIR (owner can download from the admin panel).

These complement (not replace) `pg_dump` backups made on the server before deploys.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import re
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select

from app.db import Base, session_factory

log = logging.getLogger("f1z.backup")
KEEP = 14
NAME_RE = re.compile(r"^f1z-backup-\d{8}-\d{6}\.json\.gz$")


def backup_dir() -> Path:
    path = Path(os.environ.get("BACKUP_DIR", "/srv/backups"))
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".probe"
        probe.write_text("ok")
        probe.unlink()
        return path
    except OSError:
        fallback = Path("/tmp/f1z-backups")
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def _default(value: object) -> object:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "value"):
        return value.value  # enums
    return str(value)


async def create_backup() -> dict:
    data: dict[str, list[dict]] = {}
    async with session_factory()() as session:
        for table in Base.metadata.sorted_tables:
            rows = (await session.execute(select(table))).mappings().all()
            data[table.name] = [dict(r) for r in rows]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = backup_dir() / f"f1z-backup-{stamp}.json.gz"
    payload = {"created_at": datetime.now(timezone.utc).isoformat(), "format": 1, "tables": data}
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, default=_default, ensure_ascii=False)
    _cleanup()
    log.info("backup written: %s", path.name)
    return describe(path)


def describe(path: Path) -> dict:
    st = path.stat()
    return {
        "name": path.name,
        "size": st.st_size,
        "created_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
    }


def list_backups() -> list[dict]:
    files = sorted((p for p in backup_dir().iterdir() if NAME_RE.match(p.name)), reverse=True)
    return [describe(p) for p in files]


def get_path(name: str) -> Path | None:
    if not NAME_RE.match(name):
        return None
    path = backup_dir() / name
    return path if path.is_file() else None


def _cleanup() -> None:
    files = sorted((p for p in backup_dir().iterdir() if NAME_RE.match(p.name)), reverse=True)
    for old in files[KEEP:]:
        old.unlink(missing_ok=True)


def last_backup_age_hours() -> float | None:
    files = list_backups()
    if not files:
        return None
    newest = datetime.fromisoformat(files[0]["created_at"])
    return (datetime.now(timezone.utc) - newest).total_seconds() / 3600

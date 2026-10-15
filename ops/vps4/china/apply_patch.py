#!/usr/bin/env python3
"""China (+86) region for the catalog on vps4, via regions.py (same mechanism as Japan). Anchored, all-or-nothing.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
REGIONS = 'backend/app/services/regions.py'
TEST = 'tests/test_region_china.py'

EDITS: dict[str, list[tuple[str, str]]] = {
    REGIONS: [
        ('    ("JP", "Япония", "🇯🇵", "+81", "250", "6.00", 650, 140),\n',
         '    ("JP", "Япония", "🇯🇵", "+81", "250", "6.00", 650, 140),\n'
         '    ("CN", "Китай", "🇨🇳", "+86", "100", "6.00", 225, 150),\n'),
    ],
    'backend/app/services/phones.py': [
        ('    "JP": ("Япония", "🇯🇵"),\n', '    "JP": ("Япония", "🇯🇵"),\n    "CN": ("Китай", "🇨🇳"),\n'),
    ],
    'tests/test_api.py': [
        ('    assert len(data) == 14 and "CL" not in data and "VN" not in data and data["JP"]["dial_code"] == "+81"\n',
         '    assert len(data) == 15 and "CL" not in data and "VN" not in data and data["JP"]["dial_code"] == "+81"\n'
         '    assert data["CN"]["dial_code"] == "+86"\n'),
    ],
    'tests/test_catalog_2026.py': [
        ('    assert list(data) == [c[0] for c in catalog_update.COUNTRIES_2026_10] + ["JP"]\n',
         '    assert list(data) == [c[0] for c in catalog_update.COUNTRIES_2026_10] + ["JP", "CN"]\n'),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if '("CN",' in (root / REGIONS).read_text(encoding='utf-8'):
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
    shutil.copyfile(HERE / 'test_region_china.py', root / TEST)
    print('PATCH_APPLIED', ' '.join(patched), TEST)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

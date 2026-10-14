#!/usr/bin/env python3
"""Japan (+81) region for the catalog on vps4 (/opt/f1z-prime). Anchored, all-or-nothing, re-runnable.

Usage: python3 apply_patch.py /path/to/project-copy [--check]
"""
from __future__ import annotations

import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
REGIONS = 'backend/app/services/regions.py'
TEST = 'tests/test_region_japan.py'

EDITS: dict[str, list[tuple[str, str]]] = {
    'backend/app/seed.py': [
        ('from app.services import catalog_update, rbac\n', 'from app.services import catalog_update, rbac, regions\n'),
        ('            created["catalog_update"] = report  # type: ignore[assignment]\n',
         '            created["catalog_update"] = report  # type: ignore[assignment]\n'
         '        # regions added after the 2026-10 catalog (Japan); never overwrites admin edits\n'
         '        added_regions = await regions.ensure(session)\n'
         '        if added_regions:\n'
         '            created["regions"] = added_regions  # type: ignore[assignment]\n'),
    ],
    'backend/app/services/phones.py': [
        ('    "US": ("США", "🇺🇸"), "CA": ("Канада", "🇨🇦"),',
         '    "JP": ("Япония", "🇯🇵"),\n    "US": ("США", "🇺🇸"), "CA": ("Канада", "🇨🇦"),'),
    ],
    'tests/test_api.py': [
        ('    # catalog 2026-10: exactly 13 countries; old ones (CL, VN, ID) hidden, not deleted\n'
         '    assert len(data) == 13 and "CL" not in data and "VN" not in data\n',
         '    # catalog 2026-10: 13 countries + Japan (regions.py); old ones (CL, VN, ID) hidden, not deleted\n'
         '    assert len(data) == 14 and "CL" not in data and "VN" not in data and data["JP"]["dial_code"] == "+81"\n'),
    ],
    'tests/test_catalog_2026.py': [
        ('    assert list(data) == [c[0] for c in catalog_update.COUNTRIES_2026_10]  # order of the price list\n',
         '    # order of the price list, then regions added later (regions.py)\n'
         '    assert list(data) == [c[0] for c in catalog_update.COUNTRIES_2026_10] + ["JP"]\n'),
    ],
}


def main() -> int:
    root = pathlib.Path(sys.argv[1]).resolve()
    check_only = '--check' in sys.argv[2:]
    if (root / REGIONS).exists():
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
    if '"JP":' in (root / 'backend/app/services/phones.py').read_text(encoding='utf-8'):
        print('JP_ALREADY_IN_COUNTRY_RU')
        return 1
    if check_only:
        print('ANCHORS_OK')
        return 0
    for rel, text in patched.items():
        (root / rel).write_text(text, encoding='utf-8')
    shutil.copyfile(HERE / 'regions.py', root / REGIONS)
    shutil.copyfile(HERE / 'test_region_japan.py', root / TEST)
    print('PATCH_APPLIED', ' '.join(patched), REGIONS, TEST)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

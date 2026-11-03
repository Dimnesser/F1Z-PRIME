"""Prepare a safe, non-deliverable F1Z catalog CSV from legacy aggregate inventory.

This is a preview, NOT a stock synchronization. No account credentials or numbers
are read or exported. All products remain hidden with stock=0.
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from legacy_panel_audit import audit

FIELDS = ['title', 'description', 'category', 'country_code', 'price', 'stock', 'status', 'delivery_note']


def preview(db_path: Path) -> list[dict[str, str]]:
    result = []
    for item in audit(db_path):
        region = str(item['region']).strip() or 'unknown'
        price = str(item['price'])
        result.append({
            'title': f'Legacy {region} — {price}',
            'description': f'Старая панель: {item["available"]} доступно, {item["sold"]} продано (только для сверки)',
            'category': 'numbers',
            'country_code': '',  # legacy region is not guaranteed to match F1Z country codes
            'price': price,
            'stock': '0',
            'status': 'hidden',
            'delivery_note': 'Требуется ручная проверка товара и способа выдачи',
        })
    return result


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('database', type=Path)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    if not args.database.is_file():
        p.error('database file does not exist')
    if args.output.exists():
        p.error('output already exists; refusing to overwrite')
    rows = preview(args.database)
    with args.output.open('x', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f'Prepared {len(rows)} HIDDEN draft products with stock=0: {args.output}')
    print('Review CSV before importing via admin → Products → Import.')


if __name__ == '__main__':
    main()

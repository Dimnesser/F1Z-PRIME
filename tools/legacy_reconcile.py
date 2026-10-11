"""Compare legacy aggregate catalog with F1Z product export without importing secrets.

Only reads legacy accounts' region/price/sold columns and exported product metadata.
Outputs a human-reviewable CSV; it never creates live stock or accesses sessions.
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal, InvalidOperation
from pathlib import Path

from legacy_panel_audit import audit


def reconcile(database: Path, products_csv: Path) -> list[dict[str, str]]:
    with products_csv.open(encoding='utf-8-sig', newline='') as file:
        delimiter = ';' if file.readline().count(';') > 1 else ','
        file.seek(0)
        reader = csv.DictReader(file, delimiter=delimiter)
        if not {'title', 'price'} <= set(reader.fieldnames or []):
            raise ValueError('F1Z export must contain title and price columns')
        products = list(reader)
    result = []
    for item in audit(database):
        region = str(item['region']).strip()
        try:
            price = Decimal(str(item['price']))
        except InvalidOperation:
            raise ValueError('Legacy record has an invalid price') from None
        if not price.is_finite() or price <= 0:
            raise ValueError('Legacy record has a nonpositive or nonfinite price')
        title = f'Legacy {region} — {price}'
        matches = [p for p in products if p.get('title', '').strip().casefold() == title.casefold()]
        result.append({
            'region': region, 'price': str(price), 'legacy_total': str(item['total']),
            'legacy_available_unverified': str(item['available']),
            'f1z_matching_ids': '|'.join(p.get('id', '') for p in matches),
            'action': 'REVIEW_EXISTING' if matches else 'REVIEW_NEW_DRAFT',
            'note': 'Never count legacy Telegram sessions as deliverable stock',
        })
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('legacy_db', type=Path)
    parser.add_argument('f1z_products_export', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Output exists; refusing to overwrite')
    rows = reconcile(args.legacy_db, args.f1z_products_export)
    with args.output.open('x', encoding='utf-8-sig', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=['region', 'price', 'legacy_total', 'legacy_available_unverified', 'f1z_matching_ids', 'action', 'note'])
        writer.writeheader()
        writer.writerows(rows)
    print(f'Compared {len(rows)} legacy groups. Review {args.output}; no products were changed.')


if __name__ == '__main__':
    main()

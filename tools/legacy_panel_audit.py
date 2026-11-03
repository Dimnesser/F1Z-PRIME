"""Read-only, privacy-preserving audit of the legacy panel's accounts.db.

Exports aggregate inventory statistics only. Does not read login codes, sessions,
user records, phone numbers, or financial transactions.
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
from pathlib import Path


def audit(db_path: Path) -> list[dict]:
    uri = f"{db_path.resolve().as_uri()}?mode=ro&immutable=1"
    with sqlite3.connect(uri, uri=True) as db:
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'accounts' not in tables:
            raise ValueError('Legacy database does not contain accounts table')
        cols = {row[1] for row in db.execute('PRAGMA table_info(accounts)')}
        if not {'region', 'price', 'sold'} <= cols:
            raise ValueError('Legacy accounts table is missing expected columns')
        result = db.execute('''
            SELECT COALESCE(region, 'unknown'), price,
                   COUNT(*), SUM(CASE WHEN sold = 0 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN sold <> 0 THEN 1 ELSE 0 END)
            FROM accounts GROUP BY region, price ORDER BY region, price
        ''').fetchall()
    return [dict(region=region, price=price, total=total, available=available, sold=sold)
            for region, price, total, available, sold in result]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path, help='Path to legacy accounts.db')
    parser.add_argument('--output', type=Path, help='Optional aggregate CSV output')
    args = parser.parse_args()
    rows = audit(args.database)
    if args.output:
        with args.output.open('w', newline='', encoding='utf-8-sig') as out:
            writer = csv.DictWriter(out, fieldnames=['region', 'price', 'total', 'available', 'sold'])
            writer.writeheader()
            writer.writerows(rows)
    for row in rows:
        print(f"{row['region']}: price={row['price']}, total={row['total']}, available={row['available']}, sold={row['sold']}")
    print(f'Total records: {sum(row["total"] for row in rows)}')


if __name__ == '__main__':
    main()

import csv
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from legacy_reconcile import reconcile


class ReconcileTest(unittest.TestCase):
    def test_existing_and_missing_drafts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db = root / 'accounts.db'
            with sqlite3.connect(db) as conn:
                conn.execute('CREATE TABLE accounts (region TEXT, price REAL, sold INTEGER, phone TEXT)')
                conn.executemany('INSERT INTO accounts VALUES (?, ?, ?, ?)', [
                    ('US', 75, 0, '+15555550000'), ('US', 75, 1, '+15555550001'),
                    ('CA', 65, 0, '+15555550002')])
            export = root / 'products.csv'
            with export.open('w', newline='') as f:
                w = csv.writer(f)
                w.writerow(['id', 'title', 'price'])
                w.writerow(['3', 'Legacy US — 75.0', '75'])
            result = reconcile(db, export)
            self.assertEqual([r['action'] for r in result], ['REVIEW_NEW_DRAFT', 'REVIEW_EXISTING'])
            self.assertEqual(result[1]['f1z_matching_ids'], '3')
            self.assertNotIn('555555', str(result))


if __name__ == '__main__':
    unittest.main()

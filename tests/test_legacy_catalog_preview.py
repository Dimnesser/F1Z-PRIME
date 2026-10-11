import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from legacy_catalog_preview import preview


def test_preview_is_hidden_and_has_no_credentials(tmp_path):
    path = tmp_path / 'accounts.db'
    with sqlite3.connect(path) as db:
        db.execute('CREATE TABLE accounts(region TEXT, price INTEGER, sold INTEGER, phone TEXT, secret TEXT)')
        db.execute('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)', ('US', 75, 0, '+15550001111', 'sensitive-code'))
    rows = preview(path)
    assert len(rows) == 1
    assert rows[0]['status'] == 'hidden'
    assert rows[0]['stock'] == '0'
    assert '+15550001111' not in str(rows)
    assert 'sensitive-code' not in str(rows)

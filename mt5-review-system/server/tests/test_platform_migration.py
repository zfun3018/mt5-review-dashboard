import sqlite3
import unittest

from app import storage
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class PlatformMigrationTest(TemporaryStorageCase):
    def test_legacy_import_executions_without_identity_key_can_be_migrated(self):
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("DROP TABLE import_execution_matches")
            conn.execute("DROP TABLE import_batch_executions")
            conn.execute("DROP TABLE import_executions")
            conn.execute(
                """
                CREATE TABLE import_executions (
                    id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL UNIQUE,
                    batch_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    account TEXT NOT NULL,
                    trade_date TEXT NOT NULL,
                    time_utc TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    side TEXT NOT NULL,
                    offset TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    remaining_quantity REAL NOT NULL,
                    price REAL NOT NULL,
                    fee REAL NOT NULL DEFAULT 0,
                    pnl REAL NOT NULL DEFAULT 0,
                    trade_id TEXT NOT NULL DEFAULT '',
                    order_id TEXT NOT NULL DEFAULT '',
                    source_kind TEXT NOT NULL DEFAULT '',
                    source_filename TEXT NOT NULL DEFAULT '',
                    source_sheet TEXT NOT NULL DEFAULT '',
                    source_row_number INTEGER,
                    raw_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT NOT NULL DEFAULT 'unmatched',
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.commit()
        finally:
            conn.close()

        storage.init_db(seed=False)

        conn = sqlite3.connect(storage.DB_PATH)
        try:
            columns = {
                row[1]
                for row in conn.execute("PRAGMA table_info(import_executions)").fetchall()
            }
            indexes = {
                row[1]
                for row in conn.execute("PRAGMA index_list(import_executions)").fetchall()
            }
        finally:
            conn.close()

        self.assertIn("identity_key", columns)
        self.assertIn("idx_import_executions_identity", indexes)

    def test_legacy_tonghuashun_identity_is_migrated_for_all_platform_tables(self):
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            conn.execute(
                "INSERT INTO trades (id, platform, symbol, side, lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl) "
                "VALUES ('LEGACY-1', 'tonghuashun_futures', 'IF2611', 'long', 1, '2026-10-19T01:00:00Z', '2026-10-19T02:00:00Z', 3600, 4000, 4010, 10)"
            )
            conn.commit()
        finally:
            conn.close()

        storage.init_db(seed=False)

        conn = sqlite3.connect(storage.DB_PATH)
        try:
            platform = conn.execute(
                "SELECT platform FROM trades WHERE id = 'LEGACY-1'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(platform, DOMESTIC_FUTURES_PLATFORM)


if __name__ == "__main__":
    unittest.main()

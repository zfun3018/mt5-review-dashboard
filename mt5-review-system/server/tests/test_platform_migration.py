import sqlite3
import unittest

from app import storage
from app.data.import_repository import classify_import_executions_conn, create_import_batch
from app.data.normalized_import import normalize_execution
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class PlatformMigrationTest(TemporaryStorageCase):
    def test_migrated_execution_identity_is_reused_by_new_imports(self):
        original_batch = create_import_batch(
            DOMESTIC_FUTURES_PLATFORM,
            "legacy.csv",
            "tonghuashun",
            "csv",
        )
        with storage.db() as conn:
            conn.execute(
                """
                INSERT INTO import_executions (
                    id, fingerprint, identity_key, batch_id, platform, account, trade_date,
                    time_utc, symbol, side, offset, quantity, remaining_quantity, price,
                    fee, pnl, trade_id, order_id, source_kind, source_filename,
                    source_sheet, source_row_number, raw_json, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "EXE-MIGRATED",
                    "id|domestic_futures|ACC|LEGACY-1|2026-10-20|2026-10-20T01:30:00+00:00|IF2611|long|open|1.0|4000.0|0.0|0.0",
                    "domestic_futures|ACC|2026-10-20|LEGACY-1",
                    original_batch["id"],
                    DOMESTIC_FUTURES_PLATFORM,
                    "ACC",
                    "2026-10-20",
                    "2026-10-20T01:30:00+00:00",
                    "IF2611",
                    "long",
                    "open",
                    1,
                    1,
                    4000,
                    0,
                    0,
                    "LEGACY-1",
                    "",
                    "tonghuashun",
                    "legacy.csv",
                    "",
                    2,
                    "{}",
                    "unmatched",
                ),
            )

        storage.init_db(seed=False)
        reimport_batch = create_import_batch(
            DOMESTIC_FUTURES_PLATFORM,
            "reimport.csv",
            "tonghuashun",
            "csv",
        )
        execution = normalize_execution(
            {
                "trade_date": "2026-10-20",
                "trade_time": "09:30:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "1",
                "price": "4000",
                "account": "ACC",
                "trade_id": "LEGACY-1",
            },
            {
                "platform": DOMESTIC_FUTURES_PLATFORM,
                "source_kind": "tonghuashun",
                "source_filename": "reimport.csv",
                "source_row_number": 2,
            },
        )
        with storage.db() as conn:
            result = classify_import_executions_conn(
                conn,
                reimport_batch["id"],
                (execution,),
            )

        self.assertEqual(result["new_executions"], ())
        self.assertEqual(len(result["duplicate_executions"]), 1)
        with storage.db() as conn:
            identity_key = conn.execute(
                "SELECT identity_key FROM import_executions WHERE id = 'EXE-MIGRATED'"
            ).fetchone()[0]
        self.assertEqual(identity_key, "domestic_futures|ACC|LEGACY-1")

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

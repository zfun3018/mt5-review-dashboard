from __future__ import annotations

import json

from app import storage
from tests.support import TemporaryStorageCase, insert_analysis_trade


class DataCleanupTest(TemporaryStorageCase):
    def _insert_import_metadata(self, *, account="ACC", trade_date="2026-10-20"):
        with storage.db() as conn:
            conn.execute(
                """
                INSERT INTO import_batches (
                    id, platform, source_kind, source_format, filename, status,
                    started_at, completed_at, source_row_count, new_row_count, order_count
                ) VALUES (?, 'domestic_futures', 'tonghuashun', 'xls', ?, 'committed',
                          '2026-10-20T01:00:00+00:00', '2026-10-20T01:01:00+00:00', 2, 2, 1)
                """,
                ("B-CLEAN", "selected.xls"),
            )
            conn.execute(
                """
                INSERT INTO import_executions (
                    id, fingerprint, identity_key, batch_id, platform, account, trade_date,
                    time_utc, symbol, side, offset, quantity, remaining_quantity, price,
                    fee, pnl, trade_id, order_id, source_kind, source_filename,
                    source_sheet, source_row_number, raw_json, status
                ) VALUES (?, ?, ?, 'B-CLEAN', 'domestic_futures', ?, ?,
                          '2026-10-19T13:30:00+00:00', 'FG701', 'long', 'open', 1, 0, 100,
                          1, 0, 'OPEN-1', 'ORDER-1', 'tonghuashun', 'selected.xls',
                          '成交明细', 2, ?, 'matched')
                """,
                (
                    "EXE-CLEAN",
                    "fingerprint-clean",
                    f"domestic_futures|{account}|{trade_date}|OPEN-1",
                    account,
                    trade_date,
                    json.dumps({"trade_date": trade_date}),
                ),
            )
            conn.execute(
                "INSERT INTO import_batch_executions (batch_id, execution_id, disposition, source_row_number) VALUES ('B-CLEAN', 'EXE-CLEAN', 'new', 2)"
            )

    def test_cleanup_isolates_domestic_account_and_trade_date(self):
        insert_analysis_trade(
            storage,
            "DOM-SELECTED",
            symbol="FG701",
            close_time_utc="2026-10-20T01:00:00+00:00",
            platform="domestic_futures",
            trade_date="2026-10-20",
        )
        insert_analysis_trade(
            storage,
            "DOM-OTHER-DATE",
            symbol="FG701",
            close_time_utc="2026-10-21T01:00:00+00:00",
            platform="domestic_futures",
            trade_date="2026-10-21",
        )
        insert_analysis_trade(
            storage,
            "DOM-OTHER-ACCOUNT",
            symbol="FG701",
            close_time_utc="2026-10-20T01:00:00+00:00",
            platform="domestic_futures",
            account="FUT-B",
            trade_date="2026-10-20",
        )
        insert_analysis_trade(
            storage,
            "MT5-SAME-DATE",
            symbol="XAUUSD",
            close_time_utc="2026-10-20T01:00:00+00:00",
            platform="mt5",
        )
        self._insert_import_metadata()

        preview = storage.preview_data_cleanup(
            platform="domestic_futures",
            account="ACC",
            start_date="2026-10-20",
            end_date="2026-10-20",
        )
        self.assertEqual(preview["trade_count"], 1)
        self.assertEqual(preview["import_execution_count"], 1)
        self.assertTrue(preview["requires_confirmation"])

        result = storage.cleanup_data(
            platform="domestic_futures",
            account="ACC",
            start_date="2026-10-20",
            end_date="2026-10-20",
            confirm=True,
        )

        self.assertEqual(result["deleted_trade_count"], 1)
        remaining_domestic = storage.list_trades(platform="domestic_futures")
        self.assertEqual({row["id"] for row in remaining_domestic}, {"DOM-OTHER-DATE", "DOM-OTHER-ACCOUNT"})
        self.assertEqual(
            storage.list_campaigns(platform="domestic_futures", page_size=100)["total"],
            2,
        )
        with storage.db() as conn:
            self.assertIsNone(conn.execute("SELECT 1 FROM import_executions WHERE id = 'EXE-CLEAN'").fetchone())
            self.assertIsNone(conn.execute("SELECT 1 FROM import_batches WHERE id = 'B-CLEAN'").fetchone())
            self.assertIsNotNone(conn.execute("SELECT 1 FROM trades WHERE id = 'DOM-OTHER-DATE'").fetchone())
            self.assertIsNotNone(conn.execute("SELECT 1 FROM trades WHERE id = 'DOM-OTHER-ACCOUNT'").fetchone())
            self.assertIsNotNone(conn.execute("SELECT 1 FROM trades WHERE id = 'MT5-SAME-DATE'").fetchone())

    def test_mt5_cleanup_uses_beijing_close_date(self):
        insert_analysis_trade(
            storage,
            "MT5-IN",
            close_time_utc="2026-10-19T16:30:00+00:00",
            platform="mt5",
        )
        insert_analysis_trade(
            storage,
            "MT5-OUT",
            close_time_utc="2026-10-20T16:30:00+00:00",
            platform="mt5",
        )

        storage.cleanup_data(
            platform="mt5",
            account="ACC",
            start_date="2026-10-20",
            end_date="2026-10-20",
            confirm=True,
        )

        ids = {row["id"] for row in storage.list_trades(platform="mt5")}
        self.assertEqual(ids, {"MT5-OUT"})


if __name__ == "__main__":
    import unittest

    unittest.main()

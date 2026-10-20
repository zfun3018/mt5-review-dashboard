import sqlite3
import unittest

from app import storage
from app.platform_importer import import_platform_file
from tests.support import TemporaryStorageCase


CSV_TEXT = (
    "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
    "2026-10-19 09:30:00,IF2611,买,开,4000,1,,5,1001\n"
    "2026-10-19 10:15:00,IF2611,卖,平,4010,1,100,6,1002\n"
)


class PlatformImportTest(TemporaryStorageCase):
    def test_legacy_domestic_platform_alias_is_migrated_before_dashboard_reads_it(self):
        legacy_trade = {
            "id": "LEGACY-FUT-1",
            "platform": "tonghuashun",
            "account": "DOMESTIC-FUTURES-LOCAL",
            "order_no": "LEGACY-FUT-1",
            "position_id": "LEGACY-FUT-1",
            "order_ticket": "OPEN-LEGACY-FUT-1",
            "deal_ticket": "CLOSE-LEGACY-FUT-1",
            "symbol": "IF2611",
            "side": "long",
            "lots": 1.0,
            "open_time_utc": "2026-10-19T01:30:00+00:00",
            "close_time_utc": "2026-10-19T02:15:00+00:00",
            "entry_price": 4000.0,
            "exit_price": 4010.0,
            "pnl": 100.0,
            "commission": -11.0,
            "swap": 0.0,
            "fee": 0.0,
            "screenshot_path": "",
            "review_text": "",
            "trade_type": "unclassified",
            "strategy": "strategy_unclassified",
            "source": "tonghuashun_import",
        }
        with storage.db() as conn:
            storage._upsert_trade_conn(conn, legacy_trade)

        storage.init_db(seed=False)

        rows = storage._application_services().dashboard.trades.query_analysis_rows(
            None,
            None,
            platform="domestic_futures",
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["net_pnl"], 89.0)

    def test_import_file_accepts_csv_bytes_and_reimport_is_idempotent(self):
        first = import_platform_file(
            "tonghuashun_futures",
            CSV_TEXT.encode("utf-8"),
            "trades.csv",
        )
        second = import_platform_file(
            "tonghuashun_futures",
            CSV_TEXT.encode("utf-8"),
            "trades.csv",
        )

        self.assertEqual(first["imported"], 1)
        self.assertEqual(second["imported"], 1)
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0], 1)
            product_name, contract_name = conn.execute(
                "SELECT product_name, contract_name FROM trades WHERE platform = 'domestic_futures'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(product_name, "IF")
        self.assertEqual(contract_name, "IF2611")

    def test_import_file_rejects_unknown_extension(self):
        with self.assertRaises(ValueError) as context:
            import_platform_file("tonghuashun_futures", b"data", "trades.txt")

        self.assertIn("CSV 或 XLS", str(context.exception))


if __name__ == "__main__":
    unittest.main()

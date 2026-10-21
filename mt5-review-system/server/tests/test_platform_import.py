import sqlite3
import unittest

from app import storage
from app.data.tonghuashun_csv import parse_tonghuashun_csv
from app.platform_importer import import_platform_file
from tests.support import TemporaryStorageCase


CSV_TEXT = (
    "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
    "2026-10-19 09:30:00,FG701,买,开,1400,1,,5,1001\n"
    "2026-10-19 10:15:00,FG701,卖,平,1410,1,100,6,1002\n"
)


class PlatformImportTest(TemporaryStorageCase):
    def test_order_views_use_open_date_while_realized_analysis_uses_close_date(self):
        csv_text = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id\n"
            "2026-10-21,09:30:00,IF2611,sell,close,1,4010,6,100,T-CLOSE\n"
            "2026-10-20,21:00:00,IF2611,buy,open,1,4000,5,,T-OPEN\n"
        )
        import_platform_file(
            "domestic_futures",
            csv_text.encode("utf-8"),
            "cross-date.csv",
        )

        orders = storage.list_campaigns(
            platform="domestic_futures",
            start_date="2026-10-20",
            end_date="2026-10-20",
            page_size=10,
        )
        album = storage.query_review_album(
            platform="domestic_futures",
            start_date="2026-10-20",
            end_date="2026-10-20",
            page_size=10,
        )
        analysis = storage.get_analysis(
            "2026-10-21",
            "2026-10-21",
            platform="domestic_futures",
        )

        self.assertEqual(orders["total"], 1)
        self.assertEqual(album["total"], 1)
        self.assertEqual(analysis["metrics"]["order_count"], 1)
        self.assertEqual(analysis["date_semantics"]["order_date"], "trade_date")
        self.assertEqual(analysis["date_semantics"]["pnl_date"], "close_time_utc")
        self.assertEqual(album["trades"][0]["album_date"], "2026-10-20")
        self.assertEqual(album["days"][0]["date"], "2026-10-20")

    def test_imported_order_uses_opening_exchange_trade_date_for_order_queries(self):
        csv_text = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id\n"
            "2026-10-20,09:30:00,IF2611,sell,close,1,4010,6,100,T-CLOSE\n"
            "2026-10-20,21:00:00,IF2611,buy,open,1,4000,5,,T-OPEN\n"
        )

        result = import_platform_file(
            "domestic_futures",
            csv_text.encode("utf-8"),
            "night-day.csv",
        )

        self.assertEqual(result["imported"], 1)
        with storage.db() as conn:
            trade = conn.execute(
                "SELECT trade_date, open_time_utc, close_time_utc FROM trades"
            ).fetchone()
        self.assertEqual(trade["trade_date"], "2026-10-20")
        self.assertLess(trade["open_time_utc"], trade["close_time_utc"])

        orders = storage.list_campaigns(
            platform="domestic_futures",
            start_date="2026-10-20",
            end_date="2026-10-20",
            page_size=10,
        )
        self.assertEqual(orders["total"], 1)

    def test_analysis_contract_rankings_keep_imported_contract_symbol(self):
        import_platform_file(
            "domestic_futures",
            CSV_TEXT.encode("utf-8"),
            "ranking-source.csv",
        )

        analysis = storage.get_analysis(
            "2026-10-19",
            "2026-10-19",
            platform="domestic_futures",
        )

        contribution = analysis["contract_rankings"]["contribution"]
        self.assertEqual(len(contribution), 1)
        self.assertEqual(contribution[0]["symbol"], "FG701")
        self.assertEqual(contribution[0]["product_name"], "玻璃")
        self.assertEqual(contribution[0]["contract_name"], "玻璃2701")
        self.assertNotEqual(contribution[0]["contract_name"], "未命名合约")

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
        self.assertEqual(second["imported"], 0)
        self.assertEqual(second["new_row_count"], 0)
        self.assertEqual(second["duplicate_count"], 2)
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0], 1)
            product_name, contract_name = conn.execute(
                "SELECT product_name, contract_name FROM trades WHERE platform = 'domestic_futures'"
            ).fetchone()
        finally:
            conn.close()
        self.assertEqual(product_name, "玻璃")
        self.assertEqual(contract_name, "玻璃2701")

        orders = storage.list_campaigns(platform="domestic_futures", page_size=10)
        album = storage.query_review_album(platform="domestic_futures", page_size=10)
        dashboard = storage.get_dashboard(platform="domestic_futures")
        trade_id = storage.query_trades(platform="domestic_futures", page_size=10)["trades"][0]["id"]
        trade = storage.get_trade(
            trade_id,
            platform="domestic_futures",
        )

        self.assertEqual(orders["campaigns"][0]["contract_name"], "玻璃2701")
        self.assertEqual(album["trades"][0]["contract_name"], "玻璃2701")
        self.assertEqual(dashboard["campaigns"][0]["contract_name"], "玻璃2701")
        sources = orders["campaigns"][0]["import_sources"]
        self.assertEqual([item["filename"] for item in sources], ["trades.csv", "trades.csv"])
        self.assertEqual([item["source_rows"] for item in sources], [[2, 3], [2, 3]])
        self.assertEqual(
            sources[0]["file_sha256"],
            sources[1]["file_sha256"],
        )
        self.assertEqual(
            [item["filename"] for item in trade["import_sources"]],
            ["trades.csv", "trades.csv"],
        )
        self.assertEqual(
            [item["filename"] for item in album["trades"][0]["import_sources"]],
            ["trades.csv", "trades.csv"],
        )
        self.assertEqual(
            [item["filename"] for item in dashboard["trades"][0]["import_sources"]],
            ["trades.csv", "trades.csv"],
        )

    def test_reimport_counts_existing_execution_ids_as_duplicates_and_keeps_first_source(self):
        first = import_platform_file(
            "domestic_futures",
            CSV_TEXT.encode("utf-8"),
            "first-export.csv",
        )
        second = import_platform_file(
            "domestic_futures",
            CSV_TEXT.encode("utf-8"),
            "second-export.csv",
        )

        self.assertEqual(first["new_row_count"], 2)
        self.assertEqual(first["duplicate_count"], 0)
        self.assertEqual(second["new_row_count"], 0)
        self.assertEqual(second["duplicate_count"], 2)
        self.assertEqual(second["imported"], 0)
        with storage.db() as conn:
            execution = conn.execute(
                "SELECT batch_id, source_filename FROM import_executions ORDER BY source_row_number LIMIT 1"
            ).fetchone()
            batches = conn.execute(
                "SELECT id, filename, new_row_count, duplicate_count FROM import_batches ORDER BY started_at, id"
            ).fetchall()
        self.assertEqual(execution["batch_id"], first["batch_id"])
        self.assertEqual(execution["source_filename"], "first-export.csv")
        self.assertEqual(len(batches), 2)
        self.assertEqual(batches[1]["filename"], "second-export.csv")
        self.assertEqual(batches[1]["new_row_count"], 0)
        self.assertEqual(batches[1]["duplicate_count"], 2)

    def test_reimport_prefers_stable_trade_sequence_over_export_order_number(self):
        first = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交编号,成交序号\n"
            "2026-10-19 09:30:00,FG701,买,开,1400,1,,5,EXPORT-A1,SEQ-1001\n"
            "2026-10-19 10:15:00,FG701,卖,平,1410,1,100,6,EXPORT-A2,SEQ-1002\n"
        )
        reexported = first.replace("EXPORT-A1", "EXPORT-B1").replace("EXPORT-A2", "EXPORT-B2")

        first_result = import_platform_file(
            "domestic_futures", first.encode("utf-8"), "first.csv"
        )
        second_result = import_platform_file(
            "domestic_futures", reexported.encode("utf-8"), "second.csv"
        )

        self.assertEqual(first_result["imported"], 1)
        self.assertEqual(second_result["imported"], 0)
        self.assertEqual(second_result["new_row_count"], 0)
        self.assertEqual(second_result["duplicate_count"], 2)
        self.assertEqual(
            storage.list_campaigns(platform="domestic_futures")["total"],
            1,
        )

    def test_reimport_with_different_execution_ids_reports_duplicate_order_reason(self):
        first = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
            "2026-10-19 09:30:00,FG701,买,开,1400,1,,5,FIRST-OPEN\n"
            "2026-10-19 10:15:00,FG701,卖,平,1410,1,100,6,FIRST-CLOSE\n"
        )
        reexported = first.replace("FIRST-OPEN", "SECOND-OPEN").replace(
            "FIRST-CLOSE", "SECOND-CLOSE"
        )

        import_platform_file("domestic_futures", first.encode(), "first.csv")
        result = import_platform_file("domestic_futures", reexported.encode(), "second.csv")

        self.assertEqual(result["imported"], 0)
        self.assertEqual(result["duplicate_order_count"], 1)
        duplicate = next(issue for issue in result["issues"] if issue["code"] == "duplicate_order")
        self.assertEqual(duplicate["duplicate_reason"], "完整开平订单字段完全一致")
        self.assertTrue(duplicate["existing_trade_id"])
        self.assertEqual(duplicate["source_filename"], "second.csv")
        self.assertEqual(duplicate["open_row_number"], 2)
        self.assertEqual(duplicate["close_row_number"], 3)
        self.assertEqual(storage.list_campaigns(platform="domestic_futures")["total"], 1)
        history = storage.list_import_batches("domestic_futures")
        second_batch = next(item for item in history if item["filename"] == "second.csv")
        self.assertEqual(second_batch["duplicate_order_count"], 1)
        calendar = storage.get_import_calendar("domestic_futures", 2026, 10)
        self.assertEqual(calendar["2026-10-19"]["duplicate_order_count"], 1)
        detail = storage.get_import_batch(second_batch["id"], "domestic_futures")
        self.assertEqual(detail["issues"][0]["code"], "duplicate_order")
        reverted = storage.revert_import_batch(second_batch["id"], "domestic_futures")
        self.assertTrue(reverted["reverted"])
        self.assertEqual(storage.list_campaigns(platform="domestic_futures")["total"], 1)

    def test_reimport_recognizes_orders_created_before_execution_fingerprints(self):
        legacy = parse_tonghuashun_csv(CSV_TEXT, "legacy.csv")["trades"][0]
        storage.upsert_trade(legacy)
        storage.init_db(seed=False)

        result = import_platform_file(
            "domestic_futures", CSV_TEXT.encode("utf-8"), "reimport.csv"
        )

        self.assertEqual(result["imported"], 0)
        self.assertEqual(result["new_row_count"], 0)
        self.assertEqual(result["duplicate_count"], 2)
        with storage.db() as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM import_executions").fetchone()[0],
                2,
            )

    def test_same_execution_id_with_changed_fields_is_reported_as_conflict(self):
        first = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id\n"
            "2026-10-20,09:30:00,IF2611,buy,open,1,4000,5,,SAME-1\n"
        )
        changed = first.replace(",4000,", ",4010,")

        import_platform_file("domestic_futures", first.encode(), "first.csv")
        result = import_platform_file("domestic_futures", changed.encode(), "changed.csv")

        self.assertEqual(result["new_row_count"], 0)
        self.assertEqual(result["duplicate_count"], 0)
        self.assertEqual(result["conflict_count"], 1)
        self.assertEqual(result["invalid_rows"], [])
        self.assertEqual(result["conflict_rows"][0]["code"], "execution_conflict")
        self.assertEqual(result["day_counts"]["2026-10-20"]["conflict_count"], 1)
        self.assertEqual(result["day_counts"]["2026-10-20"]["invalid_count"], 0)
        self.assertEqual(result["imported"], 0)
        self.assertTrue(any(issue["code"] == "execution_conflict" for issue in result["issues"]))
        self.assertEqual(result["conflict_rows"][0]["differences"][0]["field"], "price")
        self.assertEqual(result["conflict_rows"][0]["differences"][0]["existing"], 4000.0)
        self.assertEqual(result["conflict_rows"][0]["differences"][0]["imported"], 4010.0)

    def test_import_file_rejects_unknown_extension(self):
        with self.assertRaises(ValueError) as context:
            import_platform_file("tonghuashun_futures", b"data", "trades.txt")

        self.assertIn("CSV 或 XLS", str(context.exception))


if __name__ == "__main__":
    unittest.main()

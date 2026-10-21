import unittest

from app import storage
from app.data.import_repository import (
    create_import_batch,
    finalize_import_batch,
    get_import_calendar,
    list_import_batches,
    record_import_batch_days,
    revert_import_batch,
)
from app.platform_importer import import_platform_file
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class ImportBatchRepositoryTest(TemporaryStorageCase):
    def test_revert_import_batch_soft_deletes_its_order(self):
        csv_text = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
            "2026-10-19 09:30:00,IF2611,买,开,4000,1,,5,REV-1001\n"
            "2026-10-19 10:15:00,IF2611,卖,平,4010,1,100,6,REV-1002\n"
        )
        imported = import_platform_file("domestic_futures", csv_text.encode(), "revert.csv")

        result = revert_import_batch(imported["batch_id"], "domestic_futures")

        self.assertTrue(result["reverted"])
        self.assertEqual(storage.list_campaigns(platform="domestic_futures")["total"], 0)
        self.assertEqual(
            list_import_batches("domestic_futures")[0]["status"],
            "reverted",
        )
        self.assertEqual(
            storage.list_unmatched_import_executions("domestic_futures"),
            [],
        )

    def test_revert_original_batch_removes_orders_even_after_duplicate_import(self):
        csv_text = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
            "2026-10-19 09:30:00,IF2611,买,开,4000,1,,5,REV-DUP-1001\n"
            "2026-10-19 10:15:00,IF2611,卖,平,4010,1,100,6,REV-DUP-1002\n"
        )
        first = import_platform_file("domestic_futures", csv_text.encode(), "first.csv")
        second = import_platform_file("domestic_futures", csv_text.encode(), "second.csv")

        self.assertEqual(second["imported"], 0)
        result = revert_import_batch(first["batch_id"], "domestic_futures")

        self.assertTrue(result["reverted"])
        self.assertEqual(storage.list_campaigns(platform="domestic_futures")["total"], 0)
        self.assertEqual(storage.query_trades(platform="domestic_futures")["total"], 0)
        self.assertEqual(
            storage.get_dashboard(platform="domestic_futures")["summary"]["order_count"],
            0,
        )
        self.assertEqual(
            storage.get_analysis(platform="domestic_futures")["metrics"]["order_count"],
            0,
        )

    def test_reimport_after_revert_reactivates_execution_fingerprints(self):
        csv_text = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
            "2026-10-19 09:30:00,IF2611,买,开,4000,1,,5,REV-REIMPORT-1001\n"
            "2026-10-19 10:15:00,IF2611,卖,平,4010,1,100,6,REV-REIMPORT-1002\n"
        )
        first = import_platform_file("domestic_futures", csv_text.encode(), "first.csv")
        revert_import_batch(first["batch_id"], "domestic_futures")

        result = import_platform_file("domestic_futures", csv_text.encode(), "reimport.csv")

        self.assertEqual(result["imported"], 1)
        self.assertEqual(result["new_row_count"], 2)
        self.assertEqual(result["duplicate_count"], 0)
        self.assertEqual(storage.list_campaigns(platform="domestic_futures")["total"], 1)

    def test_duplicate_import_is_idempotent_for_campaigns_and_analysis(self):
        csv_text = (
            "成交时间,合约,买/卖,开/平,成交价,手数,平仓盈亏,手续费,成交序号\n"
            "2026-10-19 09:30:00,IF2611,买,开,4000,1,,5,1001\n"
            "2026-10-19 10:15:00,IF2611,卖,平,4010,1,100,6,1002\n"
        )

        first = import_platform_file("tonghuashun_futures", csv_text.encode(), "trades.csv")
        second = import_platform_file("tonghuashun_futures", csv_text.encode(), "trades.csv")

        self.assertEqual(first["imported"], 1)
        self.assertEqual(second["imported"], 0)
        self.assertEqual(second["new_row_count"], 0)
        self.assertEqual(second["duplicate_count"], 2)
        campaigns = storage.list_campaigns(platform=DOMESTIC_FUTURES_PLATFORM)
        analysis = storage.get_analysis(platform=DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(campaigns["total"], 1)
        self.assertEqual(analysis["metrics"]["order_count"], 1)
        self.assertEqual(analysis["metrics"]["net_pnl"], 89.0)
        self.assertEqual(
            len([batch for batch in list_import_batches(DOMESTIC_FUTURES_PLATFORM) if batch["status"] == "committed"]),
            2,
        )

    def test_batch_records_counts_and_hides_absolute_filename(self):
        batch = create_import_batch(
            DOMESTIC_FUTURES_PLATFORM,
            r"C:\private\exports\trades.xls",
            "tonghuashun",
            "xls",
        )
        record_import_batch_days(
            batch["id"],
            [
                {
                    "trade_date": "2026-10-19",
                    "source_row_count": 4,
                    "new_row_count": 2,
                    "duplicate_count": 1,
                    "invalid_count": 1,
                    "unpaired_count": 0,
                    "order_count": 1,
                }
            ],
        )
        finalized = finalize_import_batch(
            batch["id"],
            {
                "trade_date_start": "2026-10-19",
                "trade_date_end": "2026-10-19",
                "source_row_count": 4,
                "new_row_count": 2,
                "duplicate_count": 1,
                "invalid_count": 1,
                "unpaired_count": 0,
                "order_count": 1,
            },
            "committed",
        )

        self.assertEqual(finalized["status"], "committed")
        self.assertEqual(finalized["order_count"], 1)
        self.assertEqual(finalized["filename"], "trades.xls")
        self.assertNotIn("C:\\private", finalized["filename"])
        self.assertEqual(list_import_batches(DOMESTIC_FUTURES_PLATFORM)[0]["id"], batch["id"])

    def test_calendar_is_scoped_to_platform_and_trading_date(self):
        batch = create_import_batch(
            DOMESTIC_FUTURES_PLATFORM,
            "futures.csv",
            "standard_template",
            "csv",
        )
        record_import_batch_days(
            batch["id"],
            [
                {
                    "trade_date": "2026-10-19",
                    "source_row_count": 6,
                    "new_row_count": 4,
                    "duplicate_count": 1,
                    "invalid_count": 1,
                    "unpaired_count": 0,
                    "order_count": 2,
                }
            ],
        )
        finalize_import_batch(batch["id"], {"order_count": 2}, "committed")

        mt5_batch = create_import_batch("mt5", "events.jsonl", "mt5_bridge", "jsonl")
        record_import_batch_days(
            mt5_batch["id"],
            [{"trade_date": "2026-10-19", "new_row_count": 99, "order_count": 99}],
        )

        calendar = get_import_calendar(DOMESTIC_FUTURES_PLATFORM, 2026, 10)

        self.assertEqual(calendar["2026-10-19"]["new_row_count"], 4)
        self.assertEqual(calendar["2026-10-19"]["order_count"], 2)
        self.assertNotEqual(calendar["2026-10-19"]["new_row_count"], 99)

    def test_batch_detail_includes_issue_rows_without_absolute_paths(self):
        batch = create_import_batch(
            DOMESTIC_FUTURES_PLATFORM,
            r"C:\private\exports\trades.xls",
            "standard_template",
            "xls",
        )
        from app.data.import_repository import record_import_batch_issues, get_import_batch

        record_import_batch_issues(
            batch["id"],
            [
                {
                    "row_number": 12,
                    "trade_date": "2026-10-19",
                    "code": "invalid_number",
                    "message": "数量不是有效数字",
                    "details": {"source_filename": r"C:\private\exports\trades.xls"},
                }
            ],
        )

        detail = get_import_batch(batch["id"], DOMESTIC_FUTURES_PLATFORM)

        self.assertEqual(detail["issues"][0]["code"], "invalid_number")
        self.assertEqual(detail["issues"][0]["row_number"], 12)
        self.assertNotIn(r"C:\private", str(detail["issues"]))


if __name__ == "__main__":
    unittest.main()

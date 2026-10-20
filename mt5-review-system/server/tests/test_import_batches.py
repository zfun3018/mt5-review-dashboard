import unittest

from app import storage
from app.data.import_repository import (
    create_import_batch,
    finalize_import_batch,
    get_import_calendar,
    list_import_batches,
    record_import_batch_days,
)
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class ImportBatchRepositoryTest(TemporaryStorageCase):
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

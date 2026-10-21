import unittest

from app import storage
from app.platform_importer import import_platform_file
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class ImportReconciliationTest(TemporaryStorageCase):
    def test_unmatched_executions_survive_import_and_manual_match_across_batches(self):
        open_csv = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id\n"
            "2026-10-20,21:00:00,IF2611,buy,open,2,4000,5,,OPEN-1\n"
        )
        close_csv = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id\n"
            "2026-10-21,09:30:00,IF2611,sell,close,1,4010,6,100,CLOSE-1\n"
        )

        first_result = import_platform_file(
            DOMESTIC_FUTURES_PLATFORM,
            open_csv.encode("utf-8"),
            "open.csv",
        )
        second_result = import_platform_file(
            DOMESTIC_FUTURES_PLATFORM,
            close_csv.encode("utf-8"),
            "close.csv",
        )

        self.assertEqual(first_result["unmatched_open_quantity"], 2.0)
        self.assertEqual(first_result["unmatched_close_quantity"], 0.0)
        self.assertEqual(second_result["unmatched_open_quantity"], 2.0)
        self.assertEqual(second_result["unmatched_close_quantity"], 1.0)

        unmatched = storage.list_unmatched_import_executions(DOMESTIC_FUTURES_PLATFORM)

        self.assertEqual(len(unmatched), 2)
        opened = next(row for row in unmatched if row["offset"] == "open")
        closed = next(row for row in unmatched if row["offset"] == "close")
        self.assertEqual(opened["remaining_quantity"], 2.0)
        self.assertEqual(closed["remaining_quantity"], 1.0)
        self.assertEqual(opened["trade_date"], "2026-10-20")

        result = storage.match_import_executions(
            opened["id"],
            closed["id"],
            1,
            platform=DOMESTIC_FUTURES_PLATFORM,
        )

        self.assertEqual(result["trade"]["trade_date"], "2026-10-20")
        self.assertEqual(result["trade"]["lots"], 1.0)
        remaining = storage.list_unmatched_import_executions(DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["id"], opened["id"])
        self.assertEqual(remaining[0]["remaining_quantity"], 1.0)


if __name__ == "__main__":
    unittest.main()

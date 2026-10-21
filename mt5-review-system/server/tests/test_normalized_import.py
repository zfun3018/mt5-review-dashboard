import unittest

from app.data.normalized_import import (
    build_import_preview,
    deduplicate_executions,
    match_executions,
    normalize_execution,
)
from app.platform_adapters.contracts import ImportIssue, NormalizedExecution
from app.platforms import DOMESTIC_FUTURES_PLATFORM


class NormalizedImportTest(unittest.TestCase):
    def _context(self, row_number=2):
        return {
            "platform": DOMESTIC_FUTURES_PLATFORM,
            "source_kind": "standard_template",
            "source_filename": "trades.csv",
            "source_sheet": "成交明细",
            "source_row_number": row_number,
        }

    def test_normalize_execution_maps_standard_fields_and_trade_date(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-19",
                "trade_time": "21:01:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "2",
                "price": "4000.5",
                "fee": "5",
                "pnl": "0",
                "trade_id": "T-1",
                "order_id": "O-1",
            },
            self._context(),
        )

        self.assertIsInstance(result, NormalizedExecution)
        self.assertEqual(result.trade_date, "2026-10-19")
        self.assertEqual(result.offset, "open")
        self.assertEqual(result.side, "long")
        self.assertEqual(result.quantity, 2.0)
        self.assertEqual(result.price, 4000.5)
        self.assertEqual(result.source_row_number, 2)

    def test_night_time_uses_previous_natural_date_but_keeps_exchange_trade_date(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-20",
                "trade_time": "21:01:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "1",
                "price": "4000",
            },
            self._context(),
        )

        self.assertIsInstance(result, NormalizedExecution)
        self.assertEqual(result.trade_date, "2026-10-20")
        self.assertEqual(result.time_utc, "2026-10-19T13:01:00+00:00")

    def test_full_night_datetime_uses_exchange_trade_date_for_actual_timestamp(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-20",
                "trade_time": "2026-10-20 21:01:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "1",
                "price": "4000",
            },
            self._context(),
        )

        self.assertIsInstance(result, NormalizedExecution)
        self.assertEqual(result.trade_date, "2026-10-20")
        self.assertEqual(result.time_utc, "2026-10-19T13:01:00+00:00")

    def test_matching_sorts_night_before_day_even_when_source_rows_are_reversed(self):
        close = normalize_execution(
            {
                "trade_date": "2026-10-20",
                "trade_time": "09:30:00",
                "symbol": "IF2611",
                "side": "sell",
                "offset": "close",
                "quantity": "1",
                "price": "4010",
                "pnl": "100",
                "trade_id": "T-CLOSE",
            },
            self._context(3),
        )
        opened = normalize_execution(
            {
                "trade_date": "2026-10-20",
                "trade_time": "21:00:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "1",
                "price": "4000",
                "trade_id": "T-OPEN",
            },
            self._context(2),
        )

        result = match_executions([close, opened])

        self.assertEqual(len(result.trades), 1)
        self.assertEqual(result.issues, ())
        self.assertEqual(result.trades[0]["trade_date"], "2026-10-20")
        self.assertEqual(result.trades[0]["open_time_utc"], "2026-10-19T13:00:00+00:00")

    def test_import_preview_counts_orders_on_opening_trade_date(self):
        opened = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-20",
            time_utc="2026-10-19T13:00:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4000,
            trade_id="T-OPEN",
        )
        closed = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-20",
            time_utc="2026-10-20T01:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="close",
            quantity=1,
            price=4010,
            pnl=100,
            trade_id="T-CLOSE",
        )

        preview = build_import_preview(
            source_row_count=2,
            executions=(opened, closed),
            duplicates=(),
            issues=(),
            trades=match_executions((opened, closed)).trades,
        )

        self.assertEqual(preview["day_counts"]["2026-10-20"]["order_count"], 1)

    def test_normalize_execution_returns_structured_issue_for_bad_number(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-19",
                "trade_time": "09:30:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": "bad",
                "price": "4000",
            },
            self._context(9),
        )

        self.assertIsInstance(result, ImportIssue)
        self.assertEqual(result.code, "invalid_number")
        self.assertEqual(result.row_number, 9)
        self.assertEqual(result.details["trade_date"], "2026-10-19")
        self.assertEqual(result.details["field"], "quantity")
        self.assertEqual(result.details["expected"], "有效的正数")

    def test_normalize_execution_explains_non_positive_quantity(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-19",
                "trade_time": "09:30:00",
                "symbol": "IF2611",
                "side": "buy",
                "offset": "open",
                "quantity": 0,
                "price": 4000,
            },
            self._context(10),
        )

        self.assertIsInstance(result, ImportIssue)
        self.assertEqual(result.code, "invalid_number")
        self.assertEqual(result.message, "手数必须大于 0")
        self.assertEqual(result.details["value"], 0)
        self.assertEqual(result.details["expected"], "有效的正数")

    def test_deduplicate_executions_prefers_source_trade_id_and_falls_back_to_fingerprint(self):
        first = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T01:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4000,
            trade_id="T-1",
        )
        duplicate_by_id = NormalizedExecution(**{**first.__dict__, "source_row_number": 3})
        second = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T02:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4001,
        )
        duplicate_by_fingerprint = NormalizedExecution(**{**second.__dict__, "source_row_number": 5})

        result = deduplicate_executions(
            [first, duplicate_by_id, second, duplicate_by_fingerprint]
        )

        self.assertEqual(len(result.executions), 2)
        self.assertEqual([item.source_row_number for item in result.duplicates], [3, 5])

    def test_match_executions_builds_order_and_reports_unpaired_close(self):
        opened = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T01:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4000,
            fee=5,
            trade_id="T-1",
        )
        closed = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T02:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="close",
            quantity=1,
            price=4010,
            fee=6,
            pnl=100,
            trade_id="T-2",
        )
        unpaired = NormalizedExecution(**{**closed.__dict__, "trade_id": "T-3", "quantity": 1})

        result = match_executions([opened, closed, unpaired])

        self.assertEqual(len(result.trades), 1)
        self.assertEqual(result.trades[0]["lots"], 1)
        self.assertEqual(len(result.issues), 1)
        self.assertEqual(result.issues[0].code, "unpaired_close")
        self.assertEqual(result.issues[0].details["matched_quantity"], 0)
        self.assertEqual(result.issues[0].details["remaining_quantity"], 1)
        self.assertIn("找不到", result.issues[0].details["reason"])

    def test_build_trade_without_source_ids_uses_stable_string_references(self):
        opened = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T01:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4000,
        )
        closed = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T02:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="close",
            quantity=1,
            price=4010,
        )

        result = match_executions([opened, closed])

        self.assertEqual(len(result.trades), 1)
        self.assertTrue(result.trades[0]["id"].startswith("FUT-"))

    def test_build_preview_keeps_issue_rows_and_counts(self):
        preview = build_import_preview(
            source_row_count=3,
            executions=(
                NormalizedExecution(
                    platform=DOMESTIC_FUTURES_PLATFORM,
                    trade_date="2026-10-19",
                    time_utc="2026-10-19T01:30:00+00:00",
                    symbol="IF2611",
                    side="long",
                    offset="open",
                    quantity=1,
                    price=4000,
                ),
            ),
            duplicates=(),
            issues=(ImportIssue(4, "invalid_number", "数量不是有效数字", {"trade_date": "2026-10-20"}),),
            trades=(),
        )

        self.assertEqual(preview["source_row_count"], 3)
        self.assertEqual(preview["invalid_rows"][0]["code"], "invalid_number")
        self.assertEqual(preview["day_counts"]["2026-10-20"]["invalid_count"], 1)


if __name__ == "__main__":
    unittest.main()

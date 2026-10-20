import unittest

from app.data.tonghuashun_csv import (
    parse_tonghuashun_csv,
    parse_tonghuashun_rows,
    parse_tonghuashun_workbook,
)
from app.data.tonghuashun_xls import parse_tonghuashun_xls
from app.platforms import DOMESTIC_FUTURES_PLATFORM


class TonghuashunCsvTest(unittest.TestCase):
    def test_accepts_the_standard_domestic_futures_template(self):
        csv_text = (
            "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id,order_id\n"
            "2026-10-19,09:30:00,IF2611,buy,open,1,4000,5,,T-1001,O-1001\n"
            "2026-10-19,10:15:00,IF2611,sell,close,1,4010,6,100,T-1002,O-1002\n"
        )

        result = parse_tonghuashun_csv(csv_text, "domestic-futures-import-template.csv")

        self.assertEqual(len(result["trades"]), 1)
        self.assertEqual(result["trades"][0]["symbol"], "IF2611")
        self.assertEqual(result["invalid_rows"], [])

    def test_pairs_domestic_futures_open_and_close_rows(self):
        csv_text = "成交时间,合约,买卖,开平,成交价,手数,平仓盈亏,手续费,成交编号,资金账号\n"
        csv_text += "2026-10-19 09:30:00,IF2611,买,开,4000,2,,5,1001,ACC-CNY\n"
        csv_text += "2026-10-19 10:15:00,IF2611,卖,平,4010,2,200,6,1002,ACC-CNY\n"

        result = parse_tonghuashun_csv(csv_text, "tonghuashun.csv")

        self.assertEqual(result["invalid_rows"], [])
        self.assertEqual(result["unpaired_rows"], [])
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["platform"], DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(trade["symbol"], "IF2611")
        self.assertEqual(trade["side"], "long")
        self.assertEqual(trade["lots"], 2.0)
        self.assertEqual(trade["entry_price"], 4000.0)
        self.assertEqual(trade["exit_price"], 4010.0)
        self.assertEqual(trade["pnl"], 200.0)
        self.assertEqual(trade["commission"], -11.0)
        self.assertEqual(trade["account"], "ACC-CNY")
        self.assertTrue(trade["open_time_utc"].endswith("+00:00"))

    def test_maps_short_trade_and_reports_unpaired_open(self):
        csv_text = "成交时间,合约,买卖,开平,成交价,手数,手续费,成交编号\n"
        csv_text += "2026/10/19 21:01:00,螺纹2510,卖,开,3200,1,3,2001\n"
        csv_text += "2026/10/19 21:20:00,螺纹2510,买,平今,3190,1,4,2002\n"
        csv_text += "2026/10/19 22:00:00,螺纹2510,买,平今,3195,1,4,2003\n"

        result = parse_tonghuashun_csv(csv_text)

        self.assertEqual(len(result["trades"]), 1)
        self.assertEqual(result["trades"][0]["side"], "short")
        self.assertEqual(result["trades"][0]["pnl"], 0.0)
        self.assertTrue(result["warnings"])
        self.assertEqual(result["trades"][0]["commission"], -7.0)
        self.assertEqual([row["row_number"] for row in result["unpaired_rows"]], [4])

    def test_rejects_csv_without_required_columns(self):
        result = parse_tonghuashun_csv("合约,买卖\nIF2611,买\n")

        self.assertEqual(result["trades"], [])
        self.assertEqual(len(result["invalid_rows"]), 1)
        self.assertIn("缺少", result["invalid_rows"][0]["error"])

    def test_finds_transaction_table_after_report_preamble_and_summary_row(self):
        rows = [
            ["基本资料"],
            ["交易日期", "2026-10-16"],
            [],
            ["成交明细"],
            [],
            [
                "合约", "成交序号", "成交时间", "买/卖", "投机（一般）/套保/套利",
                "成交价", "手数", "成交额", "开/平", "手续费", "平仓盈亏", "实际成交日期",
            ],
            ["IF2611", "1001", "09:30:00", "买", "投机", "4000", "1", "4000", "开", "5", "", "2026-10-16"],
            ["IF2611", "1002", "10:15:00", "卖", "投机", "4010", "1", "4010", "平", "6", "100", "2026-10-16"],
            ["合计", "", "", "", "", "", "", "", "", "", "", ""],
        ]

        result = parse_tonghuashun_rows(rows, "tonghuashun.xls", "成交明细")

        self.assertEqual(result["selected_sheet"], "成交明细")
        self.assertEqual(result["table_header_row"], 6)
        self.assertEqual(result["source_row_count"], 2)
        self.assertEqual(result["invalid_rows"], [])
        self.assertEqual(result["unpaired_rows"], [])
        self.assertEqual(len(result["trades"]), 1)
        self.assertEqual(result["trades"][0]["pnl"], 100.0)

    def test_deduplicates_repeated_transaction_rows_before_fifo_matching(self):
        header = ["合约", "成交序号", "成交时间", "买/卖", "成交价", "手数", "开/平", "手续费", "平仓盈亏"]
        opening = ["IF2611", "1001", "2026-10-16 09:30:00", "买", "4000", "1", "开", "5", ""]
        closing = ["IF2611", "1002", "2026-10-16 10:15:00", "卖", "4010", "1", "平", "6", "100"]

        result = parse_tonghuashun_rows(
            [header, opening, opening, closing, closing],
            "duplicate.xls",
            "成交明细",
        )

        self.assertEqual(result["source_row_count"], 4)
        self.assertEqual(result["deduplicated_row_count"], 2)
        self.assertEqual(len(result["duplicate_rows"]), 2)
        self.assertEqual(len(result["trades"]), 1)

    def test_selects_the_transaction_sheet_from_a_multi_sheet_workbook(self):
        workbook = {
            "客户交易结算日报": [["说明"], ["无成交"]],
            "成交明细": [
                ["合约", "成交序号", "成交时间", "买/卖", "成交价", "手数", "开/平", "手续费", "平仓盈亏"],
                ["IF2611", "1001", "2026-10-16 09:30:00", "买", "4000", "1", "开", "5", ""],
                ["IF2611", "1002", "2026-10-16 10:15:00", "卖", "4010", "1", "平", "6", "100"],
            ],
        }

        result = parse_tonghuashun_workbook(workbook, "multi-sheet.xls")

        self.assertEqual(result["workbook_sheets"], ["客户交易结算日报", "成交明细"])
        self.assertEqual(result["selected_sheet"], "成交明细")
        self.assertEqual(len(result["trades"]), 1)

    def test_rejects_non_excel_binary_with_a_clear_error(self):
        with self.assertRaises(ValueError) as context:
            parse_tonghuashun_xls(b"not an excel workbook", "broken.xls")

        self.assertIn("Excel", str(context.exception))


if __name__ == "__main__":
    unittest.main()

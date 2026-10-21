import unittest

from app.data.normalized_import import normalize_execution
from app.platform_modules.domestic_futures_contracts import contract_display
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from app.platform_adapters.contracts import NormalizedExecution


class DomesticFuturesContractsTest(unittest.TestCase):
    def test_contract_display_uses_chinese_common_name_and_expands_short_month(self):
        display = contract_display("FG701")

        self.assertEqual(display["product_code"], "FG")
        self.assertEqual(display["product_name"], "玻璃")
        self.assertEqual(display["contract_name"], "玻璃2701")

    def test_contract_display_uses_industry_common_index_code(self):
        display = contract_display(" IF2611 ")

        self.assertEqual(display["product_code"], "IF")
        self.assertEqual(display["product_name"], "沪深300股指")
        self.assertEqual(display["contract_name"], "沪深300股指2611")

    def test_contract_display_uses_common_names_for_index_and_treasury_futures(self):
        expected = {
            "IC": "中证500股指",
            "IM": "中证1000股指",
            "IH": "上证50股指",
            "TF": "5年期国债",
            "TS": "2年期国债",
            "T": "10年期国债",
        }
        for code, name in expected.items():
            with self.subTest(code=code):
                self.assertEqual(contract_display(f"{code}2611")["product_name"], name)

    def test_contract_display_normalizes_alias_to_common_contract_name(self):
        display = contract_display("v2701")

        self.assertEqual(display["product_code"], "V")
        self.assertEqual(display["product_name"], "PVC")
        self.assertEqual(display["contract_name"], "PVC2701")

    def test_contract_display_uses_pe_for_polyethylene(self):
        display = contract_display("L2701")

        self.assertEqual(display["product_code"], "L")
        self.assertEqual(display["product_name"], "PE")
        self.assertEqual(display["contract_name"], "PE2701")

    def test_contract_display_normalizes_pta_alias(self):
        display = contract_display("TA2701")

        self.assertEqual(display["product_code"], "TA")
        self.assertEqual(display["product_name"], "PTA")
        self.assertEqual(display["contract_name"], "PTA2701")

    def test_contract_display_falls_back_for_unknown_product(self):
        display = contract_display("ZZ9999")

        self.assertEqual(display["product_code"], "ZZ")
        self.assertEqual(display["product_name"], "ZZ")
        self.assertEqual(display["contract_name"], "ZZ9999")

    def test_normalized_domestic_execution_carries_display_metadata(self):
        result = normalize_execution(
            {
                "trade_date": "2026-10-19",
                "trade_time": "09:30:00",
                "symbol": "IF2611",
                "side": "买",
                "offset": "开",
                "quantity": "1",
                "price": "4000",
            },
            {
                "platform": DOMESTIC_FUTURES_PLATFORM,
                "source_kind": "tonghuashun",
                "source_filename": "trades.xls",
                "source_sheet": "成交明细",
                "source_row_number": 2,
            },
        )

        self.assertIsInstance(result, NormalizedExecution)
        self.assertEqual(result.raw["product_name"], "沪深300股指")
        self.assertEqual(result.raw["contract_name"], "沪深300股指2611")


if __name__ == "__main__":
    unittest.main()

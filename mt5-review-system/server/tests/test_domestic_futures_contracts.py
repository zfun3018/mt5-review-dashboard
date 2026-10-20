import unittest

from app.data.normalized_import import normalize_execution
from app.platform_modules.domestic_futures_contracts import contract_display
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from app.platform_adapters.contracts import NormalizedExecution


class DomesticFuturesContractsTest(unittest.TestCase):
    def test_contract_display_uses_common_product_code(self):
        display = contract_display(" IF2611 ")

        self.assertEqual(display["product_code"], "IF")
        self.assertEqual(display["product_name"], "IF")
        self.assertEqual(display["contract_name"], "IF2611")

    def test_contract_display_normalizes_alias_to_common_contract_name(self):
        display = contract_display("v2701")

        self.assertEqual(display["product_code"], "V")
        self.assertEqual(display["product_name"], "PVC")
        self.assertEqual(display["contract_name"], "PVC2701")

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
        self.assertEqual(result.raw["product_name"], "IF")
        self.assertEqual(result.raw["contract_name"], "IF2611")


if __name__ == "__main__":
    unittest.main()

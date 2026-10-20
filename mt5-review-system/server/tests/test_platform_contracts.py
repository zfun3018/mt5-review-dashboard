import unittest

from app.platform_adapters.contracts import NormalizedExecution, PlatformCapabilities
from app.platform_adapters.registry import platform_registry
from app.platforms import DOMESTIC_FUTURES_PLATFORM, normalize_platform, platform_options


class PlatformContractsTest(unittest.TestCase):
    def test_platform_descriptors_declare_explicit_dashboard_capabilities(self):
        mt5 = platform_registry.adapter("mt5")
        domestic = platform_registry.adapter(DOMESTIC_FUTURES_PLATFORM)

        self.assertIsInstance(mt5.capabilities, PlatformCapabilities)
        self.assertIsInstance(domestic.capabilities, PlatformCapabilities)
        self.assertTrue(mt5.capabilities.show_market_clock)
        self.assertTrue(mt5.capabilities.show_sessions)
        self.assertTrue(mt5.capabilities.supports_r_metrics)
        self.assertFalse(mt5.capabilities.show_contract_rankings)
        self.assertFalse(domestic.capabilities.show_market_clock)
        self.assertFalse(domestic.capabilities.show_sessions)
        self.assertTrue(domestic.capabilities.show_contract_rankings)
        self.assertTrue(domestic.capabilities.show_fixed_periods)
        self.assertTrue(domestic.capabilities.show_review_coverage)
        self.assertTrue(domestic.capabilities.show_risk_summary)

    def test_domestic_futures_has_stable_user_facing_platform_identity(self):
        self.assertEqual(normalize_platform("tonghuashun_futures"), DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(normalize_platform("tonghuashun"), DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(
            platform_options(),
            [
                {"id": "mt5", "label": "MT5"},
                {"id": DOMESTIC_FUTURES_PLATFORM, "label": "国内期货"},
            ],
        )

    def test_normalized_execution_is_independent_from_trade_storage_shape(self):
        execution = NormalizedExecution(
            platform=DOMESTIC_FUTURES_PLATFORM,
            trade_date="2026-10-19",
            time_utc="2026-10-19T01:30:00+00:00",
            symbol="IF2611",
            side="long",
            offset="open",
            quantity=1,
            price=4000,
            source_kind="tonghuashun",
            source_filename="trades.xls",
            source_row_number=12,
        )

        self.assertEqual(execution.symbol, "IF2611")
        self.assertEqual(execution.offset, "open")
        self.assertEqual(execution.source_row_number, 12)
        self.assertFalse(hasattr(execution, "open_time_utc"))

    def test_registry_exposes_platform_adapter_without_importing_other_platform(self):
        adapter = platform_registry.adapter(DOMESTIC_FUTURES_PLATFORM)

        self.assertEqual(adapter.platform_id, DOMESTIC_FUTURES_PLATFORM)
        self.assertIn("csv", adapter.supported_formats)
        self.assertIn("xls", adapter.supported_formats)


if __name__ == "__main__":
    unittest.main()

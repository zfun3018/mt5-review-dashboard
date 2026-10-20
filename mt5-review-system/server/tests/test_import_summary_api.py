import unittest

from app import storage
from app.presentation.http.router import build_router
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase, insert_trade


class ImportSummaryApiTest(TemporaryStorageCase):
    def test_summary_returns_latest_trade_for_requested_platform_only(self):
        insert_trade(
            storage,
            id="MT5-LATEST",
            platform="mt5",
            close_time_utc="2026-10-19T03:00:00+00:00",
        )
        insert_trade(
            storage,
            id="FUT-LATEST",
            platform=DOMESTIC_FUTURES_PLATFORM,
            symbol="IF2611",
            product_name="IF",
            contract_name="IF2611",
            close_time_utc="2026-10-19T02:15:00+00:00",
        )

        router = build_router(storage, lambda: None)
        response = router.dispatch(
            "GET",
            "/api/platforms/import-summary",
            {"platform": [DOMESTIC_FUTURES_PLATFORM]},
            {},
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(response.payload["platform"], DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(response.payload["latest_trade"]["id"], "FUT-LATEST")
        self.assertEqual(response.payload["latest_trade"]["product_name"], "IF")
        self.assertEqual(response.payload["latest_trade"]["contract_name"], "IF2611")
        self.assertNotEqual(response.payload["latest_trade"]["id"], "MT5-LATEST")

    def test_summary_is_empty_when_platform_has_no_trades(self):
        router = build_router(storage, lambda: None)
        response = router.dispatch(
            "GET",
            "/api/platforms/import-summary",
            {"platform": [DOMESTIC_FUTURES_PLATFORM]},
            {},
        )

        self.assertEqual(response.status, 200)
        self.assertIsNone(response.payload["latest_trade"])


if __name__ == "__main__":
    unittest.main()

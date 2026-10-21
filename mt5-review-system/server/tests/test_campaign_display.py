import unittest
from unittest.mock import patch

from app.presentation.campaign_serializer import _serialize_campaign_record


class CampaignDisplayTest(unittest.TestCase):
    def test_campaign_screenshot_normalizes_legacy_backslash_path(self):
        record = {
            "id": "C-SHOT-LEGACY",
            "platform": "mt5",
            "symbol": "XAUUSDc",
            "screenshot_path": r"screenshots\legacy.png",
            "net_pnl": 12.0,
            "positions": [],
        }

        def screenshot_exists(_repository, path):
            return path == "screenshots/legacy.png"

        with patch("app.application.campaign_response.MediaRepository.exists", new=screenshot_exists):
            result = _serialize_campaign_record(record, include_positions=False)

        self.assertEqual(result["screenshot_url"], "/media/screenshots/legacy.png")
        self.assertEqual(result["screenshot_source"], "campaign")

    def test_campaign_screenshot_falls_back_to_existing_source_trade_screenshot(self):
        record = {
            "id": "C-SHOT-1",
            "platform": "mt5",
            "symbol": "XAUUSDc",
            "screenshot_path": "screenshots/missing-campaign.png",
            "net_pnl": 12.0,
            "positions": [
                {
                    "position_id": "P1",
                    "side": "long",
                    "entry_deals": [],
                    "exit_deals": [],
                    "source_trades": [
                        {
                            "id": "T1",
                            "symbol": "XAUUSDc",
                            "open_time_utc": "2026-10-19T01:30:00+00:00",
                            "close_time_utc": "2026-10-19T02:30:00+00:00",
                            "duration_seconds": 3600,
                            "screenshot_path": "screenshots/source-trade.png",
                            "custom_fields": {},
                        }
                    ],
                }
            ],
        }

        def screenshot_exists(_repository, path):
            return path == "screenshots/source-trade.png"

        with patch("app.application.campaign_response.MediaRepository.exists", new=screenshot_exists):
            result = _serialize_campaign_record(record, include_positions=True)

        self.assertEqual(result["screenshot_url"], "/media/screenshots/source-trade.png")
        self.assertEqual(result["screenshot_source"], "source_trade")
        self.assertFalse(result["screenshot_missing"])
        self.assertEqual(
            result["positions"][0]["source_trade"]["screenshot_url"],
            "/media/screenshots/source-trade.png",
        )

    def test_domestic_futures_campaign_exposes_industry_common_contract_display_name(self):
        record = {
            "id": "C-FUT-1",
            "platform": "domestic_futures",
            "symbol": "IF2611",
            "side": "long",
            "opened_at_utc": "2026-10-19T01:30:00+00:00",
            "closed_at_utc": "2026-10-19T02:30:00+00:00",
            "net_pnl": 100.0,
            "positions": [
                {
                    "position_id": "P1",
                    "side": "long",
                    "entry_deals": [],
                    "exit_deals": [],
                    "source_trades": [
                        {
                            "id": "T1",
                            "symbol": "IF2611",
                            "product_name": "IF",
                            "contract_name": "IF2611",
                            "open_time_utc": "2026-10-19T01:30:00+00:00",
                            "close_time_utc": "2026-10-19T02:30:00+00:00",
                            "duration_seconds": 3600,
                            "screenshot_path": "",
                            "custom_fields": {},
                        }
                    ],
                }
            ],
        }

        result = _serialize_campaign_record(record, include_positions=False)

        self.assertEqual(result["symbol"], "IF2611")
        self.assertEqual(result["product_name"], "沪深300股指")
        self.assertEqual(result["contract_name"], "沪深300股指2611")
        self.assertEqual(result["display_symbol"], "沪深300股指2611")


if __name__ == "__main__":
    unittest.main()

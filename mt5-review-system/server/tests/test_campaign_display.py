import unittest

from app.presentation.campaign_serializer import _serialize_campaign_record


class CampaignDisplayTest(unittest.TestCase):
    def test_domestic_futures_campaign_exposes_chinese_contract_display_name(self):
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
        self.assertEqual(result["product_name"], "IF")
        self.assertEqual(result["contract_name"], "IF2611")
        self.assertEqual(result["display_symbol"], "IF2611")


if __name__ == "__main__":
    unittest.main()

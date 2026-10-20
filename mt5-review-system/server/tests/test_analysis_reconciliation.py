from datetime import datetime, timezone
from unittest.mock import patch

from app import storage
from app.domain.analytics import build_trade_metrics, to_beijing
from tests.support import TemporaryStorageCase, insert_analysis_trade


class AnalysisReconciliationTest(TemporaryStorageCase):
    def _seed_campaigns(self, platform="mt5"):
        insert_analysis_trade(
            storage,
            "C1-A",
            position_id="C1-P1",
            symbol="XAUUSD",
            open_time_utc="2026-10-01T15:00:00+00:00",
            close_time_utc="2026-10-01T15:30:00+00:00",
            pnl=62.0,
            commission=-1.0,
            swap=-0.5,
            fee=-0.5,
            platform=platform,
        )
        insert_analysis_trade(
            storage,
            "C1-B",
            position_id="C1-P2",
            symbol="XAUUSD",
            open_time_utc="2026-10-01T15:10:00+00:00",
            close_time_utc="2026-10-01T16:30:00+00:00",
            pnl=45.0,
            commission=-2.0,
            swap=-1.0,
            fee=-2.0,
            platform=platform,
        )
        insert_analysis_trade(
            storage,
            "C2",
            symbol="EURUSD",
            open_time_utc="2026-10-01T02:00:00+00:00",
            close_time_utc="2026-10-01T02:30:00+00:00",
            pnl=55.0,
            commission=-3.0,
            swap=-1.0,
            fee=-1.0,
            trade_type="reversal",
            platform=platform,
        )
        insert_analysis_trade(
            storage,
            "C3",
            symbol="GBPUSD",
            open_time_utc="2026-10-01T08:30:00+00:00",
            close_time_utc="2026-10-01T09:00:00+00:00",
            pnl=-35.0,
            commission=-2.0,
            swap=-1.0,
            fee=-2.0,
            strategy="range",
            platform=platform,
        )
        insert_analysis_trade(
            storage,
            "C4",
            symbol="AUDUSD",
            open_time_utc="2026-10-02T08:30:00+00:00",
            close_time_utc="2026-10-02T09:00:00+00:00",
            pnl=-18.0,
            commission=-1.0,
            fee=-1.0,
            platform=platform,
        )
        insert_analysis_trade(
            storage,
            "C5",
            symbol="USDJPY",
            open_time_utc="2026-10-01T00:30:00+00:00",
            close_time_utc="2026-10-01T01:00:00+00:00",
            pnl=0.0,
            platform=platform,
        )

        page = storage.list_campaigns(platform=platform, page_size=100)
        campaign = next(
            item for item in page["campaigns"] if set(item["source_trade_ids"]) == {"C1-A", "C1-B"}
        )
        storage.update_campaign_review(
            campaign["id"],
            {
                "trade_type_tags": ["follow", "reversal"],
                "strategy_tags": ["breakout"],
                "mistake_tags": ["mistake-A", "mistake-B"],
            },
            platform=platform,
        )
        return storage.list_campaigns(platform=platform, page_size=100)

    def test_campaign_orders_analysis_calendar_and_sessions_reconcile(self):
        orders = self._seed_campaigns()
        campaigns = orders["campaigns"]

        self.assertEqual(orders["total"], 5)
        self.assertEqual(len(campaigns), 5)
        self.assertEqual(sum(item["net_pnl"] for item in campaigns), 90.0)
        self.assertEqual(sum(item["net_pnl"] > 0 for item in campaigns), 2)
        self.assertEqual(sum(item["net_pnl"] < 0 for item in campaigns), 2)
        self.assertEqual(sum(item["net_pnl"] == 0 for item in campaigns), 1)
        merged = next(item for item in campaigns if item["position_count"] == 2)
        self.assertEqual(len(merged["source_trade_ids"]), 2)
        self.assertIsNone(merged["initial_stop_price"])

        analysis = storage.get_analysis(
            start_date="2026-10-01",
            end_date="2026-10-02",
            year=2026,
            month=10,
        )

        self.assertEqual(analysis["metrics"]["order_count"], orders["total"])
        self.assertEqual(analysis["metrics"]["net_pnl"], 90.0)
        self.assertEqual(analysis["metrics"]["fee_total"], -19.0)
        self.assertEqual(
            sum(row["net_pnl"] for row in analysis["system_evaluation"]),
            analysis["metrics"]["net_pnl"],
        )
        daily = {row["date"]: row for row in analysis["system_evaluation"]}
        self.assertEqual(daily["2026-10-01"]["order_count"], 3)
        self.assertEqual(daily["2026-10-02"]["order_count"], 2)
        self.assertEqual(daily["2026-10-01"]["net_pnl"], 10.0)
        self.assertEqual(daily["2026-10-02"]["net_pnl"], 80.0)

        first_day = storage.get_analysis(
            start_date="2026-10-01",
            end_date="2026-10-01",
            year=2026,
            month=10,
        )
        expected_first_day = [
            campaign
            for campaign in campaigns
            if to_beijing(campaign["closed_at_utc"]).date().isoformat() == "2026-10-01"
        ]
        expected_first_day_metrics = build_trade_metrics(expected_first_day)
        self.assertEqual(first_day["metrics"]["order_count"], expected_first_day_metrics["order_count"])
        self.assertEqual(first_day["metrics"]["net_pnl"], expected_first_day_metrics["net_pnl"])

        calendar = analysis["calendar"]
        same_month_campaigns = [
            campaign
            for campaign in campaigns
            if to_beijing(campaign["closed_at_utc"]).strftime("%Y-%m") == "2026-10"
        ]
        same_month_metrics = build_trade_metrics(same_month_campaigns)
        self.assertEqual(calendar["month_order_count"], same_month_metrics["order_count"])
        self.assertEqual(calendar["month_net_pnl"], same_month_metrics["net_pnl"])
        self.assertEqual(
            sum(day["order_count"] for day in calendar["days"].values()),
            same_month_metrics["order_count"],
        )
        self.assertEqual(
            sum(day["net_pnl"] for day in calendar["days"].values()),
            same_month_metrics["net_pnl"],
        )
        self.assertEqual(analysis["periods"]["month"]["order_count"], same_month_metrics["order_count"])
        self.assertEqual(analysis["periods"]["month"]["net_pnl"], same_month_metrics["net_pnl"])

        session_rows = analysis["sessions"].values()
        self.assertEqual(sum(row["order_count"] for row in session_rows), orders["total"])
        self.assertEqual(sum(row["net_pnl"] for row in session_rows), same_month_metrics["net_pnl"])
        self.assertEqual(analysis["sessions"]["us"]["order_count"], 1)
        self.assertEqual(analysis["sessions"]["us"]["net_pnl"], 100.0)

        mode_rows = analysis["mode_evaluation"]
        for dimension in ("trade_type", "strategy"):
            self.assertEqual(
                sum(row["order_count"] for row in mode_rows[dimension]),
                analysis["metrics"]["order_count"],
            )
            self.assertEqual(
                sum(row["net_pnl"] for row in mode_rows[dimension]),
                analysis["metrics"]["net_pnl"],
            )
        self.assertEqual(analysis["r_metrics"]["missing_count"], orders["total"])
        self.assertEqual(analysis["metric_meta"]["r_metrics"]["status"], "estimated")

    def test_campaign_tags_reconcile_to_album_without_double_counting_multi_tags(self):
        orders = self._seed_campaigns()
        merged = next(item for item in orders["campaigns"] if item["position_count"] == 2)
        self.assertEqual(merged["mistake_tags"], ["mistake-A", "mistake-B"])

        album = storage.query_review_album(
            platform="mt5",
            tags=["mistake:mistake-A", "mistake:mistake-B"],
        )

        self.assertEqual(album["total"], 2)
        self.assertEqual(
            sum("mistake:mistake-A" in {tag["key"] for tag in item["album_tags"]} for item in album["trades"]),
            2,
        )
        self.assertEqual(
            sum("mistake:mistake-B" in {tag["key"] for tag in item["album_tags"]} for item in album["trades"]),
            2,
        )
        self.assertNotEqual(album["total"], orders["total"])

    def test_domestic_fixed_periods_use_same_campaign_rows(self):
        orders = self._seed_campaigns(platform="domestic_futures")
        class FixedDashboardDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                value = datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc)
                return value.astimezone(tz) if tz is not None else value.replace(tzinfo=None)

        with patch("app.application.dashboard_service.datetime", FixedDashboardDateTime):
            analysis = storage.get_analysis(platform="domestic_futures")

        fixed_year = analysis["fixed_periods"]["year"]
        expected = build_trade_metrics(orders["campaigns"])
        self.assertEqual(fixed_year["order_count"], expected["order_count"])
        self.assertEqual(fixed_year["net_pnl"], expected["net_pnl"])
        self.assertEqual(fixed_year["fee_total"], expected["fee_total"])


if __name__ == "__main__":
    unittest.main()

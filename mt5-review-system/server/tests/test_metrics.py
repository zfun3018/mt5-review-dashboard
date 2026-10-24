import unittest
from datetime import datetime, timezone

from app.analytics import (
    build_daily_system_evaluation,
    build_mode_evaluation,
    build_trade_metrics,
    calculate_runs_z,
    trade_net_pnl,
)
from app.domain.analysis_context import AnalysisContext
from app.domain.dashboard import build_trade_period_summaries, campaign_period_date_ranges
from app.domain.metrics import build_metric_registry


def trade(trade_id, close_time, pnl, commission=0.0, swap=0.0, trade_type="follow", strategy="breakout"):
    return {
        "id": trade_id,
        "close_time_utc": close_time,
        "pnl": pnl,
        "commission": commission,
        "swap": swap,
        "trade_type": trade_type,
        "strategy": strategy,
    }


def _campaign(campaign_id, close_time, net_pnl, **extra):
    row = {
        "id": campaign_id,
        "closed_at_utc": close_time,
        "close_time_utc": close_time,
        "net_pnl": net_pnl,
        "pnl": net_pnl,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "strategy": None,
        "trade_type": None,
        "campaign_r": None,
    }
    row.update(extra)
    return row


def _context(campaigns, *, snapshots=(), settings=None):
    merged_settings = {
        "scratch_threshold_r": 0.15,
        "selected_year": 2026,
        "selected_month": 8,
        "equity_days": None,
        "classification_options": (),
        "start_date": None,
        "end_date": None,
    }
    merged_settings.update(settings or {})
    return AnalysisContext(
        campaigns=campaigns,
        reference_campaigns=campaigns,
        equity_snapshots=snapshots,
        anchor_utc=datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc),
        platform="mt5",
        timezone="Asia/Shanghai",
        settings=merged_settings,
    )


class MetricsTest(unittest.TestCase):
    def test_trade_period_summaries_include_yesterday_and_rolling_windows(self):
        campaigns = [
            _campaign("yesterday", "2026-08-02T15:59:00+00:00", 10.0),
            _campaign("anchor-day", "2026-08-02T16:00:00+00:00", -4.0),
            _campaign("seven-day-start", "2026-07-28T16:00:00+00:00", 3.0),
            _campaign("outside-seven", "2026-07-27T15:59:00+00:00", 100.0),
        ]

        periods = build_trade_period_summaries(
            campaigns, datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)
        )

        self.assertEqual(periods["yesterday"]["order_count"], 1)
        self.assertEqual(periods["yesterday"]["net_pnl"], 10.0)
        self.assertEqual(periods["last_7_days"]["order_count"], 3)
        self.assertEqual(periods["last_7_days"]["net_pnl"], 9.0)
        self.assertEqual(periods["last_30_days"]["order_count"], 4)
        self.assertEqual(periods["last_365_days"]["order_count"], 4)
        self.assertAlmostEqual(periods["last_7_days"]["win_rate"], 2 / 3)

    def test_net_pnl_and_payoff_metrics_include_costs(self):
        trades = [
            trade("1", "2026-08-18T01:00:00+00:00", 100, commission=-5),
            trade("2", "2026-08-18T02:00:00+00:00", -40, commission=-2),
            trade("3", "2026-08-18T03:00:00+00:00", 0),
        ]

        self.assertEqual(trade_net_pnl(trades[0]), 95.0)
        metrics = build_trade_metrics(trades)

        self.assertEqual(metrics["order_count"], 3)
        self.assertEqual(metrics["net_pnl"], 53.0)
        self.assertAlmostEqual(metrics["win_rate"], 1 / 3)
        self.assertEqual(metrics["gross_profit"], 95.0)
        self.assertEqual(metrics["gross_loss"], 42.0)
        self.assertEqual(metrics["win_count"], 1)
        self.assertEqual(metrics["loss_count"], 1)
        self.assertAlmostEqual(metrics["profit_factor"], 95 / 42, places=4)
        self.assertAlmostEqual(metrics["payoff_ratio"], 95 / 42, places=4)
        self.assertEqual(metrics["max_profit"], 95.0)
        self.assertEqual(metrics["max_loss"], -42.0)

    def test_runs_z_excludes_break_even_and_is_deterministic(self):
        trades = [
            trade("1", "2026-08-18T01:00:00+00:00", 10),
            trade("2", "2026-08-18T02:00:00+00:00", 0),
            trade("3", "2026-08-18T03:00:00+00:00", -4),
            trade("4", "2026-08-18T04:00:00+00:00", 8),
        ]

        result = calculate_runs_z(trades)

        self.assertEqual(result["n"], 3)
        self.assertEqual(result["wins"], 2)
        self.assertEqual(result["losses"], 1)
        self.assertEqual(result["runs"], 3)
        self.assertEqual(result["classification"], "alternating")
        self.assertAlmostEqual(result["z"], 2.4749, places=4)

    def test_runs_z_reports_insufficient_sample(self):
        result = calculate_runs_z([trade("1", "2026-08-18T01:00:00+00:00", 10)])

        self.assertIsNone(result["z"])
        self.assertEqual(result["classification"], "insufficient_data")

    def test_daily_and_mode_evaluations_group_by_beijing_close_date(self):
        trades = [
            trade("1", "2026-08-17T16:30:00+00:00", 10, trade_type="follow", strategy="breakout"),
            trade("2", "2026-08-18T01:30:00+00:00", -4, trade_type="reversal", strategy="range"),
        ]

        daily = build_daily_system_evaluation(trades)
        modes = build_mode_evaluation(trades, "trade_type")

        self.assertEqual([row["date"] for row in daily], ["2026-08-18"])
        self.assertEqual(daily[0]["order_count"], 2)
        self.assertEqual(len(modes), 2)
        self.assertEqual(sum(item["order_count"] for item in modes), 2)
        self.assertEqual(modes[0]["share"], 0.5)

    def test_fixed_period_date_ranges_use_beijing_anchor_and_monday_week(self):
        ranges = campaign_period_date_ranges(datetime.fromisoformat("2026-10-23T01:00:00+00:00"))

        self.assertEqual(ranges["today"], {"start": "2026-10-23", "end": "2026-10-23"})
        self.assertEqual(ranges["week"], {"start": "2026-10-19", "end": "2026-10-23"})
        self.assertEqual(ranges["month"], {"start": "2026-10-01", "end": "2026-10-23"})
        self.assertEqual(ranges["year"], {"start": "2026-01-01", "end": "2026-10-23"})


class CommonMetricRegistryTest(unittest.TestCase):
    def test_registered_results_expose_metadata_and_campaign_summary_unit(self):
        context = _context(
            [
                _campaign("C-2", "2026-08-02T02:00:00+00:00", -5.0),
                _campaign("C-1", "2026-08-01T02:00:00+00:00", 10.0),
            ]
        )

        results = {result.key: result for result in build_metric_registry().evaluate(context)}

        self.assertEqual(results["summary"].value["order_count"], 2)
        self.assertEqual(results["summary"].value["net_pnl"], 5.0)
        self.assertEqual(results["summary"].sample_count, 2)
        self.assertTrue(results["summary"].definition_version)
        for result in results.values():
            self.assertIsInstance(result.sample_count, int)
            self.assertTrue(result.definition_version)

    def test_equity_curve_is_chronological_and_uses_snapshots_only_as_baseline(self):
        context = _context(
            [
                _campaign("C-2", "2026-08-02T02:00:00+00:00", -5.0),
                _campaign("C-1", "2026-08-01T02:00:00+00:00", 10.0),
            ],
            snapshots=[
                {"time_utc": "2026-08-01T00:00:00+00:00", "balance": 10000.0, "equity": 9990.0},
                {"time_utc": "2026-08-03T00:00:00+00:00", "balance": 9000.0, "equity": 9000.0},
            ],
        )

        curve = build_metric_registry().evaluate(context)
        equity = next(result for result in curve if result.key == "equity_curve")

        self.assertEqual(
            [point["trade_id"] for point in equity.value],
            ["baseline", "C-1", "C-2"],
        )
        self.assertEqual([point["cumulative_return"] for point in equity.value], [0.0, 10.0, 5.0])
        self.assertEqual(equity.value[-1]["equity"], 10005.0)

    def test_calendar_groups_by_beijing_close_date(self):
        context = _context(
            [_campaign("C-1", "2026-08-01T16:30:00+00:00", 8.0)],
            settings={"selected_year": 2026, "selected_month": 8},
        )

        calendar = next(
            result for result in build_metric_registry().evaluate(context) if result.key == "calendar"
        )

        self.assertEqual(calendar.value["days"]["2026-08-02"]["net_pnl"], 8.0)
        self.assertEqual(calendar.value["days"]["2026-08-01"]["order_count"], 0)

    def test_sessions_include_both_sides_of_cross_midnight_window(self):
        context = _context(
            [
                _campaign("C-1", "2026-08-01T14:00:00+00:00", 4.0),
                _campaign("C-2", "2026-08-01T17:00:00+00:00", 3.0),
                _campaign("C-3", "2026-08-01T02:00:00+00:00", -2.0),
            ]
        )

        sessions = next(
            result for result in build_metric_registry().evaluate(context) if result.key == "sessions"
        )

        self.assertEqual(sessions.value["us"]["order_count"], 2)
        self.assertEqual(sessions.value["asia"]["order_count"], 1)

    def test_mode_evaluation_uses_catalog_label_and_unclassified_bucket(self):
        context = _context(
            [
                _campaign("C-1", "2026-08-01T02:00:00+00:00", 4.0, strategy="s1"),
                _campaign("C-2", "2026-08-02T02:00:00+00:00", -2.0),
            ],
            settings={
                "classification_options": (
                    {"id": "s1", "label": "突破", "dimension": "strategy"},
                )
            },
        )

        mode = next(
            result
            for result in build_metric_registry().evaluate(context)
            if result.key == "mode_evaluation"
        )

        strategy_rows = {row["key"]: row for row in mode.value["strategy"]}
        self.assertEqual(strategy_rows["s1"]["label"], "突破")
        self.assertEqual(strategy_rows["unclassified"]["label"], "unclassified")

    def test_r_metrics_report_missing_r_and_insufficient_sqn_sample(self):
        context = _context(
            [
                _campaign("C-1", "2026-08-01T02:00:00+00:00", 4.0, campaign_r=0.5),
                _campaign("C-2", "2026-08-02T02:00:00+00:00", -2.0),
            ]
        )

        r_metrics = next(
            result for result in build_metric_registry().evaluate(context) if result.key == "r_metrics"
        )

        self.assertEqual(r_metrics.value["missing_count"], 1)
        self.assertEqual(r_metrics.value["sqn_status"], "insufficient_sample")
        self.assertEqual(r_metrics.value["sample_count"], 2)
        self.assertEqual(r_metrics.value["complete_count"], 1)

    def test_max_drawdown_uses_peak_to_trough_realized_campaign_curve(self):
        context = _context(
            [
                _campaign("C-1", "2026-08-01T01:00:00+00:00", 12.5),
                _campaign("C-2", "2026-08-02T01:00:00+00:00", -4.0),
                _campaign("C-3", "2026-08-03T01:00:00+00:00", 3.0),
                _campaign("C-4", "2026-08-04T01:00:00+00:00", -20.0),
            ]
        )

        results = {result.key: result for result in build_metric_registry().evaluate(context)}
        drawdown = results["max_drawdown"]

        self.assertEqual(drawdown.value, {"amount": 21.0, "peak": 12.5, "trough": -8.5})
        self.assertEqual(drawdown.sample_count, 4)
        self.assertEqual(drawdown.status, "available")


if __name__ == "__main__":
    unittest.main()

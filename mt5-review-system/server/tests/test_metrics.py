import unittest
from datetime import datetime, timezone

from app.analytics import (
    build_daily_system_evaluation,
    build_mode_evaluation,
    build_trade_metrics,
    calculate_runs_z,
    trade_net_pnl,
)


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


class MetricsTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()

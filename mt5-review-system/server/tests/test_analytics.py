import unittest
from datetime import datetime, timezone

from app.analytics import (
    build_cumulative_return_curve,
    build_equity_curve,
    build_hour_heatmap,
    build_month_calendar,
    build_session_stats,
    calculate_duration_seconds,
    parse_dt,
)


class AnalyticsTest(unittest.TestCase):
    def test_builds_cumulative_return_curve_from_trades_not_snapshot_drawdowns(self):
        trades = [
            {
                "id": "T-1",
                "close_time_utc": "2026-08-18T01:00:00+00:00",
                "pnl": 10.0,
                "commission": 0.0,
                "swap": 0.0,
                "fee": 0.0,
            },
            {
                "id": "T-2",
                "close_time_utc": "2026-08-18T02:00:00+00:00",
                "pnl": -4.0,
                "commission": 0.0,
                "swap": 0.0,
                "fee": 0.0,
            },
        ]
        snapshots = [
            {"time_utc": "2026-08-18T00:00:00+00:00", "balance": 10000.0, "equity": 10000.0},
            {"time_utc": "2026-08-18T03:00:00+00:00", "balance": 9000.0, "equity": 9000.0},
        ]

        curve = build_cumulative_return_curve(
            trades,
            snapshots,
            now_utc=datetime(2026, 8, 18, 4, 0, tzinfo=timezone.utc),
            hours=24,
        )

        self.assertEqual([point["cumulative_return"] for point in curve], [0.0, 10.0, 6.0])
        self.assertEqual(curve[-1]["equity"], 10006.0)
        self.assertEqual(curve[-1]["return_rate"], 0.06)

    def test_calculates_trade_duration_in_seconds(self):
        opened = parse_dt("2026-08-10T08:00:00+00:00")
        closed = parse_dt("2026-08-10T09:30:00+00:00")

        self.assertEqual(calculate_duration_seconds(opened, closed), 5400)

    def test_builds_month_calendar_daily_profit_and_win_rate(self):
        trades = [
            {"close_time_utc": "2026-08-03T02:00:00+00:00", "pnl": 120.0},
            {"close_time_utc": "2026-08-03T04:00:00+00:00", "pnl": -50.0},
            {"close_time_utc": "2026-08-04T12:00:00+00:00", "pnl": 80.0},
        ]

        calendar = build_month_calendar(trades, 2026, 8)

        self.assertEqual(calendar["month_net_pnl"], 150.0)
        self.assertEqual(calendar["month_order_count"], 3)
        self.assertAlmostEqual(calendar["month_win_rate"], 2 / 3)
        self.assertEqual(calendar["days"]["2026-08-03"]["net_pnl"], 70.0)
        self.assertEqual(calendar["days"]["2026-08-03"]["order_count"], 2)
        self.assertEqual(calendar["days"]["2026-08-03"]["win_rate"], 0.5)

    def test_builds_beijing_time_week_hour_heatmap(self):
        trades = [
            {"close_time_utc": "2026-08-10T14:30:00+00:00", "pnl": 120.0},
            {"close_time_utc": "2026-08-11T01:00:00+00:00", "pnl": -30.0},
        ]
        anchor = datetime(2026, 8, 12, 8, 0, tzinfo=timezone.utc)

        heatmap = build_hour_heatmap(trades, anchor_utc=anchor, days=7)

        monday = next(row for row in heatmap["days"] if row["date"] == "2026-08-10")
        tuesday = next(row for row in heatmap["days"] if row["date"] == "2026-08-11")
        self.assertEqual(monday["hours"][22]["net_pnl"], 120.0)
        self.assertEqual(tuesday["hours"][9]["net_pnl"], -30.0)

    def test_builds_session_stats_with_cross_midnight_us_session(self):
        trades = [
            {"close_time_utc": "2026-08-10T01:00:00+00:00", "pnl": 100.0},
            {"close_time_utc": "2026-08-10T08:00:00+00:00", "pnl": -40.0},
            {"close_time_utc": "2026-08-10T16:30:00+00:00", "pnl": 75.0},
        ]

        stats = build_session_stats(trades)

        self.assertEqual(stats["asia"]["order_count"], 1)
        self.assertEqual(stats["europe"]["order_count"], 1)
        self.assertEqual(stats["us"]["order_count"], 1)
        self.assertEqual(stats["us"]["win_rate"], 1.0)

    def test_filters_equity_curve_to_last_24_hours(self):
        snapshots = [
            {"time_utc": "2026-08-09T07:59:59+00:00", "equity": 9990.0},
            {"time_utc": "2026-08-09T08:00:00+00:00", "equity": 10000.0},
            {"time_utc": "2026-08-10T07:00:00+00:00", "equity": 10125.5},
        ]
        now_utc = datetime(2026, 8, 10, 8, 0, tzinfo=timezone.utc)

        curve = build_equity_curve(snapshots, now_utc=now_utc, hours=24)

        self.assertEqual(len(curve), 2)
        self.assertEqual(curve[0]["equity"], 10000.0)
        self.assertEqual(curve[-1]["equity"], 10125.5)

    def test_builds_cumulative_return_amount_and_rate_from_range_baseline(self):
        snapshots = [
            {"time_utc": "2026-08-10T07:00:00+00:00", "equity": 10000.0},
            {"time_utc": "2026-08-10T07:30:00+00:00", "equity": 10125.5},
            {"time_utc": "2026-08-10T08:00:00+00:00", "equity": 9950.0},
        ]

        curve = build_equity_curve(
            snapshots,
            now_utc=datetime(2026, 8, 10, 8, 0, tzinfo=timezone.utc),
            hours=2,
        )

        self.assertEqual(curve[0]["cumulative_return"], 0.0)
        self.assertEqual(curve[1]["cumulative_return"], 125.5)
        self.assertEqual(curve[1]["return_rate"], 1.255)
        self.assertEqual(curve[-1]["cumulative_return"], -50.0)
        self.assertEqual(curve[-1]["return_rate"], -0.5)

    def test_filters_equity_curve_by_beijing_date_range(self):
        snapshots = [
            {"time_utc": "2026-08-13T15:59:00+00:00", "equity": 9900.0},
            {"time_utc": "2026-08-13T16:00:00+00:00", "equity": 10000.0},
            {"time_utc": "2026-08-15T00:00:00+00:00", "equity": 10100.0},
            {"time_utc": "2026-08-15T16:00:00+00:00", "equity": 10200.0},
        ]

        curve = build_equity_curve(
            snapshots,
            start_date="2026-08-15",
            end_date="2026-08-15",
        )

        self.assertEqual(len(curve), 1)
        self.assertEqual(curve[0]["equity"], 10100.0)


if __name__ == "__main__":
    unittest.main()

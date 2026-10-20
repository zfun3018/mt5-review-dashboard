import unittest
from datetime import datetime, timezone

from app.domain.domestic_futures_dashboard import (
    build_contract_rankings,
    build_fixed_period_summaries,
    build_monthly_pnl,
    build_review_coverage,
    build_risk_summary,
)


def trade(trade_id, close_time, symbol, pnl, commission=0.0, fee=0.0):
    return {
        "id": trade_id,
        "close_time_utc": close_time,
        "symbol": symbol,
        "contract_name": symbol,
        "pnl": pnl,
        "commission": commission,
        "swap": 0.0,
        "fee": fee,
    }


class DomesticFuturesDashboardTest(unittest.TestCase):
    def setUp(self):
        self.trades = [
            trade("1", "2026-10-20T01:00:00+00:00", "IF2611", 1000, commission=-50),
            trade("2", "2026-10-18T01:00:00+00:00", "IF2611", -300, commission=-30),
            trade("3", "2026-09-10T01:00:00+00:00", "RB2701", 800, commission=-20),
            trade("4", "2026-06-01T01:00:00+00:00", "PVC2701", -500, commission=-40),
        ]
        self.anchor = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)

    def test_fixed_periods_are_rolling_and_include_fee_split(self):
        periods = build_fixed_period_summaries(self.trades, self.anchor)

        self.assertEqual(set(periods), {"today", "week", "month", "quarter", "year"})
        self.assertEqual(periods["today"]["order_count"], 1)
        self.assertEqual(periods["today"]["trade_pnl"], 1000.0)
        self.assertEqual(periods["today"]["fee_total"], -50.0)
        self.assertEqual(periods["today"]["net_pnl"], 950.0)
        self.assertEqual(periods["quarter"]["order_count"], 3)
        self.assertEqual(periods["year"]["order_count"], 4)

    def test_fixed_periods_can_use_real_today_independent_of_latest_trade(self):
        periods = build_fixed_period_summaries(
            self.trades,
            self.anchor,
            today=datetime(2026, 10, 21, 8, 0, tzinfo=timezone.utc),
        )

        self.assertEqual(periods["today"]["order_count"], 0)
        self.assertEqual(periods["week"]["order_count"], 2)

    def test_review_coverage_counts_initial_stop_as_complete(self):
        result = build_review_coverage([
            {"review_text": "", "has_initial_stop": 1},
            {"review_text": "", "has_initial_stop": 0},
            {"review_text": "完成文字", "has_initial_stop": 0},
        ])

        self.assertEqual(result["total"], 3)
        self.assertEqual(result["reviewed"], 1)

    def test_monthly_pnl_and_contract_rankings_use_net_pnl(self):
        monthly = build_monthly_pnl(self.trades)
        self.assertEqual([item["month"] for item in monthly], ["2026-06", "2026-09", "2026-10"])
        self.assertEqual(monthly[-1]["net_pnl"], 620.0)
        self.assertEqual(monthly[-1]["fee_total"], -80.0)

        rankings = build_contract_rankings(self.trades)
        self.assertEqual(rankings["contribution"][0]["symbol"], "RB2701")
        self.assertEqual(rankings["contribution"][0]["net_pnl"], 780.0)
        self.assertEqual(rankings["losses"][0]["symbol"], "PVC2701")
        self.assertEqual(rankings["losses"][0]["net_pnl"], -540.0)

    def test_risk_summary_exposes_drawdown_and_loss_streak(self):
        risk = build_risk_summary(self.trades)

        self.assertEqual(risk["sample_count"], 4)
        self.assertEqual(risk["max_drawdown"], 540.0)
        self.assertEqual(risk["longest_loss_streak"], 1)
        self.assertEqual(risk["max_loss"], -540.0)
        self.assertEqual(risk["fee_pressure"], round(140 / 1000, 4))


if __name__ == "__main__":
    unittest.main()

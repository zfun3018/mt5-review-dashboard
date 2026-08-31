import unittest

from app.campaigns import (
    build_r_metrics,
    calculate_campaign_r,
    calculate_position_risk,
    group_campaigns,
    reconstruct_positions,
)


def deal(
    ticket,
    position_id,
    entry_kind,
    deal_type,
    volume,
    price,
    time_msc,
    *,
    account="ACC",
    symbol="XAUUSD",
    profit=0.0,
):
    seconds = time_msc // 1000
    return {
        "deal_ticket": str(ticket),
        "account": account,
        "position_id": str(position_id),
        "entry_kind": entry_kind,
        "deal_type": deal_type,
        "symbol": symbol,
        "volume": volume,
        "price": price,
        "time_utc": f"2026-08-01T00:00:{seconds:02d}+00:00",
        "time_msc": time_msc,
        "profit": profit,
    }


class CampaignReconstructionTest(unittest.TestCase):
    def test_reconstructs_partial_exits_as_one_position(self):
        positions = reconstruct_positions(
            [
                deal(1, 100, "in", "buy", 1.0, 100.0, 1000),
                deal(2, 100, "out", "sell", 0.4, 102.0, 2000),
                deal(3, 100, "out", "sell", 0.6, 103.0, 3000),
            ]
        )

        self.assertEqual(len(positions), 1)
        self.assertEqual(positions[0]["side"], "long")
        self.assertEqual(positions[0]["reconstruction_status"], "complete")
        self.assertEqual(positions[0]["partial_exit_count"], 1)
        self.assertAlmostEqual(positions[0]["remaining_volume"], 0.0)
        self.assertAlmostEqual(positions[0]["weighted_exit_price"], 102.6)
        self.assertEqual(positions[0]["holding_seconds"], 2)


class CampaignRiskTest(unittest.TestCase):
    def test_position_risk_sums_each_entry_against_one_initial_stop(self):
        position = {
            "side": "long",
            "entry_deals": [
                {"volume": 1.0, "price": 100.0},
                {"volume": 0.5, "price": 102.0},
            ],
            "exit_deals": [
                {"volume": 0.75, "price": 104.0},
                {"volume": 0.75, "price": 106.0},
            ],
            "entry_volume": 1.5,
            "exit_volume": 1.5,
            "initial_stop_price": 98.0,
            "reconstruction_status": "complete",
        }

        result = calculate_position_risk(position)

        self.assertEqual(result["risk_status"], "complete")
        self.assertEqual(result["planned_risk"], 4.0)
        self.assertEqual(result["result"], 6.5)
        self.assertEqual(result["position_r"], 1.625)

    def test_campaign_r_sums_each_positions_planned_risk(self):
        positions = [
            {
                "side": "long",
                "entry_deals": [{"volume": 1.0, "price": 100.0}],
                "exit_deals": [{"volume": 1.0, "price": 104.0}],
                "entry_volume": 1.0,
                "exit_volume": 1.0,
                "initial_stop_price": 98.0,
                "reconstruction_status": "complete",
            },
            {
                "side": "long",
                "entry_deals": [{"volume": 0.5, "price": 102.0}],
                "exit_deals": [{"volume": 0.5, "price": 106.0}],
                "entry_volume": 0.5,
                "exit_volume": 0.5,
                "initial_stop_price": 99.0,
                "reconstruction_status": "complete",
            },
        ]

        result = calculate_campaign_r({"status": "closed"}, positions)

        self.assertEqual(result["campaign_total_risk"], 3.5)
        self.assertEqual(result["campaign_total_result"], 6.0)
        self.assertAlmostEqual(result["campaign_r"], 6.0 / 3.5)
        self.assertEqual(result["risk_positions_complete"], 2)
        self.assertEqual(result["risk_positions_total"], 2)

    def test_campaign_summary_exposes_weighted_prices_and_holding_time(self):
        positions = reconstruct_positions(
            [
                deal(1, "A", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "A", "out", "sell", 1.0, 104.0, 4000),
                deal(3, "B", "in", "buy", 0.5, 102.0, 2000),
                deal(4, "B", "out", "sell", 0.5, 106.0, 5000),
            ]
        )
        campaign = group_campaigns(positions)[0]

        self.assertAlmostEqual(campaign["weighted_entry_price"], 100.6666666667)
        self.assertAlmostEqual(campaign["weighted_exit_price"], 104.6666666667)
        self.assertEqual(campaign["holding_seconds"], 4)

    def test_missing_or_wrong_direction_stop_makes_campaign_r_unavailable(self):
        base = {
            "side": "short",
            "entry_deals": [{"volume": 1.0, "price": 100.0}],
            "exit_deals": [{"volume": 1.0, "price": 98.0}],
            "entry_volume": 1.0,
            "exit_volume": 1.0,
            "reconstruction_status": "complete",
        }
        missing = dict(base, initial_stop_price=None)
        invalid = dict(base, initial_stop_price=99.0)

        result = calculate_campaign_r({"status": "closed"}, [missing, invalid])

        self.assertIsNone(result["campaign_r"])
        self.assertEqual(result["risk_positions_complete"], 0)
        self.assertEqual(result["risk_positions_total"], 2)
        self.assertEqual(result["risk_status"], "invalid")
        self.assertEqual(set(result["risk_missing_reasons"]), {"missing_initial_stop", "invalid_stop_direction"})

    def test_open_or_unbalanced_position_has_no_r(self):
        position = {
            "side": "long",
            "entry_deals": [{"volume": 1.0, "price": 100.0}],
            "exit_deals": [{"volume": 0.5, "price": 104.0}],
            "entry_volume": 1.0,
            "exit_volume": 0.5,
            "initial_stop_price": 98.0,
            "reconstruction_status": "open",
        }

        result = calculate_campaign_r({"status": "open"}, [position])

        self.assertIsNone(result["campaign_r"])
        self.assertIn("campaign_open", result["risk_missing_reasons"])


class CampaignMetricsTest(unittest.TestCase):
    def test_builds_scratch_dual_win_rates_expectancy_and_coverage(self):
        campaigns = [
            {"id": "1", "campaign_r": 1.0, "closed_at_utc": "2026-08-01T00:01:00+00:00"},
            {"id": "2", "campaign_r": -0.5, "closed_at_utc": "2026-08-01T00:02:00+00:00"},
            {"id": "3", "campaign_r": 0.15, "closed_at_utc": "2026-08-01T00:03:00+00:00"},
            {"id": "4", "campaign_r": None, "closed_at_utc": "2026-08-01T00:04:00+00:00"},
        ]

        metrics = build_r_metrics(campaigns, scratch_threshold_r=0.15)

        self.assertEqual(metrics["sample_count"], 4)
        self.assertEqual(metrics["complete_count"], 3)
        self.assertEqual(metrics["missing_count"], 1)
        self.assertEqual(metrics["coverage_rate"], 0.75)
        self.assertEqual(metrics["scratch_count"], 1)
        self.assertAlmostEqual(metrics["scratch_rate"], 1 / 3)
        self.assertEqual(metrics["decisive_win_rate"], 0.5)
        self.assertAlmostEqual(metrics["all_sample_win_rate"], 1 / 3)
        self.assertAlmostEqual(metrics["expectancy_r"], 0.65 / 3)
        self.assertEqual(metrics["sqn_status"], "insufficient_sample")
        self.assertEqual(metrics["z_score"]["n"], 2)

    def test_sqn_uses_sample_standard_deviation_at_thirty_campaigns(self):
        campaigns = [
            {
                "id": str(index),
                "campaign_r": 1.0 if index % 2 else -1.0,
                "closed_at_utc": f"2026-08-01T00:00:{index:02d}+00:00",
            }
            for index in range(1, 31)
        ]

        metrics = build_r_metrics(campaigns)

        self.assertEqual(metrics["sqn_status"], "available")
        self.assertEqual(metrics["sqn"], 0.0)

    def test_sqn_with_zero_variance_is_unavailable(self):
        campaigns = [
            {"id": str(index), "campaign_r": 1.0, "closed_at_utc": f"2026-08-01T00:00:{index:02d}+00:00"}
            for index in range(1, 31)
        ]

        metrics = build_r_metrics(campaigns)

        self.assertEqual(metrics["sqn_status"], "zero_variance")
        self.assertIsNone(metrics["sqn"])

    def test_groups_transitively_overlapping_positions_once(self):
        positions = reconstruct_positions(
            [
                deal(1, "A", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "B", "in", "buy", 1.0, 101.0, 2000),
                deal(3, "A", "out", "sell", 1.0, 102.0, 3000),
                deal(4, "C", "in", "buy", 1.0, 103.0, 3000),
                deal(5, "B", "out", "sell", 1.0, 104.0, 4000),
                deal(6, "C", "out", "sell", 1.0, 105.0, 5000),
            ]
        )

        groups = group_campaigns(positions)

        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["position_ids"], ["ACC:A", "ACC:B", "ACC:C"])
        self.assertEqual(groups[0]["scale_in_count"], 2)
        self.assertEqual(groups[0]["position_count"], 3)

    def test_new_position_after_exposure_returns_to_zero_starts_new_campaign(self):
        positions = reconstruct_positions(
            [
                deal(1, "A", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "A", "out", "sell", 1.0, 101.0, 2000),
                deal(3, "B", "in", "buy", 1.0, 102.0, 3000),
                deal(4, "B", "out", "sell", 1.0, 103.0, 4000),
            ]
        )

        groups = group_campaigns(positions)

        self.assertEqual([group["position_ids"] for group in groups], [["ACC:A"], ["ACC:B"]])

    def test_opposite_directions_never_share_a_campaign(self):
        positions = reconstruct_positions(
            [
                deal(1, "LONG", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "SHORT", "in", "sell", 1.0, 100.0, 1500),
                deal(3, "LONG", "out", "sell", 1.0, 101.0, 3000),
                deal(4, "SHORT", "out", "buy", 1.0, 99.0, 3500),
            ]
        )

        groups = group_campaigns(positions)

        self.assertEqual(len(groups), 2)
        self.assertEqual({group["side"] for group in groups}, {"long", "short"})

    def test_same_millisecond_ticket_order_determines_overlap(self):
        overlapping = reconstruct_positions(
            [
                deal(1, "A", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "B", "in", "buy", 1.0, 101.0, 2000),
                deal(3, "A", "out", "sell", 1.0, 102.0, 2000),
                deal(4, "B", "out", "sell", 1.0, 103.0, 3000),
            ]
        )
        separate = reconstruct_positions(
            [
                deal(1, "A", "in", "buy", 1.0, 100.0, 1000),
                deal(2, "A", "out", "sell", 1.0, 102.0, 2000),
                deal(3, "B", "in", "buy", 1.0, 101.0, 2000),
                deal(4, "B", "out", "sell", 1.0, 103.0, 3000),
            ]
        )

        self.assertEqual(len(group_campaigns(overlapping)), 1)
        self.assertEqual(len(group_campaigns(separate)), 2)

    def test_missing_entry_deal_is_incomplete(self):
        positions = reconstruct_positions(
            [deal(9, "LATE", "out", "sell", 1.0, 102.0, 2000)]
        )

        self.assertEqual(positions[0]["reconstruction_status"], "incomplete")
        self.assertEqual(positions[0]["side"], "long")


if __name__ == "__main__":
    unittest.main()

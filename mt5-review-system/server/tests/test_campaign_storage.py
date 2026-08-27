import tempfile
import unittest
from pathlib import Path

from app import storage


class CampaignStorageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.originals = {
            "PROJECT_ROOT": storage.PROJECT_ROOT,
            "DATA_DIR": storage.DATA_DIR,
            "SCREENSHOT_DIR": storage.SCREENSHOT_DIR,
            "RAW_EVENTS_DIR": storage.RAW_EVENTS_DIR,
            "BACKUP_DIR": storage.BACKUP_DIR,
            "DB_PATH": storage.DB_PATH,
        }
        storage.PROJECT_ROOT = self.root
        storage.DATA_DIR = self.root / "data"
        storage.SCREENSHOT_DIR = storage.DATA_DIR / "screenshots"
        storage.RAW_EVENTS_DIR = storage.DATA_DIR / "raw-events"
        storage.BACKUP_DIR = self.root / "backups"
        storage.DB_PATH = storage.DATA_DIR / "journal.sqlite"
        storage.init_db(seed=False)

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def _trade(
        self,
        trade_id,
        position_id,
        lots,
        open_time,
        close_time,
        entry_price,
        exit_price,
        pnl,
        *,
        review_text="",
        deleted=False,
    ):
        storage.upsert_trade(
            {
                "id": trade_id,
                "account": "ACC",
                "order_no": trade_id,
                "position_id": position_id,
                "order_ticket": f"O-{trade_id}",
                "deal_ticket": f"D-{trade_id}",
                "symbol": "XAUUSD",
                "side": "long",
                "lots": lots,
                "open_time_utc": open_time,
                "close_time_utc": close_time,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "pnl": pnl,
                "commission": 0.0,
                "swap": 0.0,
                "fee": 0.0,
                "screenshot_path": "",
                "review_text": review_text,
                "trade_type": "follow",
                "strategy": "breakout",
            }
        )
        if deleted:
            storage.delete_trade(trade_id)

    def test_schema_v4_and_legacy_rebuild_are_idempotent(self):
        self._trade(
            "P1-A",
            "P1",
            0.4,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:10:00+00:00",
            100.0,
            102.0,
            0.8,
            review_text="首次减仓",
        )
        self._trade(
            "P1-B",
            "P1",
            0.6,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:30:00+00:00",
            100.0,
            104.0,
            2.4,
        )
        self._trade(
            "P2",
            "P2",
            0.5,
            "2026-08-01T00:20:00+00:00",
            "2026-08-01T00:40:00+00:00",
            101.0,
            105.0,
            2.0,
        )

        first = storage.list_campaigns()
        first_id = first["campaigns"][0]["id"]
        storage.init_db(seed=False)
        second = storage.list_campaigns()

        self.assertEqual(first["total"], 1)
        self.assertEqual(first["campaigns"][0]["position_count"], 2)
        self.assertEqual(first["campaigns"][0]["partial_exit_count"], 1)
        self.assertEqual(second["campaigns"][0]["id"], first_id)
        with storage.db() as conn:
            version = conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()["value"]
            counts = {
                table: conn.execute(f"SELECT COUNT(*) AS value FROM {table}").fetchone()["value"]
                for table in ("deal_events", "positions", "trade_campaigns", "campaign_positions")
            }
        self.assertEqual(version, "4")
        self.assertEqual(counts["positions"], 2)
        self.assertEqual(counts["campaign_positions"], 2)

    def test_each_position_stop_is_required_before_campaign_r_is_available(self):
        self._trade(
            "P1",
            "P1",
            1.0,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:30:00+00:00",
            100.0,
            104.0,
            4.0,
        )
        self._trade(
            "P2",
            "P2",
            0.5,
            "2026-08-01T00:20:00+00:00",
            "2026-08-01T00:40:00+00:00",
            102.0,
            106.0,
            2.0,
        )
        campaign = storage.list_campaigns()["campaigns"][0]
        detail = storage.get_campaign(campaign["id"])

        first = storage.update_position_initial_stop(detail["positions"][0]["id"], 98.0)
        self.assertIsNone(first["campaign"]["campaign_r"])
        self.assertEqual(first["campaign"]["risk_positions_complete"], 1)
        self.assertEqual(first["campaign"]["risk_positions_total"], 2)

        second = storage.update_position_initial_stop(detail["positions"][1]["id"], 99.0)
        self.assertAlmostEqual(second["campaign"]["campaign_r"], 6.0 / 3.5)
        self.assertEqual(second["campaign"]["risk_status"], "complete")

    def test_invalid_stop_does_not_overwrite_previous_valid_value(self):
        self._trade(
            "P1",
            "P1",
            1.0,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:30:00+00:00",
            100.0,
            104.0,
            4.0,
        )
        position_id = storage.get_campaign(storage.list_campaigns()["campaigns"][0]["id"])[
            "positions"
        ][0]["id"]
        storage.update_position_initial_stop(position_id, 98.0)

        with self.assertRaisesRegex(ValueError, "止损"):
            storage.update_position_initial_stop(position_id, 101.0)

        detail = storage.get_campaign(storage.list_campaigns()["campaigns"][0]["id"])
        self.assertEqual(detail["positions"][0]["initial_stop_price"], 98.0)

    def test_missing_r_filter_returns_only_incomplete_campaigns(self):
        self._trade(
            "P1",
            "P1",
            1.0,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:10:00+00:00",
            100.0,
            104.0,
            4.0,
        )
        first = storage.list_campaigns()["campaigns"][0]
        position_id = storage.get_campaign(first["id"])["positions"][0]["id"]
        storage.update_position_initial_stop(position_id, 98.0)
        self._trade(
            "P2",
            "P2",
            1.0,
            "2026-08-01T01:00:00+00:00",
            "2026-08-01T01:10:00+00:00",
            110.0,
            109.0,
            -1.0,
        )

        filtered = storage.list_campaigns(r_missing_only=True)

        self.assertEqual(filtered["total"], 1)
        self.assertEqual(filtered["campaigns"][0]["risk_status"], "missing")

    def test_analysis_setting_defaults_and_validates(self):
        self.assertEqual(storage.get_analysis_settings()["scratch_threshold_r"], 0.15)
        self.assertEqual(
            storage.update_analysis_settings({"scratch_threshold_r": 0.2})[
                "scratch_threshold_r"
            ],
            0.2,
        )
        with self.assertRaises(ValueError):
            storage.update_analysis_settings({"scratch_threshold_r": -0.1})

    def test_analysis_counts_one_campaign_but_keeps_cash_exit_records(self):
        self._trade(
            "P1-A",
            "P1",
            0.4,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:10:00+00:00",
            100.0,
            102.0,
            0.8,
        )
        self._trade(
            "P1-B",
            "P1",
            0.6,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:30:00+00:00",
            100.0,
            104.0,
            2.4,
        )
        self._trade(
            "P2",
            "P2",
            0.5,
            "2026-08-01T00:20:00+00:00",
            "2026-08-01T00:40:00+00:00",
            101.0,
            105.0,
            2.0,
        )
        campaign = storage.get_campaign(storage.list_campaigns()["campaigns"][0]["id"])
        for position in campaign["positions"]:
            stop = 98.0 if position["position_id"] == "P1" else 99.0
            storage.update_position_initial_stop(position["id"], stop)

        analysis = storage.get_analysis("2026-08-01", "2026-08-01")

        self.assertEqual(analysis["metrics"]["order_count"], 3)
        self.assertEqual(analysis["r_metrics"]["sample_count"], 1)
        self.assertEqual(analysis["r_metrics"]["complete_count"], 1)
        self.assertEqual(analysis["system_evaluation"][0]["order_count"], 1)
        self.assertEqual(analysis["system_evaluation"][0]["r_metrics"]["sample_count"], 1)
        self.assertEqual(
            sum(row["order_count"] for row in analysis["mode_evaluation"]["trade_type"]),
            1,
        )

    def test_soft_delete_and_restore_rebuild_campaign_membership(self):
        self._trade(
            "P1",
            "P1",
            1.0,
            "2026-08-01T00:00:00+00:00",
            "2026-08-01T00:10:00+00:00",
            100.0,
            104.0,
            4.0,
        )
        campaign_id = storage.list_campaigns()["campaigns"][0]["id"]

        storage.delete_trade("P1")
        self.assertEqual(storage.list_campaigns()["total"], 0)

        storage.restore_trade("P1")
        restored = storage.list_campaigns()
        self.assertEqual(restored["total"], 1)
        self.assertEqual(restored["campaigns"][0]["id"], campaign_id)

    def test_demo_seed_builds_campaigns_for_first_launch(self):
        storage.seed_demo_data()

        self.assertEqual(storage.list_campaigns()["total"], len(storage.list_trades()))

    def test_v4_migration_creates_one_local_sqlite_snapshot(self):
        with storage.db() as conn:
            conn.execute(
                "UPDATE schema_meta SET value = '3' WHERE key = 'schema_version'"
            )

        storage.init_db(seed=False)
        first_snapshots = list(storage.BACKUP_DIR.glob("pre-v4-*.sqlite"))
        storage.init_db(seed=False)

        self.assertEqual(len(first_snapshots), 1)
        self.assertEqual(len(list(storage.BACKUP_DIR.glob("pre-v4-*.sqlite"))), 1)


if __name__ == "__main__":
    unittest.main()

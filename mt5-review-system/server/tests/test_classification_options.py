import tempfile
import unittest
from pathlib import Path

from app import storage


class ClassificationOptionsTest(unittest.TestCase):
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
        self._insert_trade()

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def _insert_trade(self, trade_id="T-1", trade_type="follow", strategy="breakout"):
        storage.upsert_trade(
            {
                "id": trade_id,
                "account": "123",
                "order_no": trade_id,
                "position_id": trade_id,
                "order_ticket": trade_id,
                "deal_ticket": trade_id,
                "symbol": "XAUUSDc",
                "side": "long",
                "lots": 0.01,
                "open_time_utc": "2026-08-14T08:20:00+00:00",
                "close_time_utc": "2026-08-14T08:30:00+00:00",
                "entry_price": 4346.1,
                "exit_price": 4348.2,
                "pnl": 12.5,
                "commission": 0.0,
                "swap": 0.0,
                "screenshot_path": "",
                "trade_type": trade_type,
                "strategy": strategy,
            }
        )

    def test_default_options_are_seeded_and_exposed_by_bootstrap(self):
        options = storage.list_classification_options()

        self.assertIn(("trade_type", "follow", "跟随"), [
            (item["dimension"], item["id"], item["label"]) for item in options
        ])
        self.assertIn(("strategy", "breakout", "突破/窄通道"), [
            (item["dimension"], item["id"], item["label"]) for item in options
        ])
        self.assertEqual(storage.get_dashboard()["classification_options"], options)

    def test_rename_keeps_stable_id_and_updates_historical_statistics_label(self):
        updated = storage.update_classification_option("follow", {"label": "趋势跟随"})

        self.assertEqual(updated["id"], "follow")
        self.assertEqual(storage.get_trade("T-1")["trade_type"], "follow")
        row = storage.get_analysis()["mode_evaluation"]["trade_type"][0]
        self.assertEqual(row["key"], "follow")
        self.assertEqual(row["label"], "趋势跟随")
        self.assertEqual(row["order_count"], 1)
        self.assertEqual(row["net_pnl"], 12.5)

    def test_deleting_archives_option_but_preserves_historical_use(self):
        storage.delete_classification_option("follow")

        archived = next(item for item in storage.list_classification_options() if item["id"] == "follow")
        self.assertFalse(archived["active"])
        self.assertNotIn("follow", [
            item["id"] for item in storage.list_classification_options(active_only=True)
        ])
        self.assertEqual(storage.get_trade("T-1")["trade_type"], "follow")
        self.assertEqual(
            storage.get_analysis()["mode_evaluation"]["trade_type"][0]["label"],
            "跟随",
        )

    def test_schema_migration_registers_distinct_legacy_values(self):
        self._insert_trade("T-LEGACY", trade_type="custom_legacy", strategy="legacy_plan")

        storage.init_db(seed=False)

        options = {(item["dimension"], item["id"]): item for item in storage.list_classification_options()}
        self.assertEqual(options[("trade_type", "custom_legacy")]["label"], "custom_legacy")
        self.assertEqual(options[("strategy", "legacy_plan")]["label"], "legacy_plan")

    def test_trade_import_normalizes_old_default_and_registers_unknown_values(self):
        self._insert_trade("T-IMPORT", trade_type="price_action", strategy="unclassified")

        trade = storage.get_trade("T-IMPORT")
        options = {(item["dimension"], item["id"]) for item in storage.list_classification_options()}

        self.assertEqual(trade["strategy"], "strategy_unclassified")
        self.assertIn(("trade_type", "price_action"), options)

    def test_review_update_validates_dimension_and_does_not_change_legacy_remark(self):
        with storage.db() as conn:
            conn.execute("UPDATE trades SET remark = '历史备注' WHERE id = 'T-1'")
        strategy = storage.create_classification_option({"dimension": "strategy", "label": "回踩确认"})

        with self.assertRaises(ValueError):
            storage.update_trade_review(
                "T-1",
                {"review_text": "复盘内容", "trade_type": strategy["id"], "strategy": "breakout"},
            )

        updated = storage.update_trade_review(
            "T-1",
            {"review_text": "复盘内容", "trade_type": "follow", "strategy": strategy["id"]},
        )
        self.assertEqual(updated["review_text"], "复盘内容")
        self.assertEqual(updated["remark"], "历史备注")


if __name__ == "__main__":
    unittest.main()

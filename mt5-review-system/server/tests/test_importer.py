import json
import tempfile
import unittest
from pathlib import Path

from app import storage
from app.importer import import_bridge_dir


class ImporterTest(unittest.TestCase):
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

    def test_imports_bridge_jsonl_and_copies_screenshots(self):
        bridge_dir = self.root / "bridge"
        screenshot_dir = bridge_dir / "screenshots"
        screenshot_dir.mkdir(parents=True)
        (screenshot_dir / "trade-1.png").write_bytes(b"fake-png")
        payload = {
            "type": "trade_close",
            "trade_id": "MT5-1",
            "account": "123456",
            "order_no": "9001",
            "position_id": "7001",
            "order_ticket": "8001",
            "deal_ticket": "8101",
            "symbol": "EURUSD",
            "side": "long",
            "lots": 0.2,
            "open_time_utc": "2026-08-14T01:00:00+00:00",
            "close_time_utc": "2026-08-14T01:45:00+00:00",
            "entry_price": 1.101,
            "exit_price": 1.105,
            "pnl": 80.0,
            "commission": -2.0,
            "swap": 0.0,
            "screenshot_path": "screenshots/trade-1.png",
        }
        (bridge_dir / "events_20260814.jsonl").write_text(
            json.dumps(payload, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        result = import_bridge_dir(bridge_dir)
        copied = storage.SCREENSHOT_DIR / "trade-1.png"
        self.assertTrue(copied.exists())
        second = import_bridge_dir(bridge_dir)

        payload["trade_id"] = "MT5-2"
        payload["deal_ticket"] = "8102"
        with (bridge_dir / "events_20260814.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
        third = import_bridge_dir(bridge_dir)

        self.assertEqual(result["events"], 1)
        self.assertEqual(result["trades"], 1)
        self.assertEqual(result["screenshots_copied"], 1)
        self.assertEqual(second["events"], 0)
        self.assertEqual(second["duplicates"], 0)
        self.assertEqual(second["screenshots_copied"], 0)
        self.assertEqual(third["events"], 1)
        self.assertEqual(third["trades"], 1)
        self.assertEqual(storage.get_trade("MT5-1")["pnl"], 80.0)
        with storage.db() as conn:
            raw_count = conn.execute("SELECT COUNT(*) AS value FROM raw_events").fetchone()["value"]
        self.assertEqual(raw_count, 2)

    def test_same_payload_with_different_json_format_is_duplicate(self):
        bridge_dir = self.root / "bridge-restore"
        screenshot_dir = bridge_dir / "screenshots"
        screenshot_dir.mkdir(parents=True)
        (screenshot_dir / "trade-restore.png").write_bytes(b"fake-png")
        payload = {
            "type": "trade_close",
            "trade_id": "RESTORE-1",
            "account": "123456",
            "order_no": "9003",
            "position_id": "7003",
            "order_ticket": "8003",
            "deal_ticket": "8103",
            "symbol": "XAUUSDc",
            "side": "short",
            "lots": 0.01,
            "open_time_utc": "2026-08-14T08:36:19+00:00",
            "close_time_utc": "2026-08-14T08:37:54+00:00",
            "entry_price": 4345.083,
            "exit_price": 4348.9,
            "pnl": -3.8,
            "commission": 0.0,
            "swap": 0.0,
            "screenshot_path": "screenshots/trade-restore.png",
        }
        (bridge_dir / "events_20260814.jsonl").write_text(
            json.dumps(payload, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

        first = storage.ingest_mt5_event(payload, raw_event=json.dumps(payload, separators=(",", ":")))
        second = storage.ingest_mt5_event(payload, raw_event=json.dumps(payload, indent=2))

        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(storage.get_trade("RESTORE-1")["pnl"], -3.8)

    def test_duplicate_event_retries_copying_screenshot_created_after_http_ingest(self):
        bridge_dir = self.root / "bridge-late-screenshot"
        screenshot_dir = bridge_dir / "screenshots"
        screenshot_dir.mkdir(parents=True)
        screenshot_path = screenshot_dir / "late.png"
        payload = {
            "type": "trade_close",
            "trade_id": "LATE-1",
            "account": "123456",
            "order_no": "9004",
            "position_id": "7004",
            "order_ticket": "8004",
            "deal_ticket": "8104",
            "symbol": "XAUUSDc",
            "side": "long",
            "lots": 0.01,
            "open_time_utc": "2026-08-18T06:00:00+00:00",
            "close_time_utc": "2026-08-18T06:10:00+00:00",
            "entry_price": 4345.0,
            "exit_price": 4346.0,
            "pnl": 10.0,
            "commission": 0.0,
            "swap": 0.0,
            "screenshot_path": "screenshots/late.png",
        }
        event_line = json.dumps(payload, ensure_ascii=False)
        (bridge_dir / "events_20260818.jsonl").write_text(event_line + "\n", encoding="utf-8")

        storage.ingest_mt5_event(payload, raw_event=event_line)
        self.assertFalse((storage.DATA_DIR / payload["screenshot_path"]).exists())

        screenshot_path.write_bytes(b"late-png")
        result = import_bridge_dir(bridge_dir)

        self.assertEqual(result["duplicates"], 1)
        self.assertEqual(result["screenshots_copied"], 1)
        self.assertTrue((storage.DATA_DIR / payload["screenshot_path"]).exists())

    def test_import_repairs_screenshot_that_arrives_after_cursor_advances(self):
        bridge_dir = self.root / "bridge-late-file"
        screenshot_dir = bridge_dir / "screenshots"
        screenshot_dir.mkdir(parents=True)
        payload = {
            "type": "trade_close",
            "trade_id": "LATE-2",
            "account": "123456",
            "order_no": "9005",
            "position_id": "7005",
            "order_ticket": "8005",
            "deal_ticket": "8105",
            "symbol": "XAUUSDc",
            "side": "short",
            "lots": 0.01,
            "open_time_utc": "2026-08-18T06:20:00+00:00",
            "close_time_utc": "2026-08-18T06:30:00+00:00",
            "entry_price": 4346.0,
            "exit_price": 4345.0,
            "pnl": 10.0,
            "commission": 0.0,
            "swap": 0.0,
            "screenshot_path": "screenshots/late-2.png",
        }
        bridge_file = bridge_dir / "events_20260818.jsonl"
        bridge_file.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")

        first = import_bridge_dir(bridge_dir)
        self.assertEqual(first["events"], 1)
        self.assertFalse((storage.DATA_DIR / payload["screenshot_path"]).exists())

        (screenshot_dir / "late-2.png").write_bytes(b"late-png-after-cursor")
        second = import_bridge_dir(bridge_dir)

        self.assertEqual(second["events"], 0)
        self.assertEqual(second["screenshots_copied"], 1)
        self.assertTrue((storage.DATA_DIR / payload["screenshot_path"]).exists())

    def test_ingests_full_deal_lifecycle_and_is_idempotent(self):
        entry = {
            "type": "deal",
            "account": "123456",
            "deal_ticket": "9001",
            "position_id": "7001",
            "order_ticket": "8001",
            "entry_kind": "in",
            "deal_type": "buy",
            "symbol": "XAUUSD",
            "volume": 1.0,
            "price": 100.0,
            "time_utc": "2026-08-14T01:00:00+00:00",
            "time_msc": 1786678800000,
            "profit": 0.0,
        }
        exit_deal = {
            **entry,
            "deal_ticket": "9002",
            "order_ticket": "8002",
            "entry_kind": "out",
            "deal_type": "sell",
            "price": 104.0,
            "time_utc": "2026-08-14T01:30:00+00:00",
            "time_msc": 1786680600000,
            "profit": 4.0,
        }

        first = storage.ingest_mt5_event(entry)
        storage.ingest_mt5_event(exit_deal)
        duplicate = storage.ingest_mt5_event(exit_deal)
        campaign = storage.list_campaigns()["campaigns"][0]

        self.assertEqual(first["deal_ticket"], "9001")
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(campaign["status"], "closed")
        self.assertEqual(campaign["position_count"], 1)
        with storage.db() as conn:
            count = conn.execute("SELECT COUNT(*) AS value FROM deal_events").fetchone()["value"]
        self.assertEqual(count, 2)

    def test_late_entry_completes_position_after_exit_arrives_first(self):
        exit_deal = {
            "type": "deal",
            "account": "123456",
            "deal_ticket": "9102",
            "position_id": "7101",
            "order_ticket": "8102",
            "entry_kind": "out",
            "deal_type": "sell",
            "symbol": "XAUUSD",
            "volume": 1.0,
            "price": 104.0,
            "time_utc": "2026-08-14T01:30:00+00:00",
            "time_msc": 1786680600000,
            "profit": 4.0,
        }
        entry = {
            **exit_deal,
            "deal_ticket": "9101",
            "order_ticket": "8101",
            "entry_kind": "in",
            "deal_type": "buy",
            "price": 100.0,
            "time_utc": "2026-08-14T01:00:00+00:00",
            "time_msc": 1786678800000,
            "profit": 0.0,
        }

        storage.ingest_mt5_event(exit_deal)
        before = storage.get_campaign(storage.list_campaigns()["campaigns"][0]["id"])
        storage.ingest_mt5_event(entry)
        after = storage.get_campaign(storage.list_campaigns()["campaigns"][0]["id"])

        self.assertEqual(before["positions"][0]["reconstruction_status"], "incomplete")
        self.assertEqual(after["positions"][0]["reconstruction_status"], "complete")


if __name__ == "__main__":
    unittest.main()

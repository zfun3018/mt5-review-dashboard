import base64
import json
import tempfile
import unittest
from pathlib import Path

from app import storage


class ScreenshotManagementTest(unittest.TestCase):
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
        self.old_path = "screenshots/T-1-old.png"
        old_file = storage.DATA_DIR / self.old_path
        old_file.parent.mkdir(parents=True, exist_ok=True)
        old_file.write_bytes(b"old-image")
        storage.upsert_trade(
            {
                "id": "T-1",
                "account": "123",
                "order_no": "T-1",
                "position_id": "T-1",
                "order_ticket": "T-1",
                "deal_ticket": "T-1",
                "symbol": "XAUUSDc",
                "side": "long",
                "lots": 0.01,
                "open_time_utc": "2026-08-14T08:20:00+00:00",
                "close_time_utc": "2026-08-14T08:30:00+00:00",
                "entry_price": 4346.1,
                "exit_price": 4348.2,
                "pnl": 2.1,
                "screenshot_path": self.old_path,
                "raw_json": json.dumps({"screenshot_path": self.old_path}),
            }
        )

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def test_replace_screenshot_keeps_only_new_file_and_updates_path_references(self):
        encoded = base64.b64encode(b"new-image").decode("ascii")

        trade = storage.replace_trade_screenshot(
            "T-1",
            {"image_data": f"data:image/jpeg;base64,{encoded}", "filename": "review.jpg"},
        )

        new_path = trade["screenshot_path"]
        self.assertTrue(new_path.startswith("screenshots/manual-"))
        self.assertTrue(new_path.endswith(".jpg"))
        self.assertEqual((storage.DATA_DIR / new_path).read_bytes(), b"new-image")
        self.assertFalse((storage.DATA_DIR / self.old_path).exists())
        self.assertEqual(trade["screenshot_url"], f"/media/{new_path}")
        with storage.db() as conn:
            row = conn.execute("SELECT screenshot_path, raw_json FROM trades WHERE id = 'T-1'").fetchone()
        self.assertEqual(row["screenshot_path"], new_path)
        self.assertEqual(json.loads(row["raw_json"])["screenshot_path"], new_path)

    def test_delete_screenshot_clears_path_and_removes_file(self):
        storage.delete_trade_screenshot("T-1")

        trade = storage.get_trade("T-1")
        self.assertEqual(trade["screenshot_path"], "")
        self.assertEqual(trade["screenshot_url"], "")
        self.assertFalse((storage.DATA_DIR / self.old_path).exists())

    def test_shared_screenshot_is_not_removed_from_another_trade(self):
        storage.upsert_trade(
            {
                "id": "T-2",
                "account": "123",
                "order_no": "T-2",
                "position_id": "T-2",
                "order_ticket": "T-2",
                "deal_ticket": "T-2",
                "symbol": "XAUUSDc",
                "side": "short",
                "lots": 0.01,
                "open_time_utc": "2026-08-14T08:20:00+00:00",
                "close_time_utc": "2026-08-14T08:30:00+00:00",
                "entry_price": 4346.1,
                "exit_price": 4348.2,
                "pnl": 2.1,
                "screenshot_path": self.old_path,
            }
        )

        storage.delete_trade_screenshot("T-1")

        self.assertTrue((storage.DATA_DIR / self.old_path).exists())
        self.assertEqual(storage.get_trade("T-2")["screenshot_path"], self.old_path)

    def test_invalid_image_payload_does_not_change_existing_screenshot(self):
        with self.assertRaises(ValueError):
            storage.replace_trade_screenshot("T-1", {"image_data": "data:text/plain;base64,Zm9v"})

        self.assertEqual(storage.get_trade("T-1")["screenshot_path"], self.old_path)
        self.assertTrue((storage.DATA_DIR / self.old_path).exists())


if __name__ == "__main__":
    unittest.main()

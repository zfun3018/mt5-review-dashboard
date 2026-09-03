import json
import tempfile
import unittest
from pathlib import Path

from app import storage
from app.bridge_sync import auto_import_from_config


class BridgeSyncTest(unittest.TestCase):
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
            "CONFIG_FILE": storage.CONFIG_FILE,
        }
        storage.PROJECT_ROOT = self.root
        storage.DATA_DIR = self.root / "data"
        storage.SCREENSHOT_DIR = storage.DATA_DIR / "screenshots"
        storage.RAW_EVENTS_DIR = storage.DATA_DIR / "raw-events"
        storage.BACKUP_DIR = self.root / "backups"
        storage.DB_PATH = storage.DATA_DIR / "journal.sqlite"
        storage.CONFIG_FILE = self.root / "config.local.json"
        storage.init_db(seed=False)

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def test_auto_imports_configured_bridge_directory(self):
        bridge_dir = self.root / "bridge"
        bridge_dir.mkdir()
        payload = {
            "type": "trade_close",
            "trade_id": "AUTO-1",
            "account": "123456",
            "order_no": "9002",
            "position_id": "7002",
            "order_ticket": "8002",
            "deal_ticket": "8102",
            "symbol": "XAUUSDc",
            "side": "short",
            "lots": 0.01,
            "open_time_utc": "2026-08-14T08:20:18+00:00",
            "close_time_utc": "2026-08-14T08:20:56+00:00",
            "entry_price": 4346.144,
            "exit_price": 4345.259,
            "pnl": 0.8,
            "commission": 0.0,
            "swap": 0.0,
            "screenshot_path": "",
        }
        (bridge_dir / "events_20260814.jsonl").write_text(
            json.dumps(payload, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        (self.root / "config.local.json").write_text(
            json.dumps({"mql5_files_bridge_dir": str(bridge_dir)}),
            encoding="utf-8",
        )

        result = auto_import_from_config()

        self.assertEqual(result["trades"], 1)
        self.assertEqual(storage.get_trade("AUTO-1")["symbol"], "XAUUSDc")


if __name__ == "__main__":
    unittest.main()

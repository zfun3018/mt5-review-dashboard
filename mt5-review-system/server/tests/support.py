import tempfile
import unittest
from pathlib import Path

from app import storage


class TemporaryStorageCase(unittest.TestCase):
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


def insert_trade(storage_module, **overrides):
    trade_id = overrides.get("id", "T-1")
    trade = {
        "id": trade_id,
        "account": "ACC",
        "order_no": trade_id,
        "position_id": trade_id,
        "order_ticket": f"O-{trade_id}",
        "deal_ticket": f"D-{trade_id}",
        "symbol": "XAUUSD",
        "side": "long",
        "lots": 1.0,
        "open_time_utc": "2026-08-01T00:00:00+00:00",
        "close_time_utc": "2026-08-01T00:30:00+00:00",
        "entry_price": 100.0,
        "exit_price": 104.0,
        "pnl": 4.0,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "screenshot_path": "",
        "review_text": "",
        "trade_type": "follow",
        "strategy": "breakout",
    }
    trade.update(overrides)
    storage_module.upsert_trade(trade)
    return trade

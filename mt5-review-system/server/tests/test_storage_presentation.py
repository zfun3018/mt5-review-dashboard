import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from app import storage


class StoragePresentationTest(unittest.TestCase):
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

    def test_summary_includes_week_and_month_profit(self):
        trades = [
            {"account": "123", "close_time_utc": "2026-08-12T03:00:00+00:00", "pnl": 5.0, "review_text": ""},
            {"account": "123", "close_time_utc": "2026-08-02T03:00:00+00:00", "pnl": 7.0, "review_text": ""},
            {"account": "123", "close_time_utc": "2026-07-01T03:00:00+00:00", "pnl": 9.0, "review_text": ""},
        ]
        anchor = datetime(2026, 8, 14, 8, 0, tzinfo=timezone.utc)

        summary = storage.build_summary(trades, [], anchor)

        self.assertEqual(summary["week_net_pnl"], 5.0)
        self.assertEqual(summary["week_order_count"], 1)
        self.assertEqual(summary["month_net_pnl"], 12.0)
        self.assertEqual(summary["month_order_count"], 2)

    def test_trade_display_order_uses_deal_ticket_when_order_number_is_zero(self):
        storage.upsert_trade(
            {
                "id": "P1-D1",
                "account": "123",
                "order_no": "0",
                "position_id": "P1",
                "order_ticket": "0",
                "deal_ticket": "D1",
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
                "screenshot_path": "",
            }
        )

        trade = storage.list_trades()[0]

        self.assertEqual(trade["display_order_no"], "D1")
        self.assertEqual(trade["display_order_kind"], "Deal")

    def test_soft_deleted_trade_stays_hidden_after_event_replay(self):
        payload = {
            "type": "trade_close",
            "trade_id": "DELETE-1",
            "symbol": "XAUUSDc",
            "side": "long",
            "lots": 0.01,
            "open_time_utc": "2026-08-14T08:20:00+00:00",
            "close_time_utc": "2026-08-14T08:30:00+00:00",
            "entry_price": 4346.1,
            "exit_price": 4348.2,
            "pnl": 2.1,
        }
        storage.ingest_mt5_event(payload)
        storage.delete_trade("DELETE-1")

        storage.ingest_mt5_event(payload)

        self.assertIsNone(storage.get_trade("DELETE-1"))
        self.assertIsNotNone(storage.get_trade("DELETE-1", include_deleted=True))
        restored = storage.restore_trade("DELETE-1")
        self.assertEqual(restored["id"], "DELETE-1")

    def test_analysis_filters_by_beijing_date_range(self):
        for trade_id, close_time, pnl, trade_type in [
            ("RANGE-1", "2026-08-17T16:30:00+00:00", 10.0, "follow"),
            ("RANGE-2", "2026-08-18T16:30:00+00:00", -4.0, "reversal"),
        ]:
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
                    "open_time_utc": close_time,
                    "close_time_utc": close_time,
                    "entry_price": 1.0,
                    "exit_price": 1.0,
                    "pnl": pnl,
                    "screenshot_path": "",
                    "trade_type": trade_type,
                    "strategy": "breakout",
                }
            )

        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-19T00:00:00+00:00", "balance": 10000.0, "equity": 10000.0}
        )
        analysis = storage.get_analysis("2026-08-18", "2026-08-18")

        self.assertEqual(analysis["metrics"]["order_count"], 1)
        self.assertEqual(analysis["metrics"]["net_pnl"], 10.0)
        self.assertEqual(analysis["periods"]["today"]["order_count"], 1)
        self.assertEqual(analysis["periods"]["week"]["order_count"], 1)
        self.assertEqual(analysis["periods"]["month"]["order_count"], 1)
        self.assertEqual(analysis["periods"]["today"]["z_score"]["classification"], "insufficient_data")
        self.assertEqual(analysis["system_evaluation"][0]["date"], "2026-08-18")
        self.assertEqual(analysis["mode_evaluation"]["trade_type"][0]["key"], "follow")

    def test_analysis_curve_rebuilds_from_active_trades_after_soft_delete(self):
        base_trade = {
            "account": "123",
            "position_id": "P",
            "order_ticket": "O",
            "symbol": "XAUUSDc",
            "side": "long",
            "lots": 0.01,
            "open_time_utc": "2026-08-18T01:00:00+00:00",
            "entry_price": 1.0,
            "exit_price": 1.0,
            "commission": 0.0,
            "swap": 0.0,
            "fee": 0.0,
            "screenshot_path": "",
        }
        storage.upsert_trade({
            **base_trade,
            "id": "ACTIVE-1",
            "order_no": "ACTIVE-1",
            "deal_ticket": "ACTIVE-1",
            "close_time_utc": "2026-08-18T01:10:00+00:00",
            "pnl": 10.0,
        })
        storage.upsert_trade({
            **base_trade,
            "id": "DELETED-1",
            "order_no": "DELETED-1",
            "deal_ticket": "DELETED-1",
            "close_time_utc": "2026-08-18T01:20:00+00:00",
            "pnl": -2310.6,
        })
        storage.delete_trade("DELETED-1")
        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-18T00:00:00+00:00", "balance": 19532.71, "equity": 19532.71}
        )
        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-18T02:00:00+00:00", "balance": 17222.11, "equity": 17222.11}
        )

        analysis = storage.get_analysis("2026-08-18", "2026-08-18")

        self.assertEqual(analysis["metrics"]["order_count"], 1)
        self.assertEqual(analysis["equity"][-1]["cumulative_return"], 10.0)


if __name__ == "__main__":
    unittest.main()

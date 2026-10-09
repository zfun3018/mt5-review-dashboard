import tempfile
import unittest
from pathlib import Path

from app import storage


class ReviewAlbumTest(unittest.TestCase):
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

        self.single = storage.create_custom_field(
            {
                "name": "错误类型",
                "field_type": "single",
                "options": [
                    {"label": "追单", "color": "#ff5c7a"},
                    {"label": "逆势", "color": "#f97316"},
                ],
            }
        )
        self.multi = storage.create_custom_field(
            {
                "name": "交易标签",
                "field_type": "multi",
                "options": [
                    {"label": "欧盘", "color": "#2bd4ff"},
                    {"label": "突破", "color": "#4ade80"},
                ],
            }
        )
        self.text = storage.create_custom_field({"name": "复盘摘要", "field_type": "text"})

        self._insert_trade(
            "T-1",
            "EURUSD",
            "2026-08-20T16:30:00+00:00",
            "follow",
            "breakout",
            screenshot_path="screenshots/missing.png",
            single=self.single["options"][0]["id"],
            multi=[self.multi["options"][0]["id"]],
        )
        self._insert_trade(
            "T-2",
            "EURUSD",
            "2026-08-20T17:30:00+00:00",
            "reversal",
            "breakout",
            single=self.single["options"][1]["id"],
            multi=[self.multi["options"][1]["id"]],
        )
        self._insert_trade(
            "T-3",
            "XAUUSD",
            "2026-08-19T17:30:00+00:00",
            "follow",
            "range",
            multi=[self.multi["options"][0]["id"], self.multi["options"][1]["id"]],
        )
        self._insert_trade(
            "T-DELETED",
            "EURUSD",
            "2026-08-20T18:30:00+00:00",
            "follow",
            "breakout",
        )
        storage.delete_trade("T-DELETED")

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def _insert_trade(
        self,
        trade_id,
        symbol,
        close_time,
        trade_type,
        strategy,
        screenshot_path="",
        single=None,
        multi=None,
    ):
        storage.upsert_trade(
            {
                "id": trade_id,
                "account": "123",
                "order_no": trade_id,
                "position_id": trade_id,
                "order_ticket": trade_id,
                "deal_ticket": trade_id,
                "symbol": symbol,
                "side": "long",
                "lots": 0.01,
                "open_time_utc": close_time,
                "close_time_utc": close_time,
                "entry_price": 1.0,
                "exit_price": 1.5,
                "pnl": 10.0,
                "screenshot_path": screenshot_path,
                "trade_type": trade_type,
                "strategy": strategy,
            }
        )
        if single is not None:
            storage.update_trade_custom_value(self._last_id(trade_id), self.single["id"], {"value": str(single)})
        if multi is not None:
            storage.update_trade_custom_value(self._last_id(trade_id), self.multi["id"], {"value": multi})

    @staticmethod
    def _last_id(trade_id):
        return trade_id

    def test_groups_by_beijing_close_date_excludes_deleted_and_keeps_missing_screenshot(self):
        result = storage.query_review_album()

        self.assertEqual(result["total"], 3)
        self.assertEqual([day["date"] for day in result["days"]], ["2026-08-21", "2026-08-20"])
        self.assertEqual([trade["id"] for trade in result["days"][0]["trades"]], ["T-2", "T-1"])
        missing = next(trade for day in result["days"] for trade in day["trades"] if trade["id"] == "T-1")
        self.assertTrue(missing["screenshot_missing"])
        self.assertEqual(missing["album_date"], "2026-08-21")

    def test_tag_filter_uses_or_within_dimension_and_and_across_dimensions(self):
        result = storage.query_review_album(
            tags=["trade_type:follow", "trade_type:reversal", "strategy:breakout"]
        )

        self.assertEqual([trade["id"] for trade in result["trades"]], ["T-2", "T-1"])

        option_id = self.single["options"][0]["id"]
        result = storage.query_review_album(tags=[f"trade_type:follow", f"field:{self.single['id']}:{option_id}"])
        self.assertEqual([trade["id"] for trade in result["trades"]], ["T-1"])

    def test_available_tags_exclude_text_fields_and_stopped_classification(self):
        storage.delete_classification_option("follow")

        result = storage.query_review_album()
        tag_keys = {tag["key"] for tag in result["available_filters"]["tags"]}

        self.assertNotIn("trade_type:follow", tag_keys)
        self.assertTrue(any(key.startswith(f"field:{self.single['id']}:") for key in tag_keys))
        self.assertFalse(any(key.startswith(f"field:{self.text['id']}:") for key in tag_keys))
        self.assertFalse(any(
            tag["key"] == "trade_type:follow"
            for trade in result["trades"]
            for tag in trade["album_tags"]
        ))

    def test_archived_trade_is_persisted_and_returned_by_album(self):
        archived = storage.update_trade_archived("T-1", True)

        self.assertEqual(archived["id"], "T-1")
        self.assertEqual(archived["is_archived"], 1)
        self.assertFalse(any(
            item["id"] == "T-1" for item in storage.query_review_album()["trades"]
        ))
        trade = next(
            item
            for item in storage.query_review_album(archived=True)["trades"]
            if item["id"] == "T-1"
        )
        self.assertEqual(trade["is_archived"], 1)

        storage.upsert_trade(
            {
                "id": "T-1",
                "account": "123",
                "order_no": "T-1",
                "position_id": "T-1",
                "order_ticket": "T-1",
                "deal_ticket": "T-1",
                "symbol": "EURUSD",
                "side": "long",
                "lots": 0.01,
                "open_time_utc": "2026-08-20T16:30:00+00:00",
                "close_time_utc": "2026-08-20T16:30:00+00:00",
                "entry_price": 1.0,
                "exit_price": 1.5,
                "pnl": 10.0,
                "screenshot_path": "screenshots/missing.png",
                "trade_type": "follow",
                "strategy": "breakout",
            }
        )
        self.assertEqual(storage.get_trade("T-1")["is_archived"], 1)

        restored = storage.update_trade_archived("T-1", False)
        self.assertEqual(restored["is_archived"], 0)

    def test_archived_update_rejects_missing_trade(self):
        with self.assertRaises(KeyError):
            storage.update_trade_archived("missing", True)

    def test_invalid_date_and_unknown_tag_are_rejected(self):
        with self.assertRaises(ValueError):
            storage.query_review_album(start_date="2026-08-22", end_date="2026-08-20")
        with self.assertRaises(ValueError):
            storage.query_review_album(tags=["side:long"])

    def test_reading_checkin_is_unique_per_trade_and_beijing_date(self):
        first = storage.checkin_review_trade("T-1", checkin_date="2026-10-08")
        repeated = storage.checkin_review_trade("T-1", checkin_date="2026-10-08")
        next_day = storage.checkin_review_trade("T-1", checkin_date="2026-10-09")

        self.assertTrue(first["created"])
        self.assertFalse(repeated["created"])
        self.assertTrue(next_day["created"])
        current_view = storage.query_review_album()
        current_trade = next(item for item in current_view["trades"] if item["id"] == "T-1")
        self.assertTrue(current_trade["reading_checked_in_today"])
        overview = storage.get_review_checkins(days=2, today="2026-10-09")
        self.assertEqual(overview["days"], [
            {"date": "2026-10-08", "count": 1, "goal": 20, "completed": False},
            {"date": "2026-10-09", "count": 1, "goal": 20, "completed": False},
        ])
        self.assertTrue(storage.cancel_review_trade("T-1", checkin_date="2026-10-09")["deleted"])
        self.assertFalse(storage.cancel_review_trade("T-1", checkin_date="2026-10-09")["deleted"])
        self.assertEqual(storage.get_review_checkins(days=1, today="2026-10-09")["today"]["count"], 0)

    def test_album_trade_exposes_cumulative_reading_checkin_count(self):
        storage.checkin_review_trade("T-1", checkin_date="2026-10-07")
        storage.checkin_review_trade("T-1", checkin_date="2026-10-08")

        trade = next(item for item in storage.query_review_album()["trades"] if item["id"] == "T-1")
        self.assertEqual(trade["reading_checkin_count"], 2)

    def test_reading_checkin_rejects_deleted_trade_and_persists_daily_goal(self):
        with self.assertRaises(KeyError):
            storage.checkin_review_trade("T-DELETED", checkin_date="2026-10-08")

        self.assertEqual(storage.set_review_daily_goal(7)["daily_goal"], 7)
        overview = storage.get_review_checkins(days=1, today="2026-10-08")
        self.assertEqual(overview["daily_goal"], 7)
        with self.assertRaises(ValueError):
            storage.set_review_daily_goal(0)
        with self.assertRaises(ValueError):
            storage.set_review_daily_goal(2.5)

    def test_soft_deleted_trade_drops_reading_history_before_restore(self):
        storage.checkin_review_trade("T-1", checkin_date="2026-10-08")
        self.assertEqual(storage.get_review_checkins(days=1, today="2026-10-08")["today"]["count"], 1)

        storage.delete_trade("T-1")
        storage.restore_trade("T-1")

        restored = next(item for item in storage.query_review_album()["trades"] if item["id"] == "T-1")
        self.assertEqual(restored["reading_checkin_count"], 0)
        self.assertEqual(storage.get_review_checkins(days=1, today="2026-10-08")["today"]["count"], 0)


if __name__ == "__main__":
    unittest.main()

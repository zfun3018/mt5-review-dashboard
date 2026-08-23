import tempfile
import unittest
from pathlib import Path

from app import storage


class CustomFieldsTest(unittest.TestCase):
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
        storage.upsert_trade(
            {
                "id": "T-1",
                "account": "123",
                "order_no": "9001",
                "position_id": "7001",
                "order_ticket": "8001",
                "deal_ticket": "8101",
                "symbol": "XAUUSDc",
                "side": "long",
                "lots": 0.01,
                "open_time_utc": "2026-08-14T08:20:00+00:00",
                "close_time_utc": "2026-08-14T08:30:00+00:00",
                "entry_price": 4346.1,
                "exit_price": 4348.2,
                "pnl": 2.1,
                "commission": 0.0,
                "swap": 0.0,
                "screenshot_path": "",
            }
        )

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def test_custom_fields_can_be_created_renamed_listed_and_deleted(self):
        field = storage.create_custom_field({"name": "错误类型"})

        self.assertEqual(field["name"], "错误类型")
        self.assertEqual(storage.list_custom_fields()[0]["name"], "错误类型")

        updated = storage.update_custom_field(field["id"], {"name": "执行问题"})

        self.assertEqual(updated["name"], "执行问题")

        storage.delete_custom_field(field["id"])

        self.assertEqual(storage.list_custom_fields(), [])

    def test_trade_custom_field_values_are_returned_with_trades(self):
        field = storage.create_custom_field({"name": "错误类型"})

        storage.update_trade_custom_value("T-1", field["id"], {"value": "追单"})

        trade = storage.get_trade("T-1")

        self.assertEqual(trade["custom_fields"][str(field["id"])], "追单")

    def test_select_fields_include_clickable_options(self):
        field = storage.create_custom_field(
            {
                "name": "错误类型",
                "field_type": "single",
                "options": [
                    {"label": "追单", "color": "#ff5c7a"},
                    {"label": "逆势", "color": "#f97316"},
                ],
            }
        )

        self.assertEqual(field["field_type"], "single")
        self.assertEqual([option["label"] for option in field["options"]], ["追单", "逆势"])

        updated = storage.update_custom_field(
            field["id"],
            {
                "name": "问题类型",
                "field_type": "multi",
                "options": [
                    {"label": "追单", "color": "#ff5c7a"},
                    {"label": "没等确认", "color": "#2bd4ff"},
                ],
            },
        )

        self.assertEqual(updated["name"], "问题类型")
        self.assertEqual(updated["field_type"], "multi")
        self.assertEqual([option["label"] for option in updated["options"]], ["追单", "没等确认"])

    def test_single_and_multi_values_use_option_ids(self):
        single = storage.create_custom_field(
            {
                "name": "错误类型",
                "field_type": "single",
                "options": [
                    {"label": "追单", "color": "#ff5c7a"},
                    {"label": "逆势", "color": "#f97316"},
                ],
            }
        )
        multi = storage.create_custom_field(
            {
                "name": "交易标签",
                "field_type": "multi",
                "options": [
                    {"label": "欧盘", "color": "#2bd4ff"},
                    {"label": "突破", "color": "#4ade80"},
                ],
            }
        )

        storage.update_trade_custom_value(
            "T-1",
            single["id"],
            {"value": str(single["options"][1]["id"])},
        )
        storage.update_trade_custom_value(
            "T-1",
            multi["id"],
            {"value": [str(multi["options"][0]["id"]), str(multi["options"][1]["id"])]},
        )

        trade = storage.get_trade("T-1")

        self.assertEqual(trade["custom_fields"][str(single["id"])], str(single["options"][1]["id"]))
        self.assertEqual(
            trade["custom_fields"][str(multi["id"])],
            [str(multi["options"][0]["id"]), str(multi["options"][1]["id"])],
        )

    def test_updating_field_name_preserves_existing_type_and_options(self):
        field = storage.create_custom_field(
            {
                "name": "趋势判断",
                "field_type": "single",
                "options": [
                    {"label": "上涨", "color": "#4ade80"},
                    {"label": "下跌", "color": "#ff5c7a"},
                ],
            }
        )

        updated = storage.update_custom_field(field["id"], {"name": "行情判断"})

        self.assertEqual(updated["name"], "行情判断")
        self.assertEqual(updated["field_type"], "single")
        self.assertEqual([option["label"] for option in updated["options"]], ["上涨", "下跌"])
if __name__ == "__main__":
    unittest.main()


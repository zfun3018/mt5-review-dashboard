import sqlite3
import unittest

from app import storage
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from app.presentation.http.router import build_router
from tests.support import TemporaryStorageCase, insert_trade


class OrderSoftDeletePlatformTest(TemporaryStorageCase):
    def test_order_detail_write_rejects_a_trade_from_the_other_platform(self):
        insert_trade(storage, id="MT5-WRITE", platform="mt5", review_text="原始复盘")
        router = build_router(storage, lambda: None)

        response = router.dispatch(
            "PATCH",
            "/api/trades/MT5-WRITE/review",
            {"platform": [DOMESTIC_FUTURES_PLATFORM]},
            {"review_text": "不应写入"},
        )

        self.assertEqual(response.status, 404)
        self.assertEqual(storage.get_trade("MT5-WRITE", platform="mt5")["review_text"], "原始复盘")

    def test_delete_is_platform_scoped_and_keeps_reason(self):
        insert_trade(storage, id="SHARED-ID", platform="mt5")
        insert_trade(storage, id="SHARED-ID-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM)

        storage.delete_trade(
            "SHARED-ID-FUTURES",
            platform=DOMESTIC_FUTURES_PLATFORM,
            reason="导入数据异常",
        )

        self.assertIsNotNone(storage.get_trade("SHARED-ID", platform="mt5"))
        self.assertIsNone(storage.get_trade("SHARED-ID-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM))
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            deleted_at, reason = conn.execute(
                "SELECT deleted_at, deleted_reason FROM trades WHERE id = ?",
                ("SHARED-ID-FUTURES",),
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(deleted_at)
        self.assertEqual(reason, "导入数据异常")

    def test_restore_is_platform_scoped(self):
        insert_trade(storage, id="RESTORE-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM)
        storage.delete_trade("RESTORE-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM, reason="误导入")

        restored = storage.restore_trade("RESTORE-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM)

        self.assertEqual(restored["id"], "RESTORE-FUTURES")
        self.assertIsNotNone(storage.get_trade("RESTORE-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM))

    def test_campaign_list_can_switch_between_active_and_deleted_orders(self):
        insert_trade(storage, id="FILTER-FUTURES", platform=DOMESTIC_FUTURES_PLATFORM)
        storage.delete_trade(
            "FILTER-FUTURES",
            platform=DOMESTIC_FUTURES_PLATFORM,
            reason="重复导入",
        )

        active = storage.list_campaigns(platform=DOMESTIC_FUTURES_PLATFORM)
        deleted = storage.list_campaigns(
            platform=DOMESTIC_FUTURES_PLATFORM,
            deleted="deleted",
        )

        self.assertEqual(active["total"], 0)
        self.assertEqual(deleted["total"], 1)
        self.assertEqual(deleted["campaigns"][0]["source_trade_ids"], ["FILTER-FUTURES"])


if __name__ == "__main__":
    unittest.main()

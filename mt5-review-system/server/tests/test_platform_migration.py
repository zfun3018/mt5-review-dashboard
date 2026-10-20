import sqlite3
import unittest

from app import storage
from app.platforms import DOMESTIC_FUTURES_PLATFORM
from tests.support import TemporaryStorageCase


class PlatformMigrationTest(TemporaryStorageCase):
    def test_legacy_tonghuashun_identity_is_migrated_for_all_platform_tables(self):
        conn = sqlite3.connect(storage.DB_PATH)
        try:
            conn.execute(
                "INSERT INTO trades (id, platform, symbol, side, lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl) "
                "VALUES ('LEGACY-1', 'tonghuashun_futures', 'IF2611', 'long', 1, '2026-10-19T01:00:00Z', '2026-10-19T02:00:00Z', 3600, 4000, 4010, 10)"
            )
            conn.commit()
        finally:
            conn.close()

        storage.init_db(seed=False)

        conn = sqlite3.connect(storage.DB_PATH)
        try:
            platform = conn.execute(
                "SELECT platform FROM trades WHERE id = 'LEGACY-1'"
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(platform, DOMESTIC_FUTURES_PLATFORM)


if __name__ == "__main__":
    unittest.main()

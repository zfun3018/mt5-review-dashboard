import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app.core.config import RuntimePaths, get_runtime_paths, set_runtime_paths
from app.data.compatibility import (
    build_data_fingerprint,
    compare_fingerprints,
    upgrade_with_backup,
)
from app.data.database import connect
from app.data.migrations import MigrationError


FIXTURES_DIR = Path(__file__).parent / "fixtures"


def _raise_failure() -> None:
    raise RuntimeError("injected migration failure")


class DataCompatibilityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.paths = RuntimePaths.from_root(self.root)
        self.paths.data.mkdir(parents=True, exist_ok=True)
        self.paths.backups.mkdir(parents=True, exist_ok=True)
        self.original_paths = get_runtime_paths()
        set_runtime_paths(self.paths)

    def tearDown(self):
        set_runtime_paths(self.original_paths)
        self.tmp.cleanup()

    def _load_fixture(self, name: str) -> None:
        sql = (FIXTURES_DIR / name).read_text(encoding="utf-8")
        conn = sqlite3.connect(self.paths.database)
        try:
            conn.executescript(sql)
            conn.commit()
        finally:
            conn.close()
        # Warm the connection so the journal mode settles into WAL before any
        # byte-level hash comparison, otherwise the app's WAL pragma would
        # mutate the main file header and confuse the failed-upgrade assertion.
        warm = connect(self.paths)
        warm.close()

    def test_v2_upgrade_creates_backup_and_preserves_business_data(self):
        self._load_fixture("schema_v2.sql")
        before = build_data_fingerprint(self.paths)
        self.assertEqual(before.schema_version, 2)
        self.assertEqual(before.active_trades, 1)

        result = upgrade_with_backup(self.paths)

        after = build_data_fingerprint(self.paths)
        self.assertTrue(result.backup_created)
        self.assertIsNotNone(result.backup_path)
        self.assertTrue(result.backup_path.exists())
        self.assertTrue(result.report.compatible, result.report.differences)
        self.assertEqual(after.schema_version, 4)
        self.assertEqual(after.active_trades, before.active_trades)
        self.assertEqual(after.deleted_trades, 0)
        self.assertEqual(after.reviews, before.reviews)
        self.assertEqual(after.screenshot_references, before.screenshot_references)
        self.assertAlmostEqual(after.net_pnl, before.net_pnl, places=2)

    def test_v3_upgrade_preserves_soft_delete_and_custom_values(self):
        self._load_fixture("schema_v3.sql")
        before = build_data_fingerprint(self.paths)
        self.assertEqual(before.schema_version, 3)
        self.assertEqual(before.deleted_trades, 1)
        self.assertEqual(before.custom_values, 1)

        result = upgrade_with_backup(self.paths)

        after = build_data_fingerprint(self.paths)
        self.assertTrue(result.report.compatible, result.report.differences)
        self.assertEqual(after.schema_version, 4)
        self.assertEqual(after.deleted_trades, before.deleted_trades)
        self.assertEqual(after.custom_values, before.custom_values)
        self.assertAlmostEqual(after.net_pnl, before.net_pnl, places=2)

    def test_v4_fingerprint_survives_idempotent_upgrade(self):
        self._load_fixture("schema_v4.sql")
        before = build_data_fingerprint(self.paths)
        first = upgrade_with_backup(self.paths)
        after = build_data_fingerprint(self.paths)
        second = upgrade_with_backup(self.paths)
        self.assertTrue(compare_fingerprints(before, after).compatible)
        self.assertFalse(first.backup_created)
        self.assertFalse(second.backup_created)

    def test_failed_upgrade_leaves_original_database_unchanged(self):
        self._load_fixture("schema_v3.sql")
        before_hash = hashlib.sha256(self.paths.database.read_bytes()).hexdigest()
        with self.assertRaises(MigrationError):
            upgrade_with_backup(self.paths, migration_hook=_raise_failure)
        after_hash = hashlib.sha256(self.paths.database.read_bytes()).hexdigest()
        self.assertEqual(after_hash, before_hash)


if __name__ == "__main__":
    unittest.main()

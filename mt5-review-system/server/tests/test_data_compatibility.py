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
        # SQLite on Windows occasionally holds a brief lock on backup or
        # WAL files after the connection is closed. The retry-ignore flag
        # lets the test pass without masking the real assertion outcome.
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
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

    def test_rollback_drill_recovers_after_injected_failure(self):
        # End-to-end rollback drill (Task 5, plan Step 4). A v3 fixture is
        # fingerprinted, an injected migration failure is survived without
        # touching the database, the upgrade is then run successfully, and
        # the pre-upgrade backup is verified to open cleanly via SQLite's
        # ``PRAGMA integrity_check``.
        self._load_fixture("schema_v3.sql")
        before_hash = hashlib.sha256(self.paths.database.read_bytes()).hexdigest()
        before_fingerprint = build_data_fingerprint(self.paths)
        self.assertEqual(before_fingerprint.schema_version, 3)
        self.assertEqual(before_fingerprint.active_trades, 1)
        self.assertEqual(before_fingerprint.deleted_trades, 1)
        self.assertEqual(before_fingerprint.custom_values, 1)

        # 1) Inject a failure during migration. The original database bytes
        # and the data fingerprint must both be untouched.
        with self.assertRaises(MigrationError):
            upgrade_with_backup(self.paths, migration_hook=_raise_failure)
        failed_hash = hashlib.sha256(self.paths.database.read_bytes()).hexdigest()
        self.assertEqual(failed_hash, before_hash, "Failed upgrade must leave db bytes unchanged")
        failed_fingerprint = build_data_fingerprint(self.paths)
        self.assertEqual(failed_fingerprint, before_fingerprint)

        # 2) Run the upgrade successfully. A backup of the pre-upgrade v3
        # database must exist on disk; the live database must now report
        # schema v4 with the same business counts as the original v3.
        result = upgrade_with_backup(self.paths)
        self.assertTrue(result.backup_created, "Upgrade of v3 should snapshot first")
        self.assertIsNotNone(result.backup_path)
        backup_path = result.backup_path
        self.assertTrue(backup_path.exists())
        self.assertGreater(backup_path.stat().st_size, 0)

        after_fingerprint = build_data_fingerprint(self.paths)
        self.assertEqual(after_fingerprint.schema_version, 4)
        self.assertEqual(after_fingerprint.active_trades, before_fingerprint.active_trades)
        self.assertEqual(after_fingerprint.deleted_trades, before_fingerprint.deleted_trades)
        self.assertEqual(after_fingerprint.custom_values, before_fingerprint.custom_values)
        self.assertEqual(after_fingerprint.reviews, before_fingerprint.reviews)
        self.assertAlmostEqual(after_fingerprint.net_pnl, before_fingerprint.net_pnl, places=2)

        # 3) The backup itself must open cleanly: ``PRAGMA integrity_check``
        # returns ``"ok"`` for a healthy SQLite file. This is the
        # acceptance criterion that lets us actually restore from it.
        with sqlite3.connect(backup_path) as backup_conn:
            integrity = backup_conn.execute("PRAGMA integrity_check").fetchone()
            self.assertEqual(integrity, ("ok",), f"Backup failed integrity check: {integrity}")
            backup_version_row = backup_conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()
            self.assertIsNotNone(backup_version_row)
            self.assertEqual(backup_version_row[0], "3", "Backup must reflect pre-upgrade v3")

            # Counts inside the backup must match the original v3 fingerprint.
            backup_trades = backup_conn.execute(
                "SELECT COUNT(*) FROM trades WHERE deleted_at IS NULL"
            ).fetchone()[0]
            self.assertEqual(backup_trades, before_fingerprint.active_trades)


if __name__ == "__main__":
    unittest.main()

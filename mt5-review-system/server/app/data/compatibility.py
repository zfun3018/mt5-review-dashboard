"""Historical schema compatibility, migration auditing, and rollback safety.

This module provides privacy-safe data fingerprints, compatibility comparison,
and an idempotent upgrade that snapshots the pre-migration database through the
SQLite Backup API before applying schema work inside a single transaction.

Nothing in this module exposes account IDs, order IDs, terminal IDs, absolute
paths, review content, custom value content, or screenshot names.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..core.config import RuntimePaths
from .database import backup_database, connect, transaction
from .migrations import BASE_SCHEMA_SQL, MigrationError, read_schema_version


@dataclass(frozen=True)
class DataFingerprint:
    schema_version: int
    active_trades: int
    deleted_trades: int
    deals: int
    positions: int
    campaigns: int
    reviews: int
    custom_values: int
    screenshot_references: int
    net_pnl: float
    r_complete: int


@dataclass(frozen=True)
class CompatibilityReport:
    compatible: bool
    differences: tuple[str, ...]


@dataclass(frozen=True)
class UpgradeResult:
    backup_created: bool
    backup_path: Path | None
    report: CompatibilityReport


# Business fields that must survive a schema upgrade byte-for-byte in meaning.
# Schema version, derived deal/position/campaign counts, and R completeness are
# allowed to change because the derived model is rebuilt during the migration.
_INVARIANT_FIELDS = (
    "active_trades",
    "deleted_trades",
    "reviews",
    "custom_values",
    "screenshot_references",
)


def _table_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.OperationalError:
        return 0


def _conditional_count(conn: sqlite3.Connection, table: str, where: str) -> int:
    try:
        return int(
            conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]
        )
    except sqlite3.OperationalError:
        return 0


def _sum_column(conn: sqlite3.Connection, table: str, column: str) -> float:
    try:
        value = conn.execute(
            f"SELECT COALESCE(SUM({column}), 0) FROM {table}"
        ).fetchone()[0]
        return float(value or 0.0)
    except sqlite3.OperationalError:
        return 0.0


def _trade_deleted_counts(conn: sqlite3.Connection) -> tuple[int, int]:
    columns = {
        row["name"] for row in conn.execute("PRAGMA table_info(trades)").fetchall()
    }
    if "deleted_at" not in columns:
        return _table_count(conn, "trades"), 0
    active = _conditional_count(conn, "trades", "deleted_at IS NULL")
    deleted = _conditional_count(conn, "trades", "deleted_at IS NOT NULL")
    return active, deleted


def build_data_fingerprint(paths: RuntimePaths) -> DataFingerprint:
    """Summarize a database using counts and aggregates only."""
    if not paths.database.exists() or paths.database.stat().st_size == 0:
        return DataFingerprint(0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0, 0)

    conn = connect(paths)
    try:
        schema_version = read_schema_version(conn)
        active_trades, deleted_trades = _trade_deleted_counts(conn)
        deals = _table_count(conn, "deal_events")
        positions = _table_count(conn, "positions")
        campaigns = _table_count(conn, "trade_campaigns")
        reviews = _conditional_count(
            conn, "trades", "review_text IS NOT NULL AND review_text != ''"
        )
        custom_values = _table_count(conn, "trade_custom_values")
        screenshot_references = _conditional_count(
            conn, "trades", "screenshot_path IS NOT NULL AND screenshot_path != ''"
        )
        net_pnl = _sum_column(conn, "trades", "pnl")
        r_complete = _conditional_count(
            conn, "positions", "initial_stop_price IS NOT NULL"
        )
    finally:
        conn.close()

    return DataFingerprint(
        schema_version=schema_version,
        active_trades=active_trades,
        deleted_trades=deleted_trades,
        deals=deals,
        positions=positions,
        campaigns=campaigns,
        reviews=reviews,
        custom_values=custom_values,
        screenshot_references=screenshot_references,
        net_pnl=round(net_pnl, 2),
        r_complete=r_complete,
    )


def compare_fingerprints(
    before: DataFingerprint, after: DataFingerprint
) -> CompatibilityReport:
    """Compare business-invariant fields between two fingerprints."""
    differences: list[str] = []
    for field in _INVARIANT_FIELDS:
        before_value = getattr(before, field)
        after_value = getattr(after, field)
        if before_value != after_value:
            differences.append(f"{field}: {before_value} -> {after_value}")
    if round(before.net_pnl, 2) != round(after.net_pnl, 2):
        differences.append(
            f"net_pnl: {round(before.net_pnl, 2)} -> {round(after.net_pnl, 2)}"
        )
    return CompatibilityReport(
        compatible=not differences, differences=tuple(differences)
    )


def _backup_snapshot(paths: RuntimePaths) -> Path:
    created_at = datetime.now(timezone.utc)
    snapshot = paths.backups / (
        f"pre-v4-{created_at.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.sqlite"
    )
    paths.backups.mkdir(parents=True, exist_ok=True)
    backup_database(paths.database, snapshot)
    return snapshot


def upgrade_with_backup(
    paths: RuntimePaths,
    migration_hook: Callable[[], None] | None = None,
) -> UpgradeResult:
    """Upgrade the database in place, snapshotting it first when pre-v4.

    The pre-migration database is copied through the SQLite Backup API into the
    configured backup directory. All schema work runs inside one transaction and
    is followed by ``PRAGMA integrity_check``. If any step raises, the
    transaction is rolled back and the original database bytes are unchanged.
    """
    from .bootstrap import _ensure_schema as bootstrap_ensure_schema

    before = build_data_fingerprint(paths)

    backup_path: Path | None = None
    backup_created = False
    backup_record: tuple[str, str, int] | None = None
    if (
        before.schema_version < 4
        and paths.database.exists()
        and paths.database.stat().st_size > 0
    ):
        backup_path = _backup_snapshot(paths)
        backup_created = True
        backup_record = (
            str(backup_path),
            datetime.now(timezone.utc).isoformat(),
            backup_path.stat().st_size,
        )

    paths.data.mkdir(parents=True, exist_ok=True)
    paths.screenshots.mkdir(parents=True, exist_ok=True)
    paths.raw_events.mkdir(parents=True, exist_ok=True)
    paths.backups.mkdir(parents=True, exist_ok=True)

    try:
        with transaction(paths) as conn:
            conn.executescript(BASE_SCHEMA_SQL)
            previous_version = read_schema_version(conn)
            bootstrap_ensure_schema(conn, previous_version)
            if migration_hook is not None:
                migration_hook()
            conn.execute(
                "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4') "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            )
            if backup_record is not None:
                conn.execute(
                    "INSERT INTO backups (file_path, created_at, size_bytes) "
                    "VALUES (?, ?, ?)",
                    backup_record,
                )
            integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise MigrationError(f"integrity check failed: {integrity}")
    except MigrationError:
        raise
    except Exception as exc:
        raise MigrationError(f"upgrade failed: {exc}") from exc

    after = build_data_fingerprint(paths)
    report = compare_fingerprints(before, after)
    return UpgradeResult(
        backup_created=backup_created,
        backup_path=backup_path,
        report=report,
    )

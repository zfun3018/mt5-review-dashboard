from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from ..core.config import RuntimePaths, set_runtime_paths
from .database import backup_database, connect, transaction


class MigrationError(Exception):
    """Raised when a schema migration cannot be completed safely."""


BASE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#4fd1c5',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    account TEXT,
    order_no TEXT,
    position_id TEXT,
    order_ticket TEXT,
    deal_ticket TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    lots REAL NOT NULL,
    open_time_utc TEXT NOT NULL,
    close_time_utc TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    pnl REAL NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    screenshot_path TEXT,
    review_text TEXT NOT NULL DEFAULT '',
    trend_id INTEGER REFERENCES trends(id) ON DELETE SET NULL,
    remark TEXT NOT NULL DEFAULT '',
    trade_type TEXT NOT NULL DEFAULT 'unclassified',
    strategy TEXT NOT NULL DEFAULT 'strategy_unclassified',
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    field_type TEXT NOT NULL DEFAULT 'text',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classification_options (
    id TEXT PRIMARY KEY,
    dimension TEXT NOT NULL CHECK (dimension IN ('trade_type', 'strategy')),
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2bd4ff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (dimension, label)
);

CREATE TABLE IF NOT EXISTS custom_field_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2bd4ff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trade_custom_values (
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (trade_id, field_id)
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_utc TEXT NOT NULL UNIQUE,
    balance REAL NOT NULL,
    equity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    event_hash TEXT UNIQUE,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_cursors (
    file_path TEXT PRIMARY KEY,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    modified_ns INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    size_bytes INTEGER NOT NULL
);
"""


def read_schema_version(conn: sqlite3.Connection) -> int:
    table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'"
    ).fetchone()
    if not table:
        return 0
    row = conn.execute("SELECT value FROM schema_meta WHERE key = 'schema_version'").fetchone()
    return int(row[0]) if row else 0


def _backup_before_v4(paths: RuntimePaths) -> dict[str, Any] | None:
    if not paths.database.exists() or paths.database.stat().st_size == 0:
        return None
    source = connect(paths)
    try:
        version = read_schema_version(source)
    finally:
        source.close()
    if version >= 4:
        return None
    created_at = datetime.now(timezone.utc)
    snapshot = paths.backups / (
        f"pre-v4-{created_at.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.sqlite"
    )
    backup_database(paths.database, snapshot)
    return {
        "file_path": str(snapshot),
        "created_at": created_at.isoformat(),
        "size_bytes": snapshot.stat().st_size,
    }


def _backup_before_album_archive(paths: RuntimePaths) -> dict[str, Any] | None:
    if not paths.database.exists() or paths.database.stat().st_size == 0:
        return None
    source = connect(paths)
    try:
        table = source.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'trades'"
        ).fetchone()
        if not table:
            return None
        columns = {
            row["name"] for row in source.execute("PRAGMA table_info(trades)").fetchall()
        }
    finally:
        source.close()
    if "is_archived" in columns:
        return None
    created_at = datetime.now(timezone.utc)
    snapshot = paths.backups / (
        f"pre-album-archive-{created_at.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.sqlite"
    )
    backup_database(paths.database, snapshot)
    return {
        "file_path": str(snapshot),
        "created_at": created_at.isoformat(),
        "size_bytes": snapshot.stat().st_size,
    }


def ensure_schema(
    paths: RuntimePaths,
    seed: bool | Callable[[], None] = True,
    migrate: Callable[[sqlite3.Connection, int], None] | None = None,
) -> None:
    paths.data.mkdir(parents=True, exist_ok=True)
    paths.screenshots.mkdir(parents=True, exist_ok=True)
    paths.raw_events.mkdir(parents=True, exist_ok=True)
    paths.backups.mkdir(parents=True, exist_ok=True)
    migration_backup = _backup_before_v4(paths) or _backup_before_album_archive(paths)

    if migrate is None:
        from .bootstrap import _ensure_schema

        migrate = _ensure_schema

    with transaction(paths) as conn:
        conn.executescript(BASE_SCHEMA_SQL)
        previous_version = read_schema_version(conn)
        migrate(conn, previous_version)
        conn.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4') "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        )
        if migration_backup:
            conn.execute(
                "INSERT INTO backups (file_path, created_at, size_bytes) VALUES (?, ?, ?)",
                (
                    migration_backup["file_path"],
                    migration_backup["created_at"],
                    migration_backup["size_bytes"],
                ),
            )

    if callable(seed):
        seed()
    elif seed:
        from .bootstrap import seed_demo_data

        set_runtime_paths(paths)
        seed_demo_data()

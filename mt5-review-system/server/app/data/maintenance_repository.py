from __future__ import annotations

import sqlite3

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _read_local_status() -> dict[str, Any]:
    with db() as conn:
        counts = {
            "trades": conn.execute("SELECT COUNT(*) AS value FROM trades").fetchone()["value"],
            "raw_events": conn.execute("SELECT COUNT(*) AS value FROM raw_events").fetchone()["value"],
            "equity_snapshots": conn.execute("SELECT COUNT(*) AS value FROM equity_snapshots").fetchone()[
                "value"
            ],
        }
        latest_trade = conn.execute(
            "SELECT id, symbol, close_time_utc, pnl FROM trades ORDER BY close_time_utc DESC LIMIT 1"
        ).fetchone()
        latest_backup = conn.execute(
            "SELECT file_path, created_at, size_bytes FROM backups ORDER BY created_at DESC LIMIT 1"
        ).fetchone()

    screenshot_count = len([path for path in get_runtime_paths().screenshots.glob("*") if path.is_file()])
    latest_raw_file = max(get_runtime_paths().raw_events.glob("*.jsonl"), key=lambda path: path.stat().st_mtime, default=None)
    return {
        "database_path": str(get_runtime_paths().database),
        "data_dir": str(get_runtime_paths().data),
        "database_size_bytes": get_runtime_paths().database.stat().st_size if get_runtime_paths().database.exists() else 0,
        "data_size_bytes": _dir_size(get_runtime_paths().data),
        "screenshot_count": screenshot_count,
        "counts": counts,
        "latest_trade": dict(latest_trade) if latest_trade else None,
        "latest_backup": dict(latest_backup) if latest_backup else None,
        "latest_raw_event_file": str(latest_raw_file) if latest_raw_file else "",
        "bridge_endpoint": "http://127.0.0.1:8787/api/mt5/events",
    }


def _read_backups() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, file_path, created_at, size_bytes FROM backups ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
    return [dict(row) for row in rows]


def create_backup() -> dict[str, Any]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = get_runtime_paths().backups / f"mt5-review-backup-{timestamp}.zip"

    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        if get_runtime_paths().database.exists():
            archive.write(get_runtime_paths().database, "data/journal.sqlite")
        for folder in (get_runtime_paths().screenshots, get_runtime_paths().raw_events):
            for file_path in folder.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(get_runtime_paths().root))

    size = backup_path.stat().st_size
    created_at = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO backups (file_path, created_at, size_bytes) VALUES (?, ?, ?)",
            (str(backup_path), created_at, size),
        )
        backup_id = cursor.lastrowid
    return {
        "id": backup_id,
        "file_path": str(backup_path),
        "created_at": created_at,
        "size_bytes": size,
    }


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())

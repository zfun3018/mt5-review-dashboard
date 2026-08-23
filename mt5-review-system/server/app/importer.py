from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from . import storage


def import_bridge_dir(bridge_dir: str | Path) -> dict[str, Any]:
    bridge = Path(bridge_dir).expanduser().resolve()
    if not bridge.exists() or not bridge.is_dir():
        raise FileNotFoundError(f"Bridge directory not found: {bridge}")

    stats = {
        "bridge_dir": str(bridge),
        "files": 0,
        "events": 0,
        "trades": 0,
        "snapshots": 0,
        "screenshots_copied": 0,
        "duplicates": 0,
        "bytes_read": 0,
        "cursor_resets": 0,
        "errors": [],
    }

    for file_path in _jsonl_files(bridge):
        stats["files"] += 1
        resolved_path = str(file_path.resolve())
        file_stat = file_path.stat()
        cursor = storage.get_ingest_cursor(resolved_path)
        offset = int(cursor["byte_offset"]) if cursor else 0
        if cursor and (
            file_stat.st_size < offset
            or (
                file_stat.st_size == int(cursor["file_size"])
                and file_stat.st_mtime_ns != int(cursor["modified_ns"])
            )
        ):
            offset = 0
            stats["cursor_resets"] += 1

        final_offset = offset
        with file_path.open("rb") as handle:
            handle.seek(offset)
            line_number = 0
            while True:
                line_start = handle.tell()
                line = handle.readline()
                if not line:
                    break
                if not line.endswith(b"\n"):
                    handle.seek(line_start)
                    break
                final_offset = handle.tell()
                stats["bytes_read"] += len(line)
                line_number += 1
                raw = line.decode("utf-8-sig" if line_start == 0 else "utf-8").strip()
                if not raw:
                    continue
                try:
                    payload = json.loads(raw)
                    stats["events"] += 1
                    result = storage.ingest_mt5_event(
                        payload,
                        raw_event=raw,
                    )
                    if result.get("duplicate"):
                        stats["duplicates"] += 1
                        if _copy_screenshot(payload, bridge):
                            stats["screenshots_copied"] += 1
                        if result.get("restored") and result.get("trade_id"):
                            stats["trades"] += 1
                        continue
                    if _copy_screenshot(payload, bridge):
                        stats["screenshots_copied"] += 1
                    if result.get("trade_id"):
                        stats["trades"] += 1
                    if result.get("snapshot"):
                        stats["snapshots"] += 1
                except Exception as exc:
                    stats["errors"].append(
                        {
                            "file": str(file_path),
                            "line": line_number,
                            "error": str(exc),
                        }
                    )
        final_stat = file_path.stat()
        storage.update_ingest_cursor(
            resolved_path,
            final_offset,
            final_stat.st_size,
            final_stat.st_mtime_ns,
        )

    # A trade event can arrive before MT5 finishes writing its screenshot file.
    # Repair those paths even after the JSONL cursor has advanced past the event.
    for trade in storage.list_trades(include_deleted=True):
        screenshot = str(trade.get("screenshot_path") or "").strip()
        if screenshot and trade.get("screenshot_missing") and _copy_screenshot({"screenshot_path": screenshot}, bridge):
            stats["screenshots_copied"] += 1

    return stats


def _jsonl_files(bridge: Path) -> list[Path]:
    files = set(bridge.glob("events_*.jsonl"))
    files.update(bridge.glob("*.jsonl"))
    return sorted(path for path in files if path.is_file())


def _copy_screenshot(payload: dict[str, Any], bridge: Path) -> bool:
    screenshot = str(payload.get("screenshot_path") or "").replace("\\", "/").strip()
    if not screenshot:
        return False

    relative = Path(screenshot)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"Unsafe screenshot path: {screenshot}")

    source = (bridge / relative).resolve()
    if not _inside(source, bridge) or not source.exists() or not source.is_file():
        return False

    destination = (storage.DATA_DIR / relative).resolve()
    if not _inside(destination, storage.DATA_DIR):
        raise ValueError(f"Unsafe destination path: {screenshot}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size == source.stat().st_size:
        return False
    shutil.copy2(source, destination)
    return True


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent.resolve())
        return True
    except ValueError:
        return False

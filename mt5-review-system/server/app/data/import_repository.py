from __future__ import annotations

import re
import json
import uuid
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any, Iterable

from ..core.config import get_runtime_paths
from ..platforms import normalize_platform
from .database import connect, transaction


_COUNT_FIELDS = (
    "source_row_count",
    "new_row_count",
    "duplicate_count",
    "invalid_count",
    "unpaired_count",
    "order_count",
)


def create_import_batch(
    platform: str,
    filename: str,
    source_kind: str,
    source_format: str,
) -> dict[str, Any]:
    batch_id = f"IMP-{uuid.uuid4().hex[:24]}"
    started_at = datetime.now(timezone.utc).isoformat()
    safe_filename = _basename(filename)
    normalized = normalize_platform(platform)
    with transaction(get_runtime_paths()) as conn:
        conn.execute(
            """
            INSERT INTO import_batches (
                id, platform, source_kind, source_format, filename, status, started_at
            ) VALUES (?, ?, ?, ?, ?, 'preview', ?)
            """,
            (batch_id, normalized, str(source_kind or "unknown"), str(source_format or "unknown"), safe_filename, started_at),
        )
    return _batch_by_id(batch_id)


def record_import_batch_days(batch_id: str, days: Iterable[dict[str, Any]]) -> None:
    with transaction(get_runtime_paths()) as conn:
        batch = conn.execute(
            "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if batch is None:
            raise ValueError("导入批次不存在")
        for item in days:
            trade_date = str(item.get("trade_date") or "").strip()
            if not trade_date:
                continue
            values = [int(item.get(field) or 0) for field in _COUNT_FIELDS]
            conn.execute(
                """
                INSERT INTO import_batch_days (
                    batch_id, platform, trade_date,
                    source_row_count, new_row_count, duplicate_count,
                    invalid_count, unpaired_count, order_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(batch_id, trade_date) DO UPDATE SET
                    source_row_count = excluded.source_row_count,
                    new_row_count = excluded.new_row_count,
                    duplicate_count = excluded.duplicate_count,
                    invalid_count = excluded.invalid_count,
                    unpaired_count = excluded.unpaired_count,
                    order_count = excluded.order_count
                """,
                (str(batch_id), batch["platform"], trade_date, *values),
            )


def record_import_batch_issues(batch_id: str, issues: Iterable[dict[str, Any]]) -> None:
    with transaction(get_runtime_paths()) as conn:
        batch = conn.execute(
            "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if batch is None:
            raise ValueError("导入批次不存在")
        for issue in issues:
            details = _safe_details(issue.get("details") or issue)
            conn.execute(
                """
                INSERT INTO import_batch_issues (
                    batch_id, platform, row_number, trade_date, code, message, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(batch_id),
                    batch["platform"],
                    _optional_int(issue.get("row_number")),
                    str(issue.get("trade_date") or details.get("trade_date") or "") or None,
                    str(issue.get("code") or "invalid"),
                    str(issue.get("message") or issue.get("error") or "导入数据异常"),
                    json.dumps(details, ensure_ascii=False),
                ),
            )


def finalize_import_batch(
    batch_id: str,
    counts: dict[str, Any],
    status: str,
) -> dict[str, Any]:
    if status not in {"preview", "committed", "failed"}:
        raise ValueError("导入批次状态无效")
    completed_at = datetime.now(timezone.utc).isoformat()
    assignments = {
        field: int(counts.get(field) or 0)
        for field in _COUNT_FIELDS
    }
    assignments["trade_date_start"] = counts.get("trade_date_start")
    assignments["trade_date_end"] = counts.get("trade_date_end")
    with transaction(get_runtime_paths()) as conn:
        result = conn.execute(
            """
            UPDATE import_batches SET
                status = ?, completed_at = ?,
                trade_date_start = ?, trade_date_end = ?,
                source_row_count = ?, new_row_count = ?, duplicate_count = ?,
                invalid_count = ?, unpaired_count = ?, order_count = ?
            WHERE id = ?
            """,
            (
                status,
                completed_at,
                assignments["trade_date_start"],
                assignments["trade_date_end"],
                *(assignments[field] for field in _COUNT_FIELDS),
                str(batch_id),
            ),
        )
        if result.rowcount != 1:
            raise ValueError("导入批次不存在")
    return _batch_by_id(batch_id)


def list_import_batches(
    platform: str,
    year: int | None = None,
    month: int | None = None,
) -> list[dict[str, Any]]:
    normalized = normalize_platform(platform)
    clauses = ["platform = ?"]
    params: list[Any] = [normalized]
    if year is not None and month is not None:
        prefix = f"{int(year):04d}-{int(month):02d}%"
        clauses.append("started_at LIKE ?")
        params.append(prefix)
    conn = connect(get_runtime_paths())
    try:
        rows = conn.execute(
            f"SELECT * FROM import_batches WHERE {' AND '.join(clauses)} ORDER BY started_at DESC, id DESC",
            params,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_import_batch(batch_id: str, platform: str) -> dict[str, Any] | None:
    normalized = normalize_platform(platform)
    conn = connect(get_runtime_paths())
    try:
        row = conn.execute(
            "SELECT * FROM import_batches WHERE id = ? AND platform = ?",
            (str(batch_id), normalized),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["issues"] = _issues_for_batch(conn, str(batch_id))
        return result
    finally:
        conn.close()


def get_import_calendar(platform: str, year: int, month: int) -> dict[str, dict[str, int | str]]:
    normalized = normalize_platform(platform)
    prefix = f"{int(year):04d}-{int(month):02d}%"
    conn = connect(get_runtime_paths())
    try:
        rows = conn.execute(
            """
            SELECT trade_date,
                   SUM(source_row_count) AS source_row_count,
                   SUM(new_row_count) AS new_row_count,
                   SUM(duplicate_count) AS duplicate_count,
                   SUM(invalid_count) AS invalid_count,
                   SUM(unpaired_count) AS unpaired_count,
                   SUM(order_count) AS order_count
            FROM import_batch_days
            WHERE platform = ? AND trade_date LIKE ?
            GROUP BY trade_date
            ORDER BY trade_date
            """,
            (normalized, prefix),
        ).fetchall()
        return {
            str(row["trade_date"]): {
                field: int(row[field] or 0)
                for field in _COUNT_FIELDS
            }
            for row in rows
        }
    finally:
        conn.close()


def _batch_by_id(batch_id: str) -> dict[str, Any]:
    conn = connect(get_runtime_paths())
    try:
        row = conn.execute(
            "SELECT * FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if row is None:
            raise ValueError("导入批次不存在")
        result = dict(row)
        result["issues"] = _issues_for_batch(conn, str(batch_id))
        return result
    finally:
        conn.close()


def _basename(filename: str) -> str:
    text = str(filename or "").strip()
    if not text:
        return "未命名文件"
    return re.split(r"[\\/]", text)[-1] or PurePath(text).name


def _issues_for_batch(conn, batch_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, row_number, trade_date, code, message, details_json FROM import_batch_issues WHERE batch_id = ? ORDER BY row_number, id",
        (batch_id,),
    ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        try:
            details = json.loads(item.pop("details_json") or "{}")
        except json.JSONDecodeError:
            details = {}
        item.update(details)
        result.append(item)
    return result


def _safe_details(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    for key in ("source_filename", "filename", "file_path", "path"):
        if key in result:
            result[key] = _basename(str(result[key]))
    return result


def _optional_int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None

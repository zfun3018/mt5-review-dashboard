from __future__ import annotations

from pathlib import PurePath
from typing import Any

from .data.campaign_repository import CampaignRepository
from .data.database import transaction
from .data.import_repository import (
    create_import_batch,
    finalize_import_batch,
    record_import_batch_issues,
    record_import_batch_days,
)
from .data.tonghuashun_csv import parse_tonghuashun_csv
from .data.tonghuashun_xls import parse_tonghuashun_xls
from .data.trade_commands import _upsert_trade_conn
from .core.config import get_runtime_paths
from .platforms import TONGHUASHUN_PLATFORM, normalize_platform


def import_tonghuashun_csv(csv_text: str, filename: str = "") -> dict[str, Any]:
    normalized = TONGHUASHUN_PLATFORM
    batch = create_import_batch(normalized, filename, "tonghuashun", "csv")
    try:
        parsed = parse_tonghuashun_csv(csv_text, filename)
        return _persist_import(parsed, batch["id"])
    except Exception:
        finalize_import_batch(batch["id"], {"invalid_count": 1}, "failed")
        raise


def import_platform_file(platform: str, file_bytes: bytes, filename: str = "") -> dict[str, Any]:
    normalized = normalize_platform(platform)
    if normalized != TONGHUASHUN_PLATFORM:
        raise ValueError("文件导入目前只支持国内期货平台")
    if not file_bytes:
        raise ValueError("导入文件不能为空")
    if len(file_bytes) > 16 * 1024 * 1024:
        raise ValueError("导入文件不能超过 16 MB")

    extension = PurePath(str(filename or "")).suffix.lower()
    source_format = "xls" if extension == ".xls" or file_bytes.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") else "csv"
    if extension not in {"", ".csv", ".xls"}:
        raise ValueError("只支持 CSV 或 XLS 文件")
    batch = create_import_batch(normalized, filename, "tonghuashun", source_format)
    try:
        if source_format == "xls":
            parsed = parse_tonghuashun_xls(file_bytes, filename)
        else:
            parsed = parse_tonghuashun_csv(_decode_csv_bytes(file_bytes), filename)
        return _persist_import(parsed, batch["id"])
    except Exception:
        finalize_import_batch(batch["id"], {"invalid_count": 1}, "failed")
        raise


def _persist_import(parsed: dict[str, Any], batch_id: str | None = None) -> dict[str, Any]:
    with transaction(get_runtime_paths()) as conn:
        for trade in parsed["trades"]:
            _upsert_trade_conn(conn, trade)
        if parsed["trades"]:
            CampaignRepository(get_runtime_paths()).rebuild(conn=conn)
    day_counts = parsed.get("day_counts") or {}
    issues = parsed.get("issues") or []
    new_row_count = sum(int(item.get("new_row_count") or 0) for item in day_counts.values())
    result = {
        **parsed,
        "platform": TONGHUASHUN_PLATFORM,
        "imported": len(parsed["trades"]),
        "new_row_count": new_row_count,
        "duplicate_count": len(parsed.get("duplicate_rows", [])),
        "skipped": len(parsed["invalid_rows"]) + len(parsed["unpaired_rows"]) + len(parsed.get("duplicate_rows", [])),
    }
    if batch_id:
        counts = {
            "trade_date_start": _trade_date_boundary(parsed, first=True),
            "trade_date_end": _trade_date_boundary(parsed, first=False),
            "source_row_count": int(parsed.get("source_row_count") or 0),
            "new_row_count": new_row_count,
            "duplicate_count": len(parsed.get("duplicate_rows", [])),
            "invalid_count": len(parsed.get("invalid_rows", [])),
            "unpaired_count": len(parsed.get("unpaired_rows", [])),
            "order_count": len(parsed.get("trades", [])),
        }
        record_import_batch_days(
            batch_id,
            [
                {"trade_date": trade_date, **day_counts_for_date}
                for trade_date, day_counts_for_date in day_counts.items()
            ],
        )
        record_import_batch_issues(batch_id, issues)
        result["batch_id"] = finalize_import_batch(batch_id, counts, "committed")["id"]
    return result


def import_platform_csv(platform: str, csv_text: str, filename: str = "") -> dict[str, Any]:
    normalized = normalize_platform(platform)
    if normalized != TONGHUASHUN_PLATFORM:
        raise ValueError("CSV 导入目前只支持国内期货平台")
    return import_tonghuashun_csv(csv_text, filename)


def _trade_date_boundary(parsed: dict[str, Any], *, first: bool) -> str | None:
    values = [str(value) for value in (parsed.get("day_counts") or {}) if value]
    if not values:
        return None
    return sorted(values)[0 if first else -1]


def _batch_day_counts(parsed: dict[str, Any], counts: dict[str, Any]) -> dict[str, Any]:
    trade_date = _trade_date_boundary(parsed, first=True) or ""
    return {"trade_date": trade_date, **counts} if trade_date else counts


def _decode_csv_bytes(file_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("CSV 文件不是有效的 UTF-8 或 GB18030 编码")

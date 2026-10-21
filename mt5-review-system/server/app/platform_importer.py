from __future__ import annotations

from pathlib import PurePath
import hashlib
import json
from typing import Any

from .data.campaign_repository import CampaignRepository
from .data.database import transaction
from .data.import_repository import (
    apply_import_execution_match_conn,
    classify_import_executions_conn,
    create_import_batch,
    finalize_import_batch,
    find_trade_by_order_signature_conn,
    get_import_execution_conn,
    list_unmatched_import_executions,
    mark_order_duplicate_executions_conn,
    record_import_execution_matches_conn,
    record_import_executions_conn,
    record_import_batch_issues,
    record_import_batch_days,
)
from .data.tonghuashun_csv import parse_tonghuashun_csv
from .data.tonghuashun_xls import parse_tonghuashun_xls
from .data.normalized_import import (
    _build_trade,
    _issue_dict,
    build_import_preview,
    match_executions,
    trade_order_signature,
)
from .data.trade_commands import _upsert_trade_conn
from .platform_adapters.contracts import ImportIssue, NormalizedExecution
from .core.config import get_runtime_paths
from .platforms import TONGHUASHUN_PLATFORM, normalize_platform


def import_tonghuashun_csv(csv_text: str, filename: str = "") -> dict[str, Any]:
    normalized = TONGHUASHUN_PLATFORM
    batch = create_import_batch(
        normalized,
        filename,
        "tonghuashun",
        "csv",
        hashlib.sha256(csv_text.encode("utf-8")).hexdigest(),
    )
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
    batch = create_import_batch(
        normalized,
        filename,
        "tonghuashun",
        source_format,
        hashlib.sha256(file_bytes).hexdigest(),
    )
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
    executions = tuple(parsed.get("_normalized_executions") or ())
    duplicate_executions = list(parsed.get("_duplicate_executions") or ())
    invalid_issues = tuple(parsed.get("_invalid_issues") or ())
    with transaction(get_runtime_paths()) as conn:
        classification = (
            classify_import_executions_conn(conn, batch_id, executions)
            if batch_id
            else {
                "new_executions": executions,
                "duplicate_executions": (),
                "conflict_issues": (),
            }
        )
        duplicate_executions.extend(classification["duplicate_executions"])
        matched = match_executions(classification["new_executions"])
        deduplicated = _deduplicate_matched_trades(conn, matched)
        duplicate_issues = tuple(
            ImportIssue(
                row_number=item.get("row_number"),
                code=str(item.get("code") or "duplicate_execution"),
                message=str(item.get("message") or "导入记录重复，未重复计入"),
                details={**(item.get("details") or {}), "trade_date": item.get("trade_date")},
            )
            for item in classification.get("duplicate_issues", ())
        )
        conflict_issues = tuple(
            ImportIssue(
                row_number=item.get("row_number"),
                code=str(item.get("code") or "execution_conflict"),
                message=str(item.get("message") or "成交序号已存在，但成交字段不一致"),
                details={
                    **(item.get("details") or {}),
                    "trade_date": item.get("trade_date"),
                },
            )
            for item in classification["conflict_issues"]
        )
        order_duplicate_issues = tuple(deduplicated["issues"])
        all_issues = (
            tuple(invalid_issues)
            + tuple(matched.issues)
            + duplicate_issues
            + conflict_issues
            + order_duplicate_issues
        )
        preview = build_import_preview(
            source_row_count=int(parsed.get("source_row_count") or 0),
            executions=classification["new_executions"],
            duplicates=duplicate_executions,
            issues=all_issues,
            trades=deduplicated["trades"],
        )
        if batch_id:
            record_import_executions_conn(
                conn,
                batch_id,
                classification["new_executions"],
                [_issue_dict(issue) for issue in all_issues],
            )
        for trade in deduplicated["trades"]:
            _upsert_trade_conn(conn, trade)
            conn.execute(
                """
                UPDATE trades
                SET deleted_at = NULL, deleted_reason = '', updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND platform = ? AND deleted_reason = 'import_batch_revert'
                """,
                (str(trade["id"]), str(trade["platform"])),
            )
        if batch_id:
            mark_order_duplicate_executions_conn(conn, batch_id, deduplicated["matches"])
            record_import_execution_matches_conn(conn, deduplicated["matches"])
        if deduplicated["trades"]:
            CampaignRepository(get_runtime_paths()).rebuild(conn=conn)
    parsed.update(preview)
    day_counts = preview.get("day_counts") or {}
    issues = preview.get("issues") or []
    new_row_count = sum(int(item.get("new_row_count") or 0) for item in day_counts.values())
    conflict_count = len(classification["conflict_issues"])
    result = {
        **parsed,
        "platform": TONGHUASHUN_PLATFORM,
        "imported": len(deduplicated["trades"]),
        "new_row_count": new_row_count,
        "duplicate_count": len(duplicate_executions),
        "duplicate_order_count": len(order_duplicate_issues),
        "conflict_count": conflict_count,
        "skipped": len(parsed["invalid_rows"])
        + len(parsed["unpaired_rows"])
        + len(duplicate_executions)
        + len(order_duplicate_issues)
        + conflict_count,
    }
    if batch_id:
        counts = {
            "trade_date_start": _trade_date_boundary(parsed, first=True),
            "trade_date_end": _trade_date_boundary(parsed, first=False),
            "source_row_count": int(parsed.get("source_row_count") or 0),
            "new_row_count": new_row_count,
            "duplicate_count": len(duplicate_executions),
            "conflict_count": conflict_count,
            "invalid_count": len(parsed.get("invalid_rows", [])),
            "unpaired_count": len(parsed.get("unpaired_rows", [])),
            "order_count": len(deduplicated["trades"]),
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
    result.pop("_normalized_executions", None)
    result.pop("_duplicate_executions", None)
    result.pop("_invalid_issues", None)
    result["unmatched_executions"] = list_unmatched_import_executions(
        TONGHUASHUN_PLATFORM,
    )
    result["unmatched_open_quantity"] = round(
        sum(
            float(row["remaining_quantity"])
            for row in result["unmatched_executions"]
            if row["offset"] == "open"
        ),
        10,
    )
    result["unmatched_close_quantity"] = round(
        sum(
            float(row["remaining_quantity"])
            for row in result["unmatched_executions"]
            if row["offset"] == "close"
        ),
        10,
    )
    return result


def _deduplicate_matched_trades(conn, matched) -> dict[str, Any]:
    matches_by_trade = {str(item["trade_id"]): item for item in matched.matches}
    accepted_trades: list[dict[str, Any]] = []
    effective_matches: list[dict[str, Any]] = []
    duplicate_issues: list[ImportIssue] = []
    seen: dict[tuple[str, ...], dict[str, Any]] = {}

    for trade in matched.trades:
        match = matches_by_trade.get(str(trade["id"]))
        complete_pair = bool(
            match
            and abs(float(match["quantity"]) - float(match["open_execution"].quantity)) <= 1e-9
            and abs(float(match["quantity"]) - float(match["close_execution"].quantity)) <= 1e-9
        )
        signature = trade_order_signature(trade) if complete_pair else None
        existing = seen.get(signature) if signature is not None else None
        if existing is None and signature is not None:
            existing = find_trade_by_order_signature_conn(conn, trade)
        if existing is None:
            accepted_trades.append(trade)
            if signature is not None:
                seen[signature] = {
                    "trade_id": str(trade["id"]),
                    "source_filename": str(match["open_execution"].source_filename or ""),
                    "source_row_number": match["open_execution"].source_row_number,
                }
            if match:
                effective_matches.append(match)
            continue

        existing_trade_id = str(existing.get("trade_id") or existing.get("id") or "")
        existing_source = existing.get("source") or {}
        if "source" in existing:
            existing_source_filename = str(existing_source.get("filename") or "")
            existing_source_row_number = existing_source.get("source_row_number")
        else:
            existing_source_filename = str(existing.get("source_filename") or "")
            existing_source_row_number = existing.get("source_row_number")
        opened = match["open_execution"] if match else None
        closed = match["close_execution"] if match else None
        duplicate_issues.append(
            ImportIssue(
                row_number=opened.source_row_number if opened else None,
                code="duplicate_order",
                message="完整开平订单字段完全一致，未重复生成订单",
                details={
                    "trade_date": trade.get("trade_date"),
                    "duplicate_reason": "完整开平订单字段完全一致",
                    "existing_trade_id": existing_trade_id,
                    "existing_source_filename": existing_source_filename,
                    "existing_source_row_number": existing_source_row_number,
                    "source_filename": opened.source_filename if opened else "",
                    "source_sheet": opened.source_sheet if opened else "",
                    "open_row_number": opened.source_row_number if opened else None,
                    "close_row_number": closed.source_row_number if closed else None,
                    "symbol": trade.get("symbol"),
                    "side": trade.get("side"),
                    "open_time_utc": trade.get("open_time_utc"),
                    "entry_price": trade.get("entry_price"),
                    "lots": trade.get("lots"),
                    "close_time_utc": trade.get("close_time_utc"),
                    "exit_price": trade.get("exit_price"),
                    "match_kind": "order_duplicate",
                },
            )
        )
        if match:
            effective_matches.append(
                {
                    **match,
                    "trade_id": existing_trade_id,
                    "match_kind": "order_duplicate",
                }
            )

    return {
        "trades": tuple(accepted_trades),
        "matches": tuple(effective_matches),
        "issues": tuple(duplicate_issues),
    }


def match_import_executions(
    open_execution_id: str,
    close_execution_id: str,
    quantity: float,
    *,
    platform: str = TONGHUASHUN_PLATFORM,
) -> dict[str, Any]:
    normalized = normalize_platform(platform)
    if normalized != TONGHUASHUN_PLATFORM:
        raise ValueError("手动匹配目前只支持国内期货平台")
    with transaction(get_runtime_paths()) as conn:
        opened_row = get_import_execution_conn(conn, open_execution_id, normalized)
        closed_row = get_import_execution_conn(conn, close_execution_id, normalized)
        if opened_row is None or closed_row is None:
            raise ValueError("待匹配成交不存在")
        opened = _execution_from_row(opened_row)
        closed = _execution_from_row(closed_row)
        match_index = conn.execute(
            "SELECT COUNT(*) AS value FROM import_execution_matches WHERE open_execution_id = ?",
            (str(open_execution_id),),
        ).fetchone()["value"]
        trade = _build_trade(opened, closed, float(quantity), int(match_index))
        _upsert_trade_conn(conn, trade)
        apply_import_execution_match_conn(
            conn,
            open_execution_id,
            close_execution_id,
            quantity,
            trade["id"],
            normalized,
        )
        CampaignRepository(get_runtime_paths()).rebuild(conn=conn)
    return {
        "trade": trade,
        "unmatched_executions": list_unmatched_import_executions(normalized),
    }


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


def _execution_from_row(row: Any) -> NormalizedExecution:
    try:
        raw = json.loads(str(row["raw_json"] or "{}"))
    except json.JSONDecodeError:
        raw = {}
    return NormalizedExecution(
        platform=str(row["platform"]),
        trade_date=str(row["trade_date"]),
        time_utc=str(row["time_utc"]),
        symbol=str(row["symbol"]),
        side=str(row["side"]),
        offset=str(row["offset"]),
        quantity=float(row["quantity"]),
        price=float(row["price"]),
        account=str(row["account"] or ""),
        fee=float(row["fee"] or 0.0),
        pnl=float(row["pnl"] or 0.0),
        trade_id=str(row["trade_id"] or ""),
        order_id=str(row["order_id"] or ""),
        source_kind=str(row["source_kind"] or ""),
        source_filename=str(row["source_filename"] or ""),
        source_sheet=str(row["source_sheet"] or ""),
        source_row_number=row["source_row_number"],
        raw=raw if isinstance(raw, dict) else {},
    )

from __future__ import annotations

import csv
import math
import re
import io
from datetime import date, datetime
from typing import Any

from ..platforms import TONGHUASHUN_PLATFORM
from .normalized_import import (
    build_import_preview,
    deduplicate_executions,
    match_executions,
    normalize_execution,
)


_ALIASES = {
    "time": ("成交时间", "成交日期", "成交日期时间", "时间", "成交时间(本地)", "trade_time", "time"),
    "symbol": ("合约", "合约代码", "品种", "证券代码", "symbol", "contract"),
    "side": ("买卖", "买/卖", "方向", "买卖方向", "side", "direction"),
    "action": ("开平", "开/平", "开平仓", "交易类型", "开平标志", "offset", "action"),
    "price": ("成交价", "成交价格", "价格", "price"),
    "volume": ("手数", "成交量", "数量", "成交数量", "quantity", "volume"),
    "pnl": ("平仓盈亏", "平仓盈亏(元)", "盈亏", "平仓收益", "pnl"),
    "fee": ("手续费", "手续费(元)", "交易手续费", "费用", "fee"),
    "ticket": ("成交序号", "成交编号", "成交号", "订单号", "委托编号", "trade_id", "ticket", "order_id"),
    "account": ("资金账号", "账号", "账户", "客户号"),
    "date": ("实际成交日期", "成交日期", "交易日期", "trade_date", "date"),
}


def parse_tonghuashun_csv(csv_text: str, filename: str = "") -> dict[str, Any]:
    text = str(csv_text or "").lstrip("\ufeff")
    reader = csv.DictReader(io.StringIO(text))
    headers = [str(value or "").strip() for value in (reader.fieldnames or [])]
    rows = [
        [raw.get(header, "") for header in headers]
        for raw in reader
    ]
    return _parse_tonghuashun_table(headers, rows, filename, "")


def parse_tonghuashun_rows(
    rows: list[list[Any]],
    filename: str = "",
    sheet_name: str = "",
) -> dict[str, Any]:
    """Parse a worksheet-like matrix containing a Tonghuashun report."""
    normalized_rows = [list(row or []) for row in rows]
    header_index = _find_header_index(normalized_rows)
    if header_index is None:
        result = _empty_result(filename, sheet_name)
        result["invalid_rows"].append({"row_number": 1, "error": "未找到成交明细表头"})
        result["table_header_row"] = None
        return result

    headers = [_cell_text(value).strip() for value in normalized_rows[header_index]]
    data_rows = normalized_rows[header_index + 1:]
    result = _parse_tonghuashun_table(
        headers,
        data_rows,
        filename,
        sheet_name,
        row_offset=header_index + 2,
    )
    result["table_header_row"] = header_index + 1
    return result


def parse_tonghuashun_workbook(
    sheets: dict[str, list[list[Any]]],
    filename: str = "",
) -> dict[str, Any]:
    """Select and parse the non-empty worksheet named like 成交明细."""
    sheet_names = [str(name) for name in sheets]
    selected = next((name for name in sheet_names if "成交明细" in name), None)
    if selected is None:
        result = _empty_result(filename, "")
        result["workbook_sheets"] = sheet_names
        result["invalid_rows"].append({"row_number": 1, "error": "工作簿中未找到成交明细表"})
        return result
    result = parse_tonghuashun_rows(sheets[selected], filename, selected)
    result["workbook_sheets"] = sheet_names
    return result


def _parse_tonghuashun_table(
    headers: list[Any],
    rows: list[list[Any]],
    filename: str,
    sheet_name: str,
    *,
    row_offset: int = 2,
) -> dict[str, Any]:
    headers = [_cell_text(value).strip() for value in headers]
    columns = _resolve_columns(headers)
    result = _empty_result(filename, sheet_name)
    result["headers"] = headers
    required = {"time", "symbol", "side", "action", "price", "volume"}
    missing = sorted(required - set(columns))
    if missing:
        result["invalid_rows"].append({"row_number": 1, "error": f"缺少必要列: {', '.join(missing)}"})
        return result

    records: list[tuple[int, dict[str, str]]] = []
    for index, values in enumerate(rows):
        row_number = row_offset + index
        row = {
            headers[column_index]: _cell_text(values[column_index]).strip()
            for column_index in range(min(len(headers), len(values)))
            if headers[column_index]
        }
        if not any(row.values()) or _is_summary_row(row):
            continue
        records.append((row_number, row))
    result["source_row_count"] = len(records)

    executions = []
    issues = []
    for row_number, row in records:
        raw = {
            "trade_date": _value(row, columns, "date"),
            "trade_time": _value(row, columns, "time"),
            "symbol": _value(row, columns, "symbol"),
            "side": _value(row, columns, "side"),
            "offset": _value(row, columns, "action"),
            "quantity": _value(row, columns, "volume"),
            "price": _value(row, columns, "price"),
            "fee": _value(row, columns, "fee"),
            "pnl": _value(row, columns, "pnl"),
            "trade_id": _value(row, columns, "ticket"),
            "order_id": _value(row, columns, "order_id"),
            "account": _value(row, columns, "account"),
        }
        normalized = normalize_execution(
            raw,
            {
                "platform": TONGHUASHUN_PLATFORM,
                "source_kind": "tonghuashun",
                "source_filename": filename,
                "source_sheet": sheet_name,
                "source_row_number": row_number,
            },
        )
        if hasattr(normalized, "code"):
            issues.append(normalized)
        else:
            executions.append(normalized)

    deduplicated = deduplicate_executions(executions)
    matched = match_executions(deduplicated.executions)
    preview = build_import_preview(
        source_row_count=len(records),
        executions=deduplicated.executions,
        duplicates=deduplicated.duplicates,
        issues=(*issues, *matched.issues),
        trades=matched.trades,
    )
    result.update(preview)
    result["_normalized_executions"] = deduplicated.executions
    result["_duplicate_executions"] = deduplicated.duplicates
    result["_invalid_issues"] = tuple(issues)
    if "pnl" not in columns or any(not _has_value(row, columns.get("pnl")) for _, row in records):
        result["warnings"].append("导出未完整提供平仓盈亏，导入交易的盈亏将按原始数据记为 0；请确认原始导出列。")
    return result


def _empty_result(filename: str, sheet_name: str) -> dict[str, Any]:
    return {
        "platform": TONGHUASHUN_PLATFORM,
        "filename": str(filename or ""),
        "headers": [],
        "selected_sheet": str(sheet_name or ""),
        "workbook_sheets": [],
        "table_header_row": None,
        "source_row_count": 0,
        "deduplicated_row_count": 0,
        "duplicate_rows": [],
        "trades": [],
        "unpaired_rows": [],
        "invalid_rows": [],
        "conflict_rows": [],
        "issues": [],
        "day_counts": {},
        "warnings": [],
        "_duplicate_executions": (),
        "_invalid_issues": (),
    }


def _find_header_index(rows: list[list[Any]]) -> int | None:
    required = {"time", "symbol", "side", "action", "price", "volume"}
    for index, row in enumerate(rows):
        headers = [_cell_text(value).strip() for value in row]
        if required <= set(_resolve_columns(headers)):
            return index
    return None


def _row_dedupe_key(row: dict[str, str], columns: dict[str, str]) -> tuple[str, ...]:
    account = row.get(columns.get("account", ""), "") if columns.get("account") else ""
    ticket = row.get(columns.get("ticket", ""), "") if columns.get("ticket") else ""
    if ticket:
        return ("ticket", account, ticket)
    return (
        "signature",
        account,
        row.get(columns.get("time", ""), "") if columns.get("time") else "",
        row.get(columns.get("symbol", ""), "") if columns.get("symbol") else "",
        row.get(columns.get("side", ""), "") if columns.get("side") else "",
        row.get(columns.get("action", ""), "") if columns.get("action") else "",
        row.get(columns.get("price", ""), "") if columns.get("price") else "",
        row.get(columns.get("volume", ""), "") if columns.get("volume") else "",
        row.get(columns.get("pnl", ""), "") if columns.get("pnl") else "",
        row.get(columns.get("fee", ""), "") if columns.get("fee") else "",
    )


def _is_summary_row(row: dict[str, str]) -> bool:
    values = [value.strip() for value in row.values() if value.strip()]
    if not values:
        return True
    first = values[0]
    return first in {"合计", "小计", "汇总", "总计"}


def _cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    return str(value)


def _resolve_columns(headers: list[str]) -> dict[str, str]:
    normalized = {re.sub(r"[\s()（）]", "", header): header for header in headers}
    resolved: dict[str, str] = {}
    for key, aliases in _ALIASES.items():
        for alias in aliases:
            candidate = re.sub(r"[\s()（）]", "", alias)
            if candidate in normalized:
                resolved[key] = normalized[candidate]
                break
    return resolved


def _has_value(row: dict[str, str], column: str | None) -> bool:
    return bool(column and str(row.get(column) or "").strip())


def _value(row: dict[str, str], columns: dict[str, str], key: str) -> str:
    column = columns.get(key)
    return row.get(column, "") if column else ""

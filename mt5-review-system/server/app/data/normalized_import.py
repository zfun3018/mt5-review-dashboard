from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Mapping

from ..platform_adapters.contracts import ImportIssue, NormalizedExecution
from ..platforms import DOMESTIC_FUTURES_PLATFORM
from ..platform_modules.domestic_futures_contracts import contract_display


BEIJING_TZ = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class DeduplicationResult:
    executions: tuple[NormalizedExecution, ...]
    duplicates: tuple[NormalizedExecution, ...]


@dataclass(frozen=True)
class MatchResult:
    trades: tuple[dict[str, Any], ...]
    issues: tuple[ImportIssue, ...]


def normalize_execution(
    raw_row: Mapping[str, Any],
    context: Mapping[str, Any] | None = None,
) -> NormalizedExecution | ImportIssue:
    context = dict(context or {})
    row_number = _optional_int(context.get("source_row_number"))
    explicit_date = _clean(raw_row.get("trade_date") or raw_row.get("date"))
    time_value = _clean(raw_row.get("trade_time") or raw_row.get("time"))
    trade_date = _normalize_date(explicit_date)
    try:
        time_utc, inferred_date = _parse_time(time_value, trade_date)
    except ValueError as exc:
        return _issue("invalid_time", str(exc), row_number, trade_date, context)
    trade_date = trade_date or inferred_date

    symbol = _clean(raw_row.get("symbol") or raw_row.get("contract"))
    if not symbol:
        return _issue("missing_required", "缺少合约", row_number, trade_date, context)

    side_text = _clean(raw_row.get("side") or raw_row.get("direction")).replace(" ", "")
    offset_text = _clean(raw_row.get("offset") or raw_row.get("action")).replace(" ", "")
    side = _normalize_side(side_text, offset_text)
    offset = _normalize_offset(offset_text)
    if side is None or offset is None:
        return _issue(
            "invalid_enum",
            "无法识别买卖方向或开平标志",
            row_number,
            trade_date,
            context,
        )

    try:
        quantity = _number(raw_row.get("quantity") or raw_row.get("volume"), "手数")
        price = _number(raw_row.get("price"), "成交价")
        fee = _number(raw_row.get("fee"), "手续费", default=0.0)
        pnl = _number(raw_row.get("pnl"), "平仓盈亏", default=0.0)
    except ValueError as exc:
        return _issue("invalid_number", str(exc), row_number, trade_date, context)
    if quantity <= 0:
        return _issue("invalid_number", "手数必须大于 0", row_number, trade_date, context)
    if price < 0 or not math.isfinite(price):
        return _issue("invalid_number", "成交价必须是有效数字", row_number, trade_date, context)

    raw = dict(raw_row)
    if str(context.get("platform") or "").strip() == DOMESTIC_FUTURES_PLATFORM:
        raw.update(contract_display(symbol))

    return NormalizedExecution(
        platform=str(context.get("platform") or "mt5"),
        trade_date=trade_date or time_utc[:10],
        time_utc=time_utc,
        symbol=symbol,
        side=side,
        offset=offset,
        quantity=quantity,
        price=price,
        account=_clean(raw_row.get("account")) or "DOMESTIC-FUTURES-LOCAL",
        fee=fee,
        pnl=pnl,
        trade_id=_clean(raw_row.get("trade_id") or raw_row.get("ticket")),
        order_id=_clean(raw_row.get("order_id")),
        source_kind=str(context.get("source_kind") or "unknown"),
        source_filename=_basename(context.get("source_filename")),
        source_sheet=str(context.get("source_sheet") or ""),
        source_row_number=row_number,
        raw=raw,
    )


def deduplicate_executions(
    executions: Iterable[NormalizedExecution],
) -> DeduplicationResult:
    seen: dict[tuple[Any, ...], NormalizedExecution] = {}
    accepted: list[NormalizedExecution] = []
    duplicates: list[NormalizedExecution] = []
    for execution in executions:
        key = _execution_key(execution)
        if key in seen:
            duplicates.append(execution)
            continue
        seen[key] = execution
        accepted.append(execution)
    return DeduplicationResult(tuple(accepted), tuple(duplicates))


def match_executions(executions: Iterable[NormalizedExecution]) -> MatchResult:
    queues: dict[tuple[str, str, str], deque[NormalizedExecution]] = defaultdict(deque)
    trades: list[dict[str, Any]] = []
    issues: list[ImportIssue] = []
    for execution in executions:
        key = (execution.account, execution.symbol, execution.side)
        if execution.offset == "open":
            queues[key].append(execution)
            continue

        remaining = execution.quantity
        matched = False
        while remaining > 1e-9 and queues[key]:
            opened = queues[key][0]
            amount = min(remaining, opened.quantity)
            trades.append(_build_trade(opened, execution, amount, len(trades)))
            opened = _replace_quantity(opened, opened.quantity - amount)
            queues[key][0] = opened
            remaining = round(remaining - amount, 10)
            matched = True
            if opened.quantity <= 1e-9:
                queues[key].popleft()
        if remaining > 1e-9 or not matched:
            issues.append(
                _issue(
                    "unpaired_close",
                    "找不到对应开仓成交",
                    execution.source_row_number,
                    execution.trade_date,
                    {
                        "symbol": execution.symbol,
                        "quantity": remaining,
                        "platform": execution.platform,
                    },
                )
            )

    for queue in queues.values():
        for opened in queue:
            if opened.quantity <= 1e-9:
                continue
            issues.append(
                _issue(
                    "unpaired_open",
                    "开仓成交未平仓",
                    opened.source_row_number,
                    opened.trade_date,
                    {
                        "symbol": opened.symbol,
                        "quantity": opened.quantity,
                        "platform": opened.platform,
                    },
                )
            )
    return MatchResult(tuple(trades), tuple(issues))


def build_import_preview(
    *,
    source_row_count: int,
    executions: Iterable[NormalizedExecution],
    duplicates: Iterable[NormalizedExecution],
    issues: Iterable[ImportIssue],
    trades: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    executions = tuple(executions)
    duplicates = tuple(duplicates)
    issues = tuple(issues)
    trades = tuple(trades)
    invalid = [issue for issue in issues if issue.code not in {"unpaired_open", "unpaired_close"}]
    unpaired = [issue for issue in issues if issue.code in {"unpaired_open", "unpaired_close"}]
    duplicate_rows = [
        {
            "row_number": execution.source_row_number,
            "duplicate_of": None,
            "trade_date": execution.trade_date,
        }
        for execution in duplicates
    ]
    invalid_rows = [_issue_dict(issue) for issue in invalid]
    unpaired_rows = [_issue_dict(issue) for issue in unpaired]
    day_counts: dict[str, dict[str, int]] = defaultdict(lambda: {
        "source_row_count": 0,
        "new_row_count": 0,
        "duplicate_count": 0,
        "invalid_count": 0,
        "unpaired_count": 0,
        "order_count": 0,
    })
    for execution in executions:
        day_counts[execution.trade_date]["source_row_count"] += 1
        day_counts[execution.trade_date]["new_row_count"] += 1
    for execution in duplicates:
        day_counts[execution.trade_date]["source_row_count"] += 1
        day_counts[execution.trade_date]["duplicate_count"] += 1
    for issue in issues:
        day = str(issue.details.get("trade_date") or "")
        if not day:
            continue
        is_unpaired = issue.code in {"unpaired_open", "unpaired_close"}
        if not is_unpaired:
            day_counts[day]["source_row_count"] += 1
        field = "unpaired_count" if is_unpaired else "invalid_count"
        day_counts[day][field] += 1
    for trade in trades:
        day = str(trade.get("close_time_utc") or "")[:10]
        if day:
            day_counts[day]["order_count"] += 1

    return {
        "source_row_count": int(source_row_count),
        "deduplicated_row_count": len(duplicates),
        "duplicate_rows": duplicate_rows,
        "invalid_rows": invalid_rows,
        "unpaired_rows": unpaired_rows,
        "trades": list(trades),
        "issues": [_issue_dict(issue) for issue in issues],
        "day_counts": dict(day_counts),
    }


def _build_trade(opened: NormalizedExecution, closed: NormalizedExecution, quantity: float, index: int) -> dict[str, Any]:
    open_ratio = quantity / opened.quantity if opened.quantity else 1.0
    close_ratio = quantity / closed.quantity if closed.quantity else 1.0
    seed = "|".join(
        (
            opened.platform,
            opened.trade_id or _source_key(opened),
            closed.trade_id or _source_key(closed),
            opened.symbol,
            str(quantity),
            str(index),
        )
    )
    trade_id = hashlib.sha256(seed.encode()).hexdigest()[:24]
    return {
        "id": f"FUT-{trade_id}",
        "platform": opened.platform,
        "account": opened.account,
        "order_no": closed.order_id or closed.trade_id,
        "position_id": f"{opened.trade_id or _source_key(opened)}-{closed.trade_id or _source_key(closed)}-{index}",
        "order_ticket": opened.order_id or opened.trade_id,
        "deal_ticket": closed.trade_id,
        "symbol": opened.symbol,
        "product_name": str(opened.raw.get("product_name") or ""),
        "contract_name": str(opened.raw.get("contract_name") or ""),
        "side": opened.side,
        "lots": quantity,
        "open_time_utc": opened.time_utc,
        "close_time_utc": closed.time_utc,
        "entry_price": opened.price,
        "exit_price": closed.price,
        "pnl": round(closed.pnl * close_ratio, 2),
        "commission": round(-(opened.fee * open_ratio + closed.fee * close_ratio), 2),
        "swap": 0.0,
        "fee": 0.0,
        "screenshot_path": "",
        "trade_type": "unclassified",
        "strategy": "strategy_unclassified",
        "source": f"{opened.source_kind or 'data'}_import",
        "raw_json": json.dumps({"open": opened.raw, "close": closed.raw}, ensure_ascii=False),
    }


def _replace_quantity(execution: NormalizedExecution, quantity: float) -> NormalizedExecution:
    return NormalizedExecution(**{**execution.__dict__, "quantity": round(quantity, 10)})


def _execution_key(execution: NormalizedExecution) -> tuple[Any, ...]:
    if execution.trade_id:
        return ("id", execution.platform, execution.account, execution.trade_id)
    return ("signature", execution.platform, execution.account, *_source_key(execution))


def _source_key(execution: NormalizedExecution) -> tuple[str, ...]:
    return (
        execution.trade_date,
        execution.time_utc,
        execution.symbol,
        execution.side,
        execution.offset,
        str(execution.quantity),
        str(execution.price),
        str(execution.fee),
        str(execution.pnl),
    )


def _normalize_side(side_text: str, offset_text: str) -> str | None:
    if side_text in {"买", "buy", "b", "0"}:
        return "long" if _normalize_offset(offset_text) == "open" else "short"
    if side_text in {"卖", "sell", "s", "1"}:
        return "short" if _normalize_offset(offset_text) == "open" else "long"
    return None


def _normalize_offset(value: str) -> str | None:
    text = value.casefold()
    if "开" in value or text in {"open", "o"}:
        return "open"
    if "平" in value or text in {"close", "c"}:
        return "close"
    return None


def _parse_time(value: str, trade_date: str | None) -> tuple[str, str]:
    text = value.strip().replace("/", "-")
    if trade_date and re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", text):
        text = f"{trade_date} {text}"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            parsed = datetime.strptime(text, fmt).replace(tzinfo=BEIJING_TZ)
            utc = parsed.astimezone(timezone.utc)
            return utc.isoformat(), parsed.date().isoformat()
        except ValueError:
            continue
    raise ValueError("无法识别成交时间")


def _number(value: Any, label: str, default: float | None = None) -> float:
    text = _clean(value).replace(",", "")
    if not text or (default is not None and text in {"-", "--", "—", "－", "N/A", "n/a"}):
        if default is not None:
            return default
        raise ValueError(f"缺少{label}")
    try:
        number = float(text)
    except ValueError as exc:
        raise ValueError(f"{label}不是有效数字") from exc
    if not math.isfinite(number):
        raise ValueError(f"{label}不是有效数字")
    return number


def _issue(code: str, message: str, row_number: int | None, trade_date: str | None, details: Mapping[str, Any] | None = None) -> ImportIssue:
    values = dict(details or {})
    if trade_date:
        values.setdefault("trade_date", trade_date)
    return ImportIssue(row_number=row_number, code=code, message=message, details=values)


def _issue_dict(issue: ImportIssue) -> dict[str, Any]:
    return {
        "row_number": issue.row_number,
        "code": issue.code,
        "error": issue.message,
        "message": issue.message,
        **dict(issue.details),
    }


def _normalize_date(value: str) -> str | None:
    text = value.replace("/", "-").strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def _optional_int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _basename(value: Any) -> str:
    return re.split(r"[\\/]", _clean(value))[-1]

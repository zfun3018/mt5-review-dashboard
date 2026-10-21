from __future__ import annotations

import hashlib
import json
import math
import re
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
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
    matches: tuple[dict[str, Any], ...] = ()


def trade_order_signature(trade: Mapping[str, Any]) -> tuple[str, ...] | None:
    """Return the fallback identity for a complete one-open/one-close import trade."""
    required = (
        "platform",
        "account",
        "symbol",
        "side",
        "lots",
        "open_time_utc",
        "entry_price",
        "close_time_utc",
        "exit_price",
    )
    if any(str(trade.get(field) or "").strip() == "" for field in required):
        return None
    return (
        str(trade["platform"]),
        str(trade["account"]),
        str(trade["symbol"]),
        str(trade["side"]),
        _canonical_number(trade["lots"]),
        str(trade["open_time_utc"]),
        _canonical_number(trade["entry_price"]),
        str(trade["close_time_utc"]),
        _canonical_number(trade["exit_price"]),
    )


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
        time_utc, inferred_date = _parse_time(
            time_value,
            trade_date,
            domestic_futures=str(context.get("platform") or "").strip() == DOMESTIC_FUTURES_PLATFORM,
        )
    except ValueError as exc:
        return _issue(
            "invalid_time",
            str(exc),
            row_number,
            trade_date,
            {
                **context,
                "field": "trade_time",
                "value": time_value,
                "expected": "可识别的时间格式",
            },
        )
    trade_date = trade_date or inferred_date

    symbol = _clean(raw_row.get("symbol") or raw_row.get("contract"))
    if not symbol:
        return _issue(
            "missing_required",
            "缺少合约",
            row_number,
            trade_date,
            {**context, "field": "symbol", "expected": "合约代码"},
        )

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
            {
                **context,
                "field": "side/offset",
                "value": {"side": side_text, "offset": offset_text},
                "expected": "可识别的买卖方向和开平标志",
            },
        )

    quantity_value = raw_row.get("quantity")
    if quantity_value in (None, ""):
        quantity_value = raw_row.get("volume")
    try:
        quantity = _number(quantity_value, "手数")
    except ValueError as exc:
        return _issue(
            "invalid_number",
            str(exc),
            row_number,
            trade_date,
            {
                **context,
                "field": "quantity",
                "value": quantity_value,
                "expected": "有效的正数",
            },
        )
    if quantity <= 0:
        return _issue(
            "invalid_number",
            "手数必须大于 0",
            row_number,
            trade_date,
            {**context, "field": "quantity", "value": quantity, "expected": "有效的正数"},
        )

    try:
        price = _number(raw_row.get("price"), "成交价")
    except ValueError as exc:
        return _issue(
            "invalid_number",
            str(exc),
            row_number,
            trade_date,
            {**context, "field": "price", "value": raw_row.get("price"), "expected": "有效数字"},
        )
    try:
        fee = _number(raw_row.get("fee"), "手续费", default=0.0)
    except ValueError as exc:
        return _issue(
            "invalid_number",
            str(exc),
            row_number,
            trade_date,
            {**context, "field": "fee", "value": raw_row.get("fee"), "expected": "有效数字"},
        )
    try:
        pnl = _number(raw_row.get("pnl"), "平仓盈亏", default=0.0)
    except ValueError as exc:
        return _issue(
            "invalid_number",
            str(exc),
            row_number,
            trade_date,
            {**context, "field": "pnl", "value": raw_row.get("pnl"), "expected": "有效数字"},
        )
    if price < 0 or not math.isfinite(price):
        return _issue(
            "invalid_number",
            "成交价必须是有效数字",
            row_number,
            trade_date,
            {**context, "field": "price", "value": price, "expected": "有效的非负数字"},
        )

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
    matches: list[dict[str, Any]] = []
    ordered_executions = sorted(executions, key=_execution_sort_key)
    for execution in ordered_executions:
        key = (execution.account, execution.symbol, execution.side)
        if execution.offset == "open":
            queues[key].append(execution)
            continue

        remaining = execution.quantity
        matched = False
        while remaining > 1e-9 and queues[key]:
            opened = queues[key][0]
            amount = min(remaining, opened.quantity)
            trade = _build_trade(opened, execution, amount, len(trades))
            trades.append(trade)
            matches.append(
                {
                    "open_execution": opened,
                    "close_execution": execution,
                    "quantity": amount,
                    "trade_id": trade["id"],
                }
            )
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
                        "requested_quantity": execution.quantity,
                        "matched_quantity": round(execution.quantity - remaining, 10),
                        "remaining_quantity": remaining,
                        "reason": (
                            "平仓成交数量超过可用开仓数量"
                            if matched
                            else "找不到同合约、同方向且可用数量足够的开仓成交"
                        ),
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
                        "requested_quantity": opened.quantity,
                        "matched_quantity": 0.0,
                        "remaining_quantity": opened.quantity,
                        "reason": "找不到对应平仓成交",
                        "platform": opened.platform,
                    },
                )
            )
    return MatchResult(tuple(trades), tuple(issues), tuple(matches))


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
    invalid = [
        issue
        for issue in issues
        if issue.code not in {
            "unpaired_open",
            "unpaired_close",
            "execution_conflict",
            "duplicate_execution",
            "duplicate_order",
        }
    ]
    conflicts = [issue for issue in issues if issue.code == "execution_conflict"]
    unpaired = [issue for issue in issues if issue.code in {"unpaired_open", "unpaired_close"}]
    duplicate_rows = [
        _issue_dict(issue)
        for issue in issues
        if issue.code in {"duplicate_execution", "duplicate_order"}
    ]
    if not duplicate_rows:
        duplicate_rows = [
            {
                "row_number": execution.source_row_number,
                "duplicate_of": None,
                "trade_date": execution.trade_date,
                "code": "duplicate_execution",
                "message": "成交记录已导入，未重复计入",
            }
            for execution in duplicates
        ]
    invalid_rows = [_issue_dict(issue) for issue in invalid]
    conflict_rows = [_issue_dict(issue) for issue in conflicts]
    unpaired_rows = [_issue_dict(issue) for issue in unpaired]
    day_counts: dict[str, dict[str, int]] = defaultdict(lambda: {
        "source_row_count": 0,
        "new_row_count": 0,
        "duplicate_count": 0,
        "conflict_count": 0,
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
        is_conflict = issue.code == "execution_conflict"
        if not is_unpaired:
            day_counts[day]["source_row_count"] += 1
        field = (
            "unpaired_count"
            if is_unpaired
            else "conflict_count"
            if is_conflict
            else "invalid_count"
        )
        day_counts[day][field] += 1
    for trade in trades:
        day = str(trade.get("trade_date") or "")
        if day:
            day_counts[day]["order_count"] += 1

    return {
        "source_row_count": int(source_row_count),
        "deduplicated_row_count": len(duplicates),
        "duplicate_rows": duplicate_rows,
        "duplicate_order_count": sum(1 for issue in issues if issue.code == "duplicate_order"),
        "invalid_rows": invalid_rows,
        "conflict_rows": conflict_rows,
        "unpaired_rows": unpaired_rows,
        "trades": list(trades),
        "issues": [_issue_dict(issue) for issue in issues],
        "day_counts": dict(day_counts),
    }


def _execution_sort_key(execution: NormalizedExecution) -> tuple[Any, ...]:
    source_row = execution.source_row_number
    stable_row = source_row if source_row is not None else 2**31 - 1
    if execution.platform == DOMESTIC_FUTURES_PLATFORM:
        local_time = datetime.fromisoformat(
            execution.time_utc.replace("Z", "+00:00")
        ).astimezone(BEIJING_TZ)
        minutes = local_time.hour * 60 + local_time.minute
        if minutes >= 21 * 60:
            session_rank = minutes
        elif minutes < 9 * 60:
            session_rank = 24 * 60 + minutes
        else:
            session_rank = 48 * 60 + minutes
        return (
            execution.trade_date,
            session_rank,
            local_time.second,
            stable_row,
            execution.trade_id or "",
        )
    return (execution.time_utc, stable_row, execution.trade_id or "")


def _build_trade(opened: NormalizedExecution, closed: NormalizedExecution, quantity: float, index: int) -> dict[str, Any]:
    open_ratio = quantity / opened.quantity if opened.quantity else 1.0
    close_ratio = quantity / closed.quantity if closed.quantity else 1.0
    seed = "|".join(
        (
            opened.platform,
            _execution_reference(opened),
            _execution_reference(closed),
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
        "trade_date": opened.trade_date,
        "order_no": closed.order_id or closed.trade_id,
        "position_id": f"{_execution_reference(opened)}-{_execution_reference(closed)}-{index}",
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
        return (
            "id",
            execution.platform,
            execution.account,
            execution.trade_id,
            *_source_key(execution),
        )
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


def _execution_reference(execution: NormalizedExecution) -> str:
    return execution.trade_id or "|".join(_source_key(execution))


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


def _parse_time(
    value: str,
    trade_date: str | None,
    *,
    domestic_futures: bool = False,
) -> tuple[str, str]:
    text = value.strip().replace("/", "-")
    if trade_date and re.fullmatch(r"\d{1,2}:\d{2}(?::\d{2})?", text):
        parsed_time = datetime.strptime(text, "%H:%M:%S" if text.count(":") == 2 else "%H:%M").time()
        natural_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
        if domestic_futures and parsed_time.hour >= 21:
            natural_date -= timedelta(days=1)
        parsed = datetime.combine(natural_date, parsed_time).replace(tzinfo=BEIJING_TZ)
        return parsed.astimezone(timezone.utc).isoformat(), trade_date
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            parsed = datetime.strptime(text, fmt)
            if domestic_futures and trade_date:
                natural_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
                if parsed.hour >= 21:
                    natural_date -= timedelta(days=1)
                parsed = datetime.combine(natural_date, parsed.time())
            parsed = parsed.replace(tzinfo=BEIJING_TZ)
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
    return "" if value is None else str(value).strip()


def _canonical_number(value: Any) -> str:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return str(value)
    if not number.is_finite():
        return str(value)
    return format(number.normalize(), "f")


def _basename(value: Any) -> str:
    return re.split(r"[\\/]", _clean(value))[-1]

from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from math import sqrt
from typing import Any

BEIJING_TZ = timezone(timedelta(hours=8))

DEFAULT_SESSIONS = {
    "asia": {"label": "Asia", "start": time(8, 0), "end": time(15, 0)},
    "europe": {"label": "Europe", "start": time(15, 0), "end": time(20, 0)},
    "us": {"label": "US", "start": time(20, 0), "end": time(2, 0)},
}


def trade_net_pnl(trade: dict[str, Any]) -> float:
    """Return realized P/L after all known trading costs.

    If the dict already carries a precomputed ``net_pnl`` key (added by
    repositories that batch-fetch analysis rows), reuse it to avoid repeating
    the same float arithmetic tens of thousands of times per request.
    """
    try:
        cached = trade["net_pnl"]
    except KeyError:
        cached = None
    if cached is None:
        return round(
            float(trade.get("pnl", 0.0) or 0.0)
            + float(trade.get("commission", 0.0) or 0.0)
            + float(trade.get("swap", 0.0) or 0.0)
            + float(trade.get("fee", 0.0) or 0.0),
            2,
        )
    return float(cached)


def build_trade_metrics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    # Single pass instead of building `values`/`wins`/`losses` lists and then
    # re-scanning them several times. This function runs once per aggregation
    # bucket (overall, each period, each day, each mode), so the list-building
    # and repeated sum()/max()/min() passes added up to a measurable chunk of
    # the /api/analysis hot path.
    total = 0
    net_sum = 0.0
    win_sum = 0.0
    loss_sum = 0.0
    win_count = 0
    loss_count = 0
    max_val: float | None = None
    min_val: float | None = None
    for trade in trades:
        value = trade_net_pnl(trade)
        total += 1
        net_sum += value
        if value > 0:
            win_count += 1
            win_sum += value
        elif value < 0:
            loss_count += 1
            loss_sum += value
        if max_val is None or value > max_val:
            max_val = value
        if min_val is None or value < min_val:
            min_val = value

    gross_profit = round(win_sum, 2)
    gross_loss = round(abs(loss_sum), 2)
    resolved = win_count + loss_count
    avg_win = round(gross_profit / win_count, 2) if win_count else 0.0
    avg_loss = round(-gross_loss / loss_count, 2) if loss_count else 0.0
    return {
        "order_count": total,
        "resolved_count": resolved,
        "breakeven_count": total - resolved,
        "net_pnl": round(net_sum, 2),
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "win_count": win_count,
        "loss_count": loss_count,
        "win_rate": win_count / total if total else 0.0,
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss else None,
        "payoff_ratio": round(avg_win / abs(avg_loss), 4) if avg_loss else None,
        "max_profit": round(max_val, 2) if max_val is not None else 0.0,
        "max_loss": round(min_val, 2) if min_val is not None else 0.0,
        "avg_trade": round(net_sum / total, 2) if total else 0.0,
        "avg_profit": avg_win,
        "avg_loss": avg_loss,
    }


def calculate_runs_z(trades: list[dict[str, Any]]) -> dict[str, Any]:
    # Callers feed rows already ordered by close time (query_analysis_rows uses
    # ORDER BY close_time_utc ASC, and period/day buckets preserve that order),
    # so the historical re-sort here is skipped to avoid an O(n log n) pass.
    n = 0
    wins = 0
    runs = 0
    prev = 0  # sentinel: 0 marks "no outcome seen yet" (outcomes are ±1)
    for trade in trades:
        pnl = trade_net_pnl(trade)
        if pnl == 0:
            continue
        outcome = 1 if pnl > 0 else -1
        n += 1
        if outcome > 0:
            wins += 1
        if prev == 0:
            runs = 1
        elif outcome != prev:
            runs += 1
        prev = outcome
    losses = n - wins
    result: dict[str, Any] = {
        "n": n,
        "wins": wins,
        "losses": losses,
        "runs": runs,
        "z": None,
        "classification": "insufficient_data",
    }
    if n < 2 or not wins or not losses:
        return result

    x = 2 * wins * losses
    denominator = sqrt(x * (x - n) / (n - 1)) if x > n else 0.0
    if denominator <= 0:
        return result
    z = (n * (runs - 0.5) - x) / denominator
    result["z"] = round(z, 4)
    if z > 1.96:
        result["classification"] = "alternating"
    elif z < -1.96:
        result["classification"] = "clustered"
    else:
        result["classification"] = "independent"
    return result


def build_daily_system_evaluation(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for trade in trades:
        date_key = to_beijing(trade["close_time_utc"]).date().isoformat()
        grouped.setdefault(date_key, []).append(trade)
    rows = []
    for date_key in sorted(grouped):
        metrics = build_trade_metrics(grouped[date_key])
        metrics.update({"date": date_key, "z_score": calculate_runs_z(grouped[date_key])})
        rows.append(metrics)
    return rows


def build_mode_evaluation(
    trades: list[dict[str, Any]],
    dimension: str,
) -> list[dict[str, Any]]:
    if dimension not in {"trade_type", "strategy"}:
        raise ValueError("dimension must be trade_type or strategy")
    grouped: dict[str, list[dict[str, Any]]] = {}
    for trade in trades:
        value = str(trade.get(dimension) or "unclassified").strip() or "unclassified"
        grouped.setdefault(value, []).append(trade)
    total = len(trades)
    rows = []
    for value in sorted(grouped):
        metrics = build_trade_metrics(grouped[value])
        metrics.update(
            {
                "key": value,
                "label": value,
                "share": len(grouped[value]) / total if total else 0.0,
            }
        )
        rows.append(metrics)
    return rows


@lru_cache(maxsize=131072)
def _parse_dt_string(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    return _parse_dt_string(value)


@lru_cache(maxsize=131072)
def _to_beijing_string(value: str) -> datetime:
    return _parse_dt_string(value).astimezone(BEIJING_TZ)


def to_beijing(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        base = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return base.astimezone(BEIJING_TZ)
    return _to_beijing_string(value)


def calculate_duration_seconds(open_time: str | datetime, close_time: str | datetime) -> int:
    opened = parse_dt(open_time)
    closed = parse_dt(close_time)
    return max(0, int((closed - opened).total_seconds()))


def build_month_calendar(trades: list[dict[str, Any]], year: int, month: int) -> dict[str, Any]:
    _, day_count = monthrange(year, month)
    days = {
        f"{year:04d}-{month:02d}-{day:02d}": _empty_period(f"{year:04d}-{month:02d}-{day:02d}")
        for day in range(1, day_count + 1)
    }

    for trade in trades:
        closed = trade.get("_bj") or to_beijing(trade["close_time_utc"])
        if closed.year != year or closed.month != month:
            continue
        key = closed.date().isoformat()
        _add_trade(days[key], trade_net_pnl(trade))

    month_net = sum(day["net_pnl"] for day in days.values())
    month_orders = sum(day["order_count"] for day in days.values())
    month_wins = sum(day["_wins"] for day in days.values())

    for day in days.values():
        _finalize_period(day)

    return {
        "year": year,
        "month": month,
        "month_net_pnl": round(month_net, 2),
        "month_order_count": month_orders,
        "month_win_rate": _rate(month_wins, month_orders),
        "days": days,
    }


def build_hour_heatmap(
    trades: list[dict[str, Any]],
    anchor_utc: datetime | None = None,
    days: int = 7,
) -> dict[str, Any]:
    anchor = to_beijing(anchor_utc or datetime.now(timezone.utc)).date()
    start = anchor - timedelta(days=days - 1)
    rows = []
    index: dict[str, list[dict[str, Any]]] = {}

    for offset in range(days):
        current = start + timedelta(days=offset)
        key = current.isoformat()
        hours = [_empty_hour(hour) for hour in range(24)]
        rows.append(
            {
                "date": key,
                "weekday": current.strftime("%a"),
                "hours": hours,
            }
        )
        index[key] = hours

    for trade in trades:
        closed = trade.get("_bj") or to_beijing(trade["close_time_utc"])
        day_key = closed.date().isoformat()
        if day_key not in index:
            continue
        cell = index[day_key][closed.hour]
        _add_trade(cell, trade_net_pnl(trade))

    max_abs = 0.0
    for row in rows:
        for cell in row["hours"]:
            _finalize_period(cell)
            max_abs = max(max_abs, abs(cell["net_pnl"]))

    return {"days": rows, "max_abs_pnl": round(max_abs, 2)}


def build_session_stats(
    trades: list[dict[str, Any]],
    sessions: dict[str, dict[str, time]] | None = None,
) -> dict[str, Any]:
    session_defs = sessions or DEFAULT_SESSIONS
    stats = {
        key: {
            "key": key,
            "label": definition.get("label", key.title()),
            "window": _format_window(definition["start"], definition["end"]),
            "net_pnl": 0.0,
            "order_count": 0,
            "_wins": 0,
        }
        for key, definition in session_defs.items()
    }

    for trade in trades:
        closed = trade.get("_bj") or to_beijing(trade["close_time_utc"])
        pnl = trade_net_pnl(trade)
        for key, definition in session_defs.items():
            if _time_in_range(closed.time(), definition["start"], definition["end"]):
                _add_trade(stats[key], pnl)
                break

    for period in stats.values():
        _finalize_period(period)
        period["avg_pnl"] = _rate(period["net_pnl"], period["order_count"])

    return stats


def build_equity_curve(
    snapshots: list[dict[str, Any]],
    now_utc: datetime | None = None,
    hours: int = 24,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    now = parse_dt(now_utc or datetime.now(timezone.utc))
    since = now - timedelta(hours=hours)
    range_start = date.fromisoformat(start_date) if start_date else None
    range_end = date.fromisoformat(end_date) if end_date else None
    if range_start and range_end and range_start > range_end:
        raise ValueError("start_date cannot be after end_date")
    points = []

    for snapshot in snapshots:
        timestamp = parse_dt(snapshot["time_utc"])
        if range_start or range_end:
            point_date = timestamp.astimezone(BEIJING_TZ).date()
            if range_start and point_date < range_start:
                continue
            if range_end and point_date > range_end:
                continue
        elif timestamp < since or timestamp > now:
            continue
        points.append(
            {
                "time_utc": timestamp.isoformat(),
                "time_bj": timestamp.astimezone(BEIJING_TZ).isoformat(),
                "equity": round(float(snapshot.get("equity", 0.0)), 2),
            }
        )

    points = sorted(points, key=lambda item: item["time_utc"])
    if not points:
        return points

    baseline_equity = points[0]["equity"]
    for point in points:
        cumulative_return = round(point["equity"] - baseline_equity, 2)
        point["cumulative_return"] = cumulative_return
        point["return_rate"] = round(cumulative_return / baseline_equity * 100, 3) if baseline_equity else 0.0

    return points


def build_cumulative_return_curve(
    trades: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    now_utc: datetime | None = None,
    hours: int = 24,
    start_date: str | None = None,
    end_date: str | None = None,
    max_points: int | None = None,
) -> list[dict[str, Any]]:
    """Rebuild cumulative realized return from the supplied active trades.

    Snapshots provide only the starting capital used for the return-rate axis;
    they never contribute P/L points, so deleted trades cannot leak into this curve.

    ``max_points``, when set, downsamples the emitted points to roughly that many
    evenly-spaced samples (inclusive of the leading baseline). The cumulative
    value is still accumulated over every trade, so the final amount is exact;
    only the intermediate resolution is reduced.
    """
    now = parse_dt(now_utc or datetime.now(timezone.utc))
    since = now - timedelta(hours=hours)
    range_start = date.fromisoformat(start_date) if start_date else None
    range_end = date.fromisoformat(end_date) if end_date else None
    if range_start and range_end and range_start > range_end:
        raise ValueError("start_date cannot be after end_date")

    # Single pass over trades: parse each close time once and decorate it with
    # its Beijing conversion. The date-window filter and the `time_bj` output
    # then share a single astimezone call per trade instead of two.
    decorated: list[tuple[datetime, datetime, dict[str, Any]]] = []
    for trade in trades:
        timestamp = parse_dt(trade["close_time_utc"])
        beijing = timestamp.astimezone(BEIJING_TZ)
        if range_start or range_end:
            point_date = beijing.date()
            if (range_start and point_date < range_start) or (
                range_end and point_date > range_end
            ):
                continue
        elif not (since <= timestamp <= now):
            continue
        decorated.append((timestamp, beijing, trade))

    if not decorated:
        return []

    # `decorated` preserves the ascending close-time order already produced by
    # ``query_analysis_rows`` (ORDER BY close_time_utc ASC), so no re-sort is
    # needed here; skipping it avoids an O(n log n) pass over the full trade set.
    def in_window(timestamp: datetime) -> bool:
        if range_start or range_end:
            point_date = timestamp.astimezone(BEIJING_TZ).date()
            return not (
                (range_start and point_date < range_start)
                or (range_end and point_date > range_end)
            )
        return since <= timestamp <= now

    eligible_snapshots = sorted(
        (
            snapshot
            for snapshot in snapshots
            if in_window(parse_dt(snapshot["time_utc"]))
        ),
        key=lambda snapshot: parse_dt(snapshot["time_utc"]),
    )
    baseline_equity = 0.0
    if eligible_snapshots:
        first_snapshot = eligible_snapshots[0]
        baseline_equity = float(first_snapshot.get("balance", first_snapshot.get("equity", 0.0)) or 0.0)
        if not baseline_equity:
            baseline_equity = float(first_snapshot.get("equity", 0.0) or 0.0)

    first_close = decorated[0][0]
    baseline_time = first_close - timedelta(seconds=1)
    points = [
        {
            "time_utc": baseline_time.isoformat(),
            "time_bj": baseline_time.astimezone(BEIJING_TZ).isoformat(),
            "equity": round(baseline_equity, 2),
            "cumulative_return": 0.0,
            "return_rate": 0.0,
            "trade_id": "baseline",
        }
    ]

    # Downsampling keeps the baseline plus an evenly-spaced subset of trade
    # points. The cumulative value still folds in every trade, so only the
    # intermediate resolution (and the isoformat/round cost) is reduced.
    trade_count = len(decorated)
    if max_points is not None and trade_count + 1 > max_points:
        keep = _sample_indices(trade_count, max_points - 1)
    else:
        keep = None

    cumulative = 0.0
    for index, (timestamp, beijing, trade) in enumerate(decorated):
        cumulative = round(cumulative + trade_net_pnl(trade), 2)
        if keep is not None and index not in keep:
            continue
        points.append(
            {
                "time_utc": timestamp.isoformat(),
                "time_bj": beijing.isoformat(),
                "equity": round(baseline_equity + cumulative, 2),
                "cumulative_return": cumulative,
                "return_rate": round(cumulative / baseline_equity * 100, 3) if baseline_equity else 0.0,
                "trade_id": str(trade.get("id", "")),
            }
        )
    return points


def _sample_indices(total: int, max_points: int) -> set[int]:
    """Return a set of evenly-spaced indices (inclusive of the first and last).

    Mirrors the frontend ``sampleCurvePoints`` stride so the browser renders the
    same shape when it re-samples the payload.
    """
    if total <= max_points:
        return set(range(total))
    indices: set[int] = set()
    for step in range(max_points):
        indices.add(round(step / (max_points - 1) * (total - 1)))
    return indices


def _empty_period(label: str) -> dict[str, Any]:
    return {
        "label": label,
        "net_pnl": 0.0,
        "order_count": 0,
        "_wins": 0,
        "win_rate": 0.0,
    }


def _empty_hour(hour: int) -> dict[str, Any]:
    period = _empty_period(f"{hour:02d}:00")
    period["hour"] = hour
    return period


def _add_trade(period: dict[str, Any], pnl: float) -> None:
    period["net_pnl"] = round(float(period.get("net_pnl", 0.0)) + pnl, 2)
    period["order_count"] = int(period.get("order_count", 0)) + 1
    if pnl > 0:
        period["_wins"] = int(period.get("_wins", 0)) + 1


def _finalize_period(period: dict[str, Any]) -> None:
    period["win_rate"] = _rate(int(period.get("_wins", 0)), int(period.get("order_count", 0)))
    period.pop("_wins", None)


def _rate(numerator: float, denominator: float) -> float:
    if not denominator:
        return 0.0
    return numerator / denominator


def _time_in_range(value: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= value < end
    return value >= start or value < end


def _format_window(start: time, end: time) -> str:
    return f"{start.strftime('%H:%M')}-{end.strftime('%H:%M')}"

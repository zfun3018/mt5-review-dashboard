from __future__ import annotations

from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from math import sqrt
from typing import Any

BEIJING_TZ = timezone(timedelta(hours=8))

DEFAULT_SESSIONS = {
    "asia": {"label": "Asia", "start": time(8, 0), "end": time(15, 0)},
    "europe": {"label": "Europe", "start": time(15, 0), "end": time(20, 0)},
    "us": {"label": "US", "start": time(20, 0), "end": time(2, 0)},
}


def trade_net_pnl(trade: dict[str, Any]) -> float:
    """Return realized P/L after all known trading costs."""
    return round(
        float(trade.get("pnl", 0.0) or 0.0)
        + float(trade.get("commission", 0.0) or 0.0)
        + float(trade.get("swap", 0.0) or 0.0)
        + float(trade.get("fee", 0.0) or 0.0),
        2,
    )


def build_trade_metrics(trades: list[dict[str, Any]]) -> dict[str, Any]:
    values = [trade_net_pnl(trade) for trade in trades]
    wins = [value for value in values if value > 0]
    losses = [value for value in values if value < 0]
    gross_profit = round(sum(wins), 2)
    gross_loss = round(abs(sum(losses)), 2)
    resolved = len(wins) + len(losses)
    avg_win = round(gross_profit / len(wins), 2) if wins else 0.0
    avg_loss = round(-gross_loss / len(losses), 2) if losses else 0.0
    return {
        "order_count": len(values),
        "resolved_count": resolved,
        "breakeven_count": len(values) - resolved,
        "net_pnl": round(sum(values), 2),
        "gross_profit": gross_profit,
        "gross_loss": gross_loss,
        "win_count": len(wins),
        "loss_count": len(losses),
        "win_rate": len(wins) / len(values) if values else 0.0,
        "profit_factor": round(gross_profit / gross_loss, 4) if gross_loss else None,
        "payoff_ratio": round(avg_win / abs(avg_loss), 4) if avg_loss else None,
        "max_profit": round(max(values), 2) if values else 0.0,
        "max_loss": round(min(values), 2) if values else 0.0,
        "avg_trade": round(sum(values) / len(values), 2) if values else 0.0,
        "avg_profit": avg_win,
        "avg_loss": avg_loss,
    }


def calculate_runs_z(trades: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(
        trades,
        key=lambda trade: (parse_dt(trade["close_time_utc"]), str(trade.get("id", ""))),
    )
    outcomes = [1 if trade_net_pnl(trade) > 0 else -1 for trade in ordered if trade_net_pnl(trade) != 0]
    n = len(outcomes)
    wins = sum(1 for outcome in outcomes if outcome > 0)
    losses = n - wins
    runs = sum(1 for index in range(1, n) if outcomes[index] != outcomes[index - 1]) + (1 if n else 0)
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


def parse_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def to_beijing(value: str | datetime) -> datetime:
    return parse_dt(value).astimezone(BEIJING_TZ)


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
        closed = to_beijing(trade["close_time_utc"])
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
        closed = to_beijing(trade["close_time_utc"])
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
        closed = to_beijing(trade["close_time_utc"])
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
) -> list[dict[str, Any]]:
    """Rebuild cumulative realized return from the supplied active trades.

    Snapshots provide only the starting capital used for the return-rate axis;
    they never contribute P/L points, so deleted trades cannot leak into this curve.
    """
    now = parse_dt(now_utc or datetime.now(timezone.utc))
    since = now - timedelta(hours=hours)
    range_start = date.fromisoformat(start_date) if start_date else None
    range_end = date.fromisoformat(end_date) if end_date else None
    if range_start and range_end and range_start > range_end:
        raise ValueError("start_date cannot be after end_date")

    def in_window(timestamp: datetime) -> bool:
        if range_start or range_end:
            point_date = timestamp.astimezone(BEIJING_TZ).date()
            return not (
                (range_start and point_date < range_start)
                or (range_end and point_date > range_end)
            )
        return since <= timestamp <= now

    ordered_trades = sorted(
        (
            trade
            for trade in trades
            if in_window(parse_dt(trade["close_time_utc"]))
        ),
        key=lambda trade: (parse_dt(trade["close_time_utc"]), str(trade.get("id", ""))),
    )
    if not ordered_trades:
        return []

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

    first_close = parse_dt(ordered_trades[0]["close_time_utc"])
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
    cumulative = 0.0
    for trade in ordered_trades:
        cumulative = round(cumulative + trade_net_pnl(trade), 2)
        timestamp = parse_dt(trade["close_time_utc"])
        points.append(
            {
                "time_utc": timestamp.isoformat(),
                "time_bj": timestamp.astimezone(BEIJING_TZ).isoformat(),
                "equity": round(baseline_equity + cumulative, 2),
                "cumulative_return": cumulative,
                "return_rate": round(cumulative / baseline_equity * 100, 3) if baseline_equity else 0.0,
                "trade_id": str(trade.get("id", "")),
            }
        )
    return points


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

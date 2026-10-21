from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

from .analytics import build_trade_metrics, to_beijing, trade_net_pnl
from ..platform_modules.domestic_futures_contracts import contract_display


def build_fixed_period_summaries(
    trades: list[dict[str, Any]], anchor: datetime, today: datetime | None = None
) -> dict[str, dict[str, Any]]:
    """Build fixed cards from a Beijing-today anchor, independent of filters."""
    anchor_date = to_beijing(today or anchor).date()
    windows = {
        "today": anchor_date,
        "week": anchor_date - timedelta(days=6),
        "month": anchor_date - timedelta(days=29),
        "quarter": anchor_date - timedelta(days=89),
        "year": anchor_date - timedelta(days=364),
    }
    result: dict[str, dict[str, Any]] = {}
    for key, start_date in windows.items():
        selected = [
            trade
            for trade in trades
            if start_date <= to_beijing(trade["close_time_utc"]).date() <= anchor_date
        ]
        result[key] = build_trade_metrics(selected)
    return result


def build_monthly_pnl(
    trades: list[dict[str, Any]], limit: int = 12
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for trade in trades:
        closed = to_beijing(trade["close_time_utc"])
        grouped[closed.strftime("%Y-%m")].append(trade)
    months = sorted(grouped)[-max(1, int(limit)) :]
    return [{"month": month, **build_trade_metrics(grouped[month])} for month in months]


def build_contract_rankings(
    trades: list[dict[str, Any]], limit: int = 10
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for trade in trades:
        symbol = str(trade.get("symbol") or "").strip()
        display = contract_display(symbol) if symbol else {
            "product_name": "未命名品种",
            "contract_name": "未命名合约",
        }
        enriched = dict(trade)
        enriched["product_name"] = display["product_name"]
        enriched["contract_name"] = display["contract_name"]
        grouped[display["contract_name"]].append(enriched)

    rows = []
    for contract_name, selected in grouped.items():
        metrics = build_trade_metrics(selected)
        rows.append(
            {
                "symbol": str(selected[0].get("symbol") or contract_name),
                "product_name": str(selected[0].get("product_name") or "未命名品种"),
                "contract_name": contract_name,
                **metrics,
            }
        )
    contribution = sorted(rows, key=lambda row: (-row["net_pnl"], row["contract_name"]))
    losses = sorted(
        (row for row in rows if row["net_pnl"] < 0),
        key=lambda row: (row["net_pnl"], row["contract_name"]),
    )
    return {
        "contribution": contribution[: max(1, int(limit))],
        "losses": losses[: max(1, int(limit))],
    }


def build_review_coverage(trades: list[dict[str, Any]]) -> dict[str, int]:
    total = len(trades)
    return {
        "total": total,
        # A review is complete when its initial risk plan exists. Review text
        # and screenshots remain useful quality signals, but are not the
        # completion criterion for the dashboard coverage metric.
        "reviewed": sum(1 for trade in trades if trade.get("has_initial_stop")),
        "with_screenshot": sum(1 for trade in trades if str(trade.get("screenshot_path") or "").strip()),
        "unclassified": sum(
            1
            for trade in trades
            if str(trade.get("trade_type") or "unclassified") == "unclassified"
            or str(trade.get("strategy") or "strategy_unclassified") == "strategy_unclassified"
        ),
    }


def build_risk_summary(trades: list[dict[str, Any]]) -> dict[str, Any]:
    """Return transparent, realized-result risk factors for the dashboard.

    This deliberately does not estimate margin or account-level liquidation
    risk because the analysis rows do not contain account equity, margin, or
    unrealized P/L. Drawdown is measured on the realized cumulative net P/L.
    """
    metrics = build_trade_metrics(trades)
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    current_loss_streak = 0
    longest_loss_streak = 0
    ordered = sorted(trades, key=lambda trade: to_beijing(trade["close_time_utc"]))
    for trade in ordered:
        value = trade_net_pnl(trade)
        cumulative += value
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        if value < 0:
            current_loss_streak += 1
            longest_loss_streak = max(longest_loss_streak, current_loss_streak)
        elif value > 0:
            current_loss_streak = 0

    fee_pressure = abs(metrics["fee_total"]) / max(abs(metrics["trade_pnl"]), 1.0)
    return {
        "sample_count": metrics["order_count"],
        "max_drawdown": round(max_drawdown, 2),
        "longest_loss_streak": longest_loss_streak,
        "max_loss": metrics["max_loss"],
        "gross_loss": metrics["gross_loss"],
        "fee_pressure": round(fee_pressure, 4),
        "profit_factor": metrics["profit_factor"],
        "win_rate": metrics["win_rate"],
    }

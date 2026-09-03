from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from .analytics import build_trade_metrics, calculate_runs_z, to_beijing
from .r_metrics import build_r_metrics


def campaign_cash_metrics(campaigns: list[dict[str, Any]]) -> dict[str, Any]:
    # Campaign rows already carry a precomputed `net_pnl` column, so they can be
    # fed straight into `build_trade_metrics` (which short-circuits on that key)
    # without building a throwaway dict per campaign.
    metrics = build_trade_metrics(campaigns)
    metrics["cash_win_rate"] = metrics["win_rate"]
    return metrics


def campaign_evaluation_row(
    campaigns: list[dict[str, Any]], threshold: float
) -> dict[str, Any]:
    r_metrics = build_r_metrics(campaigns, threshold)
    return {
        **campaign_cash_metrics(campaigns),
        "r_metrics": r_metrics,
        "z_score": r_metrics["z_score"],
    }


def build_daily_campaign_evaluation(
    campaigns: list[dict[str, Any]], threshold: float
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for campaign in campaigns:
        closed_at = campaign.get("closed_at_utc")
        if closed_at:
            closed_date = (campaign.get("_bj") or to_beijing(closed_at)).date()
            grouped.setdefault(closed_date.isoformat(), []).append(campaign)
    return [
        {"date": key, **campaign_evaluation_row(grouped[key], threshold)}
        for key in sorted(grouped)
    ]


def labeled_campaign_mode_evaluation(
    campaigns: list[dict[str, Any]],
    dimension: str,
    options: list[dict[str, Any]],
    threshold: float,
) -> list[dict[str, Any]]:
    if dimension not in {"trade_type", "strategy"}:
        raise ValueError("dimension must be trade_type or strategy")
    labels = {
        str(option["id"]): str(option["label"])
        for option in options
        if option["dimension"] == dimension
    }
    grouped: dict[str, list[dict[str, Any]]] = {}
    for campaign in campaigns:
        key = str(campaign.get(dimension) or "unclassified")
        grouped.setdefault(key, []).append(campaign)
    total = len(campaigns)
    return [
        {
            "key": key,
            "label": labels.get(key, key),
            "share": len(grouped[key]) / total if total else 0.0,
            **campaign_evaluation_row(grouped[key], threshold),
        }
        for key in sorted(grouped)
    ]


def build_campaign_period_metrics(
    campaigns: list[dict[str, Any]], anchor: datetime, threshold: float
) -> dict[str, dict[str, Any]]:
    anchor_date = to_beijing(anchor).date()
    week_start = anchor_date - timedelta(days=anchor_date.weekday())
    month_start = anchor_date.replace(day=1)
    year_start = anchor_date.replace(month=1, day=1)

    buckets: dict[str, list[dict[str, Any]]] = {
        "today": [],
        "week": [],
        "month": [],
        "year": [],
    }
    for campaign in campaigns:
        closed_at = campaign.get("closed_at_utc")
        if not closed_at:
            continue
        closed_date = (campaign.get("_bj") or to_beijing(closed_at)).date()
        if closed_date > anchor_date:
            continue
        if closed_date >= year_start:
            buckets["year"].append(campaign)
        if closed_date >= month_start:
            buckets["month"].append(campaign)
        if closed_date >= week_start:
            buckets["week"].append(campaign)
        if closed_date >= anchor_date:
            buckets["today"].append(campaign)

    return {
        key: build_r_metrics(buckets[key], threshold)
        for key in ("today", "week", "month", "year")
    }


def build_trade_period_summaries(
    trades: list[dict[str, Any]], anchor: datetime
) -> dict[str, dict[str, Any]]:
    anchor_date = to_beijing(anchor).date()
    week_start = anchor_date - timedelta(days=anchor_date.weekday())
    month_start = anchor_date.replace(day=1)
    year_start = anchor_date.replace(month=1, day=1)

    buckets: dict[str, list[dict[str, Any]]] = {
        "today": [],
        "week": [],
        "month": [],
        "year": [],
    }
    for trade in trades:
        closed_date = (trade.get("_bj") or to_beijing(trade["close_time_utc"])).date()
        if closed_date > anchor_date:
            continue
        if closed_date >= year_start:
            buckets["year"].append(trade)
        if closed_date >= month_start:
            buckets["month"].append(trade)
        if closed_date >= week_start:
            buckets["week"].append(trade)
        if closed_date >= anchor_date:
            buckets["today"].append(trade)

    return {
        key: _period_summary(buckets[key])
        for key in ("today", "week", "month", "year")
    }


def _period_summary(selected: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = build_trade_metrics(selected)
    metrics["z_score"] = calculate_runs_z(selected)
    return metrics

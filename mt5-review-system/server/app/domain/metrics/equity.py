"""Realized equity curve metrics."""

from __future__ import annotations

from datetime import datetime, timezone

from ..analytics import build_cumulative_return_curve, parse_dt, trade_net_pnl
from ..analysis_context import AnalysisContext
from ..metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def equity_definition() -> MetricDefinition:
    return MetricDefinition(
        key="equity_curve",
        definition_version=DEFINITION_VERSION,
        calculate=build_equity_result,
    )


def drawdown_definition() -> MetricDefinition:
    return MetricDefinition(
        key="max_drawdown",
        definition_version="1",
        calculate=build_max_drawdown_result,
    )


def build_equity_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    anchor = context.anchor_utc or _latest_activity_time(campaigns, list(context.equity_snapshots))
    equity_days = context.settings.get("equity_days")
    curve = build_cumulative_return_curve(
        campaigns,
        list(context.equity_snapshots),
        now_utc=anchor,
        hours=int(equity_days) * 24 if equity_days is not None else None,
        start_date=context.settings.get("start_date"),
        end_date=context.settings.get("end_date"),
        max_points=200,
    )
    return MetricResult(
        key="equity_curve",
        value=curve,
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if campaigns else 0.0,
    )


def build_max_drawdown_result(context: AnalysisContext) -> MetricResult:
    campaigns = sorted(
        context.campaigns,
        key=lambda campaign: parse_dt(
            campaign.get("close_time_utc") or campaign.get("closed_at_utc")
        ),
    )
    if not campaigns:
        return MetricResult(
            key="max_drawdown",
            value=None,
            unit="currency",
            status="insufficient_data",
            sample_count=0,
            definition_version="1",
            coverage=0.0,
        )

    cumulative = 0.0
    peak = 0.0
    max_amount = 0.0
    max_peak = 0.0
    max_trough = 0.0
    for campaign in campaigns:
        cumulative = round(cumulative + trade_net_pnl(campaign), 2)
        peak = max(peak, cumulative)
        amount = round(peak - cumulative, 2)
        if amount > max_amount:
            max_amount = amount
            max_peak = peak
            max_trough = cumulative

    return MetricResult(
        key="max_drawdown",
        value={"amount": max_amount, "peak": max_peak, "trough": max_trough},
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version="1",
        coverage=1.0,
    )


def _latest_activity_time(campaigns, snapshots):
    candidates = [row.get("close_time_utc") or row.get("closed_at_utc") for row in campaigns]
    candidates.extend(row.get("time_utc") for row in snapshots)
    candidates = [value for value in candidates if value]
    if not candidates:
        return datetime.now(timezone.utc)
    return max(parse_dt(value) for value in candidates)

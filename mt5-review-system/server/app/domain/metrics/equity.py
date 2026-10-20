"""Realized equity curve metrics."""

from __future__ import annotations

from datetime import datetime, timezone

from app.domain.analytics import build_cumulative_return_curve, parse_dt
from app.domain.analysis_context import AnalysisContext
from app.domain.metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def equity_definition() -> MetricDefinition:
    return MetricDefinition(
        key="equity_curve",
        definition_version=DEFINITION_VERSION,
        calculate=build_equity_result,
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


def _latest_activity_time(campaigns, snapshots):
    candidates = [row.get("close_time_utc") or row.get("closed_at_utc") for row in campaigns]
    candidates.extend(row.get("time_utc") for row in snapshots)
    candidates = [value for value in candidates if value]
    if not candidates:
        return datetime.now(timezone.utc)
    return max(parse_dt(value) for value in candidates)

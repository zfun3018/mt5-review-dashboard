"""Time-of-day, weekday, and session metrics."""

from __future__ import annotations

from app.domain.analytics import (
    build_hour_heatmap,
    build_session_stats,
    build_weekday_hour_heatmap,
)
from app.domain.analysis_context import AnalysisContext
from app.domain.metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def time_pattern_definitions() -> tuple[MetricDefinition, ...]:
    return (
        MetricDefinition(
            key="hour_heatmap",
            definition_version=DEFINITION_VERSION,
            calculate=build_hour_heatmap_result,
        ),
        MetricDefinition(
            key="weekday_hour_heatmap",
            definition_version=DEFINITION_VERSION,
            calculate=build_weekday_hour_heatmap_result,
        ),
        MetricDefinition(
            key="sessions",
            definition_version=DEFINITION_VERSION,
            calculate=build_sessions_result,
        ),
    )


def build_hour_heatmap_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    value = build_hour_heatmap(campaigns, anchor_utc=context.anchor_utc)
    return _result("hour_heatmap", value, len(campaigns))


def build_weekday_hour_heatmap_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    value = build_weekday_hour_heatmap(campaigns)
    return _result("weekday_hour_heatmap", value, len(campaigns))


def build_sessions_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    value = build_session_stats(campaigns)
    return _result("sessions", value, len(campaigns))


def _result(key: str, value, sample_count: int) -> MetricResult:
    return MetricResult(
        key=key,
        value=value,
        unit="currency",
        status="available",
        sample_count=sample_count,
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if sample_count else 0.0,
    )

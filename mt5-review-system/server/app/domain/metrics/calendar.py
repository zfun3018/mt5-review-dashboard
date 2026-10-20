"""Calendar and monthly P/L metrics."""

from __future__ import annotations

from app.domain.analytics import build_month_calendar
from app.domain.analysis_context import AnalysisContext
from app.domain.domestic_futures_dashboard import build_monthly_pnl
from app.domain.metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def calendar_definitions() -> tuple[MetricDefinition, ...]:
    return (
        MetricDefinition(
            key="calendar",
            definition_version=DEFINITION_VERSION,
            calculate=build_calendar_result,
        ),
        MetricDefinition(
            key="monthly_pnl",
            definition_version=DEFINITION_VERSION,
            calculate=build_monthly_pnl_result,
        ),
    )


def build_calendar_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.reference_campaigns or context.campaigns)
    value = build_month_calendar(
        campaigns,
        int(context.settings["selected_year"]),
        int(context.settings["selected_month"]),
    )
    return MetricResult(
        key="calendar",
        value=value,
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if campaigns else 0.0,
    )


def build_monthly_pnl_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    return MetricResult(
        key="monthly_pnl",
        value=build_monthly_pnl(campaigns),
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if campaigns else 0.0,
    )

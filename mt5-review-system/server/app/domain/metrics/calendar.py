"""Calendar and monthly P/L metrics."""

from __future__ import annotations

from ..analytics import build_month_calendar
from ..analysis_context import AnalysisContext
from ..domestic_futures_dashboard import build_monthly_pnl
from ..metric_contracts import MetricDefinition, MetricResult
from ...platforms import DOMESTIC_FUTURES_PLATFORM


DEFINITION_VERSION = "2"
MONTHLY_PNL_DEFINITION_VERSION = "2"


def calendar_definitions() -> tuple[MetricDefinition, ...]:
    return (
        MetricDefinition(
            key="calendar",
            definition_version=DEFINITION_VERSION,
            calculate=build_calendar_result,
        ),
        MetricDefinition(
            key="monthly_pnl",
            definition_version=MONTHLY_PNL_DEFINITION_VERSION,
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
    target_prefix = "domestic_futures" if context.platform == DOMESTIC_FUTURES_PLATFORM else "mt5"
    month_target = max(0.0, float(context.settings.get(f"{target_prefix}_monthly_target_pnl") or 0))
    daily_target = max(0.0, float(context.settings.get(f"{target_prefix}_daily_target_pnl") or 0))
    active_days = [day for day in value["days"].values() if day["order_count"] > 0]
    value.update({
        "month_target_pnl": month_target,
        "daily_target_pnl": daily_target,
        "month_target_completion_percent": (
            round(value["month_net_pnl"] / month_target * 100, 1)
            if month_target > 0 else None
        ),
        "daily_target_days_met": (
            sum(1 for day in active_days if day["net_pnl"] >= daily_target)
            if daily_target > 0 else None
        ),
        "daily_target_days_total": len(active_days),
    })
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
        value=build_monthly_pnl(
            campaigns,
            include_product_pnl=context.platform == DOMESTIC_FUTURES_PLATFORM,
        ),
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version=MONTHLY_PNL_DEFINITION_VERSION,
        coverage=1.0 if campaigns else 0.0,
    )

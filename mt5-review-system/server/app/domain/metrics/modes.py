"""Period and classification mode evaluation metrics."""

from __future__ import annotations

from datetime import datetime

from ..analysis_context import AnalysisContext
from ..dashboard import (
    build_campaign_period_metrics,
    build_daily_campaign_evaluation,
    build_trade_period_summaries,
    labeled_campaign_mode_evaluation,
)
from ..metric_contracts import MetricDefinition, MetricResult
from ..r_metrics import build_r_metrics


DEFINITION_VERSION = "1"


def mode_definitions() -> tuple[MetricDefinition, ...]:
    return (
        MetricDefinition(
            key="periods",
            definition_version=DEFINITION_VERSION,
            calculate=build_periods_result,
        ),
        MetricDefinition(
            key="system_evaluation",
            definition_version=DEFINITION_VERSION,
            calculate=build_system_evaluation_result,
        ),
        MetricDefinition(
            key="mode_evaluation",
            definition_version=DEFINITION_VERSION,
            calculate=build_mode_evaluation_result,
        ),
    )


def build_periods_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    anchor = _anchor(context)
    periods = build_trade_period_summaries(campaigns, anchor)
    for key, metrics in build_campaign_period_metrics(
        campaigns, anchor, _threshold(context)
    ).items():
        periods.setdefault(key, {})["r_metrics"] = metrics
    return _result("periods", periods, len(campaigns))


def build_system_evaluation_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    return _result(
        "system_evaluation",
        build_daily_campaign_evaluation(campaigns, _threshold(context)),
        len(campaigns),
    )


def build_mode_evaluation_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    options = list(context.settings.get("classification_options") or [])
    threshold = _threshold(context)
    value = {
        "trade_type": labeled_campaign_mode_evaluation(
            campaigns, "trade_type", options, threshold
        ),
        "strategy": labeled_campaign_mode_evaluation(
            campaigns, "strategy", options, threshold
        ),
    }
    return _result("mode_evaluation", value, len(campaigns))


def _threshold(context: AnalysisContext) -> float:
    return float(context.settings.get("scratch_threshold_r", 0.15))


def _anchor(context: AnalysisContext) -> datetime:
    if context.anchor_utc is not None:
        return context.anchor_utc
    for campaign in reversed(context.campaigns):
        close_time = campaign.get("closed_at_utc") or campaign.get("close_time_utc")
        if close_time:
            from ..analytics import parse_dt

            return parse_dt(close_time)
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


def _result(key: str, value, sample_count: int) -> MetricResult:
    return MetricResult(
        key=key,
        value=value,
        unit="mixed",
        status="available",
        sample_count=sample_count,
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if sample_count else 0.0,
    )

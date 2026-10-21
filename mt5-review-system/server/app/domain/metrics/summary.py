"""Campaign-level summary metrics."""

from __future__ import annotations

from ..analytics import build_trade_metrics
from ..analysis_context import AnalysisContext
from ..metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def summary_definition() -> MetricDefinition:
    return MetricDefinition(
        key="summary",
        definition_version=DEFINITION_VERSION,
        calculate=build_summary_result,
    )


def build_summary_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    return MetricResult(
        key="summary",
        value=build_trade_metrics(campaigns),
        unit="currency",
        status="available",
        sample_count=len(campaigns),
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if campaigns else 0.0,
    )

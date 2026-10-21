"""Domestic-futures-only dashboard metrics."""

from __future__ import annotations

from ..analytics import build_daily_system_evaluation
from ..analysis_context import AnalysisContext
from ..domestic_futures_dashboard import (
    build_contract_rankings,
    build_fixed_period_summaries,
    build_review_coverage,
    build_risk_summary,
)
from ..metric_contracts import MetricDefinition, MetricResult


DEFINITION_VERSION = "1"


def domestic_metric_definitions() -> tuple[MetricDefinition, ...]:
    return (
        MetricDefinition("fixed_periods", DEFINITION_VERSION, build_fixed_periods_result),
        MetricDefinition("contract_rankings", DEFINITION_VERSION, build_contract_rankings_result),
        MetricDefinition(
            "domestic_system_evaluation",
            DEFINITION_VERSION,
            build_domestic_system_evaluation_result,
        ),
        MetricDefinition("review_coverage", DEFINITION_VERSION, build_review_coverage_result),
        MetricDefinition("risk_summary", DEFINITION_VERSION, build_risk_summary_result),
    )


def build_fixed_periods_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.reference_campaigns or context.campaigns)
    if not _enabled(context, "show_fixed_periods"):
        return _not_applicable("fixed_periods", len(campaigns))
    anchor = context.anchor_utc
    if anchor is None:
        raise ValueError("fixed_periods requires anchor_utc")
    value = build_fixed_period_summaries(
        campaigns,
        anchor,
        today=context.settings.get(
            "fixed_period_anchor_utc",
            context.settings.get("fixed_review_day", anchor),
        ),
    )
    return _available("fixed_periods", value, len(campaigns))


def build_contract_rankings_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    if not _enabled(context, "show_contract_rankings"):
        return _not_applicable("contract_rankings", len(campaigns))
    return _available("contract_rankings", build_contract_rankings(campaigns), len(campaigns))


def build_domestic_system_evaluation_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    if not _enabled(context, "show_domestic_system_evaluation"):
        return _not_applicable("domestic_system_evaluation", len(campaigns))
    return _available(
        "domestic_system_evaluation",
        build_daily_system_evaluation(campaigns),
        len(campaigns),
    )


def build_review_coverage_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    if not _enabled(context, "show_review_coverage"):
        return _not_applicable("review_coverage", len(campaigns))
    return _available("review_coverage", build_review_coverage(campaigns), len(campaigns))


def build_risk_summary_result(context: AnalysisContext) -> MetricResult:
    campaigns = list(context.campaigns)
    if not _enabled(context, "show_risk_summary"):
        return _not_applicable("risk_summary", len(campaigns))
    return _available("risk_summary", build_risk_summary(campaigns), len(campaigns))


def _enabled(context: AnalysisContext, capability: str) -> bool:
    return bool(context.capabilities.get(capability, False))


def _available(key: str, value, sample_count: int) -> MetricResult:
    return MetricResult(
        key=key,
        value=value,
        unit="mixed",
        status="available",
        sample_count=sample_count,
        definition_version=DEFINITION_VERSION,
        coverage=1.0 if sample_count else 0.0,
    )


def _not_applicable(key: str, sample_count: int) -> MetricResult:
    return MetricResult(
        key=key,
        value=None,
        unit="mixed",
        status="not_applicable",
        sample_count=sample_count,
        definition_version=DEFINITION_VERSION,
    )

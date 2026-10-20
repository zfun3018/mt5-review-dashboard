from __future__ import annotations

import inspect
from contextlib import closing, nullcontext
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from ..data.database import connect
from ..domain.analytics import (
    build_cumulative_return_curve,
    build_daily_system_evaluation,
    build_hour_heatmap,
    build_month_calendar,
    build_session_stats,
    build_trade_metrics,
    parse_dt,
    to_beijing,
)
from ..domain.analysis_context import AnalysisContext
from ..domain.domestic_futures_dashboard import (
    build_contract_rankings,
    build_fixed_period_summaries,
    build_monthly_pnl,
    build_review_coverage,
    build_risk_summary,
)
from ..domain.dashboard import (
    build_campaign_period_metrics,
    build_daily_campaign_evaluation,
    build_trade_period_summaries,
    labeled_campaign_mode_evaluation,
)
from ..domain.r_metrics import build_r_metrics
from ..domain.metric_contracts import MetricDefinition, MetricResult
from ..domain.metric_registry import MetricRegistry
from . import AnalysisWindow


class DashboardService:
    def __init__(
        self,
        trades,
        campaigns,
        catalogs,
        settings,
        paths=None,
        metric_registry: MetricRegistry | None = None,
    ) -> None:
        self.trades = trades
        self.campaigns = campaigns
        self.catalogs = catalogs
        self.settings = settings
        self.paths = paths
        self.metric_registry = metric_registry or _build_legacy_metric_registry()

    def get_analysis(
        self, window: AnalysisWindow, year: int | None = None, month: int | None = None,
        platform: str = "mt5",
    ) -> dict[str, Any]:
        context = self._load_analysis_context(window, year, month, platform)
        report = self._build_analysis_report(context)
        return self._serialize_legacy_payload(report)

    def _load_analysis_context(
        self,
        window: AnalysisWindow,
        year: int | None,
        month: int | None,
        platform: str,
    ) -> AnalysisContext:
        # Open one shared connection for the whole analysis so the five
        # repository reads below don't each pay the connect() overhead
        # (sqlite3.connect + PRAGMA foreign_keys/busy_timeout/WAL). When `paths`
        # isn't configured (unit tests inject fakes), fall back to conn=None so
        # each repository opens its own connection as before.
        context = closing(connect(self.paths)) if self.paths is not None else nullcontext(None)
        with context as conn:
            snapshots_query = self.trades.list_equity_snapshots
            snapshot_kwargs = {"conn": conn}
            if "platform" in inspect.signature(snapshots_query).parameters:
                snapshot_kwargs["platform"] = platform
            snapshots = snapshots_query(**snapshot_kwargs)
            campaign_query = self.campaigns.query_analysis_rows
            campaign_kwargs = {"conn": conn}
            if "platform" in inspect.signature(campaign_query).parameters:
                campaign_kwargs["platform"] = platform
            campaign_rows = campaign_query(
                window.start_date, window.end_date, **campaign_kwargs
            )
            # Fixed-period cards and the calendar are deliberately independent
            # of the active analysis filter on both platforms. The filtered
            # rows still drive the range-sensitive metrics and charts below.
            all_campaign_rows = campaign_query(None, None, **campaign_kwargs)
            classification_options = self.catalogs.list_classifications(conn=conn)
            analysis_settings = self.settings.get_analysis_settings(conn=conn)
        anchor = (
            datetime.fromisoformat(f"{window.end_date}T23:59:59+08:00").astimezone(
                timezone.utc
            )
            if window.end_date
            else _latest_activity_time(campaign_rows, snapshots)
        )
        fixed_calendar_day = datetime.now(timezone.utc)
        fixed_review_day = fixed_calendar_day - timedelta(days=1)
        if platform == "domestic_futures":
            _decorate_contract_rows(campaign_rows)
            _decorate_contract_rows(all_campaign_rows)
        calendar_anchor = _latest_activity_time(all_campaign_rows, snapshots)
        selected_calendar = to_beijing(calendar_anchor)
        settings = dict(analysis_settings)
        settings.update(
            {
                "classification_options": tuple(classification_options),
                "selected_year": year or selected_calendar.year,
                "selected_month": month or selected_calendar.month,
                "equity_days": window.equity_days,
                "fixed_review_day": fixed_review_day,
                "start_date": window.start_date,
                "end_date": window.end_date,
            }
        )
        return AnalysisContext(
            campaigns=campaign_rows,
            reference_campaigns=all_campaign_rows,
            equity_snapshots=snapshots,
            window_start=_window_boundary(window.start_date),
            window_end=_window_boundary(window.end_date, end=True),
            anchor_utc=anchor,
            platform=platform,
            timezone="Asia/Shanghai",
            settings=settings,
            data_quality={
                "campaign_count": len(campaign_rows),
                "reference_campaign_count": len(all_campaign_rows),
                "snapshot_count": len(snapshots),
            },
        )

    def _build_analysis_report(self, context: AnalysisContext) -> dict[str, Any]:
        return {
            "context": context,
            "results": self.metric_registry.evaluate(context),
        }

    def _serialize_legacy_payload(self, report: dict[str, Any]) -> dict[str, Any]:
        context = report["context"]
        results = {result.key: result for result in report["results"]}
        payload = {
            "start_date": context.settings.get("start_date") or "",
            "end_date": context.settings.get("end_date") or "",
            "metrics": results["summary"].value,
            "r_metrics": results["r_metrics"].value,
            "periods": results["periods"].value,
            "equity": results["equity_curve"].value,
            "calendar": results["calendar"].value,
            "monthly_pnl": results["monthly_pnl"].value,
            "heatmap": results["hour_heatmap"].value,
            "sessions": results["sessions"].value,
            "system_evaluation": results["system_evaluation"].value,
            "mode_evaluation": results["mode_evaluation"].value,
            "metric_meta": {
                key: _serialize_metric_meta(result)
                for key, result in results.items()
            },
        }
        for key in (
            "fixed_periods",
            "contract_rankings",
            "domestic_system_evaluation",
            "review_coverage",
            "risk_summary",
        ):
            result = results[key]
            if result.status != "not_applicable":
                payload[key] = result.value
        return payload


def _decorate_contract_rows(rows: list[dict[str, Any]]) -> None:
    from ..platform_modules.domestic_futures_contracts import contract_display

    for row in rows:
        display = contract_display(str(row.get("symbol") or ""))
        row["product_name"] = row.get("product_name") or display["product_name"]
        row["contract_name"] = row.get("contract_name") or display["contract_name"]


def _window_boundary(value: str | None, *, end: bool = False) -> datetime | None:
    if not value:
        return None
    suffix = "23:59:59.999999" if end else "00:00:00"
    return datetime.fromisoformat(f"{value}T{suffix}+08:00").astimezone(timezone.utc)


def _serialize_metric_meta(result: MetricResult) -> dict[str, Any]:
    return {
        "status": result.status,
        "unit": result.unit,
        "sample_count": result.sample_count,
        "definition_version": result.definition_version,
        "coverage": result.coverage,
        "warnings": list(result.warnings),
    }


def _legacy_metric_result(
    key: str,
    value: Any,
    context: AnalysisContext,
    *,
    applicable: bool = True,
) -> MetricResult:
    if not applicable:
        return MetricResult(
            key=key,
            value=None,
            unit="mixed",
            status="not_applicable",
            sample_count=len(context.campaigns),
            definition_version="1",
            coverage=None,
        )
    sample_count = len(context.campaigns)
    return MetricResult(
        key=key,
        value=value,
        unit="mixed",
        status="available",
        sample_count=sample_count,
        definition_version="1",
        coverage=1.0 if sample_count else 0.0,
        warnings=("legacy compatibility calculation",),
    )


def _legacy_definition(
    key: str,
    calculate: Callable[[AnalysisContext], Any],
    *,
    platforms: tuple[str, ...] | None = None,
) -> MetricDefinition:
    def evaluate(context: AnalysisContext) -> MetricResult:
        applicable = platforms is None or context.platform in platforms
        if not applicable:
            return _legacy_metric_result(key, None, context, applicable=False)
        return _legacy_metric_result(key, calculate(context), context)

    return MetricDefinition(
        key=key,
        definition_version="1",
        calculate=evaluate,
    )


def _build_legacy_metric_registry() -> MetricRegistry:
    def rows(context: AnalysisContext) -> list[dict[str, Any]]:
        return list(context.campaigns)

    def reference_rows(context: AnalysisContext) -> list[dict[str, Any]]:
        return list(context.reference_campaigns or context.campaigns)

    def threshold(context: AnalysisContext) -> float:
        return float(context.settings["scratch_threshold_r"])

    def anchor(context: AnalysisContext) -> datetime:
        return context.anchor_utc or _latest_activity_time(rows(context), list(context.equity_snapshots))

    def build_periods(context: AnalysisContext) -> dict[str, dict[str, Any]]:
        result = build_trade_period_summaries(rows(context), anchor(context))
        for key, metrics in build_campaign_period_metrics(
            rows(context), anchor(context), threshold(context)
        ).items():
            result.setdefault(key, {})["r_metrics"] = metrics
        return result

    def build_mode_evaluation(context: AnalysisContext) -> dict[str, list[dict[str, Any]]]:
        options = list(context.settings.get("classification_options") or [])
        return {
            "trade_type": labeled_campaign_mode_evaluation(
                rows(context), "trade_type", options, threshold(context)
            ),
            "strategy": labeled_campaign_mode_evaluation(
                rows(context), "strategy", options, threshold(context)
            ),
        }

    return MetricRegistry(
        (
            _legacy_definition("summary", lambda context: build_trade_metrics(rows(context))),
            _legacy_definition("r_metrics", lambda context: build_r_metrics(rows(context), threshold(context))),
            _legacy_definition("periods", build_periods),
            _legacy_definition(
                "equity_curve",
                lambda context: build_cumulative_return_curve(
                    rows(context),
                    list(context.equity_snapshots),
                    now_utc=anchor(context),
                    hours=(
                        int(context.settings["equity_days"]) * 24
                        if context.settings.get("equity_days") is not None
                        else None
                    ),
                    start_date=context.settings.get("start_date"),
                    end_date=context.settings.get("end_date"),
                    max_points=200,
                ),
            ),
            _legacy_definition(
                "calendar",
                lambda context: build_month_calendar(
                    reference_rows(context),
                    int(context.settings["selected_year"]),
                    int(context.settings["selected_month"]),
                ),
            ),
            _legacy_definition("monthly_pnl", lambda context: build_monthly_pnl(rows(context))),
            _legacy_definition(
                "hour_heatmap",
                lambda context: build_hour_heatmap(rows(context), anchor_utc=anchor(context)),
            ),
            _legacy_definition("sessions", lambda context: build_session_stats(rows(context))),
            _legacy_definition(
                "system_evaluation",
                lambda context: build_daily_campaign_evaluation(rows(context), threshold(context)),
            ),
            _legacy_definition("mode_evaluation", build_mode_evaluation),
            _legacy_definition(
                "fixed_periods",
                lambda context: build_fixed_period_summaries(
                    reference_rows(context),
                    context.settings["fixed_review_day"],
                    today=context.settings["fixed_review_day"],
                ),
                platforms=("domestic_futures",),
            ),
            _legacy_definition(
                "contract_rankings",
                lambda context: build_contract_rankings(rows(context)),
                platforms=("domestic_futures",),
            ),
            _legacy_definition(
                "domestic_system_evaluation",
                lambda context: build_daily_system_evaluation(rows(context)),
                platforms=("domestic_futures",),
            ),
            _legacy_definition(
                "review_coverage",
                lambda context: build_review_coverage(rows(context)),
                platforms=("domestic_futures",),
            ),
            _legacy_definition(
                "risk_summary",
                lambda context: build_risk_summary(rows(context)),
                platforms=("domestic_futures",),
            ),
        )
    )

def _latest_activity_time(
    trades: list[dict[str, Any]], snapshots: list[dict[str, Any]]
) -> datetime:
    candidates = [trade["close_time_utc"] for trade in trades]
    candidates.extend(snapshot["time_utc"] for snapshot in snapshots)
    if not candidates:
        return datetime.now(timezone.utc)
    return max(parse_dt(value) for value in candidates)

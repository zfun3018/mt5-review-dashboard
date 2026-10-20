from __future__ import annotations

import inspect
from contextlib import closing, nullcontext
from datetime import datetime, timedelta, timezone
from typing import Any

from ..data.database import connect
from ..domain.analytics import (
    build_cumulative_return_curve,
    build_daily_system_evaluation,
    build_weekday_hour_heatmap,
    build_month_calendar,
    build_session_stats,
    build_trade_metrics,
    parse_dt,
    to_beijing,
)
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
from . import AnalysisWindow


class DashboardService:
    def __init__(self, trades, campaigns, catalogs, settings, paths=None) -> None:
        self.trades = trades
        self.campaigns = campaigns
        self.catalogs = catalogs
        self.settings = settings
        self.paths = paths

    def get_analysis(
        self, window: AnalysisWindow, year: int | None = None, month: int | None = None,
        platform: str = "mt5",
    ) -> dict[str, Any]:
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
            threshold = self.settings.get_analysis_settings(conn=conn)[
                "scratch_threshold_r"
            ]
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
        periods = build_trade_period_summaries(campaign_rows, anchor)
        for key, metrics in build_campaign_period_metrics(
            campaign_rows, anchor, threshold
        ).items():
            periods.setdefault(key, {})["r_metrics"] = metrics
        beijing_anchor = to_beijing(anchor)
        calendar_rows = all_campaign_rows
        calendar_anchor = _latest_activity_time(calendar_rows, snapshots)
        selected_calendar = to_beijing(calendar_anchor)
        selected_year = year or selected_calendar.year
        selected_month = month or selected_calendar.month
        result = {
            "start_date": window.start_date or "",
            "end_date": window.end_date or "",
            "metrics": build_trade_metrics(campaign_rows),
            "r_metrics": build_r_metrics(campaign_rows, threshold),
            "periods": periods,
            "equity": build_cumulative_return_curve(
                campaign_rows,
                snapshots,
                now_utc=anchor,
                hours=window.equity_days * 24 if window.equity_days is not None else None,
                start_date=window.start_date,
                end_date=window.end_date,
                max_points=200,
            ),
            "calendar": build_month_calendar(calendar_rows, selected_year, selected_month),
            "monthly_pnl": build_monthly_pnl(campaign_rows),
            "heatmap": build_weekday_hour_heatmap(campaign_rows),
            "sessions": build_session_stats(campaign_rows),
            "system_evaluation": build_daily_campaign_evaluation(
                campaign_rows, threshold
            ),
            "mode_evaluation": {
                "trade_type": labeled_campaign_mode_evaluation(
                    campaign_rows,
                    "trade_type",
                    classification_options,
                    threshold,
                ),
                "strategy": labeled_campaign_mode_evaluation(
                    campaign_rows,
                    "strategy",
                    classification_options,
                    threshold,
                ),
            },
        }
        if platform == "domestic_futures":
            result.update(
                {
                    "fixed_periods": build_fixed_period_summaries(
                        all_campaign_rows,
                        fixed_review_day,
                        today=fixed_review_day,
                    ),
                    "contract_rankings": build_contract_rankings(campaign_rows),
                    "domestic_system_evaluation": build_daily_system_evaluation(campaign_rows),
                    "review_coverage": build_review_coverage(campaign_rows),
                    "risk_summary": build_risk_summary(campaign_rows),
                }
            )
        return result


def _decorate_contract_rows(rows: list[dict[str, Any]]) -> None:
    from ..platform_modules.domestic_futures_contracts import contract_display

    for row in rows:
        display = contract_display(str(row.get("symbol") or ""))
        row["product_name"] = row.get("product_name") or display["product_name"]
        row["contract_name"] = row.get("contract_name") or display["contract_name"]

def _latest_activity_time(
    trades: list[dict[str, Any]], snapshots: list[dict[str, Any]]
) -> datetime:
    candidates = [trade["close_time_utc"] for trade in trades]
    candidates.extend(snapshot["time_utc"] for snapshot in snapshots)
    if not candidates:
        return datetime.now(timezone.utc)
    return max(parse_dt(value) for value in candidates)

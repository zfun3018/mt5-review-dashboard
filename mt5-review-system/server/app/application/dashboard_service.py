from __future__ import annotations

from contextlib import closing, nullcontext
from datetime import datetime, timezone
from typing import Any

from ..data.database import connect
from ..domain.analytics import (
    build_cumulative_return_curve,
    build_hour_heatmap,
    build_month_calendar,
    build_session_stats,
    build_trade_metrics,
    parse_dt,
    to_beijing,
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
        self, window: AnalysisWindow, year: int | None = None, month: int | None = None
    ) -> dict[str, Any]:
        # Open one shared connection for the whole analysis so the five
        # repository reads below don't each pay the connect() overhead
        # (sqlite3.connect + PRAGMA foreign_keys/busy_timeout/WAL). When `paths`
        # isn't configured (unit tests inject fakes), fall back to conn=None so
        # each repository opens its own connection as before.
        context = closing(connect(self.paths)) if self.paths is not None else nullcontext(None)
        with context as conn:
            trade_rows = self.trades.query_analysis_rows(
                window.start_date, window.end_date, conn=conn
            )
            snapshots = self.trades.list_equity_snapshots(conn=conn)
            campaign_rows = self.campaigns.query_analysis_rows(
                window.start_date, window.end_date, conn=conn
            )
            classification_options = self.catalogs.list_classifications(conn=conn)
            threshold = self.settings.get_analysis_settings(conn=conn)[
                "scratch_threshold_r"
            ]
        anchor = (
            datetime.fromisoformat(f"{window.end_date}T23:59:59+08:00").astimezone(
                timezone.utc
            )
            if window.end_date
            else _latest_activity_time(trade_rows, snapshots)
        )
        periods = build_trade_period_summaries(trade_rows, anchor)
        for key, metrics in build_campaign_period_metrics(
            campaign_rows, anchor, threshold
        ).items():
            periods.setdefault(key, {})["r_metrics"] = metrics
        beijing_anchor = to_beijing(anchor)
        selected_year = year or beijing_anchor.year
        selected_month = month or beijing_anchor.month
        return {
            "start_date": window.start_date or "",
            "end_date": window.end_date or "",
            "metrics": build_trade_metrics(trade_rows),
            "r_metrics": build_r_metrics(campaign_rows, threshold),
            "periods": periods,
            "equity": build_cumulative_return_curve(
                trade_rows,
                snapshots,
                now_utc=anchor,
                hours=window.equity_days * 24,
                start_date=window.start_date,
                end_date=window.end_date,
                max_points=200,
            ),
            "calendar": build_month_calendar(trade_rows, selected_year, selected_month),
            "heatmap": build_hour_heatmap(trade_rows, anchor_utc=anchor, days=7),
            "sessions": build_session_stats(trade_rows),
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

def _latest_activity_time(
    trades: list[dict[str, Any]], snapshots: list[dict[str, Any]]
) -> datetime:
    candidates = [trade["close_time_utc"] for trade in trades]
    candidates.extend(snapshot["time_utc"] for snapshot in snapshots)
    if not candidates:
        return datetime.now(timezone.utc)
    return max(parse_dt(value) for value in candidates)

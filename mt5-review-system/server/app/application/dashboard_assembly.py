from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from ..core.config import get_runtime_paths
from ..data.campaign_repository import CampaignRepository
from ..data.catalog_commands import list_trends
from ..data.catalog_repository import CatalogRepository
from ..data.ingestion_repository import list_equity_snapshots
from ..data.maintenance_repository import _read_backups, _read_local_status
from ..data.trade_commands import list_trades
from ..domain.analytics import (
    build_cumulative_return_curve,
    build_equity_curve,
    build_hour_heatmap,
    build_month_calendar,
    build_session_stats,
    build_trade_metrics,
    to_beijing,
)
from ..domain.dashboard import (
    build_campaign_period_metrics,
    build_daily_campaign_evaluation,
    build_trade_period_summaries,
    labeled_campaign_mode_evaluation,
)
from ..domain.r_metrics import build_r_metrics
from .campaign_response import CampaignResponseSerializer


def db():
    from ..data.database import transaction

    return transaction(get_runtime_paths())


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def list_classification_options(active_only: bool = True) -> list[dict[str, Any]]:
    return CatalogRepository(get_runtime_paths()).list_classifications(active_only=active_only)


def list_custom_fields(active_only: bool = True) -> list[dict[str, Any]]:
    return CatalogRepository(get_runtime_paths()).list_custom_fields(active_only=active_only)


def get_analysis_settings():
    return CatalogRepository(get_runtime_paths()).get_analysis_settings()


def get_local_status():
    return _read_local_status()


def list_backups():
    return _read_backups()


def _campaign_records_conn(conn):
    return _campaign_repository().records(conn=conn)


def get_dashboard(
    year: int | None = None,
    month: int | None = None,
    *,
    trade_serializer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    campaign_serializer: CampaignResponseSerializer | None = None,
) -> dict[str, Any]:
    trades = list_trades()
    serialize_trade = trade_serializer or dict
    serialize_campaign = campaign_serializer or CampaignResponseSerializer(serialize_trade)
    snapshots = list_equity_snapshots()
    # Surface only active classifications + custom fields across all downstream
    # surfaces (filters, dashboards, mode evaluation, custom field columns).
    # Inactive entries are kept for label lookups and historical aggregation.
    classification_options = list_classification_options(active_only=True)
    custom_fields = list_custom_fields(active_only=True)
    with db() as conn:
        campaigns = [record for record in _campaign_records_conn(conn) if record.get("status") == "closed"]
    threshold = get_analysis_settings()["scratch_threshold_r"]
    anchor = _latest_activity_time(trades, snapshots)
    target = to_beijing(anchor)
    selected_year = year or target.year
    selected_month = month or target.month

    periods = build_trade_period_summaries(trades, anchor)
    period_r_metrics = build_campaign_period_metrics(campaigns, anchor, threshold)
    for key, metrics in period_r_metrics.items():
        periods.setdefault(key, {})["r_metrics"] = metrics
    return {
        "summary": build_summary(trades, snapshots, anchor),
        "status": get_local_status(),
        "trends": list_trends(),
        "custom_fields": custom_fields,
        "classification_options": classification_options,
        "trades": [serialize_trade(trade) for trade in trades],
        "campaigns": [
            serialize_campaign.serialize_campaign(record, include_positions=False)
            for record in campaigns
        ],
        "r_metrics": build_r_metrics(campaigns, threshold),
        "periods": periods,
        "equity": build_cumulative_return_curve(trades, snapshots, now_utc=anchor, hours=24 * 30),
        "calendar": build_month_calendar(trades, selected_year, selected_month),
        "heatmap": build_hour_heatmap(trades, anchor_utc=anchor, days=7),
        "sessions": build_session_stats(trades),
        "system_evaluation": build_daily_campaign_evaluation(campaigns, threshold),
        "mode_evaluation": {
            "trade_type": labeled_campaign_mode_evaluation(
                campaigns, "trade_type", classification_options, threshold
            ),
            "strategy": labeled_campaign_mode_evaluation(
                campaigns, "strategy", classification_options, threshold
            ),
        },
        "backups": list_backups(),
    }


def build_summary(
    trades: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    anchor_utc: datetime | None = None,
) -> dict[str, Any]:
    anchor = anchor_utc or _latest_activity_time(trades, snapshots)
    overall = build_trade_metrics(trades)
    recent_curve = build_equity_curve(
        snapshots,
        now_utc=anchor,
        hours=24 * 30,
    )
    latest_equity = recent_curve[-1]["equity"] if recent_curve else 0.0
    first_equity = recent_curve[0]["equity"] if recent_curve else latest_equity
    curve_delta = round(float(latest_equity) - float(first_equity), 2)
    open_reviews = sum(1 for trade in trades if not trade.get("review_text"))
    periods = build_period_summaries(trades, anchor)
    today = periods["today"]
    week = periods["week"]
    month = periods["month"]
    year = periods["year"]

    return {
        "account": trades[0]["account"] if trades else "LOCAL-DEMO",
        "net_pnl": overall["net_pnl"],
        "order_count": overall["order_count"],
        "win_rate": overall["win_rate"],
        "profit_factor": overall["profit_factor"],
        "payoff_ratio": overall["payoff_ratio"],
        "gross_profit": overall["gross_profit"],
        "gross_loss": overall["gross_loss"],
        "max_profit": overall["max_profit"],
        "max_loss": overall["max_loss"],
        "avg_trade": overall["avg_trade"],
        "today": today,
        "week": week,
        "month": month,
        "year": year,
        "week_net_pnl": week["net_pnl"],
        "week_order_count": week["order_count"],
        "week_win_rate": week["win_rate"],
        "month_net_pnl": month["net_pnl"],
        "month_order_count": month["order_count"],
        "month_win_rate": month["win_rate"],
        "latest_equity": latest_equity,
        "curve_delta": curve_delta,
        "open_reviews": open_reviews,
        "storage_mode": "local",
    }


def build_period_summaries(trades: list[dict[str, Any]], anchor: datetime) -> dict[str, dict[str, Any]]:
    return build_trade_period_summaries(trades, anchor)


def _latest_activity_time(trades: list[dict[str, Any]], snapshots: list[dict[str, Any]]) -> datetime:
    candidates = []
    if trades:
        candidates.append(max(trade["close_time_utc"] for trade in trades))
    if snapshots:
        candidates.append(max(snapshot["time_utc"] for snapshot in snapshots))
    if not candidates:
        return datetime.now(timezone.utc)
    return max(datetime.fromisoformat(str(value)) for value in candidates)

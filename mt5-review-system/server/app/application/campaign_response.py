from __future__ import annotations

from typing import Any, Callable

from ..domain.analytics import to_beijing
from ..domain.campaigns import calculate_position_risk


TradeSerializer = Callable[[dict[str, Any]], dict[str, Any]]


class CampaignResponseSerializer:
    def __init__(self, trade_serializer: TradeSerializer | None = None) -> None:
        self.trade_serializer = trade_serializer or dict

    def serialize_position(self, position: dict[str, Any]) -> dict[str, Any]:
        serialized = dict(position)
        sources = [
            self.trade_serializer(source)
            for source in position.get("source_trades") or []
        ]
        serialized["source_trades"] = sources
        serialized["source_trade"] = sources[-1] if sources else None
        if sources:
            representative = sources[-1]
            for key in (
                "review_text",
                "custom_fields",
                "screenshot_url",
                "trade_type",
                "strategy",
            ):
                serialized[key] = representative.get(key)
        raw_id = str(serialized.get("position_id") or "")
        position_pnl = round(
            sum(
                float(deal.get("profit") or 0.0)
                for deal in serialized.get("exit_deals") or []
            ),
            2,
        )
        return {
            **serialized,
            **calculate_position_risk(serialized),
            "display_position_id": f"••••{raw_id[-4:]}" if len(raw_id) > 4 else raw_id,
            "position_pnl": position_pnl,
        }

    def serialize_position_summary(
        self, position: dict[str, Any]
    ) -> dict[str, Any]:
        serialized = self.serialize_position(position)
        keys = (
            "id",
            "position_id",
            "display_position_id",
            "side",
            "entry_volume",
            "exit_volume",
            "weighted_entry_price",
            "weighted_exit_price",
            "holding_seconds",
            "initial_stop_price",
            "partial_exit_count",
            "reconstruction_status",
            "planned_risk",
            "result",
            "position_pnl",
            "position_r",
            "risk_status",
            "risk_missing_reason",
            "source_trade",
            "review_text",
            "custom_fields",
            "screenshot_url",
            "trade_type",
            "strategy",
        )
        return {key: serialized.get(key) for key in keys}

    def serialize_campaign(
        self, record: dict[str, Any], *, include_positions: bool
    ) -> dict[str, Any]:
        serialized = {key: value for key, value in record.items() if key != "positions"}
        campaign_id = str(serialized.get("id") or "")
        serialized["display_order_kind"] = "Campaign"
        serialized["display_order_no"] = campaign_id[:8]
        serialized["campaign_total_pnl"] = float(serialized.get("net_pnl") or 0.0)
        serialized["net_pnl"] = float(serialized.get("net_pnl") or 0.0)
        serialized["open_time_utc"] = serialized.get("opened_at_utc")
        serialized["close_time_utc"] = serialized.get("closed_at_utc")
        serialized["position_summaries"] = [
            self.serialize_position_summary(position)
            for position in record.get("positions", [])
        ]
        if record.get("opened_at_utc"):
            serialized["open_time_bj"] = to_beijing(
                record["opened_at_utc"]
            ).isoformat()
        if record.get("closed_at_utc"):
            serialized["close_time_bj"] = to_beijing(
                record["closed_at_utc"]
            ).isoformat()
        serialized["risk_missing_label"] = {
            "complete": "",
            "missing": "R 缺失",
            "invalid": "止损方向无效",
            "incomplete": "成交数据不完整",
        }.get(str(record.get("risk_status")), "R 数据不完整")
        if include_positions:
            serialized["positions"] = [
                self.serialize_position(position)
                for position in record.get("positions", [])
            ]
        return serialized

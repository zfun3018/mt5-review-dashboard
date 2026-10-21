from __future__ import annotations

from typing import Any, Callable

from ..domain.analytics import to_beijing
from ..domain.campaigns import calculate_position_risk
from ..core.config import get_runtime_paths
from ..data.media_repository import MediaRepository
from ..platform_modules.domestic_futures_contracts import contract_display
from ..platforms import DOMESTIC_FUTURES_PLATFORM


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
        serialized["import_sources"] = _merge_import_sources(sources)
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
        serialized.update(_campaign_contract_display(record))
        campaign_id = str(serialized.get("id") or "")
        serialized["display_order_kind"] = "Campaign"
        serialized["display_order_no"] = campaign_id[:8]
        serialized["campaign_total_pnl"] = float(serialized.get("net_pnl") or 0.0)
        serialized["net_pnl"] = float(serialized.get("net_pnl") or 0.0)
        serialized["import_sources"] = _merge_import_sources(
            source
            for position in record.get("positions", [])
            for source in position.get("source_trades", [])
        )
        screenshot_source, screenshot_path, screenshot_missing = _campaign_screenshot(
            record,
            MediaRepository(get_runtime_paths()),
        )
        serialized["screenshot_source"] = screenshot_source
        serialized["screenshot_missing"] = screenshot_missing
        serialized["screenshot_url"] = f"/media/{screenshot_path}" if screenshot_path else ""
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


def _campaign_screenshot(
    record: dict[str, Any], media: MediaRepository
) -> tuple[str, str, bool]:
    """Resolve one stable screenshot for a merged campaign.

    Older records may still keep the image on a source Trade even though the
    campaign is now the canonical review unit. Prefer the campaign image, then
    the first existing source image in repository order.
    """
    candidates: list[tuple[str, str]] = []
    campaign_path = str(record.get("screenshot_path") or "").strip()
    if campaign_path:
        candidates.append(("campaign", campaign_path))
    for position in record.get("positions") or []:
        for source in position.get("source_trades") or []:
            source_path = str(source.get("screenshot_path") or "").strip()
            if source_path and ("source_trade", source_path) not in candidates:
                candidates.append(("source_trade", source_path))

    for source, path in candidates:
        normalized = media.normalize_relative_path(path)
        if normalized and media.exists(normalized):
            return source, normalized, False
    return "", "", bool(candidates)


def _merge_import_sources(sources) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for source in sources:
        for item in source.get("import_sources") or []:
            batch_id = str(item.get("batch_id") or "")
            if not batch_id:
                continue
            current = merged.setdefault(batch_id, {**item})
            current["source_rows"] = sorted(
                set(current.get("source_rows") or [])
                | set(item.get("source_rows") or [])
            )
            current["execution_ids"] = sorted(
                set(current.get("execution_ids") or [])
                | set(item.get("execution_ids") or [])
            )
            current["trade_ids"] = sorted(
                set(current.get("trade_ids") or [])
                | set(item.get("trade_ids") or [])
            )
    return sorted(
        merged.values(),
        key=lambda item: (
            str(item.get("started_at") or ""),
            str(item.get("batch_id") or ""),
        ),
    )


def _campaign_contract_display(record: dict[str, Any]) -> dict[str, str]:
    """Expose human-readable contract fields without changing the stable symbol code."""
    source_trades = [
        source
        for position in record.get("positions", [])
        for source in position.get("source_trades", [])
        if isinstance(source, dict)
    ]
    representative = source_trades[-1] if source_trades else {}
    symbol = str(record.get("symbol") or representative.get("symbol") or "")
    if str(record.get("platform") or "mt5") == DOMESTIC_FUTURES_PLATFORM:
        display = contract_display(symbol)
        return {
            "product_name": display["product_name"],
            "contract_name": display["contract_name"],
            "display_symbol": display["contract_name"],
        }
    product_name = str(
        representative.get("product_name") or record.get("product_name") or ""
    )
    contract_name = str(
        representative.get("contract_name") or record.get("contract_name") or ""
    )
    return {
        "product_name": product_name,
        "contract_name": contract_name,
        "display_symbol": contract_name or product_name or symbol,
    }

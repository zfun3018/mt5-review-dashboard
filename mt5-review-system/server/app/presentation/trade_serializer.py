from __future__ import annotations

import sqlite3
from typing import Any

from ..core.config import get_runtime_paths
from ..data.catalog_repository import CatalogRepository
from ..data.media_repository import MediaRepository
from ..domain.analytics import to_beijing, trade_net_pnl
from ..platform_modules.domestic_futures_contracts import contract_display
from ..platforms import DOMESTIC_FUTURES_PLATFORM


runtime_paths = get_runtime_paths


def _serialize_trade(
    row: sqlite3.Row,
    custom_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    trade = dict(row)
    if str(trade.get("platform") or "mt5") == DOMESTIC_FUTURES_PLATFORM:
        display = contract_display(str(trade.get("symbol") or ""))
        trade["product_name"] = display["product_name"]
        trade["contract_name"] = display["contract_name"]
        trade["display_symbol"] = display["contract_name"]
    trade["net_pnl"] = trade_net_pnl(trade)
    trade["open_time_bj"] = to_beijing(trade["open_time_utc"]).isoformat()
    trade["close_time_bj"] = to_beijing(trade["close_time_utc"]).isoformat()
    trade["duration_label"] = _duration_label(int(trade["duration_seconds"]))
    display_kind, display_no = _display_order_number(trade)
    trade["display_order_kind"] = display_kind
    trade["display_order_no"] = display_no
    trade["custom_fields"] = (custom_values or {}).get(trade["id"], {})
    trade["session_label"] = _trade_session_label(trade["close_time_utc"])
    screenshot_exists = MediaRepository(runtime_paths()).exists(
        str(trade.get("screenshot_path") or "")
    )
    trade["screenshot_missing"] = bool(trade["screenshot_path"]) and not screenshot_exists
    if screenshot_exists:
        trade["screenshot_url"] = f"/media/{trade['screenshot_path']}"
    else:
        trade["screenshot_url"] = ""
    return trade


def _custom_values_for_trade_ids(
    conn: sqlite3.Connection,
    trade_ids: list[str],
) -> dict[str, dict[str, Any]]:
    return CatalogRepository(runtime_paths()).custom_values_for_trade_ids(
        conn, trade_ids
    )


def _display_order_number(trade: dict[str, Any]) -> tuple[str, str]:
    for kind, key in (("Order", "order_no"), ("Deal", "deal_ticket"), ("Position", "position_id")):
        value = str(trade.get(key) or "").strip()
        if value and value not in {"0", "None", "null"}:
            return kind, value
    return "Trade", str(trade.get("id", ""))


def _trade_session_label(close_time_utc: str) -> str:
    close_time = to_beijing(close_time_utc).time()
    minutes = close_time.hour * 60 + close_time.minute
    if 8 * 60 <= minutes < 15 * 60:
        return "亚盘"
    if 15 * 60 <= minutes < 20 * 60:
        return "欧盘"
    if minutes >= 20 * 60 or minutes < 2 * 60:
        return "美盘"
    return "其他"


def _duration_label(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"

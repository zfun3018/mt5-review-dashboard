from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import base64
import binascii
import json
import mimetypes
import uuid
from typing import Any

from ..domain.analytics import calculate_duration_seconds
from ..domain.analytics import to_beijing
from ..platforms import normalize_platform
from .campaign_repository import CampaignRepository
from .catalog_commands import _ensure_classification_option, _validate_classification_assignment
from .catalog_repository import CatalogRepository
from .import_repository import import_sources_for_trade_ids


MAX_MANUAL_SCREENSHOT_BYTES = 15 * 1024 * 1024
SCREENSHOT_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def _custom_values_for_trade_ids(
    conn: sqlite3.Connection,
    trade_ids: list[str],
) -> dict[str, dict[str, Any]]:
    return CatalogRepository(get_runtime_paths()).custom_values_for_trade_ids(
        conn, trade_ids
    )


def list_trades(include_deleted: bool = False, platform: str = "mt5") -> list[dict[str, Any]]:
    with db() as conn:
        deleted_clause = "" if include_deleted else "trades.deleted_at IS NULL AND "
        rows = conn.execute(
            f"""
            SELECT trades.*, trends.name AS trend_name, trends.color AS trend_color
            FROM trades
            LEFT JOIN trends ON trends.id = trades.trend_id
            WHERE {deleted_clause} trades.platform = ?
            ORDER BY trades.close_time_utc DESC
            """,
            (platform,),
        ).fetchall()
        custom_values = _custom_values_for_trade_ids(conn, [row["id"] for row in rows])
        import_sources = import_sources_for_trade_ids(conn, [row["id"] for row in rows])
    result = [dict(row) for row in rows]
    for row in result:
        row["custom_fields"] = custom_values.get(str(row["id"]), {})
        row["import_sources"] = import_sources.get(str(row["id"]), [])
    return result


def get_trade(
    trade_id: str,
    include_deleted: bool = False,
    platform: str = "mt5",
) -> dict[str, Any] | None:
    with db() as conn:
        deleted_clause = "" if include_deleted else "AND trades.deleted_at IS NULL"
        row = conn.execute(
            f"""
            SELECT trades.*, trends.name AS trend_name, trends.color AS trend_color
            FROM trades
            LEFT JOIN trends ON trends.id = trades.trend_id
            WHERE trades.id = ? AND trades.platform = ? {deleted_clause}
            """,
            (trade_id, normalize_platform(platform)),
        ).fetchone()
        custom_values = _custom_values_for_trade_ids(conn, [row["id"]]) if row else {}
        import_sources = import_sources_for_trade_ids(conn, [row["id"]]) if row else {}
    if not row:
        return None
    result = dict(row)
    result["custom_fields"] = custom_values.get(str(result["id"]), {})
    result["import_sources"] = import_sources.get(str(result["id"]), [])
    return result


def replace_trade_screenshot(
    trade_id: str,
    payload: dict[str, Any],
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    image_bytes, extension = _decode_manual_screenshot(payload)
    new_path = f"screenshots/manual-{uuid.uuid4().hex}{extension}"
    new_file = get_runtime_paths().data / new_path
    new_file.parent.mkdir(parents=True, exist_ok=True)
    new_file.write_bytes(image_bytes)

    try:
        with db() as conn:
            current = conn.execute(
                "SELECT id, screenshot_path, raw_json FROM trades WHERE id = ? AND platform = ? AND deleted_at IS NULL",
                (trade_id, normalized_platform),
            ).fetchone()
            if not current:
                raise KeyError(trade_id)
            old_path = str(current["screenshot_path"] or "")
            raw_json = _raw_json_with_screenshot_path(current["raw_json"], new_path)
            conn.execute(
                """
                UPDATE trades
                SET screenshot_path = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND platform = ?
                """,
                (new_path, raw_json, trade_id, normalized_platform),
            )
            _refresh_campaign_presentation_conn(
                conn, trade_id, clear_screenshot=True
            )
    except Exception:
        new_file.unlink(missing_ok=True)
        raise

    _remove_unreferenced_screenshot(old_path, trade_id)
    trade = get_trade(trade_id, platform=normalized_platform)
    if not trade:
        raise KeyError(trade_id)
    return trade


def delete_trade_screenshot(trade_id: str, platform: str = "mt5") -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        current = conn.execute(
            "SELECT id, screenshot_path, raw_json FROM trades WHERE id = ? AND platform = ? AND deleted_at IS NULL",
            (trade_id, normalized_platform),
        ).fetchone()
        if not current:
            raise KeyError(trade_id)
        old_path = str(current["screenshot_path"] or "")
        raw_json = _raw_json_with_screenshot_path(current["raw_json"], "")
        conn.execute(
            """
            UPDATE trades
            SET screenshot_path = '', raw_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ?
            """,
            (raw_json, trade_id, normalized_platform),
        )
        _refresh_campaign_presentation_conn(conn, trade_id, clear_screenshot=True)

    _remove_unreferenced_screenshot(old_path, trade_id)
    trade = get_trade(trade_id, platform=normalized_platform)
    if not trade:
        raise KeyError(trade_id)
    return trade


def _decode_manual_screenshot(payload: dict[str, Any]) -> tuple[bytes, str]:
    raw_data = str(payload.get("image_data", "")).strip()
    if not raw_data:
        raise ValueError("Screenshot image data is required")
    mime = ""
    encoded = raw_data
    if raw_data.startswith("data:"):
        header, separator, encoded = raw_data.partition(",")
        if not separator or ";base64" not in header:
            raise ValueError("Screenshot must be a base64 data URL")
        mime = header[5:].split(";", 1)[0].lower()
    if not mime:
        filename = str(payload.get("filename", "")).strip()
        mime = mimetypes.guess_type(filename)[0] or ""
    extension = SCREENSHOT_MIME_EXTENSIONS.get(mime)
    if not extension:
        raise ValueError("Unsupported screenshot format")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid screenshot image data") from exc
    if not image_bytes:
        raise ValueError("Screenshot image data is empty")
    if len(image_bytes) > MAX_MANUAL_SCREENSHOT_BYTES:
        raise ValueError("Screenshot image is too large")
    return image_bytes, extension


def _raw_json_with_screenshot_path(raw_json: Any, screenshot_path: str) -> str:
    try:
        parsed = json.loads(str(raw_json or "{}"))
    except (TypeError, json.JSONDecodeError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    parsed["screenshot_path"] = screenshot_path
    return json.dumps(parsed, ensure_ascii=False)


def _remove_unreferenced_screenshot(path_value: str, trade_id: str) -> None:
    relative = str(path_value or "").replace("\\", "/").strip()
    if not relative:
        return
    candidate = (get_runtime_paths().data / relative).resolve()
    screenshot_root = get_runtime_paths().screenshots.resolve()
    if not candidate.is_relative_to(screenshot_root) or not candidate.is_file():
        return
    with db() as conn:
        references = conn.execute(
            "SELECT COUNT(*) AS count FROM trades WHERE screenshot_path = ? AND id != ?",
            (relative, trade_id),
        ).fetchone()["count"]
    if not references:
        candidate.unlink(missing_ok=True)


def _refresh_campaign_presentation_conn(
    conn: sqlite3.Connection,
    trade_id: str,
    *,
    clear_review: bool = False,
    clear_screenshot: bool = False,
) -> None:
    assignments = []
    if clear_review:
        assignments.append("review_text = ''")
    if clear_screenshot:
        assignments.append("screenshot_path = ''")
    if assignments:
        conn.execute(
            f"""
            UPDATE trade_campaigns
            SET {', '.join(assignments)}, updated_at = CURRENT_TIMESTAMP
            WHERE id IN (
                SELECT campaign_id FROM campaign_source_trades WHERE trade_id = ?
            )
            """,
            (trade_id,),
        )
    _campaign_repository().rebuild(conn=conn)


def update_trade_review(
    trade_id: str,
    payload: dict[str, Any],
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        existing = conn.execute(
            "SELECT id, review_text, trend_id, trade_type, strategy FROM trades WHERE id = ? AND platform = ?",
            (trade_id, normalized_platform),
        ).fetchone()
        if not existing:
            raise KeyError(trade_id)
        trade_type = str(payload.get("trade_type", existing["trade_type"]) or "unclassified")
        strategy = str(payload.get("strategy", existing["strategy"]) or "strategy_unclassified")
        _validate_classification_assignment(
            conn, "trade_type", trade_type, existing["trade_type"]
        )
        _validate_classification_assignment(
            conn, "strategy", strategy, existing["strategy"]
        )
        conn.execute(
            """
            UPDATE trades
            SET review_text = ?, trend_id = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ?
            """,
            (
                str(payload.get("review_text", existing["review_text"])),
                payload.get("trend_id", existing["trend_id"]),
                trade_type,
                strategy,
                trade_id,
                normalized_platform,
            ),
        )
        _refresh_campaign_presentation_conn(conn, trade_id, clear_review=True)
    trade = get_trade(trade_id, platform=normalized_platform)
    if not trade:
        raise KeyError(trade_id)
    return trade


def update_trade_archived(
    trade_id: str,
    archived: bool,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        cursor = conn.execute(
            """
            UPDATE trades
            SET is_archived = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (1 if archived else 0, trade_id, normalized_platform),
        )
        if cursor.rowcount == 0:
            raise KeyError(trade_id)
    trade = get_trade(trade_id, platform=normalized_platform)
    if not trade:
        raise KeyError(trade_id)
    return trade


def checkin_review_trade(
    trade_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    trade_id = str(trade_id).strip()
    if not trade_id:
        raise ValueError("trade_id is required")
    day = checkin_date or to_beijing(datetime.now(timezone.utc)).date().isoformat()
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("checkin_date must be YYYY-MM-DD") from exc
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        trade = conn.execute(
            """
            SELECT trades.id, campaign_source_trades.campaign_id
            FROM trades
            LEFT JOIN campaign_source_trades
              ON campaign_source_trades.trade_id = trades.id
            LEFT JOIN trade_campaigns
              ON trade_campaigns.id = campaign_source_trades.campaign_id
             AND trade_campaigns.platform = trades.platform
             AND trade_campaigns.deleted_at IS NULL
            WHERE trades.id = ? AND trades.platform = ? AND trades.deleted_at IS NULL
            ORDER BY trade_campaigns.updated_at DESC
            LIMIT 1
            """,
            (trade_id, normalized_platform),
        ).fetchone()
        if not trade:
            raise KeyError(trade_id)
        cursor = conn.execute(
            "INSERT OR IGNORE INTO campaign_checkins (campaign_id, checkin_date) VALUES (?, ?)",
            (trade["campaign_id"], day),
        )
    return {
        "trade_id": trade_id,
        "campaign_id": str(trade["campaign_id"]),
        "date": day,
        "created": cursor.rowcount == 1,
        "checked_in": True,
    }


def cancel_review_trade(
    trade_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    trade_id = str(trade_id).strip()
    if not trade_id:
        raise ValueError("trade_id is required")
    day = checkin_date or to_beijing(datetime.now(timezone.utc)).date().isoformat()
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("checkin_date must be YYYY-MM-DD") from exc
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        trade = conn.execute(
            """
            SELECT trades.id, campaign_source_trades.campaign_id
            FROM trades
            JOIN campaign_source_trades
              ON campaign_source_trades.trade_id = trades.id
            JOIN trade_campaigns
              ON trade_campaigns.id = campaign_source_trades.campaign_id
             AND trade_campaigns.platform = trades.platform
             AND trade_campaigns.deleted_at IS NULL
            WHERE trades.id = ? AND trades.platform = ? AND trades.deleted_at IS NULL
            ORDER BY trade_campaigns.updated_at DESC
            LIMIT 1
            """,
            (trade_id, normalized_platform),
        ).fetchone()
        if not trade:
            raise KeyError(trade_id)
        cursor = conn.execute(
            "DELETE FROM campaign_checkins WHERE campaign_id = ? AND checkin_date = ?",
            (trade["campaign_id"], day),
        )
    return {
        "trade_id": trade_id,
        "campaign_id": str(trade["campaign_id"]),
        "date": day,
        "deleted": cursor.rowcount == 1,
        "checked_in": False,
    }


def set_review_daily_goal(daily_goal: int) -> dict[str, int]:
    if isinstance(daily_goal, bool):
        raise ValueError("daily_goal must be an integer")
    if isinstance(daily_goal, float) and not daily_goal.is_integer():
        raise ValueError("daily_goal must be an integer")
    try:
        goal = int(daily_goal)
    except (TypeError, ValueError) as exc:
        raise ValueError("daily_goal must be an integer") from exc
    if not 1 <= goal <= 500:
        raise ValueError("daily_goal must be between 1 and 500")
    with db() as conn:
        conn.execute(
            """
            INSERT INTO analysis_settings (key, value, updated_at)
            VALUES ('reading_daily_goal', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            """,
            (str(goal),),
        )
    return {"daily_goal": goal}


def delete_trade(
    trade_id: str,
    platform: str = "mt5",
    reason: str = "",
) -> None:
    normalized_platform = normalize_platform(platform)
    normalized_reason = str(reason or "").strip()[:500]
    with db() as conn:
        cursor = conn.execute(
            """
            UPDATE trades
            SET deleted_at = CURRENT_TIMESTAMP,
                deleted_reason = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (normalized_reason, trade_id, normalized_platform),
        )
        if cursor.rowcount == 0:
            raise KeyError(trade_id)
        # Remove campaign check-ins only when this deletion removes the last
        # active source trade from the merged order. A surviving source trade
        # keeps the campaign and its review history intact.
        conn.execute(
            """
            DELETE FROM campaign_checkins
            WHERE campaign_id IN (
                SELECT links.campaign_id
                FROM campaign_source_trades AS links
                WHERE links.trade_id = ?
                  AND NOT EXISTS (
                      SELECT 1
                      FROM campaign_source_trades AS siblings
                      JOIN trades AS active_trades
                        ON active_trades.id = siblings.trade_id
                      WHERE siblings.campaign_id = links.campaign_id
                        AND active_trades.deleted_at IS NULL
                  )
            )
            """,
            (trade_id,),
        )
        _campaign_repository().rebuild(conn=conn)


def restore_trade(trade_id: str, platform: str = "mt5") -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    with db() as conn:
        cursor = conn.execute(
            "UPDATE trades SET deleted_at = NULL, deleted_reason = '', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND platform = ?",
            (trade_id, normalized_platform),
        )
        if cursor.rowcount == 0:
            raise KeyError(trade_id)
        # A deleted campaign has no active order to review. Any old campaign
        # check-ins were removed during the delete transaction.
        _campaign_repository().rebuild(conn=conn)
    trade = get_trade(trade_id, platform=normalized_platform)
    if not trade:
        raise KeyError(trade_id)
    return trade


def upsert_trade(trade: dict[str, Any]) -> None:
    with db() as conn:
        _upsert_trade_conn(conn, trade)
        _campaign_repository().rebuild(conn=conn)


def _upsert_trade_conn(
    conn: sqlite3.Connection,
    trade: dict[str, Any],
) -> None:
    open_time = trade["open_time_utc"]
    close_time = trade["close_time_utc"]
    trade["duration_seconds"] = calculate_duration_seconds(open_time, close_time)
    trade.setdefault("commission", 0.0)
    trade.setdefault("swap", 0.0)
    trade.setdefault("fee", 0.0)
    trade.setdefault("platform", "mt5")
    trade.setdefault("trade_date", None)
    trade.setdefault("product_name", "")
    trade.setdefault("contract_name", "")
    trade.setdefault("review_text", "")
    trade.setdefault("trend_id", None)
    trade.setdefault("remark", "")
    trade.setdefault("trade_type", "unclassified")
    trade.setdefault("strategy", "strategy_unclassified")
    trade.setdefault("source", "mt5")
    trade.setdefault("raw_json", json.dumps(trade, ensure_ascii=False))

    trade["trade_type"] = _ensure_classification_option(
        conn, "trade_type", trade["trade_type"]
    )
    trade["strategy"] = _ensure_classification_option(
        conn, "strategy", trade["strategy"]
    )
    conn.execute(
        """
        INSERT INTO trades (
            id, platform, trade_date, account, order_no, position_id, order_ticket, deal_ticket, symbol, product_name, contract_name, side, lots,
            open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl,
            commission, swap, fee, screenshot_path, review_text, trend_id, remark,
            trade_type, strategy, source, raw_json
        ) VALUES (
            :id, :platform, :trade_date, :account, :order_no, :position_id, :order_ticket, :deal_ticket, :symbol, :product_name, :contract_name, :side, :lots,
            :open_time_utc, :close_time_utc, :duration_seconds, :entry_price, :exit_price, :pnl,
            :commission, :swap, :fee, :screenshot_path, :review_text, :trend_id, :remark,
            :trade_type, :strategy, :source, :raw_json
        )
        ON CONFLICT(id) DO UPDATE SET
            platform = excluded.platform,
            trade_date = excluded.trade_date,
            account = excluded.account,
            order_no = excluded.order_no,
            position_id = excluded.position_id,
            order_ticket = excluded.order_ticket,
            deal_ticket = excluded.deal_ticket,
            symbol = excluded.symbol,
            product_name = excluded.product_name,
            contract_name = excluded.contract_name,
            side = excluded.side,
            lots = excluded.lots,
            open_time_utc = excluded.open_time_utc,
            close_time_utc = excluded.close_time_utc,
            duration_seconds = excluded.duration_seconds,
            entry_price = excluded.entry_price,
            exit_price = excluded.exit_price,
            pnl = excluded.pnl,
            commission = excluded.commission,
            swap = excluded.swap,
            fee = excluded.fee,
            screenshot_path = excluded.screenshot_path,
            raw_json = excluded.raw_json,
            updated_at = CURRENT_TIMESTAMP
        """,
        trade,
    )

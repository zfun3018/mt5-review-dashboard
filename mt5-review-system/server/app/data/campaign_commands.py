from __future__ import annotations

import sqlite3

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import math
from typing import Any

from ..domain.campaigns import calculate_position_risk
from .campaign_repository import CampaignRepository
from .catalog_commands import _ensure_classification_option


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    return _campaign_repository().get(campaign_id)


def update_position_initial_stop(position_id: str, value: Any) -> dict[str, Any]:
    repository = _campaign_repository()
    with db() as conn:
        row = conn.execute("SELECT id FROM positions WHERE id = ?", (position_id,)).fetchone()
        if not row:
            raise KeyError(position_id)
        membership = conn.execute(
            "SELECT campaign_id FROM campaign_positions WHERE position_id = ?", (position_id,)
        ).fetchone()
        campaign_id = str(membership["campaign_id"]) if membership else ""
        campaign = repository.get(campaign_id, conn=conn)
        if not campaign:
            raise KeyError(campaign_id)
        position = next(
            (item for item in campaign["positions"] if item["id"] == position_id),
            None,
        )
        if not position:
            raise KeyError(position_id)
        if value in (None, ""):
            stop = None
        else:
            try:
                stop = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("初始止损必须是有效数字") from exc
            if not math.isfinite(stop):
                raise ValueError("初始止损必须是有效数字")
            validation = calculate_position_risk({**position, "initial_stop_price": stop})
            if validation["risk_status"] == "invalid":
                raise ValueError("初始止损方向无效：多单止损须低于入场价，空单止损须高于入场价")
        conn.execute(
            "UPDATE positions SET initial_stop_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (stop, position_id),
        )
        updated = repository.get(campaign_id, conn=conn)
        if not updated:
            raise KeyError(campaign_id)
        conn.execute(
            """
            UPDATE trade_campaigns
               SET campaign_r = ?, risk_status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
            """,
            (updated.get("campaign_r"), updated.get("risk_status"), campaign_id),
        )
        return {
            "position_id": position_id,
            "campaign": updated,
        }


def update_analysis_settings(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        threshold = float(payload.get("scratch_threshold_r"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Scratch 阈值必须是有效数字") from exc
    if not math.isfinite(threshold) or not 0 <= threshold <= 5:
        raise ValueError("Scratch 阈值必须在 0R 到 5R 之间")
    with db() as conn:
        conn.execute(
            """
            INSERT INTO analysis_settings (key, value, updated_at)
            VALUES ('scratch_threshold_r', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            """,
            (str(threshold),),
        )
    return {"scratch_threshold_r": threshold}


def update_campaign_review(campaign_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    review_text = str(payload.get("review_text") or "")
    if len(review_text) > 10000:
        raise ValueError("复盘内容不能超过 10000 个字符")
    with db() as conn:
        current = conn.execute(
            "SELECT trade_type, strategy FROM trade_campaigns WHERE id = ? AND deleted_at IS NULL",
            (campaign_id,),
        ).fetchone()
        if not current:
            raise KeyError(campaign_id)
        trade_type = _ensure_classification_option(
            conn,
            "trade_type",
            str(payload.get("trade_type") or current["trade_type"] or "unclassified"),
        )
        strategy = _ensure_classification_option(
            conn,
            "strategy",
            str(payload.get("strategy") or current["strategy"] or "strategy_unclassified"),
        )
        conn.execute(
            """
            UPDATE trade_campaigns
            SET review_text = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (review_text, trade_type, strategy, campaign_id),
        )
        source = conn.execute(
            """
            SELECT trade_id FROM campaign_source_trades
            WHERE campaign_id = ? ORDER BY trade_id LIMIT 1
            """,
            (campaign_id,),
        ).fetchone()
        if source:
            conn.execute(
                """
                UPDATE trades
                SET review_text = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (review_text, trade_type, strategy, source["trade_id"]),
            )
    updated = get_campaign(campaign_id)
    if not updated:
        raise KeyError(campaign_id)
    return updated

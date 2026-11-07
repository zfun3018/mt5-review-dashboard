from __future__ import annotations

import uuid
from typing import Any

from ..core.config import get_runtime_paths
from .database import transaction
from .campaign_repository import CampaignRepository
from .trade_commands import (
    MAX_MANUAL_SCREENSHOT_BYTES,
    SCREENSHOT_MIME_EXTENSIONS,
    _decode_manual_screenshot,
    _raw_json_with_screenshot_path,
)


def db():
    return transaction(get_runtime_paths())

import math
import json
from datetime import datetime, timezone
from typing import Any

from ..domain.analytics import to_beijing
from ..domain.campaigns import calculate_position_risk
from ..platforms import normalize_platform
from .campaign_repository import CampaignRepository
from .catalog_commands import (
    _ensure_classification_option,
    _normalize_custom_value,
    _option_ids_for_field,
)


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    return _campaign_repository().get(campaign_id)


def campaign_checkin_overview(
    days: int = 90,
    today: Any = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    return _campaign_repository().campaign_checkin_overview(
        days=days, today=today, platform=platform
    )


def random_featured_campaign(platform: str = "mt5") -> dict[str, Any] | None:
    return _campaign_repository().random_featured(platform=normalize_platform(platform))


def replace_campaign_screenshot(
    campaign_id: str,
    payload: dict[str, Any],
    platform: str = "mt5",
) -> dict[str, Any]:
    image_bytes, extension = _decode_manual_screenshot(payload)
    new_path = f"screenshots/manual-{uuid.uuid4().hex}{extension}"
    new_file = get_runtime_paths().data / new_path
    new_file.parent.mkdir(parents=True, exist_ok=True)
    new_file.write_bytes(image_bytes)
    old_path = ""
    try:
        with db() as conn:
            current = conn.execute(
                """
                SELECT id, screenshot_path
                FROM trade_campaigns
                WHERE id = ? AND platform = ? AND deleted_at IS NULL
                """,
                (campaign_id, platform),
            ).fetchone()
            if not current:
                raise KeyError(campaign_id)
            old_path = str(current["screenshot_path"] or "")
            conn.execute(
                """
                UPDATE trade_campaigns
                SET screenshot_path = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND platform = ?
                """,
                (new_path, campaign_id, platform),
            )
            source_rows = conn.execute(
                """
                SELECT trades.id, trades.raw_json
                FROM trades
                JOIN campaign_source_trades
                  ON campaign_source_trades.trade_id = trades.id
                WHERE campaign_source_trades.campaign_id = ?
                """,
                (campaign_id,),
            ).fetchall()
            for source in source_rows:
                conn.execute(
                    """
                    UPDATE trades
                    SET screenshot_path = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND platform = ?
                    """,
                    (
                        new_path,
                        _raw_json_with_screenshot_path(source["raw_json"], new_path),
                        source["id"],
                        platform,
                    ),
                )
            _campaign_repository().rebuild(conn=conn)
            record = _campaign_repository().get(campaign_id, conn=conn)
    except Exception:
        new_file.unlink(missing_ok=True)
        raise
    _remove_unreferenced_campaign_screenshot(old_path, campaign_id)
    if not record:
        raise KeyError(campaign_id)
    return record


def delete_campaign_screenshot(
    campaign_id: str,
    platform: str = "mt5",
) -> dict[str, Any]:
    old_path = ""
    with db() as conn:
        current = conn.execute(
            """
            SELECT id, screenshot_path
            FROM trade_campaigns
            WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (campaign_id, platform),
        ).fetchone()
        if not current:
            raise KeyError(campaign_id)
        old_path = str(current["screenshot_path"] or "")
        conn.execute(
            """
            UPDATE trade_campaigns
            SET screenshot_path = '', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ?
            """,
            (campaign_id, platform),
        )
        source_rows = conn.execute(
            """
            SELECT trades.id, trades.raw_json
            FROM trades
            JOIN campaign_source_trades
              ON campaign_source_trades.trade_id = trades.id
            WHERE campaign_source_trades.campaign_id = ?
            """,
            (campaign_id,),
        ).fetchall()
        for source in source_rows:
            conn.execute(
                """
                UPDATE trades
                SET screenshot_path = '', raw_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND platform = ?
                """,
                (
                    _raw_json_with_screenshot_path(source["raw_json"], ""),
                    source["id"],
                    platform,
                ),
            )
        _campaign_repository().rebuild(conn=conn)
        record = _campaign_repository().get(campaign_id, conn=conn)
    _remove_unreferenced_campaign_screenshot(old_path, campaign_id)
    if not record:
        raise KeyError(campaign_id)
    return record


def _remove_unreferenced_campaign_screenshot(path_value: str, campaign_id: str) -> None:
    relative = str(path_value or "").replace("\\", "/").strip()
    if not relative:
        return
    candidate = (get_runtime_paths().data / relative).resolve()
    screenshot_root = get_runtime_paths().screenshots.resolve()
    if not candidate.is_relative_to(screenshot_root) or not candidate.is_file():
        return
    with db() as conn:
        references = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM trade_campaigns
            WHERE screenshot_path = ? AND id != ?
            """,
            (relative, campaign_id),
        ).fetchone()["count"]
    if not references:
        candidate.unlink(missing_ok=True)


def update_campaign_featured(
    campaign_id: str,
    featured: bool,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    if not isinstance(featured, bool):
        raise ValueError("featured must be a boolean")
    repository = _campaign_repository()
    with db() as conn:
        campaign = repository.get(campaign_id, conn=conn)
        if not campaign or campaign.get("platform", "mt5") != normalized_platform:
            raise KeyError(campaign_id)
        conn.execute(
            """
            UPDATE trade_campaigns
               SET is_featured = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (1 if featured else 0, campaign_id, normalized_platform),
        )
        # Keep legacy source rows synchronized so older readers cannot resurrect
        # a campaign-level selection during a model rebuild.
        conn.execute(
            """
            UPDATE trades
               SET is_featured = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id IN (
                 SELECT trade_id
                 FROM campaign_source_trades
                 WHERE campaign_id = ?
             ) AND platform = ?
            """,
            (1 if featured else 0, campaign_id, normalized_platform),
        )
        updated = repository.get(campaign_id, conn=conn)
    if not updated:
        raise KeyError(campaign_id)
    return updated


def checkin_campaign(
    campaign_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    day = checkin_date or to_beijing(datetime.now(timezone.utc)).date().isoformat()
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("checkin_date must be YYYY-MM-DD") from exc
    with db() as conn:
        campaign = conn.execute(
            """
            SELECT id
            FROM trade_campaigns
            WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (campaign_id, normalized_platform),
        ).fetchone()
        if not campaign:
            raise KeyError(campaign_id)
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO campaign_checkins (campaign_id, checkin_date)
            VALUES (?, ?)
            """,
            (campaign_id, day),
        )
    return {
        "campaign_id": campaign_id,
        "date": day,
        "created": cursor.rowcount == 1,
        "checked_in": True,
    }


def cancel_campaign_checkin(
    campaign_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    day = checkin_date or to_beijing(datetime.now(timezone.utc)).date().isoformat()
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("checkin_date must be YYYY-MM-DD") from exc
    with db() as conn:
        campaign = conn.execute(
            """
            SELECT id
            FROM trade_campaigns
            WHERE id = ? AND platform = ? AND deleted_at IS NULL
            """,
            (campaign_id, normalized_platform),
        ).fetchone()
        if not campaign:
            raise KeyError(campaign_id)
        cursor = conn.execute(
            "DELETE FROM campaign_checkins WHERE campaign_id = ? AND checkin_date = ?",
            (campaign_id, day),
        )
    return {
        "campaign_id": campaign_id,
        "date": day,
        "deleted": cursor.rowcount == 1,
        "checked_in": False,
    }


def update_position_initial_stop(
    position_id: str,
    value: Any,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
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
        if not campaign or campaign.get("platform", "mt5") != normalized_platform:
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
            "UPDATE positions SET initial_stop_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND platform = ?",
            (stop, position_id, normalized_platform),
        )
        updated = repository.get(campaign_id, conn=conn)
        if not updated:
            raise KeyError(campaign_id)
        conn.execute(
            """
            UPDATE trade_campaigns
               SET campaign_r = ?, risk_status = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND platform = ?
            """,
            (updated.get("campaign_r"), updated.get("risk_status"), campaign_id, normalized_platform),
        )
        return {
            "position_id": position_id,
            "campaign": updated,
        }


def update_campaign_initial_stop(
    campaign_id: str,
    value: Any,
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    repository = _campaign_repository()
    with db() as conn:
        campaign = repository.get(campaign_id, conn=conn)
        if not campaign or campaign.get("platform", "mt5") != normalized_platform:
            raise KeyError(campaign_id)
        if value in (None, ""):
            stop = None
        else:
            try:
                stop = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("初始止损必须是有效数字") from exc
            if not math.isfinite(stop):
                raise ValueError("初始止损必须是有效数字")
            for position in campaign.get("positions", []):
                validation = calculate_position_risk(
                    {**position, "initial_stop_price": stop}
                )
                if validation["risk_status"] == "invalid":
                    raise ValueError("初始止损方向无效：多单止损须低于入场价，空单止损须高于入场价")
        position_ids = [position["id"] for position in campaign.get("positions", [])]
        if position_ids:
            placeholders = ",".join("?" for _ in position_ids)
            conn.execute(
                f"UPDATE positions SET initial_stop_price = ?, updated_at = CURRENT_TIMESTAMP "
                f"WHERE id IN ({placeholders}) AND platform = ?",
                [stop, *position_ids, normalized_platform],
            )
        updated = repository.get(campaign_id, conn=conn)
        if not updated:
            raise KeyError(campaign_id)
        conn.execute(
            "UPDATE trade_campaigns SET campaign_r = ?, risk_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND platform = ?",
            (updated.get("campaign_r"), updated.get("risk_status"), campaign_id, normalized_platform),
        )
        return updated


def update_analysis_settings(payload: dict[str, Any]) -> dict[str, Any]:
    definitions = {
        "scratch_threshold_r": (0.15, 0, 5, "Scratch 阈值必须在 0R 到 5R 之间"),
        "domestic_futures_monthly_target_pnl": (0, 0, 1e9, "期货月目标必须在 0 到 1,000,000,000 之间"),
        "domestic_futures_daily_target_pnl": (0, 0, 1e9, "期货日均目标必须在 0 到 1,000,000,000 之间"),
    }
    values = {}
    for key, (default, minimum, maximum, range_error) in definitions.items():
        if key not in payload:
            continue
        try:
            value = float(payload[key])
        except (TypeError, ValueError) as exc:
            label = "Scratch 阈值" if key == "scratch_threshold_r" else "期货目标"
            raise ValueError(f"{label}必须是有效数字") from exc
        if not math.isfinite(value) or not minimum <= value <= maximum:
            raise ValueError(range_error)
        values[key] = value
    with db() as conn:
        conn.executemany(
            """
            INSERT INTO analysis_settings (key, value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            """,
            [(key, str(value)) for key, value in values.items()],
        )
        rows = conn.execute(
            "SELECT key, value FROM analysis_settings WHERE key IN (?, ?, ?)",
            tuple(definitions),
        ).fetchall()
    current = {row["key"]: float(row["value"]) for row in rows}
    return {key: current.get(key, default) for key, (default, *_rest) in definitions.items()}


def update_campaign_review(
    campaign_id: str,
    payload: dict[str, Any],
    platform: str = "mt5",
) -> dict[str, Any]:
    normalized_platform = normalize_platform(platform)
    review_text = str(payload.get("review_text") or "")
    if len(review_text) > 10000:
        raise ValueError("复盘内容不能超过 10000 个字符")
    with db() as conn:
        current = conn.execute(
            "SELECT trade_type, strategy FROM trade_campaigns WHERE id = ? AND platform = ? AND deleted_at IS NULL",
            (campaign_id, normalized_platform),
        ).fetchone()
        if not current:
            raise KeyError(campaign_id)
        current_tags = conn.execute(
            "SELECT trade_type_tags, strategy_tags, mistake_tags FROM trade_campaigns WHERE id = ? AND platform = ?",
            (campaign_id, normalized_platform),
        ).fetchone()

        def custom_field_row(field_id: int):
            row = conn.execute(
                "SELECT id, name, field_type, active, platforms FROM custom_fields WHERE id = ?",
                (field_id,),
            ).fetchone()
            if not row or not row["active"]:
                raise ValueError("Custom field is inactive or missing")
            try:
                platforms = json.loads(row["platforms"] or "[]")
            except json.JSONDecodeError:
                platforms = []
            if normalized_platform not in platforms:
                raise ValueError("Custom field is not enabled for this platform")
            return row

        def save_campaign_custom_value(field_id: int, raw_value: Any) -> list[str]:
            field = custom_field_row(field_id)
            existing_value = conn.execute(
                "SELECT value FROM campaign_custom_values WHERE campaign_id = ? AND field_id = ?",
                (campaign_id, field_id),
            ).fetchone()
            allowed = _option_ids_for_field(
                conn,
                field_id,
                existing_value["value"] if existing_value else None,
            )
            value, stored = _normalize_custom_value(raw_value, field["field_type"], allowed)
            conn.execute(
                """
                INSERT INTO campaign_custom_values (campaign_id, field_id, value, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(campaign_id, field_id) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (campaign_id, field_id, stored),
            )
            return value if isinstance(value, list) else [value] if value else []

        custom_field_values = payload.get("custom_fields")
        if custom_field_values is not None:
            if not isinstance(custom_field_values, dict):
                raise ValueError("custom_fields must be an object")
            for raw_field_id, raw_value in custom_field_values.items():
                save_campaign_custom_value(int(raw_field_id), raw_value)

        def tag_values(key: str, fallback_key: str, fallback: str) -> list[str]:
            explicit = key in payload or fallback_key in payload
            if key in payload:
                raw = payload.get(key)
            elif fallback_key in payload:
                raw = [payload.get(fallback_key)]
            else:
                raw = current_tags[key]
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except json.JSONDecodeError:
                    raw = [raw]
            if not isinstance(raw, list):
                raw = []
            values = []
            for item in raw:
                value = str(item or "").strip()
                if value and value not in values:
                    values.append(value)
            if values or explicit:
                return values
            return [fallback] if fallback else []

        trade_type_tags = [
            _ensure_classification_option(conn, "trade_type", value)
            for value in tag_values("trade_type_tags", "trade_type", current["trade_type"] or "unclassified")
        ]
        strategy_tags = [
            _ensure_classification_option(conn, "strategy", value)
            for value in tag_values("strategy_tags", "strategy", current["strategy"] or "strategy_unclassified")
        ]
        mistake_tags = tag_values("mistake_tags", "", "")
        if "mistake_tags" in payload:
            mistake_field = conn.execute(
                "SELECT id FROM custom_fields WHERE name = '犯错' ORDER BY id LIMIT 1"
            ).fetchone()
            if mistake_field:
                mistake_field_id = int(mistake_field["id"])
                mistake_ids = _ensure_mistake_option_ids(
                    conn, mistake_field_id, mistake_tags
                )
                save_campaign_custom_value(mistake_field_id, mistake_ids)
        elif custom_field_values is not None:
            mistake_field = conn.execute(
                "SELECT id FROM custom_fields WHERE name = '犯错' ORDER BY id LIMIT 1"
            ).fetchone()
            if mistake_field and str(mistake_field["id"]) in custom_field_values:
                mistake_tags = _legacy_mistake_labels(
                    conn,
                    custom_field_values[str(mistake_field["id"])],
                    int(mistake_field["id"]),
                )
        trade_type = trade_type_tags[0] if trade_type_tags else "unclassified"
        strategy = strategy_tags[0] if strategy_tags else "strategy_unclassified"
        conn.execute(
            """
            UPDATE trade_campaigns
            SET review_text = ?, trade_type = ?, strategy = ?,
                trade_type_tags = ?, strategy_tags = ?, mistake_tags = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ?
            """,
            (
                review_text,
                trade_type,
                strategy,
                json.dumps(trade_type_tags, ensure_ascii=False),
                json.dumps(strategy_tags, ensure_ascii=False),
                json.dumps(mistake_tags, ensure_ascii=False),
                campaign_id,
                normalized_platform,
            ),
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
                SET review_text = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (review_text, source["trade_id"]),
            )
    updated = _campaign_repository().get(campaign_id)
    if not updated:
        raise KeyError(campaign_id)
    return updated


def _legacy_mistake_labels(
    conn: Any,
    raw_value: Any,
    field_id: int,
) -> list[str]:
    values = raw_value if isinstance(raw_value, list) else [raw_value]
    option_ids = {str(row["id"]): str(row["label"]) for row in conn.execute(
        "SELECT id, label FROM custom_field_options WHERE field_id = ?",
        (field_id,),
    ).fetchall()}
    return [option_ids[str(value)] for value in values if str(value) in option_ids]


def _ensure_mistake_option_ids(
    conn: Any,
    field_id: int,
    raw_values: list[str],
) -> list[str]:
    options = {
        str(row["id"]): str(row["label"])
        for row in conn.execute(
            "SELECT id, label FROM custom_field_options WHERE field_id = ?",
            (field_id,),
        ).fetchall()
    }
    labels_to_ids = {label: option_id for option_id, label in options.items()}
    values = []
    for raw_value in raw_values:
        value = str(raw_value or "").strip()
        if not value:
            continue
        option_id = value if value in options else labels_to_ids.get(value)
        if option_id is None:
            cursor = conn.execute(
                "INSERT INTO custom_field_options (field_id, label, color, sort_order) VALUES (?, ?, '#f2bd68', ?)",
                (field_id, value, len(options) + 1),
            )
            option_id = str(cursor.lastrowid)
            options[option_id] = value
            labels_to_ids[value] = option_id
        if option_id not in values:
            values.append(option_id)
    return values

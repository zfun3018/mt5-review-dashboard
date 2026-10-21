from __future__ import annotations

from datetime import datetime
from contextlib import closing
from typing import Any

from ..core.config import get_runtime_paths
from ..domain.analytics import to_beijing
from ..platforms import DOMESTIC_FUTURES_PLATFORM, normalize_platform
from .campaign_repository import CampaignRepository
from .database import connect, transaction


def list_accounts(platform: str = "mt5") -> list[str]:
    normalized = normalize_platform(platform)
    with closing(connect(get_runtime_paths())) as conn:
        rows = conn.execute(
            """
            SELECT account FROM trades WHERE platform = ?
            UNION SELECT account FROM deal_events WHERE platform = ?
            UNION SELECT account FROM import_executions WHERE platform = ?
            ORDER BY account
            """,
            (normalized, normalized, normalized),
        ).fetchall()
    return [str(row["account"]) for row in rows if str(row["account"] or "").strip()]


def preview_cleanup(
    *, platform: str, account: str, start_date: str, end_date: str
) -> dict[str, Any]:
    normalized, normalized_account, start, end = _validate_scope(
        platform, account, start_date, end_date
    )
    with closing(connect(get_runtime_paths())) as conn:
        scope = _scope_rows(conn, normalized, normalized_account, start, end)
        return _preview_payload(normalized, normalized_account, start, end, scope, conn)


def cleanup_data(
    *,
    platform: str,
    account: str,
    start_date: str,
    end_date: str,
    confirm: bool = False,
) -> dict[str, Any]:
    normalized, normalized_account, start, end = _validate_scope(
        platform, account, start_date, end_date
    )
    with transaction(get_runtime_paths()) as conn:
        scope = _scope_rows(conn, normalized, normalized_account, start, end)
        preview = _preview_payload(normalized, normalized_account, start, end, scope, conn)
        if not confirm:
            return preview

        trade_ids = set(scope["trade_ids"])
        execution_ids = set(scope["execution_ids"])
        position_ids = set(scope["position_ids"])

        related_trade_ids = _matched_trade_ids(conn, execution_ids)
        trade_ids.update(related_trade_ids)
        if related_trade_ids:
            placeholders = _placeholders(related_trade_ids)
            rows = conn.execute(
                f"SELECT position_id FROM trades WHERE id IN ({placeholders})",
                tuple(related_trade_ids),
            ).fetchall()
            position_ids.update(str(row["position_id"]) for row in rows if row["position_id"])

        affected_execution_ids = set(execution_ids)
        affected_execution_ids.update(_matched_execution_ids(conn, execution_ids))
        surviving_match_execution_ids = affected_execution_ids - execution_ids

        if execution_ids or related_trade_ids:
            match_clauses = []
            match_params: list[Any] = []
            if execution_ids:
                placeholders = _placeholders(execution_ids)
                match_clauses.extend(
                    [
                        f"open_execution_id IN ({placeholders})",
                        f"close_execution_id IN ({placeholders})",
                    ]
                )
                match_params.extend(execution_ids)
                match_params.extend(execution_ids)
            if related_trade_ids:
                placeholders = _placeholders(related_trade_ids)
                match_clauses.append(f"trade_id IN ({placeholders})")
                match_params.extend(related_trade_ids)
            conn.execute(
                f"DELETE FROM import_execution_matches WHERE {' OR '.join(match_clauses)}",
                tuple(match_params),
            )

        if execution_ids:
            placeholders = _placeholders(execution_ids)
            conn.execute(
                f"DELETE FROM import_batch_executions WHERE execution_id IN ({placeholders})",
                tuple(execution_ids),
            )
            conn.execute(
                f"DELETE FROM import_executions WHERE id IN ({placeholders}) AND platform = ?",
                (*execution_ids, normalized),
            )

        if surviving_match_execution_ids:
            placeholders = _placeholders(surviving_match_execution_ids)
            conn.execute(
                f"""
                UPDATE import_executions
                SET remaining_quantity = MAX(
                        0,
                        quantity - COALESCE((
                            SELECT SUM(matches.quantity)
                            FROM import_execution_matches AS matches
                            WHERE matches.open_execution_id = import_executions.id
                               OR matches.close_execution_id = import_executions.id
                        ), 0)
                    ),
                    status = CASE WHEN remaining_quantity > 1e-9 THEN 'unmatched' ELSE 'matched' END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id IN ({placeholders})
                """,
                tuple(surviving_match_execution_ids),
            )

        if trade_ids:
            placeholders = _placeholders(trade_ids)
            conn.execute(
                f"DELETE FROM trades WHERE id IN ({placeholders}) AND platform = ?",
                (*trade_ids, normalized),
            )

        deal_event_ids = set(scope["deal_event_ids"])
        if position_ids:
            placeholders = _placeholders(position_ids)
            rows = conn.execute(
                f"""
                SELECT deal_ticket FROM deal_events
                WHERE platform = ? AND account = ? AND position_id IN ({placeholders})
                """,
                (normalized, normalized_account, *position_ids),
            ).fetchall()
            deal_event_ids.update(str(row["deal_ticket"]) for row in rows)
        if deal_event_ids:
            placeholders = _placeholders(deal_event_ids)
            conn.execute(
                f"DELETE FROM deal_events WHERE deal_ticket IN ({placeholders}) AND platform = ?",
                (*deal_event_ids, normalized),
            )

        if normalized == DOMESTIC_FUTURES_PLATFORM:
            conn.execute(
                "DELETE FROM import_batch_issues WHERE platform = ? AND trade_date BETWEEN ? AND ?",
                (normalized, start, end),
            )
            conn.execute(
                "DELETE FROM import_batch_days WHERE platform = ? AND trade_date BETWEEN ? AND ?",
                (normalized, start, end),
            )
            _recalculate_preserved_batches(conn, normalized)
        conn.execute(
            "DELETE FROM import_batches WHERE platform = ? AND NOT EXISTS (SELECT 1 FROM import_batch_executions WHERE import_batch_executions.batch_id = import_batches.id)",
            (normalized,),
        )

        CampaignRepository(get_runtime_paths()).rebuild(conn=conn)
        conn.execute(
            "DELETE FROM campaign_position_history WHERE NOT EXISTS (SELECT 1 FROM positions WHERE positions.id = campaign_position_history.position_id)"
        )
        conn.execute(
            "DELETE FROM positions WHERE NOT EXISTS (SELECT 1 FROM campaign_positions WHERE campaign_positions.position_id = positions.id)"
        )
        conn.execute(
            """
            DELETE FROM trade_campaigns
            WHERE platform = ? AND account = ?
              AND NOT EXISTS (SELECT 1 FROM campaign_positions WHERE campaign_positions.campaign_id = trade_campaigns.id)
              AND NOT EXISTS (SELECT 1 FROM campaign_source_trades WHERE campaign_source_trades.campaign_id = trade_campaigns.id)
            """,
            (normalized, normalized_account),
        )
        result = dict(preview)
        result.update(
            {
                "requires_confirmation": False,
                "deleted": True,
                "deleted_trade_count": len(trade_ids),
                "deleted_deal_event_count": len(deal_event_ids),
                "deleted_import_execution_count": len(execution_ids),
            }
        )
        return result


def _scope_rows(conn, platform: str, account: str, start: str, end: str) -> dict[str, set[str]]:
    trade_ids: set[str] = set()
    position_ids: set[str] = set()
    trade_rows = conn.execute(
        "SELECT id, position_id, close_time_utc, trade_date FROM trades WHERE platform = ? AND account = ?",
        (platform, account),
    ).fetchall()
    for row in trade_rows:
        if _in_scope(platform, row["trade_date"], row["close_time_utc"], start, end):
            trade_ids.add(str(row["id"]))
            if row["position_id"]:
                position_ids.add(str(row["position_id"]))

    execution_ids: set[str] = set()
    if platform == DOMESTIC_FUTURES_PLATFORM:
        rows = conn.execute(
            "SELECT id FROM import_executions WHERE platform = ? AND account = ? AND trade_date BETWEEN ? AND ? AND status != 'reverted'",
            (platform, account, start, end),
        ).fetchall()
        execution_ids = {str(row["id"]) for row in rows}

    deal_event_ids: set[str] = set()
    event_rows = conn.execute(
        "SELECT deal_ticket, position_id, time_utc FROM deal_events WHERE platform = ? AND account = ?",
        (platform, account),
    ).fetchall()
    for row in event_rows:
        if str(row["position_id"] or "") in position_ids or _in_scope(platform, None, row["time_utc"], start, end):
            deal_event_ids.add(str(row["deal_ticket"]))
    return {
        "trade_ids": trade_ids,
        "position_ids": position_ids,
        "execution_ids": execution_ids,
        "deal_event_ids": deal_event_ids,
    }


def _preview_payload(platform, account, start, end, scope, conn) -> dict[str, Any]:
    trade_ids = scope["trade_ids"]
    execution_ids = scope["execution_ids"]
    campaign_count = 0
    batch_count = 0
    if trade_ids:
        placeholders = _placeholders(trade_ids)
        campaign_count = conn.execute(
            f"SELECT COUNT(DISTINCT campaign_id) AS value FROM campaign_source_trades WHERE trade_id IN ({placeholders})",
            tuple(trade_ids),
        ).fetchone()["value"]
    if execution_ids:
        placeholders = _placeholders(execution_ids)
        batch_count = conn.execute(
            f"SELECT COUNT(DISTINCT batch_id) AS value FROM import_batch_executions WHERE execution_id IN ({placeholders})",
            tuple(execution_ids),
        ).fetchone()["value"]
    return {
        "platform": platform,
        "account": account,
        "start_date": start,
        "end_date": end,
        "trade_count": len(trade_ids),
        "campaign_count": int(campaign_count or 0),
        "deal_event_count": len(scope["deal_event_ids"]),
        "import_execution_count": len(execution_ids),
        "import_batch_count": int(batch_count or 0),
        "requires_confirmation": True,
    }


def _matched_trade_ids(conn, execution_ids: set[str]) -> set[str]:
    if not execution_ids:
        return set()
    placeholders = _placeholders(execution_ids)
    rows = conn.execute(
        f"SELECT DISTINCT trade_id FROM import_execution_matches WHERE open_execution_id IN ({placeholders}) OR close_execution_id IN ({placeholders})",
        (*execution_ids, *execution_ids),
    ).fetchall()
    return {str(row["trade_id"]) for row in rows if str(row["trade_id"] or "").strip()}


def _matched_execution_ids(conn, execution_ids: set[str]) -> set[str]:
    if not execution_ids:
        return set()
    placeholders = _placeholders(execution_ids)
    rows = conn.execute(
        f"SELECT open_execution_id, close_execution_id FROM import_execution_matches WHERE open_execution_id IN ({placeholders}) OR close_execution_id IN ({placeholders})",
        (*execution_ids, *execution_ids),
    ).fetchall()
    result = set()
    for row in rows:
        result.update((str(row["open_execution_id"]), str(row["close_execution_id"])))
    return result


def _recalculate_preserved_batches(conn, platform: str) -> None:
    rows = conn.execute(
        "SELECT id FROM import_batches WHERE platform = ?",
        (platform,),
    ).fetchall()
    for row in rows:
        batch_id = str(row["id"])
        day_rows = conn.execute(
            "SELECT * FROM import_batch_days WHERE batch_id = ? ORDER BY trade_date",
            (batch_id,),
        ).fetchall()
        if not day_rows:
            continue
        sums = {
            field: sum(int(day[field] or 0) for day in day_rows)
            for field in (
                "source_row_count", "new_row_count", "duplicate_count",
                "conflict_count", "invalid_count", "unpaired_count", "order_count",
            )
        }
        conn.execute(
            """
            UPDATE import_batches SET trade_date_start = ?, trade_date_end = ?,
                source_row_count = ?, new_row_count = ?, duplicate_count = ?,
                conflict_count = ?, invalid_count = ?, unpaired_count = ?, order_count = ?
            WHERE id = ?
            """,
            (day_rows[0]["trade_date"], day_rows[-1]["trade_date"], *sums.values(), batch_id),
        )


def _validate_scope(platform, account, start_date, end_date):
    normalized = normalize_platform(platform)
    normalized_account = str(account or "").strip()
    if not normalized_account:
        raise ValueError("account 是必填项")
    start = _date_value(start_date, "start_date")
    end = _date_value(end_date, "end_date")
    if start > end:
        raise ValueError("start_date 不能晚于 end_date")
    return normalized, normalized_account, start, end


def _date_value(value, field):
    text = str(value or "").strip()
    try:
        return datetime.strptime(text, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise ValueError(f"{field} 必须是 YYYY-MM-DD") from exc


def _in_scope(platform, trade_date, time_value, start, end):
    if platform == DOMESTIC_FUTURES_PLATFORM and trade_date:
        value = str(trade_date)[:10]
    else:
        try:
            value = to_beijing(str(time_value)).date().isoformat()
        except (TypeError, ValueError):
            return False
    return start <= value <= end


def _placeholders(values: set[str]) -> str:
    if not values:
        raise ValueError("empty SQL value set")
    return ",".join("?" for _ in values)

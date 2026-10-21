from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import closing, nullcontext
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from ..core.config import RuntimePaths
from ..domain.analytics import to_beijing, trade_net_pnl
from ..domain.campaigns import calculate_campaign_r, group_campaigns, reconstruct_positions
from .catalog_repository import CatalogRepository
from .database import connect, transaction
from .import_repository import import_sources_for_trade_ids
from .trade_repository import Page, _beijing_date_bounds, _escape_like


CAMPAIGN_MODEL_REVISION = "7"
CAMPAIGN_ID_NAMESPACE = uuid.UUID("d72ca9de-dfff-4e64-b1cc-5a8a1837c71d")


def _json_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    try:
        parsed = json.loads(str(value or "[]"))
    except (TypeError, json.JSONDecodeError):
        return []
    return [str(item) for item in parsed if str(item).strip()] if isinstance(parsed, list) else []


class CampaignRepository:
    def __init__(
        self,
        paths: RuntimePaths,
        review_formatter: Callable[[str, str], str] | None = None,
    ) -> None:
        self.paths = paths
        self.catalog = CatalogRepository(paths)
        self.review_formatter = review_formatter or (lambda trade_id, review: f"{trade_id}\n{review}")

    def query(
        self,
        filters: dict[str, Any],
        page: int,
        page_size: int,
    ) -> Page:
        safe_page = max(1, int(page))
        safe_size = max(1, min(int(page_size), 200))
        clauses, parameters = self._where(filters)
        where_sql = f"WHERE {' AND '.join(clauses)}"
        with closing(connect(self.paths)) as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) AS value FROM trade_campaigns AS campaigns {where_sql}",
                    parameters,
                ).fetchone()["value"]
            )
            ids = [
                str(row["id"])
                for row in conn.execute(
                    f"""
                    SELECT campaigns.id
                    FROM trade_campaigns AS campaigns
                    {where_sql}
                    ORDER BY COALESCE(campaigns.trade_date, campaigns.closed_at_utc, campaigns.opened_at_utc) DESC,
                             campaigns.id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*parameters, safe_size, (safe_page - 1) * safe_size],
                ).fetchall()
            ]
            items = self.records(
                conn=conn,
                campaign_ids=ids,
                deleted=str(filters.get("deleted") or "active"),
            )
        return Page(items, total, safe_page, safe_size)

    def get(
        self,
        campaign_id: str,
        *,
        deleted: str = "active",
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if conn is None:
            with closing(connect(self.paths)) as owned_conn:
                return self.get(campaign_id, deleted=deleted, conn=owned_conn)
        records = self.records(conn=conn, campaign_ids=[campaign_id], deleted=deleted)
        return records[0] if records else None

    def random_featured(
        self,
        *,
        platform: str = "mt5",
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any] | None:
        if conn is None:
            with closing(connect(self.paths)) as owned_conn:
                return self.random_featured(platform=platform, conn=owned_conn)
        row = conn.execute(
            """
            SELECT id
            FROM trade_campaigns
            WHERE platform = ?
              AND deleted_at IS NULL
              AND status = 'closed'
              AND is_featured = 1
            ORDER BY RANDOM()
            LIMIT 1
            """,
            (platform,),
        ).fetchone()
        return self.get(str(row["id"]), conn=conn) if row else None

    def campaign_checkin_summary(
        self,
        campaign_ids: list[str],
        checkin_date: str | None = None,
    ) -> dict[str, dict[str, int | bool]]:
        ids = [str(value) for value in campaign_ids if str(value)]
        if not ids:
            return {}
        day = checkin_date or to_beijing(datetime.now(timezone.utc)).date().isoformat()
        placeholders = ",".join("?" for _ in ids)
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                f"""
                SELECT campaign_id,
                       COUNT(*) AS count,
                       MAX(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) AS checked_in
                FROM campaign_checkins
                WHERE campaign_id IN ({placeholders})
                GROUP BY campaign_id
                """,
                [day, *ids],
            ).fetchall()
        return {
            str(row["campaign_id"]): {
                "count": int(row["count"]),
                "checked_in": bool(row["checked_in"]),
            }
            for row in rows
        }

    def campaign_checkin_overview(
        self,
        days: int = 90,
        today: str | date | None = None,
        platform: str = "mt5",
    ) -> dict[str, Any]:
        safe_days = max(1, min(int(days), 366))
        end = _coerce_campaign_date(today) if today is not None else to_beijing(
            datetime.now(timezone.utc)
        ).date()
        start = end - timedelta(days=safe_days - 1)
        start_value = start.isoformat()
        end_value = end.isoformat()
        with closing(connect(self.paths)) as conn:
            goal_row = conn.execute(
                "SELECT value FROM analysis_settings WHERE key = 'reading_daily_goal'"
            ).fetchone()
            count_rows = conn.execute(
                """
                SELECT checkins.checkin_date, COUNT(*) AS count
                FROM campaign_checkins AS checkins
                JOIN trade_campaigns AS campaigns
                  ON campaigns.id = checkins.campaign_id
                WHERE checkins.checkin_date BETWEEN ? AND ?
                  AND campaigns.deleted_at IS NULL
                  AND campaigns.platform = ?
                GROUP BY checkins.checkin_date
                """,
                (start_value, end_value, platform),
            ).fetchall()
        goal = _normalize_campaign_goal(goal_row["value"] if goal_row else 20)
        counts = {str(row["checkin_date"]): int(row["count"]) for row in count_rows}
        day_rows = []
        for offset in range(safe_days):
            current = start + timedelta(days=offset)
            count = counts.get(current.isoformat(), 0)
            day_rows.append(
                {
                    "date": current.isoformat(),
                    "count": count,
                    "goal": goal,
                    "completed": count >= goal,
                }
            )
        today_value = end.isoformat()
        today_count = counts.get(today_value, 0)
        return {
            "daily_goal": goal,
            "today": {
                "date": today_value,
                "count": today_count,
                "completed": today_count >= goal,
            },
            "days": day_rows,
            "range": {"start": start_value, "end": end_value},
        }

    @staticmethod
    def _source_deleted_clause(deleted: str) -> str:
        state = str(deleted or "active").strip().lower()
        if state == "active":
            return "AND trades.deleted_at IS NULL"
        if state == "deleted":
            return "AND trades.deleted_at IS NOT NULL"
        if state == "all":
            return ""
        raise ValueError("deleted must be active, deleted, or all")

    def query_analysis_rows(
        self,
        start_date: str | None,
        end_date: str | None,
        *,
        platform: str = "mt5",
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        clauses = [
            "campaigns.deleted_at IS NULL",
            "campaigns.status = 'closed'",
        ]
        parameters: list[Any] = []
        clauses.append("campaigns.platform = ?")
        parameters.append(platform)
        start_utc, end_utc = _beijing_date_bounds(start_date, end_date)
        # Direct ISO-string comparison (not julianday()) so the query can SEARCH
        # `idx_campaign_closed_at`; EXPLAIN QUERY PLAN shows a SEARCH on
        # closed_at_utc rather than a full SCAN.
        if start_utc:
            clauses.append("campaigns.closed_at_utc >= ?")
            parameters.append(start_utc)
        if end_utc:
            clauses.append("campaigns.closed_at_utc < ?")
            parameters.append(end_utc)

        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = [
                dict(row)
                for row in active_conn.execute(
                    f"""
                    SELECT campaigns.id, campaigns.trade_date, campaigns.symbol, campaigns.status, campaigns.closed_at_utc,
                           campaigns.closed_at_utc AS close_time_utc,
                           campaigns.trade_pnl AS pnl, campaigns.trade_pnl,
                           campaigns.commission, campaigns.swap, campaigns.fee,
                           campaigns.net_pnl, campaigns.trade_type, campaigns.strategy,
                           campaigns.campaign_r, campaigns.risk_status,
                           campaigns.screenshot_path, campaigns.is_featured,
                           CASE WHEN EXISTS (
                               SELECT 1
                               FROM campaign_positions AS stop_links
                               JOIN positions AS stop_positions
                                 ON stop_positions.id = stop_links.position_id
                               WHERE stop_links.campaign_id = campaigns.id
                                 AND stop_positions.initial_stop_price IS NOT NULL
                           ) THEN 1 ELSE 0 END AS has_initial_stop,
                           campaigns.platform
                    FROM trade_campaigns AS campaigns
                    WHERE {' AND '.join(clauses)}
                    ORDER BY campaigns.closed_at_utc DESC, campaigns.id DESC
                    """,
                    parameters,
                ).fetchall()
            ]
        for row in rows:
            closed_at = row.get("closed_at_utc")
            row["_bj"] = to_beijing(closed_at) if closed_at else None
        return rows

    def records(
        self,
        *,
        conn: sqlite3.Connection | None = None,
        campaign_ids: list[str] | None = None,
        deleted: str = "active",
    ) -> list[dict[str, Any]]:
        if conn is None:
            with closing(connect(self.paths)) as owned_conn:
                return self.records(
                    conn=owned_conn,
                    campaign_ids=campaign_ids,
                    deleted=deleted,
                )

        id_clause = ""
        parameters: list[Any] = []
        if campaign_ids is not None:
            if not campaign_ids:
                return []
            id_clause = f"AND campaigns.id IN ({','.join('?' for _ in campaign_ids)})"
            parameters.extend(campaign_ids)
        deleted_state = str(deleted or "active").strip().lower()
        if deleted_state == "active":
            deleted_clause = "AND campaigns.deleted_at IS NULL"
            source_deleted_clause = "AND trades.deleted_at IS NULL"
        elif deleted_state == "deleted":
            deleted_clause = "AND (campaigns.platform = 'domestic_futures' OR campaigns.deleted_at IS NOT NULL)"
            source_deleted_clause = "AND trades.deleted_at IS NOT NULL"
        elif deleted_state == "all":
            deleted_clause = ""
            source_deleted_clause = ""
        else:
            raise ValueError("deleted must be active, deleted, or all")
        campaign_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT campaigns.*
                FROM trade_campaigns AS campaigns
                WHERE EXISTS (
                      SELECT 1 FROM campaign_positions
                      WHERE campaign_positions.campaign_id = campaigns.id
                  )
                  {deleted_clause}
                  {id_clause}
                ORDER BY COALESCE(campaigns.trade_date, campaigns.closed_at_utc, campaigns.opened_at_utc) DESC,
                         campaigns.id DESC
                """,
                parameters,
            ).fetchall()
        ]
        if not campaign_rows:
            return []
        ordered_ids = [str(row["id"]) for row in campaign_rows]
        placeholders = ",".join("?" for _ in ordered_ids)
        today = to_beijing(datetime.now(timezone.utc)).date().isoformat()
        checkin_rows = conn.execute(
            f"""
            SELECT campaign_id,
                   COUNT(*) AS count,
                   MAX(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) AS checked_in
            FROM campaign_checkins
            WHERE campaign_id IN ({placeholders})
            GROUP BY campaign_id
            """,
            [today, *ordered_ids],
        ).fetchall()
        checkins = {
            str(row["campaign_id"]): {
                "count": int(row["count"]),
                "checked_in": bool(row["checked_in"]),
            }
            for row in checkin_rows
        }

        memberships: dict[str, list[str]] = {campaign_id: [] for campaign_id in ordered_ids}
        for row in conn.execute(
            f"""
            SELECT campaign_id, position_id
            FROM campaign_positions
            WHERE campaign_id IN ({placeholders})
            ORDER BY campaign_id, sort_order
            """,
            ordered_ids,
        ):
            memberships.setdefault(str(row["campaign_id"]), []).append(str(row["position_id"]))

        position_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT DISTINCT positions.*
                FROM positions
                JOIN campaign_positions ON campaign_positions.position_id = positions.id
                WHERE campaign_positions.campaign_id IN ({placeholders})
                """,
                ordered_ids,
            ).fetchall()
        ]
        deal_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT DISTINCT deal_events.deal_ticket, deal_events.platform, deal_events.account,
                       deal_events.position_id, deal_events.order_ticket,
                       deal_events.entry_kind, deal_events.deal_type, deal_events.symbol,
                       deal_events.volume, deal_events.price, deal_events.time_utc,
                       deal_events.time_msc, deal_events.profit, deal_events.commission,
                       deal_events.swap, deal_events.fee, deal_events.screenshot_path,
                       deal_events.source_kind, deal_events.source_trade_id
                FROM deal_events
                JOIN positions
                  ON positions.platform = deal_events.platform
                 AND positions.account = deal_events.account
                 AND positions.position_id = deal_events.position_id
                JOIN campaign_positions ON campaign_positions.position_id = positions.id
                WHERE campaign_positions.campaign_id IN ({placeholders})
                ORDER BY deal_events.time_msc, deal_events.deal_ticket
                """,
                ordered_ids,
            ).fetchall()
        ]
        reconstructed = {
            str(position["id"]): position for position in reconstruct_positions(deal_rows)
        }
        position_domains: dict[str, dict[str, Any]] = {}
        for row in position_rows:
            position = reconstructed.get(str(row["id"]))
            if not position:
                continue
            position = dict(position)
            position["initial_stop_price"] = row["initial_stop_price"]
            position["reconstruction_status"] = row["reconstruction_status"]
            position_domains[str(row["id"])] = position

        source_ids: dict[str, list[str]] = {campaign_id: [] for campaign_id in ordered_ids}
        for row in conn.execute(
            f"""
            SELECT campaign_id, trade_id
            FROM campaign_source_trades
            WHERE campaign_id IN ({placeholders})
            ORDER BY campaign_id, trade_id
            """,
            ordered_ids,
        ):
            source_ids.setdefault(str(row["campaign_id"]), []).append(str(row["trade_id"]))
        source_rows = [
            dict(row)
            for row in conn.execute(
                f"""
                SELECT DISTINCT trades.*
                FROM trades
                JOIN campaign_source_trades ON campaign_source_trades.trade_id = trades.id
                WHERE campaign_source_trades.campaign_id IN ({placeholders})
                  {source_deleted_clause}
                ORDER BY trades.close_time_utc, trades.id
                """,
                ordered_ids,
            ).fetchall()
        ]
        source_custom_values = self.catalog.custom_values_for_trade_ids(
            conn, [str(row["id"]) for row in source_rows]
        )
        source_imports = import_sources_for_trade_ids(
            conn, [str(row["id"]) for row in source_rows]
        )
        source_by_position: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in source_rows:
            row["custom_fields"] = source_custom_values.get(str(row["id"]), {})
            row["import_sources"] = source_imports.get(str(row["id"]), [])
            key = (
                str(row.get("platform") or "mt5"),
                str(row.get("account") or "MT5-LOCAL"),
                str(row.get("position_id") or row["id"]),
            )
            source_by_position.setdefault(key, []).append(row)

        records = []
        for campaign in campaign_rows:
            campaign_id = str(campaign["id"])
            checkin = checkins.get(campaign_id, {"count": 0, "checked_in": False})
            campaign["checkin_count"] = checkin["count"]
            campaign["checkin_checked_in_today"] = checkin["checked_in"]
            campaign["reading_checkin_count"] = checkin["count"]
            campaign["reading_checked_in_today"] = checkin["checked_in"]
            members = [
                position_domains[position_id]
                for position_id in memberships.get(campaign_id, [])
                if position_id in position_domains
            ]
            for member in members:
                related_sources = source_by_position.get(
                    (
                        str(member.get("platform") or "mt5"),
                        str(member.get("account") or "MT5-LOCAL"),
                        str(member.get("position_id") or ""),
                    ),
                    [],
                )
                member["source_trades"] = related_sources
                member["source_trade"] = related_sources[-1] if related_sources else None
                if related_sources:
                    representative = related_sources[-1]
                    for key in ("review_text", "custom_fields", "trade_type", "strategy"):
                        member[key] = representative.get(key)

            grouped = group_campaigns(members)
            aggregate = grouped[0] if grouped else {}
            risk = calculate_campaign_r(campaign, members)
            stop_values = [
                member.get("initial_stop_price")
                for member in members
                if member.get("initial_stop_price") not in (None, "")
            ]
            normalized_stops = []
            for value in stop_values:
                try:
                    normalized_stops.append(float(value))
                except (TypeError, ValueError):
                    normalized_stops = []
                    break
            campaign["initial_stop_price"] = (
                stop_values[0]
                if len(stop_values) == len(members)
                and normalized_stops
                and all(value == normalized_stops[0] for value in normalized_stops)
                else None
            )
            campaign["trade_type_tags"] = _json_tags(campaign.get("trade_type_tags"))
            campaign["strategy_tags"] = _json_tags(campaign.get("strategy_tags"))
            campaign["mistake_tags"] = _json_tags(campaign.get("mistake_tags"))
            records.append(
                {
                    **campaign,
                    **risk,
                    "positions": members,
                    "position_count": int(aggregate.get("position_count") or len(members)),
                    "scale_in_count": int(aggregate.get("scale_in_count") or 0),
                    "partial_exit_count": int(aggregate.get("partial_exit_count") or 0),
                    "source_trade_ids": source_ids.get(campaign_id, []),
                    "entry_volume": float(aggregate.get("entry_volume") or 0.0),
                    "exit_volume": float(aggregate.get("exit_volume") or 0.0),
                    "weighted_entry_price": aggregate.get("weighted_entry_price"),
                    "weighted_exit_price": aggregate.get("weighted_exit_price"),
                    "holding_seconds": aggregate.get("holding_seconds"),
                }
            )
        return records

    def rebuild(
        self,
        affected_accounts: Iterable[str] | None = None,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> None:
        if conn is not None:
            self.rebuild_in_transaction(conn, affected_accounts)
            return
        with transaction(self.paths) as owned_conn:
            self.rebuild_in_transaction(owned_conn, affected_accounts)

    def rebuild_in_transaction(
        self,
        conn: sqlite3.Connection,
        affected_accounts: Iterable[str] | None = None,
    ) -> None:
        # Rebuilding all accounts preserves grouping correctness when a write
        # changes an event's account or legacy Position identity.
        del affected_accounts
        self._sync_legacy_deal_events(conn)
        deal_rows = [
            dict(row)
            for row in conn.execute(
                """
                SELECT deal_ticket, platform, account, position_id, order_ticket, entry_kind,
                       deal_type, symbol, volume, price, time_utc, time_msc, profit,
                       commission, swap, fee, screenshot_path, source_kind, source_trade_id
                FROM deal_events
                ORDER BY time_msc, deal_ticket
                """
            )
        ]
        positions = reconstruct_positions(deal_rows)
        source_kinds: dict[str, set[str]] = {}
        for deal in deal_rows:
            key = f"{deal.get('platform') or 'mt5'}:{deal['account']}:{deal['position_id']}"
            source_kinds.setdefault(key, set()).add(str(deal.get("source_kind") or "mt5"))

        previous_stops = {
            str(row["id"]): row["initial_stop_price"]
            for row in conn.execute("SELECT id, initial_stop_price FROM positions")
        }
        previous_classifications = {
            str(row["id"]): {
                "trade_type": str(row["trade_type"] or "unclassified"),
                "strategy": str(row["strategy"] or "strategy_unclassified"),
                "trade_type_tags": _json_tags(row["trade_type_tags"]),
                "strategy_tags": _json_tags(row["strategy_tags"]),
                "mistake_tags": _json_tags(row["mistake_tags"]),
            }
            for row in conn.execute(
                "SELECT id, trade_type, strategy, trade_type_tags, strategy_tags, mistake_tags FROM trade_campaigns"
            )
        }
        previous_memberships = {
            str(row["position_id"]): {
                "campaign_id": str(row["campaign_id"]),
                "created_at": row["created_at"],
            }
            for row in conn.execute(
                """
                SELECT campaign_positions.position_id, campaign_positions.campaign_id,
                       trade_campaigns.created_at
                FROM campaign_positions
                JOIN trade_campaigns ON trade_campaigns.id = campaign_positions.campaign_id
                """
            )
        }
        for row in conn.execute(
            "SELECT position_id, campaign_id, campaign_created_at FROM campaign_position_history"
        ):
            previous_memberships.setdefault(
                str(row["position_id"]),
                {
                    "campaign_id": str(row["campaign_id"]),
                    "created_at": row["campaign_created_at"],
                },
            )

        for position in positions:
            if (
                position["reconstruction_status"] == "complete"
                and source_kinds.get(str(position["id"])) == {"legacy"}
            ):
                position["reconstruction_status"] = "legacy_estimated"
            position["initial_stop_price"] = previous_stops.get(str(position["id"]))
            opened_ticket = str(
                position["entry_deals"][0]["deal_ticket"] if position["entry_deals"] else ""
            )
            closed_ticket = str(
                position["exit_deals"][-1]["deal_ticket"] if position["exit_deals"] else ""
            )
            conn.execute(
                """
                INSERT INTO positions (
                    id, platform, account, position_id, symbol, side, opened_at_utc, closed_at_utc,
                    opened_sort_msc, opened_sort_ticket, closed_sort_msc, closed_sort_ticket,
                    entry_volume, exit_volume, weighted_entry_price, reconstruction_status,
                    initial_stop_price
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    account = excluded.account,
                    platform = excluded.platform,
                    position_id = excluded.position_id,
                    symbol = excluded.symbol,
                    side = excluded.side,
                    opened_at_utc = excluded.opened_at_utc,
                    closed_at_utc = excluded.closed_at_utc,
                    opened_sort_msc = excluded.opened_sort_msc,
                    opened_sort_ticket = excluded.opened_sort_ticket,
                    closed_sort_msc = excluded.closed_sort_msc,
                    closed_sort_ticket = excluded.closed_sort_ticket,
                    entry_volume = excluded.entry_volume,
                    exit_volume = excluded.exit_volume,
                    weighted_entry_price = excluded.weighted_entry_price,
                    reconstruction_status = excluded.reconstruction_status,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    position["id"],
                    position.get("platform") or "mt5",
                    position["account"],
                    position["position_id"],
                    position["symbol"],
                    position["side"],
                    position["opened_at_utc"],
                    position["closed_at_utc"],
                    int(position["opened_sort_key"][0]),
                    opened_ticket,
                    int(position["closed_sort_key"][0]) if position.get("closed_sort_key") else None,
                    closed_ticket or None,
                    position["entry_volume"],
                    position["exit_volume"],
                    position["weighted_entry_price"],
                    position["reconstruction_status"],
                    position["initial_stop_price"],
                ),
            )

        source_rows = [dict(row) for row in conn.execute("SELECT * FROM trades")]
        source_by_position: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in source_rows:
            key = (
                str(row.get("platform") or "mt5"),
                str(row.get("account") or "MT5-LOCAL"),
                str(row.get("position_id") or row["id"]),
            )
            source_by_position.setdefault(key, []).append(row)

        reserved_campaign_ids = {
            str(row["id"]) for row in conn.execute("SELECT id FROM trade_campaigns")
        }
        conn.execute("DELETE FROM campaign_positions")
        conn.execute("DELETE FROM campaign_source_trades")
        claimed_campaign_ids: set[str] = set()
        for campaign in group_campaigns(positions):
            candidates = {
                previous_memberships[position_id]["campaign_id"]: previous_memberships[position_id][
                    "created_at"
                ]
                for position_id in campaign["position_ids"]
                if position_id in previous_memberships
            }
            available_candidates = [
                candidate_id
                for candidate_id in candidates
                if candidate_id not in claimed_campaign_ids
            ]
            if available_candidates:
                campaign_id = min(
                    available_candidates,
                    key=lambda key: (str(candidates[key]), key),
                )
            else:
                identity = "\x1f".join(
                    sorted(str(value) for value in campaign["position_ids"])
                )
                probe = 0
                while True:
                    seed = identity if probe == 0 else f"{identity}\x1f{probe}"
                    campaign_id = str(uuid.uuid5(CAMPAIGN_ID_NAMESPACE, seed))
                    if (
                        campaign_id not in reserved_campaign_ids
                        and campaign_id not in claimed_campaign_ids
                    ):
                        break
                    probe += 1
            claimed_campaign_ids.add(campaign_id)
            related_rows = []
            for member in campaign["positions"]:
                related_rows.extend(
                source_by_position.get((member.get("platform") or "mt5", member["account"], member["position_id"]), [])
                )
            active_rows = [row for row in related_rows if not row.get("deleted_at")]
            active_rows.sort(
                key=lambda row: (str(row.get("close_time_utc") or ""), str(row["id"]))
            )
            review_rows = [
                (str(row["id"]), str(row.get("review_text") or "").strip())
                for row in active_rows
                if str(row.get("review_text") or "").strip()
            ]
            reviews = [
                review
                if len(review_rows) == 1
                else self.review_formatter(trade_id, review)
                for trade_id, review in review_rows
            ]
            trade_types = list(
                dict.fromkeys(
                    str(row.get("trade_type") or "unclassified") for row in active_rows
                )
            )
            strategies = list(
                dict.fromkeys(
                    str(row.get("strategy") or "strategy_unclassified") for row in active_rows
                )
            )
            previous_classification = previous_classifications.get(campaign_id)
            if previous_classification:
                campaign_trade_type = previous_classification["trade_type"]
                campaign_strategy = previous_classification["strategy"]
                campaign_trade_type_tags = previous_classification["trade_type_tags"] or [campaign_trade_type]
                campaign_strategy_tags = previous_classification["strategy_tags"] or [campaign_strategy]
                campaign_mistake_tags = previous_classification["mistake_tags"]
            else:
                campaign_trade_type = trade_types[0] if trade_types else "unclassified"
                campaign_strategy = strategies[0] if strategies else "strategy_unclassified"
                campaign_trade_type_tags = trade_types or [campaign_trade_type]
                campaign_strategy_tags = strategies or [campaign_strategy]
                campaign_mistake_tags = []
            screenshot_path = next(
                (
                    str(row.get("screenshot_path") or "")
                    for row in reversed(active_rows)
                    if row.get("screenshot_path")
                ),
                "",
            )
            trade_pnl = round(
                sum(float(row.get("pnl") or 0.0) for row in active_rows), 2
            )
            opening_rows = sorted(
                active_rows,
                key=lambda row: (str(row.get("open_time_utc") or ""), str(row["id"])),
            )
            campaign_trade_date = next(
                (
                    str(row.get("trade_date") or "").strip()
                    for row in opening_rows
                    if str(row.get("trade_date") or "").strip()
                ),
                None,
            )
            commission = round(
                sum(float(row.get("commission") or 0.0) for row in active_rows), 2
            )
            swap = round(sum(float(row.get("swap") or 0.0) for row in active_rows), 2)
            fee = round(sum(float(row.get("fee") or 0.0) for row in active_rows), 2)
            net_pnl = round(trade_pnl + commission + swap + fee, 2)
            is_featured = int(any(bool(row.get("is_featured")) for row in active_rows))
            risk = calculate_campaign_r(campaign, campaign["positions"])
            conn.execute(
                """
                INSERT INTO trade_campaigns (
                    id, platform, trade_date, account, symbol, side, opened_at_utc, closed_at_utc, status,
                    trade_pnl, commission, swap, fee, net_pnl, review_text,
                    trade_type, strategy, screenshot_path, is_featured,
                    classification_conflict, campaign_r, risk_status,
                    trade_type_tags, strategy_tags, mistake_tags
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    account = excluded.account,
                    platform = excluded.platform,
                    trade_date = excluded.trade_date,
                    symbol = excluded.symbol,
                    side = excluded.side,
                    opened_at_utc = excluded.opened_at_utc,
                    closed_at_utc = excluded.closed_at_utc,
                    status = excluded.status,
                    trade_pnl = excluded.trade_pnl,
                    commission = excluded.commission,
                    swap = excluded.swap,
                    fee = excluded.fee,
                    net_pnl = excluded.net_pnl,
                    is_featured = MAX(trade_campaigns.is_featured, excluded.is_featured),
                    trade_type = excluded.trade_type,
                    strategy = excluded.strategy,
                    review_text = CASE
                        WHEN trade_campaigns.review_text = '' THEN excluded.review_text
                        ELSE trade_campaigns.review_text
                    END,
                    screenshot_path = CASE
                        WHEN excluded.screenshot_path != '' THEN excluded.screenshot_path
                        ELSE trade_campaigns.screenshot_path
                    END,
                    classification_conflict = excluded.classification_conflict,
                    campaign_r = excluded.campaign_r,
                    risk_status = excluded.risk_status,
                    deleted_at = CASE
                        WHEN ? = 1 THEN COALESCE(trade_campaigns.deleted_at, CURRENT_TIMESTAMP)
                        ELSE NULL
                    END,
                    trade_type_tags = excluded.trade_type_tags,
                    strategy_tags = excluded.strategy_tags,
                    mistake_tags = excluded.mistake_tags,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    campaign_id,
                    campaign.get("platform") or "mt5",
                    campaign_trade_date,
                    campaign["account"],
                    campaign["symbol"],
                    campaign["side"],
                    campaign["opened_at_utc"],
                    campaign["closed_at_utc"],
                    campaign["status"],
                    trade_pnl,
                    commission,
                    swap,
                    fee,
                    net_pnl,
                    "\n\n".join(reviews),
                    campaign_trade_type,
                    campaign_strategy,
                    screenshot_path,
                    is_featured,
                    int(len(trade_types) > 1 or len(strategies) > 1),
                    risk["campaign_r"],
                    risk["risk_status"],
                    json.dumps(campaign_trade_type_tags, ensure_ascii=False),
                    json.dumps(campaign_strategy_tags, ensure_ascii=False),
                    json.dumps(campaign_mistake_tags, ensure_ascii=False),
                    int(bool(related_rows) and not active_rows),
                ),
            )
            for index, member in enumerate(campaign["positions"]):
                conn.execute(
                    "INSERT INTO campaign_positions (campaign_id, position_id, sort_order) VALUES (?, ?, ?)",
                    (campaign_id, member["id"], index),
                )
                created_at = conn.execute(
                    "SELECT created_at FROM trade_campaigns WHERE id = ?", (campaign_id,)
                ).fetchone()["created_at"]
                conn.execute(
                    """
                    INSERT INTO campaign_position_history (
                        position_id, campaign_id, campaign_created_at
                    ) VALUES (?, ?, ?)
                    ON CONFLICT(position_id) DO UPDATE SET
                        campaign_id = excluded.campaign_id,
                        campaign_created_at = excluded.campaign_created_at
                    """,
                    (member["id"], campaign_id, created_at),
                )
            for row in related_rows:
                conn.execute(
                    "INSERT OR IGNORE INTO campaign_source_trades (campaign_id, trade_id) VALUES (?, ?)",
                    (campaign_id, row["id"]),
                )
        conn.execute(
            """
            INSERT INTO schema_meta (key, value) VALUES ('model_revision', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (CAMPAIGN_MODEL_REVISION,),
        )

    def _sync_legacy_deal_events(self, conn: sqlite3.Connection) -> None:
        conn.execute("DELETE FROM deal_events WHERE source_kind = 'legacy'")
        rows = [dict(row) for row in conn.execute("SELECT * FROM trades ORDER BY open_time_utc, id")]
        grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
        for row in rows:
            platform = str(row.get("platform") or "mt5")
            account = str(row.get("account") or "MT5-LOCAL")
            position_id = str(row.get("position_id") or row["id"])
            grouped.setdefault((platform, account, position_id), []).append(row)

        for (platform, account, position_id), source_rows in grouped.items():
            has_native = conn.execute(
                """
                SELECT 1 FROM deal_events
                WHERE platform = ? AND account = ? AND position_id = ? AND source_kind = 'mt5'
                LIMIT 1
                """,
                (platform, account, position_id),
            ).fetchone()
            if has_native:
                continue
            if not source_rows:
                continue
            source_rows.sort(key=lambda row: (str(row["open_time_utc"]), str(row["id"])))
            total_volume = sum(float(row.get("lots") or 0.0) for row in source_rows)
            if total_volume <= 0:
                continue
            entry_price = sum(
                float(row.get("lots") or 0.0) * float(row.get("entry_price") or 0.0)
                for row in source_rows
            ) / total_volume
            first = source_rows[0]
            side = str(first.get("side") or "long").lower()
            conn.execute(
                """
                INSERT INTO deal_events (
                    deal_ticket, platform, account, position_id, order_ticket, entry_kind, deal_type,
                    symbol, volume, price, time_utc, time_msc, profit, commission, swap,
                    fee, screenshot_path, source_kind, source_trade_id, raw_json
                ) VALUES (?, ?, ?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '', 'legacy', ?, ?)
                """,
                (
                    f"legacy-in:{platform}:{account}:{position_id}",
                    platform,
                    account,
                    position_id,
                    str(first.get("order_ticket") or ""),
                    "buy" if side == "long" else "sell",
                    str(first.get("symbol") or ""),
                    total_volume,
                    entry_price,
                    str(first["open_time_utc"]),
                    _legacy_time_msc(str(first["open_time_utc"])),
                    str(first["id"]),
                    json.dumps(
                        {
                            "legacy_estimated": True,
                            "source_trade_ids": [row["id"] for row in source_rows],
                        }
                    ),
                ),
            )
            for index, row in enumerate(source_rows):
                close_time = str(row["close_time_utc"])
                conn.execute(
                    """
                    INSERT INTO deal_events (
                        deal_ticket, platform, account, position_id, order_ticket, entry_kind, deal_type,
                        symbol, volume, price, time_utc, time_msc, profit, commission, swap,
                        fee, screenshot_path, source_kind, source_trade_id, raw_json
                    ) VALUES (?, ?, ?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy', ?, ?)
                    """,
                    (
                        f"legacy-out:{platform}:{row['id']}",
                        platform,
                        account,
                        position_id,
                        str(row.get("order_ticket") or ""),
                        "sell" if side == "long" else "buy",
                        str(row.get("symbol") or ""),
                        float(row.get("lots") or 0.0),
                        float(row.get("exit_price") or 0.0),
                        close_time,
                        _legacy_time_msc(close_time) + index,
                        float(row.get("pnl") or 0.0),
                        float(row.get("commission") or 0.0),
                        float(row.get("swap") or 0.0),
                        float(row.get("fee") or 0.0),
                        str(row.get("screenshot_path") or ""),
                        str(row["id"]),
                        str(row.get("raw_json") or ""),
                    ),
                )

    @staticmethod
    def _where(filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
        clauses = [
            "EXISTS (SELECT 1 FROM campaign_positions "
            "WHERE campaign_positions.campaign_id = campaigns.id)"
        ]
        parameters: list[Any] = []
        platform = str(filters.get("platform") or "mt5").strip()
        clauses.append("campaigns.platform = ?")
        parameters.append(platform)
        deleted = str(filters.get("deleted") or "active").strip().lower()
        if deleted == "active":
            clauses.append("campaigns.deleted_at IS NULL")
            if platform == "domestic_futures":
                clauses.append(
                    "EXISTS (SELECT 1 FROM campaign_source_trades "
                    "JOIN trades ON trades.id = campaign_source_trades.trade_id "
                    "WHERE campaign_source_trades.campaign_id = campaigns.id "
                    "AND trades.deleted_at IS NULL)"
                )
        elif deleted == "deleted":
            if platform == "domestic_futures":
                clauses.append(
                    "EXISTS (SELECT 1 FROM campaign_source_trades "
                    "JOIN trades ON trades.id = campaign_source_trades.trade_id "
                    "WHERE campaign_source_trades.campaign_id = campaigns.id "
                    "AND trades.deleted_at IS NOT NULL)"
                )
            else:
                clauses.append("campaigns.deleted_at IS NOT NULL")
        elif deleted != "all":
            raise ValueError("deleted must be active, deleted, or all")

        featured = filters.get("featured", filters.get("is_featured"))
        if featured in (True, 1, "1", "true", "True"):
            clauses.append("campaigns.is_featured = 1")

        needle = str(filters.get("query") or filters.get("q") or "").strip().casefold()
        if needle:
            pattern = f"%{_escape_like(needle)}%"
            clauses.append(
                "(LOWER(COALESCE(campaigns.id, '')) LIKE ? ESCAPE '\\' "
                "OR LOWER(COALESCE(campaigns.symbol, '')) LIKE ? ESCAPE '\\' "
                "OR EXISTS (SELECT 1 FROM campaign_source_trades "
                "WHERE campaign_source_trades.campaign_id = campaigns.id "
                "AND LOWER(campaign_source_trades.trade_id) LIKE ? ESCAPE '\\'))"
            )
            parameters.extend([pattern, pattern, pattern])
        for key in ("symbol", "side", "trade_type", "strategy", "status"):
            value = str(filters.get(key) or "").strip()
            if value and value != "all":
                if key in {"trade_type", "strategy"}:
                    clauses.append(
                        f"(campaigns.{key} = ? OR EXISTS ("
                        f"SELECT 1 FROM json_each(COALESCE(campaigns.{key}_tags, '[]')) "
                        "WHERE json_each.value = ?))"
                    )
                    parameters.extend([value, value])
                else:
                    clauses.append(f"campaigns.{key} = ?")
                    parameters.append(value)

        start_date = filters.get("start_date") or filters.get("start")
        end_date = filters.get("end_date") or filters.get("end")
        start_utc, end_utc = _beijing_date_bounds(start_date, end_date)
        if platform == "domestic_futures":
            if start_date:
                clauses.append("campaigns.trade_date >= ?")
                parameters.append(str(start_date))
            if end_date:
                clauses.append("campaigns.trade_date <= ?")
                parameters.append(str(end_date))
        else:
            if start_utc:
                clauses.append("julianday(campaigns.closed_at_utc) >= julianday(?)")
                parameters.append(start_utc)
            if end_utc:
                clauses.append("julianday(campaigns.closed_at_utc) < julianday(?)")
                parameters.append(end_utc)
        if filters.get("r_missing_only") or filters.get("r_missing"):
            clauses.append(
                "(campaigns.status != 'closed' OR EXISTS ("
                "SELECT 1 FROM campaign_positions "
                "JOIN positions ON positions.id = campaign_positions.position_id "
                "WHERE campaign_positions.campaign_id = campaigns.id "
                "AND (positions.initial_stop_price IS NULL "
                "OR positions.weighted_entry_price IS NULL "
                "OR positions.reconstruction_status NOT IN ('complete', 'legacy_estimated') "
                "OR EXISTS (SELECT 1 FROM deal_events AS entry_deals "
                "WHERE entry_deals.platform = positions.platform "
                "AND entry_deals.account = positions.account "
                "AND entry_deals.position_id = positions.position_id "
                "AND PYTHON_STRIP_LOWER(entry_deals.entry_kind) "
                "IN ('in', 'deal_entry_in', '0') "
                "AND ((positions.side = 'long' "
                "AND positions.initial_stop_price >= entry_deals.price) "
                "OR (positions.side = 'short' "
                "AND positions.initial_stop_price <= entry_deals.price))))))"
            )
        return clauses, parameters


def _legacy_time_msc(value: str, fallback: int = 0) -> int:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError):
        return int(fallback)


def _coerce_campaign_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError) as exc:
        raise ValueError("today must be YYYY-MM-DD") from exc


def _normalize_campaign_goal(value: Any) -> int:
    try:
        goal = int(value)
    except (TypeError, ValueError):
        return 20
    return max(1, min(goal, 500))

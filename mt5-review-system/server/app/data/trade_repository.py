from __future__ import annotations

import json
from contextlib import closing, nullcontext
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from ..core.config import RuntimePaths
from ..domain.analytics import to_beijing
from ..platform_modules.domestic_futures_contracts import contract_display
from ..platforms import DOMESTIC_FUTURES_PLATFORM
from .catalog_repository import CatalogRepository
from .database import connect


BEIJING_TIMEZONE = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class Page:
    items: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class TradeRepository:
    def __init__(self, paths: RuntimePaths) -> None:
        self.paths = paths
        self.catalog = CatalogRepository(paths)

    def query(
        self,
        filters: dict[str, Any],
        page: int,
        page_size: int,
    ) -> Page:
        safe_page = max(1, int(page))
        safe_size = max(1, min(int(page_size), 200))
        clauses, parameters = self._where(filters)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        from_sql = "FROM trades LEFT JOIN trends ON trends.id = trades.trend_id"

        with closing(connect(self.paths)) as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) AS value {from_sql} {where_sql}",
                    parameters,
                ).fetchone()["value"]
            )
            rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT trades.*, trends.name AS trend_name, trends.color AS trend_color
                    {from_sql}
                    {where_sql}
                    ORDER BY trades.close_time_utc DESC, trades.id DESC
                    LIMIT ? OFFSET ?
                    """,
                    [*parameters, safe_size, (safe_page - 1) * safe_size],
                ).fetchall()
            ]
            custom_values = self.catalog.custom_values_for_trade_ids(
                conn, [str(row["id"]) for row in rows]
            )
            campaign_reviews = self._campaign_reviews_for_trade_ids(
                conn,
                [str(row["id"]) for row in rows],
                str(filters.get("platform") or "mt5"),
            )

        for row in rows:
            row["custom_fields"] = custom_values.get(str(row["id"]), {})
            row.update(campaign_reviews.get(str(row["id"]), {}))
        return Page(rows, total, safe_page, safe_size)

    def query_analysis_rows(
        self,
        start_date: str | None,
        end_date: str | None,
        *,
        platform: str = "mt5",
        conn: Any | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["trades.deleted_at IS NULL"]
        parameters: list[Any] = []
        clauses.append("trades.platform = ?")
        parameters.append(platform)
        start_utc, end_utc = _beijing_date_bounds(start_date, end_date)
        # Direct ISO-string comparison (not julianday()) so the query can SEARCH
        # `idx_trades_close_time`; EXPLAIN QUERY PLAN shows a SEARCH on
        # close_time_utc rather than a full SCAN. All close_time_utc values are
        # stored as UTC ISO-8601 strings, so lexicographic order == time order.
        if start_utc:
            clauses.append("trades.close_time_utc >= ?")
            parameters.append(start_utc)
        if end_utc:
            clauses.append("trades.close_time_utc < ?")
            parameters.append(end_utc)
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = active_conn.execute(
                f"""
                SELECT trades.id, trades.close_time_utc, trades.symbol,
                       trades.product_name, trades.contract_name, trades.pnl,
                       trades.commission, trades.swap, trades.fee,
                       trades.review_text, trades.screenshot_path,
                       trades.trade_type, trades.strategy,
                       CASE WHEN EXISTS (
                           SELECT 1
                           FROM campaign_source_trades AS source_links
                           JOIN campaign_positions AS campaign_links
                             ON campaign_links.campaign_id = source_links.campaign_id
                           JOIN positions AS linked_positions
                             ON linked_positions.id = campaign_links.position_id
                            AND linked_positions.platform = trades.platform
                           WHERE source_links.trade_id = trades.id
                             AND linked_positions.initial_stop_price IS NOT NULL
                       ) THEN 1 ELSE 0 END AS has_initial_stop,
                       (COALESCE(trades.pnl, 0.0) + COALESCE(trades.commission, 0.0)
                        + COALESCE(trades.swap, 0.0) + COALESCE(trades.fee, 0.0)) AS net_pnl
                FROM trades
                WHERE {' AND '.join(clauses)}
                ORDER BY trades.close_time_utc ASC
                """,
                parameters,
            ).fetchall()
        result: list[dict[str, Any]] = []
        for row in rows:
            trade = dict(row)
            # The four cost columns are collapsed into a single summed column in
            # SQL to shrink the fetched payload; `round` stays here so the result
            # matches Python's `round` semantics exactly (SQLite's ROUND differs
            # on half-way ties).
            trade["net_pnl"] = round(trade["net_pnl"], 2)
            trade["_bj"] = to_beijing(trade["close_time_utc"])
            result.append(trade)
        return result

    def query_album(
        self,
        filters: dict[str, Any],
        page: int,
        page_size: int,
    ) -> Page:
        safe_page = max(1, int(page))
        safe_size = max(1, min(int(page_size), 100))
        clauses, parameters = self._album_where(filters)
        where_sql = f"WHERE {' AND '.join(clauses)}"
        sort = str(filters.get("sort") or "desc").lower()
        if sort not in {"asc", "desc"}:
            raise ValueError("sort must be asc or desc")
        direction = "ASC" if sort == "asc" else "DESC"

        with closing(connect(self.paths)) as conn:
            total = int(
                conn.execute(
                    f"SELECT COUNT(*) AS value FROM trades {where_sql}",
                    parameters,
                ).fetchone()["value"]
            )
            rows = [
                dict(row)
                for row in conn.execute(
                    f"""
                    SELECT trades.*, trends.name AS trend_name,
                           trends.color AS trend_color
                    FROM trades
                    LEFT JOIN trends ON trends.id = trades.trend_id
                    {where_sql}
                    ORDER BY trades.close_time_utc {direction}, trades.id {direction}
                    LIMIT ? OFFSET ?
                    """,
                    [*parameters, safe_size, (safe_page - 1) * safe_size],
                ).fetchall()
            ]
            custom_values = self.catalog.custom_values_for_trade_ids(
                conn, [str(row["id"]) for row in rows]
            )
            campaign_reviews = self._campaign_reviews_for_trade_ids(
                conn,
                [str(row["id"]) for row in rows],
                str(filters.get("platform") or "mt5"),
            )
        for row in rows:
            row["custom_fields"] = custom_values.get(str(row["id"]), {})
            row.update(campaign_reviews.get(str(row["id"]), {}))
        return Page(rows, total, safe_page, safe_size)

    def random_album_trade(self, platform: str = "mt5") -> dict[str, Any] | None:
        clauses, parameters = self._album_where({"archived": False, "platform": platform})
        where_sql = f"WHERE {' AND '.join(clauses)}"
        with closing(connect(self.paths)) as conn:
            row = conn.execute(
                f"""
                SELECT trades.*, trends.name AS trend_name,
                       trends.color AS trend_color
                FROM trades
                LEFT JOIN trends ON trends.id = trades.trend_id
                {where_sql}
                ORDER BY RANDOM()
                LIMIT 1
                """,
                parameters,
            ).fetchone()
            if row is None:
                return None
            trade = dict(row)
            custom_values = self.catalog.custom_values_for_trade_ids(
                conn, [str(trade["id"])]
            )
            campaign_reviews = self._campaign_reviews_for_trade_ids(
                conn, [str(trade["id"])], platform
            )
        trade["custom_fields"] = custom_values.get(str(trade["id"]), {})
        trade.update(campaign_reviews.get(str(trade["id"]), {}))
        return trade

    @staticmethod
    def _campaign_reviews_for_trade_ids(
        conn: Any,
        trade_ids: list[str],
        platform: str,
    ) -> dict[str, dict[str, Any]]:
        if not trade_ids:
            return {}
        placeholders = ",".join("?" for _ in trade_ids)
        rows = conn.execute(
            f"""
            SELECT campaign_source_trades.trade_id,
                   trade_campaigns.id AS campaign_id,
                   trade_campaigns.review_text,
                   trade_campaigns.trade_type_tags,
                   trade_campaigns.strategy_tags,
                   trade_campaigns.mistake_tags
            FROM campaign_source_trades
            JOIN trade_campaigns
              ON trade_campaigns.id = campaign_source_trades.campaign_id
            WHERE campaign_source_trades.trade_id IN ({placeholders})
              AND trade_campaigns.platform = ?
              AND trade_campaigns.deleted_at IS NULL
            ORDER BY trade_campaigns.updated_at DESC, trade_campaigns.id DESC
            """,
            [*trade_ids, platform],
        ).fetchall()
        result: dict[str, dict[str, Any]] = {}
        for row in rows:
            trade_id = str(row["trade_id"])
            if trade_id in result:
                continue
            result[trade_id] = {
                "campaign_id": str(row["campaign_id"]),
                "review_text": str(row["review_text"] or ""),
                "trade_type_tags": _json_tags(row["trade_type_tags"]),
                "strategy_tags": _json_tags(row["strategy_tags"]),
                "mistake_tags": _json_tags(row["mistake_tags"]),
            }
        return result

    def list_album_mistake_tags(self, platform: str = "mt5") -> list[str]:
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT CAST(mistake.value AS TEXT) AS tag
                FROM trade_campaigns
                JOIN campaign_source_trades
                  ON campaign_source_trades.campaign_id = trade_campaigns.id
                JOIN trades
                  ON trades.id = campaign_source_trades.trade_id
                 AND trades.platform = trade_campaigns.platform
                JOIN json_each(
                    CASE WHEN json_valid(trade_campaigns.mistake_tags)
                         THEN trade_campaigns.mistake_tags ELSE '[]' END
                ) AS mistake
                WHERE trade_campaigns.platform = ?
                  AND trade_campaigns.deleted_at IS NULL
                  AND trades.deleted_at IS NULL
                  AND CAST(mistake.value AS TEXT) <> ''
                ORDER BY tag
                """,
                (platform,),
            ).fetchall()
        return [str(row["tag"]) for row in rows]

    def reading_checkin_status(
        self,
        trade_ids: list[str],
        checkin_date: str | None = None,
    ) -> set[str]:
        ids = [str(trade_id) for trade_id in trade_ids if str(trade_id)]
        if not ids:
            return set()
        day = checkin_date or _beijing_today()
        placeholders = ",".join("?" for _ in ids)
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                f"""
                SELECT DISTINCT links.trade_id
                FROM campaign_source_trades AS links
                JOIN campaign_checkins AS checkins
                  ON checkins.campaign_id = links.campaign_id
                JOIN trade_campaigns AS campaigns
                  ON campaigns.id = links.campaign_id
                WHERE checkins.checkin_date = ?
                  AND links.trade_id IN ({placeholders})
                  AND campaigns.deleted_at IS NULL
                """,
                [day, *ids],
            ).fetchall()
        return {str(row["trade_id"]) for row in rows}

    def reading_checkin_counts(self, trade_ids: list[str]) -> dict[str, int]:
        ids = [str(trade_id) for trade_id in trade_ids if str(trade_id)]
        if not ids:
            return {}
        placeholders = ",".join("?" for _ in ids)
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                f"""
                SELECT links.trade_id, COUNT(DISTINCT checkins.checkin_date) AS count
                FROM campaign_source_trades AS links
                JOIN campaign_checkins AS checkins
                  ON checkins.campaign_id = links.campaign_id
                JOIN trade_campaigns AS campaigns
                  ON campaigns.id = links.campaign_id
                WHERE links.trade_id IN ({placeholders})
                  AND campaigns.deleted_at IS NULL
                GROUP BY links.trade_id
                """,
                ids,
            ).fetchall()
        return {str(row["trade_id"]): int(row["count"]) for row in rows}

    def reading_checkin_summary(
        self,
        trade_ids: list[str],
        checkin_date: str | None = None,
    ) -> dict[str, dict[str, int | bool]]:
        ids = [str(trade_id) for trade_id in trade_ids if str(trade_id)]
        if not ids:
            return {}
        day = checkin_date or _beijing_today()
        placeholders = ",".join("?" for _ in ids)
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                f"""
                SELECT links.trade_id,
                       COUNT(DISTINCT checkins.checkin_date) AS count,
                       MAX(CASE WHEN checkins.checkin_date = ? THEN 1 ELSE 0 END) AS checked_in
                FROM campaign_source_trades AS links
                JOIN campaign_checkins AS checkins
                  ON checkins.campaign_id = links.campaign_id
                JOIN trade_campaigns AS campaigns
                  ON campaigns.id = links.campaign_id
                WHERE links.trade_id IN ({placeholders})
                  AND campaigns.deleted_at IS NULL
                GROUP BY links.trade_id
                """,
                [day, *ids],
            ).fetchall()
        return {
            str(row["trade_id"]): {
                "count": int(row["count"]),
                "checked_in": bool(row["checked_in"]),
            }
            for row in rows
        }

    def reading_checkin_overview(
        self,
        days: int = 90,
        today: str | date | None = None,
        platform: str = "mt5",
    ) -> dict[str, Any]:
        safe_days = max(1, min(int(days), 366))
        end = _coerce_date(today) if today is not None else date.today()
        if today is None:
            end = _beijing_today_object()
        start = end - timedelta(days=safe_days - 1)
        start_value = start.isoformat()
        end_value = end.isoformat()
        with closing(connect(self.paths)) as conn:
            goal_row = conn.execute(
                "SELECT value FROM analysis_settings WHERE key = 'reading_daily_goal'"
            ).fetchone()
            count_rows = conn.execute(
                """
                SELECT checkins.checkin_date, COUNT(DISTINCT checkins.campaign_id) AS count
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
        goal = _normalize_reading_goal(goal_row["value"] if goal_row else 20)
        counts = {str(row["checkin_date"]): int(row["count"]) for row in count_rows}
        day_rows = [
            {
                "date": (start + timedelta(days=offset)).isoformat(),
                "count": counts.get((start + timedelta(days=offset)).isoformat(), 0),
                "goal": goal,
                "completed": counts.get((start + timedelta(days=offset)).isoformat(), 0) >= goal,
            }
            for offset in range(safe_days)
        ]
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

    def list_active_symbols(self, platform: str = "mt5") -> list[str]:
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT symbol
                FROM trades
                WHERE deleted_at IS NULL AND platform = ? AND COALESCE(symbol, '') != ''
                ORDER BY symbol
                """
                , (platform,)
            ).fetchall()
        return [str(row["symbol"]) for row in rows]

    def list_equity_snapshots(self, *, platform: str = "mt5", conn: Any | None = None) -> list[dict[str, Any]]:
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = active_conn.execute(
                "SELECT platform, time_utc, balance, equity FROM equity_snapshots WHERE platform = ? ORDER BY time_utc",
                (platform,),
            ).fetchall()
        return [dict(row) for row in rows]

    def latest_import_summary(self, platform: str = "mt5") -> dict[str, Any]:
        with closing(connect(self.paths)) as conn:
            trade_row = conn.execute(
                """
                SELECT id, close_time_utc, symbol, product_name, contract_name
                FROM trades
                WHERE platform = ? AND deleted_at IS NULL
                ORDER BY close_time_utc DESC, id DESC
                LIMIT 1
                """,
                (platform,),
            ).fetchone()
            batch_row = conn.execute(
                """
                SELECT *
                FROM import_batches
                WHERE platform = ? AND status = 'committed'
                ORDER BY COALESCE(completed_at, started_at) DESC, id DESC
                LIMIT 1
                """,
                (platform,),
            ).fetchone()
            trade_count = conn.execute(
                "SELECT COUNT(*) AS value FROM trades WHERE platform = ? AND deleted_at IS NULL",
                (platform,),
            ).fetchone()["value"]
            batch_count = conn.execute(
                "SELECT COUNT(*) AS value FROM import_batches WHERE platform = ?",
                (platform,),
            ).fetchone()["value"]

        latest_trade = None
        if trade_row is not None:
            close_time_bj = to_beijing(str(trade_row["close_time_utc"] or ""))
            symbol = str(trade_row["symbol"] or "")
            if platform == DOMESTIC_FUTURES_PLATFORM:
                display = contract_display(symbol)
                product_name = display["product_name"]
                contract_name = display["contract_name"]
            else:
                product_name = str(trade_row["product_name"] or "")
                contract_name = str(trade_row["contract_name"] or "")
            latest_trade = {
                "id": str(trade_row["id"]),
                "trade_date": close_time_bj.date().isoformat(),
                "time_bj": close_time_bj.isoformat(),
                "symbol": symbol,
                "product_name": product_name,
                "contract_name": contract_name,
            }
        latest_batch = dict(batch_row) if batch_row is not None else None
        return {
            "platform": platform,
            "latest_trade": latest_trade,
            "latest_imported_at": (latest_batch or {}).get("completed_at"),
            "latest_batch": latest_batch,
            "counts": {
                "trades": int(trade_count or 0),
                "import_batches": int(batch_count or 0),
            },
        }

    def _where(self, filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
        clauses: list[str] = []
        parameters: list[Any] = []
        clauses.append("trades.platform = ?")
        parameters.append(str(filters.get("platform") or "mt5"))
        deleted = str(filters.get("deleted") or "").strip().lower()
        if not deleted:
            deleted = "all" if filters.get("include_deleted") else "active"
        if deleted == "active":
            clauses.append("trades.deleted_at IS NULL")
        elif deleted == "deleted":
            clauses.append("trades.deleted_at IS NOT NULL")
        elif deleted != "all":
            raise ValueError("deleted must be active, deleted, or all")

        needle = str(filters.get("query") or filters.get("q") or "").strip().casefold()
        if needle:
            pattern = f"%{_escape_like(needle)}%"
            clauses.append(
                "(LOWER(COALESCE(trades.id, '')) LIKE ? ESCAPE '\\' "
                "OR LOWER(COALESCE(trades.order_no, '')) LIKE ? ESCAPE '\\' "
                "OR LOWER(COALESCE(trades.deal_ticket, '')) LIKE ? ESCAPE '\\' "
                "OR LOWER(COALESCE(trades.position_id, '')) LIKE ? ESCAPE '\\' "
                "OR LOWER(COALESCE(trades.symbol, '')) LIKE ? ESCAPE '\\')"
            )
            parameters.extend([pattern] * 5)

        for key in ("symbol", "side", "trade_type", "strategy"):
            value = str(filters.get(key) or "").strip()
            if value and value != "all":
                clauses.append(f"trades.{key} = ?")
                parameters.append(value)

        start_utc, end_utc = _beijing_date_bounds(
            filters.get("start_date") or filters.get("start"),
            filters.get("end_date") or filters.get("end"),
        )
        if start_utc:
            clauses.append("trades.close_time_utc >= ?")
            parameters.append(start_utc)
        if end_utc:
            clauses.append("trades.close_time_utc < ?")
            parameters.append(end_utc)
        return clauses, parameters

    @staticmethod
    def _album_where(filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
        clauses = ["trades.deleted_at IS NULL"]
        parameters: list[Any] = []
        clauses.append("trades.platform = ?")
        parameters.append(str(filters.get("platform") or "mt5"))
        archived = filters.get("archived", False)
        if not isinstance(archived, bool):
            raise ValueError("archived must be a boolean")
        clauses.append("COALESCE(trades.is_archived, 0) = ?")
        parameters.append(1 if archived else 0)
        start_utc, end_utc = _beijing_date_bounds(
            filters.get("start_date") or filters.get("start"),
            filters.get("end_date") or filters.get("end"),
        )
        if start_utc:
            clauses.append("trades.close_time_utc >= ?")
            parameters.append(start_utc)
        if end_utc:
            clauses.append("trades.close_time_utc < ?")
            parameters.append(end_utc)

        symbols = [
            str(value).strip().casefold()
            for value in filters.get("symbols") or []
            if str(value).strip()
        ]
        if symbols:
            placeholders = ",".join("?" for _ in symbols)
            clauses.append(f"LOWER(trades.symbol) IN ({placeholders})")
            parameters.extend(symbols)

        for dimension in ("trade_type", "strategy", "mistake"):
            selected = [
                str(value)
                for value in filters.get(dimension) or []
                if str(value)
            ]
            if selected:
                placeholders = ",".join("?" for _ in selected)
                tag_column = {
                    "trade_type": "trade_type_tags",
                    "strategy": "strategy_tags",
                    "mistake": "mistake_tags",
                }[dimension]
                json_match = (
                    "EXISTS (SELECT 1 FROM json_each("
                    f"CASE WHEN json_valid(selected_campaign.{tag_column}) "
                    f"THEN selected_campaign.{tag_column} ELSE '[]' END"
                    ") AS selected_tag "
                    f"WHERE CAST(selected_tag.value AS TEXT) IN ({placeholders}))"
                )
                if dimension == "mistake":
                    campaign_match = json_match
                    parameters.extend(selected)
                    fallback_match = None
                else:
                    campaign_match = (
                        f"(selected_campaign.{dimension} IN ({placeholders}) "
                        f"OR {json_match})"
                    )
                    parameters.extend(selected)
                    parameters.extend(selected)
                    fallback_match = (
                        "NOT EXISTS (SELECT 1 FROM campaign_source_trades AS "
                        "legacy_source JOIN trade_campaigns AS legacy_campaign "
                        "ON legacy_campaign.id = legacy_source.campaign_id "
                        "WHERE legacy_source.trade_id = trades.id "
                        "AND legacy_campaign.platform = trades.platform "
                        "AND legacy_campaign.deleted_at IS NULL) "
                        f"AND trades.{dimension} IN ({placeholders})"
                    )
                    parameters.extend(selected)
                campaign_exists = (
                    "EXISTS (SELECT 1 FROM campaign_source_trades AS selected_source "
                    "JOIN trade_campaigns AS selected_campaign "
                    "ON selected_campaign.id = selected_source.campaign_id "
                    "WHERE selected_source.trade_id = trades.id "
                    "AND selected_campaign.platform = trades.platform "
                    "AND selected_campaign.deleted_at IS NULL "
                    f"AND {campaign_match})"
                )
                clauses.append(
                    campaign_exists
                    if fallback_match is None
                    else f"({campaign_exists} OR ({fallback_match}))"
                )

        custom_fields = filters.get("custom_fields") or {}
        for field_id in sorted(custom_fields, key=str):
            selection = custom_fields[field_id]
            option_ids = [
                str(value)
                for value in selection.get("option_ids") or []
                if str(value)
            ]
            if not option_ids:
                continue
            placeholders = ",".join("?" for _ in option_ids)
            if selection.get("field_type") == "multi":
                clauses.append(
                    "EXISTS (SELECT 1 FROM trade_custom_values AS selected_values "
                    "JOIN json_each(CASE WHEN json_valid(selected_values.value) "
                    "THEN selected_values.value ELSE '[]' END) AS selected_options "
                    "WHERE selected_values.trade_id = trades.id "
                    "AND selected_values.field_id = ? "
                    f"AND CAST(selected_options.value AS TEXT) IN ({placeholders}))"
                )
            else:
                clauses.append(
                    "EXISTS (SELECT 1 FROM trade_custom_values AS selected_values "
                    "WHERE selected_values.trade_id = trades.id "
                    "AND selected_values.field_id = ? "
                    f"AND selected_values.value IN ({placeholders}))"
                )
            parameters.append(int(field_id))
            parameters.extend(option_ids)
        return clauses, parameters


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _json_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        parsed = value
    else:
        try:
            parsed = json.loads(str(value or "[]"))
        except (TypeError, json.JSONDecodeError):
            parsed = []
    return [str(item).strip() for item in parsed if str(item).strip()] if isinstance(parsed, list) else []


def _beijing_date_bounds(
    start_value: Any,
    end_value: Any,
) -> tuple[str | None, str | None]:
    start = date.fromisoformat(str(start_value)) if start_value else None
    end = date.fromisoformat(str(end_value)) if end_value else None
    if start and end and start > end:
        raise ValueError("start_date cannot be after end_date")
    start_utc = (
        datetime.combine(start, time.min, BEIJING_TIMEZONE).astimezone(timezone.utc).isoformat()
        if start
        else None
    )
    end_utc = (
        datetime.combine(end + timedelta(days=1), time.min, BEIJING_TIMEZONE)
        .astimezone(timezone.utc)
        .isoformat()
        if end
        else None
    )
    return start_utc, end_utc


def _beijing_today_object() -> date:
    return to_beijing(datetime.now(timezone.utc)).date()


def _beijing_today() -> str:
    return _beijing_today_object().isoformat()


def _coerce_date(value: str | date) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _normalize_reading_goal(value: object) -> int:
    try:
        goal = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("reading daily goal must be an integer") from exc
    if not 1 <= goal <= 500:
        raise ValueError("reading daily goal must be between 1 and 500")
    return goal

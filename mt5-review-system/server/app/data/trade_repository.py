from __future__ import annotations

from contextlib import closing, nullcontext
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from ..core.config import RuntimePaths
from ..domain.analytics import to_beijing
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

        for row in rows:
            row["custom_fields"] = custom_values.get(str(row["id"]), {})
        return Page(rows, total, safe_page, safe_size)

    def query_analysis_rows(
        self,
        start_date: str | None,
        end_date: str | None,
        *,
        conn: Any | None = None,
    ) -> list[dict[str, Any]]:
        clauses = ["trades.deleted_at IS NULL"]
        parameters: list[Any] = []
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
                SELECT trades.id, trades.close_time_utc,
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
        for row in rows:
            row["custom_fields"] = custom_values.get(str(row["id"]), {})
        return Page(rows, total, safe_page, safe_size)

    def random_album_trade(self) -> dict[str, Any] | None:
        clauses, parameters = self._album_where({"archived": False})
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
        trade["custom_fields"] = custom_values.get(str(trade["id"]), {})
        return trade

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
                SELECT trade_id
                FROM reading_checkins
                WHERE checkin_date = ? AND trade_id IN ({placeholders})
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
                SELECT trade_id, COUNT(*) AS count
                FROM reading_checkins
                WHERE trade_id IN ({placeholders})
                GROUP BY trade_id
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
                SELECT trade_id,
                       COUNT(*) AS count,
                       MAX(CASE WHEN checkin_date = ? THEN 1 ELSE 0 END) AS checked_in
                FROM reading_checkins
                WHERE trade_id IN ({placeholders})
                GROUP BY trade_id
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
                SELECT checkin_date, COUNT(*) AS count
                FROM reading_checkins
                JOIN trades ON trades.id = reading_checkins.trade_id
                WHERE checkin_date BETWEEN ? AND ? AND trades.deleted_at IS NULL
                GROUP BY checkin_date
                """,
                (start_value, end_value),
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

    def list_active_symbols(self) -> list[str]:
        with closing(connect(self.paths)) as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT symbol
                FROM trades
                WHERE deleted_at IS NULL AND COALESCE(symbol, '') != ''
                ORDER BY symbol
                """
            ).fetchall()
        return [str(row["symbol"]) for row in rows]

    def list_equity_snapshots(self, *, conn: Any | None = None) -> list[dict[str, Any]]:
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = active_conn.execute(
                "SELECT time_utc, balance, equity FROM equity_snapshots ORDER BY time_utc"
            ).fetchall()
        return [dict(row) for row in rows]

    def _where(self, filters: dict[str, Any]) -> tuple[list[str], list[Any]]:
        clauses: list[str] = []
        parameters: list[Any] = []
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

        for dimension in ("trade_type", "strategy"):
            selected = [
                str(value)
                for value in filters.get(dimension) or []
                if str(value)
            ]
            if selected:
                placeholders = ",".join("?" for _ in selected)
                clauses.append(f"trades.{dimension} IN ({placeholders})")
                parameters.extend(selected)

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

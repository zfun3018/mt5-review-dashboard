from __future__ import annotations

import json
import sqlite3
from contextlib import closing, nullcontext
from typing import Any

from ..core.config import RuntimePaths
from .database import connect


CLASSIFICATION_DIMENSIONS = {"trade_type", "strategy"}


class CatalogRepository:
    def __init__(self, paths: RuntimePaths) -> None:
        self.paths = paths

    def custom_values_for_trade_ids(
        self,
        conn: sqlite3.Connection,
        trade_ids: list[str],
    ) -> dict[str, dict[str, Any]]:
        if not trade_ids:
            return {}
        placeholders = ",".join("?" for _ in trade_ids)
        rows = conn.execute(
            f"""
            SELECT trade_custom_values.trade_id,
                   trade_custom_values.field_id,
                   trade_custom_values.value,
                   custom_fields.field_type
            FROM trade_custom_values
            JOIN custom_fields ON custom_fields.id = trade_custom_values.field_id
            WHERE trade_custom_values.trade_id IN ({placeholders})
              AND custom_fields.active = 1
            """,
            trade_ids,
        ).fetchall()
        values: dict[str, dict[str, Any]] = {trade_id: {} for trade_id in trade_ids}
        for row in rows:
            value: Any = row["value"]
            if row["field_type"] == "multi":
                try:
                    parsed = json.loads(value or "[]")
                    value = parsed if isinstance(parsed, list) else []
                except json.JSONDecodeError:
                    value = []
            values.setdefault(str(row["trade_id"]), {})[str(row["field_id"])] = value
        return values

    def list_classifications(
        self,
        dimension: str | None = None,
        active_only: bool = False,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        if dimension is not None and dimension not in CLASSIFICATION_DIMENSIONS:
            raise ValueError("dimension must be trade_type or strategy")
        clauses = []
        parameters: list[Any] = []
        if dimension:
            clauses.append("dimension = ?")
            parameters.append(dimension)
        if active_only:
            clauses.append("active = 1")
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = active_conn.execute(
                f"""
                SELECT id, dimension, label, color, sort_order, active
                FROM classification_options
                {where}
                ORDER BY dimension, active DESC, sort_order, label, id
                """,
                parameters,
            ).fetchall()
        result = [dict(row) for row in rows]
        for row in result:
            row["active"] = bool(row["active"])
        return result

    def list_custom_fields(
        self,
        active_only: bool = False,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        where_clause = "WHERE active = 1" if active_only else ""
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            rows = [
                dict(row)
                for row in active_conn.execute(
                    f"SELECT id, name, field_type, sort_order, active "
                    f"FROM custom_fields {where_clause} ORDER BY sort_order, id"
                ).fetchall()
            ]
            field_ids = [int(row["id"]) for row in rows]
            options: dict[int, list[dict[str, Any]]] = {
                field_id: [] for field_id in field_ids
            }
            if field_ids:
                placeholders = ",".join("?" for _ in field_ids)
                for option in active_conn.execute(
                    f"""
                    SELECT id, field_id, label, color, sort_order
                    FROM custom_field_options
                    WHERE field_id IN ({placeholders})
                    ORDER BY sort_order, id
                    """,
                    field_ids,
                ):
                    options[int(option["field_id"])].append(dict(option))
        for row in rows:
            row["field_type"] = row.get("field_type") or "text"
            row["options"] = options.get(int(row["id"]), [])
            row["active"] = bool(row.get("active", 1))
        return rows

    def get_analysis_settings(self, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        context = nullcontext(conn) if conn is not None else closing(connect(self.paths))
        with context as active_conn:
            row = active_conn.execute(
                "SELECT value FROM analysis_settings WHERE key = 'scratch_threshold_r'"
            ).fetchone()
        return {"scratch_threshold_r": float(row["value"] if row else 0.15)}

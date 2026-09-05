from __future__ import annotations

import sqlite3

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import hashlib
import json
import uuid
from typing import Any


CLASSIFICATION_DIMENSIONS = {"trade_type", "strategy"}


def _serialize_classification_option(row: sqlite3.Row) -> dict[str, Any]:
    option = dict(row)
    option["active"] = bool(option["active"])
    return option


def create_classification_option(payload: dict[str, Any]) -> dict[str, Any]:
    dimension = str(payload.get("dimension", "")).strip()
    if dimension not in CLASSIFICATION_DIMENSIONS:
        raise ValueError("dimension must be trade_type or strategy")
    label = str(payload.get("label", "")).strip()
    if not label:
        raise ValueError("Option label is required")
    color = str(payload.get("color", "#2bd4ff")).strip() or "#2bd4ff"
    option_id = f"{dimension}_{uuid.uuid4().hex}"
    try:
        with db() as conn:
            max_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) AS value FROM classification_options WHERE dimension = ?",
                (dimension,),
            ).fetchone()["value"]
            conn.execute(
                """
                INSERT INTO classification_options
                    (id, dimension, label, color, sort_order, active)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (option_id, dimension, label, color, int(max_order) + 1),
            )
            row = conn.execute(
                """
                SELECT id, dimension, label, color, sort_order, active
                FROM classification_options WHERE id = ?
                """,
                (option_id,),
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise ValueError("Option label already exists") from exc
    return _serialize_classification_option(row)


def update_classification_option(option_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        current = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
        if not current:
            raise KeyError(option_id)
        label = str(payload.get("label", current["label"])).strip()
        if not label:
            raise ValueError("Option label is required")
        color = str(payload.get("color", current["color"])).strip() or current["color"]
        try:
            conn.execute(
                """
                UPDATE classification_options
                SET label = ?, color = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (label, color, option_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Option label already exists") from exc
        row = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
    return _serialize_classification_option(row)


def delete_classification_option(option_id: str) -> None:
    with db() as conn:
        cursor = conn.execute(
            """
            UPDATE classification_options
            SET active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND active = 1
            """,
            (option_id,),
        )
        if cursor.rowcount == 0:
            raise KeyError(option_id)


def restore_classification_option(option_id: str) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
        if not row:
            raise KeyError(option_id)
        conn.execute(
            "UPDATE classification_options SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (option_id,),
        )
        restored = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
    return _serialize_classification_option(restored)


def _validate_classification_assignment(
    conn: sqlite3.Connection,
    dimension: str,
    option_id: str,
    current_id: str,
) -> None:
    option = conn.execute(
        "SELECT dimension, active FROM classification_options WHERE id = ?",
        (option_id,),
    ).fetchone()
    if not option or option["dimension"] != dimension:
        raise ValueError(f"Invalid {dimension} option")
    if not option["active"] and option_id != current_id:
        raise ValueError(f"Inactive {dimension} option")


def _ensure_classification_option(
    conn: sqlite3.Connection,
    dimension: str,
    raw_value: Any,
) -> str:
    value = str(raw_value or "unclassified").strip() or "unclassified"
    if dimension == "strategy" and value == "unclassified":
        value = "strategy_unclassified"
    existing = conn.execute(
        "SELECT id, dimension FROM classification_options WHERE id = ?",
        (value,),
    ).fetchone()
    if existing and existing["dimension"] == dimension:
        return value
    by_label = conn.execute(
        "SELECT id FROM classification_options WHERE dimension = ? AND label = ?",
        (dimension, value),
    ).fetchone()
    if by_label:
        return str(by_label["id"])
    option_id = value
    if existing:
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
        option_id = f"legacy_{dimension}_{digest}"
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS value FROM classification_options WHERE dimension = ?",
        (dimension,),
    ).fetchone()["value"]
    conn.execute(
        """
        INSERT OR IGNORE INTO classification_options
            (id, dimension, label, color, sort_order, active)
        VALUES (?, ?, ?, '#8ca29b', ?, 1)
        """,
        (option_id, dimension, value, int(max_order) + 1),
    )
    return option_id


def list_trends() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, color, sort_order FROM trends ORDER BY sort_order, id"
        ).fetchall()
    return [dict(row) for row in rows]


def create_trend(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Trend name is required")
    color = str(payload.get("color", "#4fd1c5")).strip() or "#4fd1c5"
    with db() as conn:
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS value FROM trends").fetchone()[
            "value"
        ]
        cursor = conn.execute(
            "INSERT INTO trends (name, color, sort_order) VALUES (?, ?, ?)",
            (name, color, int(max_order) + 1),
        )
        trend_id = cursor.lastrowid
        row = conn.execute(
            "SELECT id, name, color, sort_order FROM trends WHERE id = ?",
            (trend_id,),
        ).fetchone()
    return dict(row)


def update_trend(trend_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Trend name is required")
    color = str(payload.get("color", "#4fd1c5")).strip() or "#4fd1c5"
    with db() as conn:
        conn.execute(
            "UPDATE trends SET name = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (name, color, trend_id),
        )
        row = conn.execute(
            "SELECT id, name, color, sort_order FROM trends WHERE id = ?",
            (trend_id,),
        ).fetchone()
    if not row:
        raise KeyError(trend_id)
    return dict(row)


def delete_trend(trend_id: int) -> None:
    with db() as conn:
        cursor = conn.execute("DELETE FROM trends WHERE id = ?", (trend_id,))
        if cursor.rowcount == 0:
            raise KeyError(trend_id)


def _serialize_custom_field(
    row: sqlite3.Row,
    options_by_field: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    field = dict(row)
    field["field_type"] = field.get("field_type") or "text"
    field["options"] = options_by_field.get(int(field["id"]), [])
    field["active"] = bool(field.get("active", 1))
    return field


def _custom_options_for_field_ids(
    conn: sqlite3.Connection,
    field_ids: list[int],
) -> dict[int, list[dict[str, Any]]]:
    if not field_ids:
        return {}
    placeholders = ",".join("?" for _ in field_ids)
    rows = conn.execute(
        f"""
        SELECT id, field_id, label, color, sort_order
        FROM custom_field_options
        WHERE field_id IN ({placeholders})
        ORDER BY sort_order, id
        """,
        field_ids,
    ).fetchall()
    options: dict[int, list[dict[str, Any]]] = {int(field_id): [] for field_id in field_ids}
    for row in rows:
        options.setdefault(int(row["field_id"]), []).append(dict(row))
    return options


def _replace_custom_options(
    conn: sqlite3.Connection,
    field_id: int,
    raw_options: Any,
    field_type: str,
) -> None:
    if field_type == "text":
        conn.execute("DELETE FROM custom_field_options WHERE field_id = ?", (field_id,))
        return
    options = raw_options if isinstance(raw_options, list) else []
    kept_ids = []
    for index, option in enumerate(options, start=1):
        if not isinstance(option, dict):
            continue
        label = str(option.get("label", "")).strip()
        if not label:
            continue
        color = str(option.get("color", "#2bd4ff")).strip() or "#2bd4ff"
        option_id = option.get("id")
        if option_id:
            existing = conn.execute(
                "SELECT id FROM custom_field_options WHERE id = ? AND field_id = ?",
                (int(option_id), field_id),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE custom_field_options
                    SET label = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND field_id = ?
                    """,
                    (label, color, index, int(option_id), field_id),
                )
                kept_ids.append(int(option_id))
                continue
        cursor = conn.execute(
            """
            INSERT INTO custom_field_options (field_id, label, color, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (field_id, label, color, index),
        )
        kept_ids.append(int(cursor.lastrowid))
    if kept_ids:
        placeholders = ",".join("?" for _ in kept_ids)
        conn.execute(
            f"DELETE FROM custom_field_options WHERE field_id = ? AND id NOT IN ({placeholders})",
            [field_id, *kept_ids],
        )
    else:
        conn.execute("DELETE FROM custom_field_options WHERE field_id = ?", (field_id,))


def _option_ids_for_field(conn: sqlite3.Connection, field_id: int) -> set[str]:
    rows = conn.execute(
        "SELECT id FROM custom_field_options WHERE field_id = ?",
        (field_id,),
    ).fetchall()
    return {str(row["id"]) for row in rows}


def _normalize_field_type(value: Any) -> str:
    field_type = str(value or "text").strip().lower()
    if field_type not in {"text", "single", "multi"}:
        raise ValueError("Field type must be text, single, or multi")
    return field_type


def _normalize_custom_value(value: Any, field_type: str, allowed_options: set[str]) -> tuple[Any, str]:
    if field_type == "multi":
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                selected: list[str] = []
            else:
                try:
                    parsed = json.loads(stripped)
                    selected = parsed if isinstance(parsed, list) else [str(parsed)]
                except json.JSONDecodeError:
                    selected = [stripped]
        elif isinstance(value, list):
            selected = [str(item) for item in value if str(item).strip()]
        else:
            selected = []
        invalid = [item for item in selected if item not in allowed_options]
        if invalid:
            raise ValueError("Unknown option id")
        return selected, json.dumps(selected, ensure_ascii=False)
    if field_type == "single":
        selected = str(value or "").strip()
        if selected and selected not in allowed_options:
            raise ValueError("Unknown option id")
        return selected, selected
    return str(value or ""), str(value or "")


def create_custom_field(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Field name is required")
    field_type = _normalize_field_type(payload.get("field_type", "text"))
    with db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS value FROM custom_fields"
        ).fetchone()["value"]
        cursor = conn.execute(
            "INSERT INTO custom_fields (name, field_type, sort_order) VALUES (?, ?, ?)",
            (name, field_type, int(max_order) + 1),
        )
        field_id = cursor.lastrowid
        _replace_custom_options(conn, int(field_id), payload.get("options", []), field_type)
        row = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        options = _custom_options_for_field_ids(conn, [int(field_id)])
    return _serialize_custom_field(row, options)


def update_custom_field(field_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Field name is required")
    with db() as conn:
        current = conn.execute(
            "SELECT id, name, field_type, sort_order, active FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if not current:
            raise KeyError(field_id)
        current_options = _custom_options_for_field_ids(conn, [field_id]).get(field_id, [])
        field_type = _normalize_field_type(payload.get("field_type", current["field_type"] or "text"))
        options = payload["options"] if "options" in payload else current_options
        if "active" in payload:
            active_value = 1 if bool(payload.get("active")) else 0
        else:
            active_value = int(current["active"])
        conn.execute(
            """
            UPDATE custom_fields
            SET name = ?, field_type = ?, active = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (name, field_type, active_value, field_id),
        )
        _replace_custom_options(conn, field_id, options, field_type)
        row = conn.execute(
            "SELECT id, name, field_type, sort_order, active FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        updated_options = _custom_options_for_field_ids(conn, [field_id])
    serialized = _serialize_custom_field(row, updated_options)
    serialized["active"] = bool(serialized.get("active", 1))
    return serialized


def delete_custom_field(field_id: int) -> None:
    with db() as conn:
        cursor = conn.execute(
            "UPDATE custom_fields SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1",
            (field_id,),
        )
        if cursor.rowcount == 0:
            raise KeyError(field_id)


def purge_custom_field(field_id: int) -> None:
    """Permanently remove a custom field and its values/options."""
    with db() as conn:
        cursor = conn.execute("DELETE FROM custom_fields WHERE id = ?", (field_id,))
        if cursor.rowcount == 0:
            raise KeyError(field_id)


def restore_custom_field(field_id: int) -> dict[str, Any]:
    with db() as conn:
        current = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if not current:
            raise KeyError(field_id)
        conn.execute(
            "UPDATE custom_fields SET active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (field_id,),
        )
        row = conn.execute(
            "SELECT id, name, field_type, sort_order, active FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        options = _custom_options_for_field_ids(conn, [field_id])
    serialized = _serialize_custom_field(row, options)
    serialized["active"] = bool(serialized.get("active", 1))
    return serialized


def update_trade_custom_value(
    trade_id: str,
    field_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    with db() as conn:
        trade = conn.execute("SELECT id FROM trades WHERE id = ?", (trade_id,)).fetchone()
        if not trade:
            raise KeyError(trade_id)
        field = conn.execute(
            "SELECT id, field_type FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if not field:
            raise KeyError(field_id)
        allowed = _option_ids_for_field(conn, field_id)
        value, stored = _normalize_custom_value(payload.get("value", ""), field["field_type"], allowed)
        conn.execute(
            """
            INSERT INTO trade_custom_values (trade_id, field_id, value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(trade_id, field_id) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (trade_id, field_id, stored),
        )
    return {"trade_id": trade_id, "field_id": field_id, "value": value}

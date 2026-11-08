from __future__ import annotations

import sqlite3
import uuid


def ensure_dashboard_layout_schema(conn: sqlite3.Connection) -> None:
    create_sql = (
        "CREATE TABLE dashboard_layouts ("
        "platform TEXT PRIMARY KEY, "
        "revision INTEGER NOT NULL DEFAULT 0, "
        "layout_json TEXT NOT NULL, "
        "updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    conn.execute(create_sql.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ", 1))
    info = conn.execute("PRAGMA table_info(dashboard_layouts)").fetchall()
    columns = {row["name"] for row in info}
    platform_is_primary_key = any(
        row["name"] == "platform" and int(row["pk"] or 0) > 0 for row in info
    )
    expected_columns = {"platform", "revision", "layout_json", "updated_at"}
    if columns == expected_columns and platform_is_primary_key:
        return

    legacy_table = f"dashboard_layouts__schema_migration_{uuid.uuid4().hex}"
    conn.execute(f"ALTER TABLE dashboard_layouts RENAME TO {legacy_table}")
    conn.execute(create_sql)

    def source(column: str, fallback: str) -> str:
        if column not in columns:
            return fallback
        return f'"{column}"'

    layout_column = "layout_json" if "layout_json" in columns else "layout"
    layout_value = source(layout_column, "'{}'")
    platform_value = source("platform", "'mt5'")
    revision_value = source("revision", "0")
    updated_at_value = source("updated_at", "CURRENT_TIMESTAMP")
    conn.execute(
        "INSERT OR REPLACE INTO dashboard_layouts "
        "(platform, revision, layout_json, updated_at) "
        "SELECT "
        f"{platform_value}, "
        f"{revision_value}, "
        f"{layout_value}, "
        f"{updated_at_value} "
        f"FROM {legacy_table} ORDER BY rowid"
    )
    conn.execute(f"DROP TABLE {legacy_table}")
    conn.execute(
        "UPDATE dashboard_layouts SET updated_at = CURRENT_TIMESTAMP "
        "WHERE updated_at IS NULL OR updated_at = ''"
    )

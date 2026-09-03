from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from ..core.config import RuntimePaths, get_runtime_paths


def _python_strip_lower(value: object) -> str:
    # Match domain text normalization for persisted values, including Unicode whitespace.
    return str(value or "").strip().lower()


def execute_sql_script(
    conn: sqlite3.Connection, sql_script: str
) -> sqlite3.Cursor:
    cursor = conn.cursor()
    statement: list[str] = []
    for character in sql_script:
        statement.append(character)
        if character == ";" and sqlite3.complete_statement("".join(statement)):
            cursor.execute("".join(statement))
            statement.clear()

    remainder = "".join(statement).strip()
    if remainder:
        candidate = f"{remainder}\n;"
        if not sqlite3.complete_statement(candidate):
            raise sqlite3.OperationalError("incomplete SQL script")
        cursor.execute(candidate)
    return cursor


class TransactionalConnection(sqlite3.Connection):
    def executescript(self, sql_script: str) -> sqlite3.Cursor:
        return execute_sql_script(self, sql_script)


def connect(paths: RuntimePaths | None = None) -> sqlite3.Connection:
    active_paths = paths or get_runtime_paths()
    conn = sqlite3.connect(
        active_paths.database,
        timeout=10,
        factory=TransactionalConnection,
    )
    conn.row_factory = sqlite3.Row
    conn.create_function(
        "PYTHON_STRIP_LOWER",
        1,
        _python_strip_lower,
        deterministic=True,
    )
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def backup_database(source_path: Path, destination_path: Path) -> None:
    source = sqlite3.connect(source_path, timeout=10)
    try:
        destination = sqlite3.connect(destination_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()


@contextmanager
def transaction(paths: RuntimePaths | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(paths)
    try:
        conn.execute("BEGIN")
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()

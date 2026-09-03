from __future__ import annotations

from typing import Any


Query = dict[str, list[str]]
Body = dict[str, Any] | None


def first(query: Query, key: str, default: str | None) -> str | None:
    values = query.get(key)
    return values[0] if values else default


def optional_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def request_body(body: Body) -> dict[str, Any]:
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ValueError("JSON body must be an object")
    return body


def path_part(path: str, index: int) -> str:
    parts = path.split("/")
    if len(parts) <= index:
        raise ValueError("Invalid route identifier")
    return parts[index]

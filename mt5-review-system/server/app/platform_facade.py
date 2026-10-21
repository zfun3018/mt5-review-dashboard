from __future__ import annotations

from typing import Any

from .data.import_repository import (
    get_import_batch as _get_import_batch,
    get_import_calendar as _get_import_calendar,
    list_unmatched_import_executions as _list_unmatched_import_executions,
    list_import_batches as _list_import_batches,
    revert_import_batch as _revert_import_batch,
)
from .platform_importer import import_platform_csv, import_platform_file, match_import_executions as _match_import_executions
from .platforms import normalize_platform, platform_options
from .core.config import get_runtime_paths
from .data.trade_repository import TradeRepository


def list_platforms() -> list[dict[str, str]]:
    return platform_options()


def list_import_batches(
    platform: str = "mt5", year: int | None = None, month: int | None = None
) -> list[dict[str, Any]]:
    return _list_import_batches(normalize_platform(platform), year, month)


def get_import_calendar(
    platform: str = "mt5", year: int | None = None, month: int | None = None
) -> dict[str, dict[str, int | str]]:
    if year is None or month is None:
        raise ValueError("year 和 month 是必填项")
    return _get_import_calendar(normalize_platform(platform), year, month)


def get_import_batch(batch_id: str, platform: str = "mt5") -> dict[str, Any] | None:
    return _get_import_batch(batch_id, normalize_platform(platform))


def revert_import_batch(
    batch_id: str,
    platform: str = "mt5",
    *,
    confirm: bool = False,
) -> dict[str, Any]:
    return _revert_import_batch(
        batch_id,
        normalize_platform(platform),
        confirm=bool(confirm),
    )


def list_unmatched_import_executions(
    platform: str = "mt5", batch_id: str | None = None
) -> list[dict[str, Any]]:
    return _list_unmatched_import_executions(normalize_platform(platform), batch_id)


def match_import_executions(
    open_execution_id: str,
    close_execution_id: str,
    quantity: float,
    *,
    platform: str = "mt5",
) -> dict[str, Any]:
    return _match_import_executions(
        open_execution_id,
        close_execution_id,
        quantity,
        platform=normalize_platform(platform),
    )


def latest_import_summary(platform: str = "mt5") -> dict[str, Any]:
    normalized = normalize_platform(platform)
    return TradeRepository(get_runtime_paths()).latest_import_summary(normalized)


def import_csv(platform: str, csv_text: str, filename: str = "") -> dict[str, Any]:
    return import_platform_csv(platform, csv_text, filename)


import_file = import_platform_file

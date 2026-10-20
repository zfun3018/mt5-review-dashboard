from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class NormalizedExecution:
    """A platform-neutral fill used before trade/order reconstruction."""

    platform: str
    trade_date: str
    time_utc: str
    symbol: str
    side: str
    offset: str
    quantity: float
    price: float
    account: str = ""
    fee: float = 0.0
    pnl: float = 0.0
    trade_id: str = ""
    order_id: str = ""
    source_kind: str = ""
    source_filename: str = ""
    source_sheet: str = ""
    source_row_number: int | None = None
    raw: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportIssue:
    row_number: int | None
    code: str
    message: str
    details: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ImportParseResult:
    platform: str
    source_kind: str
    source_format: str
    filename: str
    executions: tuple[NormalizedExecution, ...] = ()
    issues: tuple[ImportIssue, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class PlatformCapabilities:
    """Explicit dashboard and analysis capabilities owned by a platform."""

    show_market_clock: bool = False
    show_sessions: bool = False
    show_contract_rankings: bool = False
    show_fixed_periods: bool = False
    supports_r_metrics: bool = True
    supports_market_replay: bool = False
    show_review_coverage: bool = False
    show_risk_summary: bool = False
    show_domestic_system_evaluation: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "show_market_clock": self.show_market_clock,
            "show_sessions": self.show_sessions,
            "show_contract_rankings": self.show_contract_rankings,
            "show_fixed_periods": self.show_fixed_periods,
            "supports_r_metrics": self.supports_r_metrics,
            "supports_market_replay": self.supports_market_replay,
            "show_review_coverage": self.show_review_coverage,
            "show_risk_summary": self.show_risk_summary,
            "show_domestic_system_evaluation": self.show_domestic_system_evaluation,
        }


MT5_CAPABILITIES = PlatformCapabilities(
    show_market_clock=True,
    show_sessions=True,
    supports_r_metrics=True,
)
DOMESTIC_FUTURES_CAPABILITIES = PlatformCapabilities(
    show_fixed_periods=True,
    show_contract_rankings=True,
    supports_r_metrics=True,
    show_review_coverage=True,
    show_risk_summary=True,
    show_domestic_system_evaluation=True,
)


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

"""Page-oriented application services and immutable request values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class AnalysisWindow:
    start_date: str | None
    end_date: str | None
    equity_days: int = 30

    def __post_init__(self) -> None:
        start = date.fromisoformat(self.start_date) if self.start_date else None
        end = date.fromisoformat(self.end_date) if self.end_date else None
        if start and end and start > end:
            raise ValueError("start_date cannot be after end_date")
        if (
            isinstance(self.equity_days, bool)
            or not isinstance(self.equity_days, int)
            or not 1 <= self.equity_days <= 366
        ):
            raise ValueError("equity_days must be between 1 and 366")


@dataclass(frozen=True)
class PageRequest:
    page: int = 1
    page_size: int = 50

    def __post_init__(self) -> None:
        if isinstance(self.page, bool) or not isinstance(self.page, int) or self.page < 1:
            raise ValueError("page must be at least 1")
        if (
            isinstance(self.page_size, bool)
            or not isinstance(self.page_size, int)
            or not 1 <= self.page_size <= 200
        ):
            raise ValueError("page_size must be between 1 and 200")


__all__ = ["AnalysisWindow", "PageRequest"]

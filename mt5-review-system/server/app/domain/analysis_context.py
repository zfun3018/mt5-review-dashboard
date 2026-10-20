"""Immutable input contract shared by dashboard metric calculations."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any


def _freeze_rows(value: Iterable[Mapping[str, Any]] | None, field_name: str) -> tuple[Mapping[str, Any], ...]:
    rows = []
    for row in value or ():
        if not isinstance(row, Mapping):
            raise TypeError(f"{field_name} must contain mapping rows")
        rows.append(MappingProxyType(dict(row)))
    return tuple(rows)


def _freeze_mapping(value: Mapping[str, Any] | None, field_name: str) -> Mapping[str, Any]:
    if value is None:
        return MappingProxyType({})
    if not isinstance(value, Mapping):
        raise TypeError(f"{field_name} must be a mapping")
    return MappingProxyType(dict(value))


@dataclass(frozen=True, slots=True)
class AnalysisContext:
    """Normalized, read-only inputs available to all metric modules."""

    campaigns: tuple[Mapping[str, Any], ...] = field(default_factory=tuple)
    reference_campaigns: tuple[Mapping[str, Any], ...] = field(default_factory=tuple)
    equity_snapshots: tuple[Mapping[str, Any], ...] = field(default_factory=tuple)
    window_start: datetime | None = None
    window_end: datetime | None = None
    anchor_utc: datetime | None = None
    platform: str = ""
    timezone: str = "Asia/Shanghai"
    capabilities: Mapping[str, Any] = field(default_factory=dict)
    settings: Mapping[str, Any] = field(default_factory=dict)
    data_quality: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.window_start and self.window_end and self.window_start > self.window_end:
            raise ValueError("window_start must not be after window_end")
        if not str(self.platform).strip():
            raise ValueError("platform is required")
        if not str(self.timezone).strip():
            raise ValueError("timezone is required")
        object.__setattr__(self, "campaigns", _freeze_rows(self.campaigns, "campaigns"))
        object.__setattr__(
            self,
            "reference_campaigns",
            _freeze_rows(self.reference_campaigns, "reference_campaigns"),
        )
        object.__setattr__(
            self,
            "equity_snapshots",
            _freeze_rows(self.equity_snapshots, "equity_snapshots"),
        )
        object.__setattr__(self, "settings", _freeze_mapping(self.settings, "settings"))
        object.__setattr__(
            self,
            "capabilities",
            _freeze_mapping(self.capabilities, "capabilities"),
        )
        object.__setattr__(self, "data_quality", _freeze_mapping(self.data_quality, "data_quality"))

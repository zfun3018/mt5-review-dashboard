"""Contracts for quality-aware dashboard metric results."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, TYPE_CHECKING

if TYPE_CHECKING:
    from .analysis_context import AnalysisContext


METRIC_STATUSES = frozenset(
    {
        "available",
        "insufficient_data",
        "incomplete_data",
        "estimated",
        "not_applicable",
    }
)
UNKNOWN_VALUE_STATUSES = frozenset(
    {"insufficient_data", "incomplete_data", "not_applicable"}
)

MetricCalculator = Callable[["AnalysisContext"], "MetricResult"]


@dataclass(frozen=True, slots=True)
class MetricResult:
    key: str
    value: Any
    unit: str
    status: str
    sample_count: int
    definition_version: str
    coverage: float | None = None
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def __post_init__(self) -> None:
        if not str(self.key).strip():
            raise ValueError("metric key is required")
        if not str(self.unit).strip():
            raise ValueError("metric unit is required")
        if self.status not in METRIC_STATUSES:
            raise ValueError(f"unsupported metric status: {self.status}")
        if not str(self.definition_version).strip():
            raise ValueError("definition_version is required")
        if (
            isinstance(self.sample_count, bool)
            or not isinstance(self.sample_count, int)
            or self.sample_count < 0
        ):
            raise ValueError("sample_count must be a non-negative integer")
        if self.status == "available" and self.value is None:
            raise ValueError("available metrics must have a value")
        if self.status in UNKNOWN_VALUE_STATUSES and self.value is not None:
            raise ValueError(f"{self.status} metrics must not encode a value")
        if self.coverage is not None:
            coverage = float(self.coverage)
            if not math.isfinite(coverage) or not 0.0 <= coverage <= 1.0:
                raise ValueError("coverage must be between 0 and 1")
            object.__setattr__(self, "coverage", coverage)
        object.__setattr__(self, "warnings", tuple(str(warning) for warning in self.warnings))


@dataclass(frozen=True, slots=True)
class MetricDefinition:
    key: str
    definition_version: str
    calculate: MetricCalculator

    def __post_init__(self) -> None:
        if not str(self.key).strip():
            raise ValueError("metric key is required")
        if not str(self.definition_version).strip():
            raise ValueError("definition_version is required")
        if not callable(self.calculate):
            raise TypeError("calculate must be callable")

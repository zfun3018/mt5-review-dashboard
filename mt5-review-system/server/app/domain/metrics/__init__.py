"""Common dashboard metric registry.

The registry owns only pure metric definitions. Repository reads and HTTP
serialization remain in the application layer.
"""

from __future__ import annotations

from app.domain.metric_registry import MetricRegistry
from app.domain.r_metrics import r_metrics_definition

from .calendar import calendar_definitions
from .equity import equity_definition
from .modes import mode_definitions
from .summary import summary_definition
from .time_patterns import time_pattern_definitions


def build_metric_registry() -> MetricRegistry:
    definitions = [summary_definition(), r_metrics_definition()]
    definitions.extend(mode_definitions())
    definitions.append(equity_definition())
    definitions.extend(calendar_definitions())
    definitions.extend(time_pattern_definitions())
    return MetricRegistry(definitions)


__all__ = ["build_metric_registry"]

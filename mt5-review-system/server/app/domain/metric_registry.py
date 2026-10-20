"""Runtime registry for pure dashboard metric definitions."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from .analysis_context import AnalysisContext
from .metric_contracts import MetricDefinition, MetricResult


class MetricRegistry:
    def __init__(self, definitions: Iterable[MetricDefinition] = ()) -> None:
        self._definitions: dict[str, MetricDefinition] = {}
        for definition in definitions:
            self.register(definition)

    def register(self, definition: MetricDefinition) -> None:
        if definition.key in self._definitions:
            raise ValueError(f"duplicate metric key: {definition.key}")
        self._definitions[definition.key] = definition

    def keys(self) -> tuple[str, ...]:
        return tuple(self._definitions)

    def evaluate(
        self,
        context: AnalysisContext,
        keys: Sequence[str] | None = None,
    ) -> tuple[MetricResult, ...]:
        definitions = self._select(keys)
        results = []
        for definition in definitions:
            result = definition.calculate(context)
            if not isinstance(result, MetricResult):
                raise TypeError(f"metric {definition.key} did not return MetricResult")
            if result.key != definition.key:
                raise ValueError(
                    f"metric result key mismatch: expected {definition.key}, got {result.key}"
                )
            if result.definition_version != definition.definition_version:
                raise ValueError(
                    f"metric {definition.key} returned an undeclared definition version"
                )
            results.append(result)
        return tuple(results)

    def _select(self, keys: Sequence[str] | None) -> tuple[MetricDefinition, ...]:
        if keys is None:
            return tuple(self._definitions.values())
        selected = []
        for key in keys:
            try:
                selected.append(self._definitions[key])
            except KeyError as exc:
                raise KeyError(f"unknown metric key: {key}") from exc
        return tuple(selected)

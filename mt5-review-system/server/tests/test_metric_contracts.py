"""Documentation contracts for the dashboard metric inventory."""

from __future__ import annotations

import re
import unittest
from dataclasses import FrozenInstanceError
from datetime import datetime
from pathlib import Path

from app.domain.analysis_context import AnalysisContext
from app.domain.metric_contracts import MetricDefinition, MetricResult
from app.domain.metric_registry import MetricRegistry


PROJECT_ROOT = Path(__file__).resolve().parents[3]
METRICS_README = PROJECT_ROOT / "docs" / "metrics" / "README.md"
METRIC_CONTRACT = PROJECT_ROOT / "docs" / "metrics" / "metric-contract.md"
ANALYSIS_ENGINE = PROJECT_ROOT / "docs" / "architecture" / "ANALYSIS-ENGINE.md"

EXPECTED_METRICS = {
    "summary",
    "r_metrics",
    "periods",
    "equity_curve",
    "calendar",
    "hour_heatmap",
    "sessions",
    "system_evaluation",
    "mode_evaluation",
    "domestic_fixed_periods",
    "contract_rankings",
    "review_coverage",
    "risk_summary",
}

REQUIRED_COLUMNS = (
    "key",
    "owner",
    "unit",
    "statistical_unit",
    "time_field",
    "timezone",
    "definition_version",
    "test_path",
)


def _metric_rows(markdown: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in markdown.splitlines()]
    table_start = next(
        index
        for index, line in enumerate(lines)
        if line.startswith("| key |")
    )
    headers = [cell.strip() for cell in lines[table_start].strip("|").split("|")]
    rows = []
    for line in lines[table_start + 2 :]:
        if not line.startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if len(cells) != len(headers):
            continue
        rows.append(dict(zip(headers, cells)))
    return rows


class MetricDocumentationContractTest(unittest.TestCase):
    def test_metric_documents_exist(self):
        for path in (METRICS_README, METRIC_CONTRACT, ANALYSIS_ENGINE):
            self.assertTrue(path.is_file(), f"missing analysis document: {path}")

    def test_metric_catalog_declares_required_columns(self):
        rows = _metric_rows(METRICS_README.read_text(encoding="utf-8"))
        self.assertGreater(len(rows), 0, "metric catalog has no registered rows")

        headers = set(rows[0])
        self.assertTrue(
            set(REQUIRED_COLUMNS).issubset(headers),
            f"missing metric columns: {sorted(set(REQUIRED_COLUMNS) - headers)}",
        )
        for row in rows:
            for column in REQUIRED_COLUMNS:
                self.assertTrue(
                    row[column],
                    f"metric {row.get('key', '<unknown>')} has empty {column}",
                )

    def test_current_dashboard_inventory_is_registered(self):
        rows = _metric_rows(METRICS_README.read_text(encoding="utf-8"))
        registered = {row["key"] for row in rows}
        self.assertEqual(registered, EXPECTED_METRICS)

    def test_contract_document_defines_formula_and_quality_requirements(self):
        contract = METRIC_CONTRACT.read_text(encoding="utf-8")
        for phrase in (
            "公式",
            "统计对象",
            "时间字段",
            "时区",
            "缺失数据",
            "最小样本量",
            "definition_version",
            "insufficient_data",
        ):
            self.assertIn(phrase, contract, f"metric contract omits {phrase}")

    def test_architecture_document_keeps_campaign_as_analysis_source(self):
        architecture = ANALYSIS_ENGINE.read_text(encoding="utf-8")
        self.assertIn("Campaign", architecture)
        self.assertRegex(architecture, re.compile(r"单一事实源|唯一业务订单"))
        self.assertIn("仪表盘", architecture)


class AnalysisContextContractTest(unittest.TestCase):
    def test_context_normalizes_rows_and_freezes_configuration(self):
        context = AnalysisContext(
            campaigns=[{"id": "campaign-1", "net_pnl": 12.5}],
            equity_snapshots=[{"time_utc": "2026-10-20T00:00:00+00:00", "equity": 1012.5}],
            window_start=datetime(2026, 10, 1),
            window_end=datetime(2026, 10, 31),
            platform="mt5",
            timezone="Asia/Shanghai",
            settings={"scratch_threshold_r": 0.15},
            data_quality={"missing_campaign_count": 0},
        )

        self.assertEqual(len(context.campaigns), 1)
        self.assertEqual(context.campaigns[0]["id"], "campaign-1")
        self.assertEqual(context.equity_snapshots[0]["equity"], 1012.5)
        with self.assertRaises(TypeError):
            context.settings["scratch_threshold_r"] = 0.2
        with self.assertRaises(FrozenInstanceError):
            context.platform = "domestic_futures"


class MetricResultContractTest(unittest.TestCase):
    def test_result_supports_explicit_quality_statuses(self):
        statuses = (
            "available",
            "insufficient_data",
            "incomplete_data",
            "estimated",
            "not_applicable",
        )
        for status in statuses:
            result = MetricResult(
                key="summary.net_pnl",
                value=12.5 if status in {"available", "estimated"} else None,
                unit="currency",
                status=status,
                sample_count=3,
                definition_version="1",
                coverage=1.0 if status == "available" else None,
                warnings=("synthetic warning",) if status == "estimated" else (),
            )
            self.assertEqual(result.status, status)
            self.assertEqual(result.sample_count, 3)

    def test_unknown_status_cannot_be_encoded_as_zero(self):
        with self.assertRaises(ValueError):
            MetricResult(
                key="summary.net_pnl",
                value=0,
                unit="currency",
                status="insufficient_data",
                sample_count=0,
                definition_version="1",
                coverage=0.0,
            )

    def test_result_requires_stable_metadata(self):
        with self.assertRaises(ValueError):
            MetricResult(
                key="",
                value=1,
                unit="count",
                status="available",
                sample_count=1,
                definition_version="1",
                coverage=1.0,
            )
        with self.assertRaises(ValueError):
            MetricResult(
                key="summary.count",
                value=1,
                unit="count",
                status="available",
                sample_count=1,
                definition_version="",
                coverage=1.0,
            )
        with self.assertRaises(ValueError):
            MetricResult(
                key="summary.count",
                value=1,
                unit="count",
                status="available",
                sample_count=1.5,
                definition_version="1",
                coverage=1.0,
            )


class MetricRegistryContractTest(unittest.TestCase):
    def test_registry_rejects_duplicate_keys_and_unversioned_definitions(self):
        registry = MetricRegistry()
        definition = MetricDefinition(
            key="summary.count",
            definition_version="1",
            calculate=lambda context: MetricResult(
                key="summary.count",
                value=len(context.campaigns),
                unit="count",
                status="available",
                sample_count=len(context.campaigns),
                definition_version="1",
                coverage=1.0,
            ),
        )
        registry.register(definition)

        with self.assertRaises(ValueError):
            registry.register(definition)
        with self.assertRaises(ValueError):
            MetricDefinition(
                key="summary.unversioned",
                definition_version="",
                calculate=lambda context: None,
            )

    def test_registry_evaluates_registered_metrics_with_shared_context(self):
        registry = MetricRegistry()
        registry.register(
            MetricDefinition(
                key="summary.count",
                definition_version="1",
                calculate=lambda context: MetricResult(
                    key="summary.count",
                    value=len(context.campaigns),
                    unit="count",
                    status="available",
                    sample_count=len(context.campaigns),
                    definition_version="1",
                    coverage=1.0,
                ),
            )
        )
        context = AnalysisContext(
            campaigns=[{"id": "campaign-1"}],
            platform="mt5",
            timezone="Asia/Shanghai",
        )

        results = registry.evaluate(context)

        self.assertEqual([result.key for result in results], ["summary.count"])
        self.assertEqual(results[0].value, 1)
        self.assertEqual(results[0].definition_version, "1")


if __name__ == "__main__":
    unittest.main()

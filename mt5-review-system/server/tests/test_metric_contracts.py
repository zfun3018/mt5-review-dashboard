"""Documentation contracts for the dashboard metric inventory."""

from __future__ import annotations

import re
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()

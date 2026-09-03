"""Safety and result contracts for the synthetic workspace benchmark tool."""

import sys
import unittest
from pathlib import Path

# The benchmark tool lives in the sibling `tools/` directory. Add the project
# root (the parent of `server/`) so `tools.benchmark_synthetic` is importable.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from tools.benchmark_synthetic import (  # noqa: E402
    BENCHMARK_ENDPOINTS,
    EndpointTiming,
    run_benchmark,
)


class BenchmarkToolTest(unittest.TestCase):
    def test_benchmark_uses_only_its_temporary_root(self):
        result = run_benchmark(trade_count=100, repeats=2)

        self.assertEqual(result.trade_count, 100)
        # The benchmark must clean up its temporary runtime root before returning.
        self.assertFalse(result.runtime_root.exists())
        # Every configured endpoint is measured and reported.
        for endpoint in BENCHMARK_ENDPOINTS:
            self.assertIn(endpoint, result.endpoints)
        # Analysis and campaigns are the primary acceptance endpoints.
        self.assertIn("/api/analysis?start=2026-01-01&end=2026-12-31&equity_days=30", result.endpoints)
        self.assertIn("/api/campaigns?page=1&page_size=50", result.endpoints)

    def test_timings_are_non_negative_and_finite(self):
        result = run_benchmark(trade_count=50, repeats=3)

        for endpoint, timing in result.endpoints.items():
            self.assertIsInstance(timing, EndpointTiming)
            self.assertGreaterEqual(timing.median_ms, 0.0, endpoint)
            self.assertGreaterEqual(timing.p95_ms, 0.0, endpoint)
            self.assertGreaterEqual(timing.p95_ms, timing.median_ms, endpoint)


if __name__ == "__main__":
    unittest.main()

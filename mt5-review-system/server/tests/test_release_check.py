"""One-command release check construction and behavior contracts.

The release check is the single entry point humans run before tagging a
release. It owns the gate list, the per-gate runner, the order, and the
fail-fast semantics. These tests pin those contracts so the tool cannot
silently drop a gate or change its ordering without the test suite noticing.
"""

from __future__ import annotations

import importlib
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

# The release check lives in the sibling `tools/` directory. Add the project
# root (the parent of `server/`) so `tools.check_release` is importable.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

check_release = importlib.import_module("tools.check_release")


class ReleaseCheckGateListTest(unittest.TestCase):
    def test_release_check_includes_required_gates(self):
        names = [gate.name for gate in check_release.build_gates(skip_browser=False)]
        self.assertEqual(
            names,
            ["python", "node", "syntax", "compatibility", "benchmark", "browser"],
        )

    def test_skip_browser_drops_browser_gate_only(self):
        names = [gate.name for gate in check_release.build_gates(skip_browser=True)]
        self.assertEqual(
            names,
            ["python", "node", "syntax", "compatibility", "benchmark"],
        )
        self.assertNotIn("browser", names)

    def test_gates_have_callable_runners(self):
        gates = check_release.build_gates(skip_browser=False)
        for gate in gates:
            self.assertTrue(callable(gate.run), f"Gate {gate.name} has no run()")
            # The runner must accept no required parameters so the release
            # tool can iterate them generically. ``bound`` first wraps the
            # method; ``signature`` strips ``self`` automatically.
            import inspect

            sig = inspect.signature(gate.run)
            self.assertEqual(
                list(sig.parameters),
                [],
                f"Gate {gate.name}.run should take no parameters, got {sig}",
            )

    def test_gates_carry_a_working_directory(self):
        gates = check_release.build_gates(skip_browser=False)
        for gate in gates:
            self.assertTrue(
                gate.cwd.exists(),
                f"Gate {gate.name} cwd does not exist: {gate.cwd}",
            )


class ReleaseCheckExecutionTest(unittest.TestCase):
    def test_run_all_returns_zero_when_every_gate_passes(self):
        # Synthesise a single green gate. The runner must aggregate the exit
        # codes (all zeros) and return 0.
        class _GreenGate:
            name = "green"
            cwd = Path.cwd()

            def run(self) -> int:
                return 0

        code = check_release.run_all([_GreenGate()])
        self.assertEqual(code, 0)

    def test_run_all_stops_on_first_failure(self):
        class _RedGate:
            name = "red"
            cwd = Path.cwd()

            def run(self) -> int:
                return 7

        called: list[str] = []

        class _TrackingGate:
            name = "tail"
            cwd = Path.cwd()

            def run(self) -> int:
                called.append(self.name)
                return 0

        code = check_release.run_all([_RedGate(), _TrackingGate()])
        self.assertEqual(code, 7)
        self.assertEqual(called, [], "run_all must short-circuit on first failure")

    def test_main_prints_redacted_failure_summary(self):
        # Drive a failing gate via a real subprocess so the failure summary
        # path is exercised end to end. We write the child script to a
        # temporary file rather than using ``python -c`` because Windows
        # path escaping through ``%r`` formatting is unreliable (a single
        # backslash difference corrupts the embedded script).
        import tempfile

        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".py",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(
                "import sys, pathlib\n"
                f"sys.path.insert(0, {str(_PROJECT_ROOT)!r})\n"
                "from tools import check_release as cr\n"
                "class G:\n"
                "    name = 'red'\n"
                "    cwd = pathlib.Path('.')\n"
                "    def run(self):\n"
                "        # Deliberately include a Windows-style absolute path in\n"
                "        # the child's stderr so we can assert that the release\n"
                "        # check's own failure summary does NOT echo it back.\n"
                "        print('leaking C:\\\\Users\\\\Me\\\\secret', file=sys.stderr)\n"
                "        return 3\n"
                "sys.exit(cr.run_all([G()]))\n"
            )
            child_path = handle.name
        try:
            result = subprocess.run(
                [sys.executable, child_path],
                capture_output=True,
                text=True,
            )
        finally:
            Path(child_path).unlink(missing_ok=True)
        self.assertEqual(result.returncode, 3)
        # The release check prints the gate name and "FAILED" to stderr;
        # the child's own stderr may include any string but the runner's
        # summary line MUST be present and MUST NOT echo workspace paths
        # (neither on stdout nor on stderr).
        self.assertIn("red FAILED", result.stderr)
        self.assertNotIn(str(_PROJECT_ROOT), result.stdout)
        self.assertNotIn(str(_PROJECT_ROOT), result.stderr)


class ReleaseCheckCliTest(unittest.TestCase):
    def test_main_parses_skip_browser_flag(self):
        # Drive the CLI with a known-good tool path so the test does not
        # actually run the full suite. We monkeypatch build_gates to a single
        # green gate so the run is fast and deterministic.
        class _GreenGate:
            name = "green"
            cwd = Path.cwd()

            def run(self) -> int:
                return 0

        original = check_release.build_gates
        check_release.build_gates = lambda skip_browser: [_GreenGate()]
        try:
            with mock.patch.object(sys, "argv", ["check_release.py", "--skip-browser"]):
                self.assertEqual(check_release.main(), 0)
        finally:
            check_release.build_gates = original


class ReleaseCheckBenchmarkArtifactTest(unittest.TestCase):
    def test_benchmark_gate_is_present_and_isolatable(self):
        # The benchmark gate is the gate that enforces the v0.6.0 latency
        # budget (analysis p95 ≤ 200 ms). It must be wired into the default
        # gate list so the release cannot ship without measuring perf.
        gates = check_release.build_gates(skip_browser=False)
        names = [gate.name for gate in gates]
        self.assertIn("benchmark", names)
        benchmark_gate = next(g for g in gates if g.name == "benchmark")

        # Swap *every* gate for a stand-in whose ``run`` records whether it
        # was called. ``Gate`` is a frozen dataclass so we cannot patch its
        # ``run`` attribute in place; replacing the whole list element is the
        # only safe way to exercise the ``run_all`` path without spawning
        # the real test runner / Node / Playwright subprocesses.
        called: list[str] = []

        class _StandIn:
            def __init__(self, name: str, cwd: Path) -> None:
                self.name = name
                self.cwd = cwd

            def run(self) -> int:
                called.append(self.name)
                return 0

        gates = [_StandIn(g.name, g.cwd) for g in gates]

        # Run the gates directly via ``run_all``; we are not invoking any
        # real subprocess here. The ``run_all`` contract is what we already
        # exercised in :class:`ReleaseCheckExecutionTest`.
        code = check_release.run_all(gates)
        self.assertEqual(code, 0)
        # The benchmark gate must have actually been visited (i.e. wired
        # into the iterable).
        self.assertIn("benchmark", called)


if __name__ == "__main__":
    unittest.main()

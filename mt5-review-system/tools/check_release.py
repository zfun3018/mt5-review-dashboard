"""One-command release check for the MT5 review system.

Runs the six release gates (or five with ``--skip-browser``) in a fixed
order and short-circuits on the first failure. Designed to be the single
entry point humans invoke before tagging a release:

    python tools/check_release.py            # full suite (browser included)
    python tools/check_release.py --skip-browser   # CI / headless

Design constraints:

* All subprocess calls use argument arrays (no shell=True), with an
  explicit ``cwd`` so behaviour is identical on Windows and POSIX.
* Normal test output streams through to the user. When a gate fails, the
  runner emits a small redacted summary that *names the gate* but does not
  echo back workspace or temporary-root paths.
* The benchmark gate enforces the v0.6.0 latency budget
  (``/api/analysis`` p95 ≤ 200 ms) and refuses to proceed if the artifact
  is missing or stale.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = PROJECT_ROOT / "server"
TESTS_DIR = SERVER_DIR / "tests"
WEB_DIR = PROJECT_ROOT / "web"
NODE_TEST_SCRIPT = PROJECT_ROOT / "scripts" / "run-unit-tests.mjs"
NODE_BIN = "node"
PLAYWRIGHT_BIN = PROJECT_ROOT / "node_modules" / ".bin" / (
    "playwright.cmd" if os.name == "nt" else "playwright"
)
BENCHMARK_TOOL = PROJECT_ROOT / "tools" / "benchmark_synthetic.py"
BENCHMARK_ARTIFACT = SERVER_DIR / "artifacts" / "benchmark-v0.6.0.json"
ANALYSIS_BUDGET_P95_MS = 200.0


@dataclass(frozen=True)
class Gate:
    """A single release check step.

    ``name`` is the public label shown in summary lines. ``cwd`` is the
    working directory used when invoking the subprocess. ``run`` performs
    the actual work and returns a POSIX exit code (0 = success).
    """

    name: str
    cwd: Path
    run: Callable[[], int]


# --- Gate runners -----------------------------------------------------------


def _run(args: Sequence[str], *, cwd: Path, env: dict | None = None) -> int:
    """Run a subprocess and return its exit code.

    stdout/stderr stream through unchanged so the user sees the test output
    in real time. A separate process group would be needed on POSIX for
    signal hygiene, but the goal here is correctness, not isolation.
    """
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    completed = subprocess.run(  # noqa: S603 — intentional subprocess
        list(args),
        cwd=str(cwd),
        env=merged_env,
        check=False,
    )
    return completed.returncode


def _python_gate() -> int:
    return _run(
        [sys.executable, "-m", "unittest", "discover", "-s", "tests"],
        cwd=SERVER_DIR,
    )


def _node_gate() -> int:
    # ``scripts/run-unit-tests.mjs`` excludes the browser/ directory
    # automatically, so we do not need to filter here.
    return _run(
        [NODE_BIN, str(NODE_TEST_SCRIPT)],
        cwd=PROJECT_ROOT,
    )


def _syntax_gate() -> int:
    # Compile every Python file under server/ and syntax-check the key
    # Node entry points. Both halves must pass; the first failure short
    # circuits via subprocess exit codes.
    py = _run(
        [sys.executable, "-m", "compileall", "-q", "server"],
        cwd=PROJECT_ROOT,
    )
    if py != 0:
        return py
    targets = [
        WEB_DIR / "shared" / "js" / "shell.mjs",
        WEB_DIR / "dashboard" / "dashboard.mjs",
        WEB_DIR / "orders" / "orders.mjs",
        WEB_DIR / "album" / "album.mjs",
        WEB_DIR / "settings" / "settings.mjs",
    ]
    for target in targets:
        code = _run([NODE_BIN, "--check", str(target)], cwd=PROJECT_ROOT)
        if code != 0:
            return code
    return 0


def _compatibility_gate() -> int:
    # The compatibility suite is a strict subset of the Python suite; we
    # invoke it directly so a regression here surfaces in isolation rather
    # than buried in a full-suite failure.
    return _run(
        [
            sys.executable,
            "-m",
            "unittest",
            "tests.test_data_compatibility",
            "-v",
        ],
        cwd=SERVER_DIR,
    )


def _benchmark_gate() -> int:
    # Run a small benchmark (1k trades) to keep this gate fast, then assert
    # the v0.6.0 latency budget from the resulting artifact. Full 10k
    # benchmarks remain a local acceptance step (see
    # docs/superpowers/plans/2026-09-02-v06-integration-release.md).
    BENCHMARK_ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    code = _run(
        [
            sys.executable,
            str(BENCHMARK_TOOL),
            "--trades",
            "1000",
            "--repeats",
            "5",
            "--seed",
            "20260903",
            "--json",
            str(BENCHMARK_ARTIFACT),
        ],
        cwd=PROJECT_ROOT,
    )
    if code != 0:
        return code
    if not BENCHMARK_ARTIFACT.exists():
        print(
            f"benchmark: artifact missing at {BENCHMARK_ARTIFACT.relative_to(PROJECT_ROOT)}",
            file=sys.stderr,
        )
        return 1
    try:
        report = json.loads(BENCHMARK_ARTIFACT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"benchmark: artifact is not valid JSON: {exc}", file=sys.stderr)
        return 1
    analysis = (report.get("endpoints") or {}).get(
        "/api/analysis?start=2026-01-01&end=2026-12-31&equity_days=30"
    )
    if not analysis:
        print("benchmark: artifact missing /api/analysis endpoint", file=sys.stderr)
        return 1
    p95 = float(analysis.get("p95_ms", 0.0))
    if p95 > ANALYSIS_BUDGET_P95_MS:
        print(
            f"benchmark: /api/analysis p95={p95:.1f}ms exceeds budget {ANALYSIS_BUDGET_P95_MS:.1f}ms",
            file=sys.stderr,
        )
        return 1
    elapsed = time.monotonic() - started
    print(
        f"benchmark: /api/analysis p95={p95:.1f}ms "
        f"(budget {ANALYSIS_BUDGET_P95_MS:.0f}ms) — {elapsed:.1f}s"
    )
    return 0


def _browser_gate() -> int:
    if not PLAYWRIGHT_BIN.exists():
        print(
            "browser: Playwright is not installed; run `npm install` first.",
            file=sys.stderr,
        )
        return 1
    return _run([str(PLAYWRIGHT_BIN), "test"], cwd=PROJECT_ROOT)


# --- Public API -------------------------------------------------------------


def build_gates(*, skip_browser: bool) -> list[Gate]:
    """Return the ordered list of release gates.

    The order is part of the contract. The benchmark gate must run after
    Python and Node so we know the codebase is sound before measuring
    latency, and the browser gate (when included) runs last because it is
    the slowest and the most likely to be unavailable in CI.
    """
    gates: list[Gate] = [
        Gate(name="python", cwd=SERVER_DIR, run=_python_gate),
        Gate(name="node", cwd=PROJECT_ROOT, run=_node_gate),
        Gate(name="syntax", cwd=PROJECT_ROOT, run=_syntax_gate),
        Gate(name="compatibility", cwd=SERVER_DIR, run=_compatibility_gate),
        Gate(name="benchmark", cwd=PROJECT_ROOT, run=_benchmark_gate),
    ]
    if not skip_browser:
        gates.append(Gate(name="browser", cwd=PROJECT_ROOT, run=_browser_gate))
    return gates


def run_all(gates: Sequence[Gate]) -> int:
    """Run the supplied gates in order, stopping on the first failure."""
    started = time.monotonic()
    for gate in gates:
        print(f"=== {gate.name} ===", flush=True)
        before = time.monotonic()
        code = gate.run()
        elapsed = time.monotonic() - before
        if code != 0:
            # Summary intentionally redacts paths so a release run is safe to
            # paste into a chat thread or ticket without leaking the
            # developer's machine layout.
            print(
                f"\n!! {gate.name} FAILED in {elapsed:.1f}s (exit {code})",
                file=sys.stderr,
                flush=True,
            )
            return code
        print(f"--- {gate.name} OK ({elapsed:.1f}s) ---", flush=True)
    total = time.monotonic() - started
    print(f"\nAll {len(gates)} gates passed in {total:.1f}s", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the v0.6.0 release verification gates.",
    )
    parser.add_argument(
        "--skip-browser",
        action="store_true",
        help="Skip the Playwright gate (intended for CI without Chromium).",
    )
    args = parser.parse_args(argv)
    gates = build_gates(skip_browser=args.skip_browser)
    return run_all(gates)


if __name__ == "__main__":
    raise SystemExit(main())

"""Synthetic workspace benchmark for the MT5 review system.

Generates a deterministic set of closed trades into a temporary runtime root,
rebuilds derived campaign models once, then times representative HTTP
endpoints against a local ``ThreadingHTTPServer``.

Only aggregate timings are printed; no trade records or filesystem paths are
written to stdout. The temporary runtime root is removed before returning so
the benchmark never touches or leaves files in the user's project directories.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

# Make the server package importable regardless of the invocation directory.
# `tools/` and `server/` are siblings under the project root.
_SERVER_DIR = Path(__file__).resolve().parents[1] / "server"
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from app import storage  # noqa: E402
from app.core.config import RuntimePaths, set_runtime_paths  # noqa: E402
from app.domain.analytics import calculate_duration_seconds  # noqa: E402
from app.server import ReviewRequestHandler  # noqa: E402

DEFAULT_TRADE_COUNT = 10_000
DEFAULT_REPEATS = 20
DEFAULT_SEED = 20260903

SYMBOLS = ("XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD")
SYMBOL_BASE_PRICE = {
    "XAUUSD": 2000.0,
    "EURUSD": 1.08,
    "GBPUSD": 1.27,
    "USDJPY": 148.0,
    "AUDUSD": 0.66,
    "USDCAD": 1.36,
}
TRADE_TYPES = ("follow", "reversal", "unclassified")
STRATEGIES = ("breakout", "range", "major_reversal", "strategy_unclassified")

# Representative read endpoints exercised by the four workspaces.
BENCHMARK_ENDPOINTS = (
    "/api/analysis?start=2026-01-01&end=2026-12-31&equity_days=30",
    "/api/campaigns?page=1&page_size=50",
    "/api/campaigns?q=XAU&page=3&page_size=50",
    "/api/review-album?page=1&page_size=24",
    "/api/status",
    "/api/custom-fields",
)

_SYNTHETIC_TRADE_INSERT = """
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side, lots,
    open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl,
    commission, swap, fee, screenshot_path, review_text, trend_id, remark,
    trade_type, strategy, source, raw_json
) VALUES (
    :id, :account, :order_no, :position_id, :order_ticket, :deal_ticket, :symbol, :side, :lots,
    :open_time_utc, :close_time_utc, :duration_seconds, :entry_price, :exit_price, :pnl,
    :commission, :swap, :fee, :screenshot_path, :review_text, :trend_id, :remark,
    :trade_type, :strategy, :source, :raw_json
)
"""


@dataclass(frozen=True)
class EndpointTiming:
    median_ms: float
    p95_ms: float


@dataclass(frozen=True)
class BenchmarkResult:
    trade_count: int
    runtime_root: Path
    endpoints: dict[str, EndpointTiming]


def _synthetic_trade(index: int, rng: random.Random) -> dict:
    """Build one deterministic closed trade spread across 2026."""
    symbol = SYMBOLS[index % len(SYMBOLS)]
    side = "long" if index % 2 == 0 else "short"
    base = SYMBOL_BASE_PRICE[symbol]

    open_time = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(
        days=rng.uniform(0.0, 360.0),
        hours=rng.uniform(0.0, 23.0),
    )
    close_time = open_time + timedelta(minutes=rng.uniform(5.0, 240.0))

    entry_price = round(base * (1.0 + rng.uniform(-0.01, 0.01)), 5)
    move = rng.uniform(0.001, 0.02) * base * (1.0 if rng.random() < 0.5 else -1.0)
    exit_price = round(entry_price + move, 5)
    pnl = round((exit_price - entry_price) * (1.0 if side == "long" else -1.0) * 10.0, 2)

    trade_id = f"SYN-{index:05d}"
    return {
        "id": trade_id,
        "account": "SYNTHETIC",
        "order_no": str(index),
        "position_id": f"P-{index:05d}",
        "order_ticket": f"O-{index:05d}",
        "deal_ticket": f"D-{index:05d}",
        "symbol": symbol,
        "side": side,
        "lots": 1.0,
        "open_time_utc": open_time.isoformat(),
        "close_time_utc": close_time.isoformat(),
        "duration_seconds": calculate_duration_seconds(open_time, close_time),
        "entry_price": entry_price,
        "exit_price": exit_price,
        "pnl": pnl,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "screenshot_path": "",
        "review_text": f"合成复盘 {index}" if index % 3 == 0 else "",
        "trend_id": None,
        "remark": "",
        "trade_type": TRADE_TYPES[index % len(TRADE_TYPES)],
        "strategy": STRATEGIES[index % len(STRATEGIES)],
        "source": "synthetic",
        "raw_json": json.dumps({"synthetic": True}),
    }


def _seed_synthetic_trades(conn, trade_count: int, rng: random.Random) -> int:
    """Bulk-insert deterministic trades inside the caller's transaction."""
    rows = [_synthetic_trade(index, rng) for index in range(trade_count)]
    conn.executemany(_SYNTHETIC_TRADE_INSERT, rows)
    return len(rows)


def _seed_initial_stops(conn, rng: random.Random) -> int:
    """Assign an initial stop to a subset of positions to exercise R completeness."""
    positions = [
        dict(row)
        for row in conn.execute(
            "SELECT id, side, weighted_entry_price FROM positions "
            "WHERE weighted_entry_price IS NOT NULL"
        )
    ]
    assigned = 0
    for position in positions:
        if rng.random() < 0.5:
            continue
        entry = float(position["weighted_entry_price"])
        side = str(position["side"] or "").lower()
        stop = entry * (0.985 if side == "long" else 1.015)
        conn.execute(
            "UPDATE positions SET initial_stop_price = ? WHERE id = ?",
            (round(stop, 5), position["id"]),
        )
        assigned += 1
    return assigned


def _prepare_runtime(root: Path, trade_count: int, seed: int) -> None:
    """Create the schema, seed trades, and rebuild campaigns under `root`."""
    paths = RuntimePaths.from_root(root)
    set_runtime_paths(paths)
    storage.init_db(seed=False)

    rng = random.Random(seed)
    with storage.db() as conn:
        _seed_synthetic_trades(conn, trade_count, rng)
    storage.rebuild_campaign_models()
    with storage.db() as conn:
        _seed_initial_stops(conn, rng)


def _fetch(base_url: str, path: str) -> None:
    request = urllib.request.Request(f"{base_url}{path}")
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read()


def _percentile(values: list[float], percentile: float) -> float:
    """Return an inclusive linear-interpolation percentile of a list of samples."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (percentile / 100.0) * (len(ordered) - 1)
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _time_endpoint(base_url: str, path: str, repeats: int) -> EndpointTiming:
    for _ in range(2):  # warm each endpoint twice
        _fetch(base_url, path)
    samples: list[float] = []
    for _ in range(repeats):
        started = time.perf_counter()
        _fetch(base_url, path)
        samples.append((time.perf_counter() - started) * 1000.0)
    return EndpointTiming(
        median_ms=round(statistics.median(samples), 3),
        p95_ms=round(_percentile(samples, 95.0), 3),
    )


def run_benchmark(
    trade_count: int = DEFAULT_TRADE_COUNT,
    repeats: int = DEFAULT_REPEATS,
    seed: int = DEFAULT_SEED,
) -> BenchmarkResult:
    """Seed a temporary workspace and time every benchmark endpoint.

    The temporary runtime root is removed before this function returns.
    """
    original_paths = storage.runtime_paths()
    tmp = TemporaryDirectory(prefix="mt5-benchmark-")
    root = Path(tmp.name).resolve()
    try:
        _prepare_runtime(root, trade_count, seed)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), ReviewRequestHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{httpd.server_address[1]}"
            endpoints = {
                path: _time_endpoint(base_url, path, repeats)
                for path in BENCHMARK_ENDPOINTS
            }
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)
    finally:
        set_runtime_paths(original_paths)
        tmp.cleanup()

    return BenchmarkResult(
        trade_count=trade_count,
        runtime_root=root,
        endpoints=endpoints,
    )


def _report(result: BenchmarkResult) -> dict:
    return {
        "trade_count": result.trade_count,
        "endpoints": {
            path: {"median_ms": timing.median_ms, "p95_ms": timing.p95_ms}
            for path, timing in result.endpoints.items()
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run a synthetic workspace benchmark against a local HTTP server."
    )
    parser.add_argument("--trades", type=int, default=DEFAULT_TRADE_COUNT)
    parser.add_argument("--repeats", type=int, default=DEFAULT_REPEATS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args(argv)

    result = run_benchmark(
        trade_count=args.trades,
        repeats=args.repeats,
        seed=args.seed,
    )

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(
            json.dumps(_report(result), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    for path, timing in result.endpoints.items():
        print(f"{path}: median={timing.median_ms:.1f}ms p95={timing.p95_ms:.1f}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# v0.6.0 Integration and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove historical-data compatibility, performance, responsive behavior, rollback safety, and release readiness for the one-time v0.6.0 architecture switch.

**Architecture:** Integrate the completed backend and frontend plans without touching real user data during automated verification. Use synthetic schema fixtures, a read-only audit interface, local HTTP benchmarks, and Playwright browser checks; retain the browser deployment while finalizing boundaries needed by the later Windows wrapper.

**Tech Stack:** Python 3.11+ standard library, SQLite Backup API, Node.js 20+, Playwright test runner, Chromium, PowerShell

**Spec:** `docs/superpowers/specs/2026-09-02-architecture-redesign-design.md`

## Global Constraints

- Complete both `2026-09-02-v06-backend-architecture.md` and `2026-09-02-v06-frontend-workspaces.md` first.
- Never run migration, benchmark, or browser tests against `mt5-review-system/data/`, `backups/`, real screenshots, raw events, or `config.local.json`.
- Automated tests create temporary synthetic data and delete only their own temporary directories.
- Keep the existing business schema at version 4; add indexes and `schema_meta` keys idempotently without changing business field meaning.
- Do not create the Windows installer in v0.6.0.
- Default service binding is `127.0.0.1`; LAN binding requires an explicit environment or settings choice.
- A release cannot proceed unless Python tests, Node tests, syntax checks, performance results, and desktop/390px browser checks all pass.
- Keep the previous stable version and pre-migration SQLite snapshot recoverable until v0.6.0 is accepted.

---

## File Map

- `server/app/data/compatibility.py`: schema/data audit summaries and comparison rules.
- `server/tests/fixtures/schema_v2.sql`, `schema_v3.sql`, `schema_v4.sql`: minimal synthetic legacy schemas with representative records.
- `server/tests/test_data_compatibility.py`: legacy upgrade, audit, and rollback tests.
- `tools/benchmark_synthetic.py`: temporary 10,000-trade local API benchmark.
- `tools/check_release.py`: one-command non-sensitive release verification orchestrator.
- `web/tests/browser/workspaces.spec.mjs`: Playwright desktop/mobile workflows.
- `playwright.config.mjs`: local server and viewport configuration.
- `package.json` and `package-lock.json`: development-only Playwright dependency and verification scripts.
- `run.py` and `server/app/core/config.py`: explicit future desktop data-root boundary.
- `README.md`, `mt5-review-system/README.md`, `docs/VERSION-ROUTE.md`, and `VERSION`: v0.6.0 documentation.

### Task 1: Add Historical Schema Compatibility and Migration Auditing

**Files:**
- Create: `mt5-review-system/server/app/data/compatibility.py`
- Create: `mt5-review-system/server/tests/fixtures/schema_v2.sql`
- Create: `mt5-review-system/server/tests/fixtures/schema_v3.sql`
- Create: `mt5-review-system/server/tests/fixtures/schema_v4.sql`
- Create: `mt5-review-system/server/tests/test_data_compatibility.py`
- Modify: `mt5-review-system/server/app/data/migrations.py`

**Interfaces:**
- Produces: `build_data_fingerprint(paths) -> DataFingerprint`, `compare_fingerprints(before, after) -> CompatibilityReport`, and `upgrade_with_backup(paths) -> UpgradeResult`.
- Consumes: `RuntimePaths`, SQLite Backup API, and application services for fixed metric summaries.

- [x] **Step 1: Create minimal legacy fixtures**

Each fixture contains only synthetic identifiers and covers:

- one active profitable trade;
- one soft-deleted trade where supported;
- one review text;
- classification values;
- one custom field value where supported;
- one screenshot-relative path that points to a synthetic placeholder;
- v4 Deal, Position, Campaign, initial stop, and analysis setting records.

Do not include account, order, terminal, path, or screenshot values derived from the real workspace.

- [x] **Step 2: Add fingerprint and upgrade tests**

```python
def test_v4_fingerprint_survives_idempotent_upgrade(self):
    before = build_data_fingerprint(self.paths)
    first = upgrade_with_backup(self.paths)
    after = build_data_fingerprint(self.paths)
    second = upgrade_with_backup(self.paths)
    self.assertTrue(compare_fingerprints(before, after).compatible)
    self.assertFalse(second.backup_created)

def test_failed_upgrade_leaves_original_database_unchanged(self):
    before_hash = sha256(self.paths.database.read_bytes()).hexdigest()
    with self.assertRaises(MigrationError):
        upgrade_with_backup(self.paths, migration_hook=raise_failure)
    self.assertEqual(sha256(self.paths.database.read_bytes()).hexdigest(), before_hash)
```

- [x] **Step 3: Run compatibility tests and verify they fail**

Run from `mt5-review-system/server`: `..\.venv\Scripts\python.exe -m unittest tests.test_data_compatibility -v`

Expected: FAIL because compatibility interfaces and fixtures do not exist.

- [x] **Step 4: Implement privacy-safe fingerprints**

`DataFingerprint` contains counts and aggregate checks only:

```python
@dataclass(frozen=True)
class DataFingerprint:
    schema_version: int
    active_trades: int
    deleted_trades: int
    deals: int
    positions: int
    campaigns: int
    reviews: int
    custom_values: int
    screenshot_references: int
    net_pnl: float
    r_complete: int

@dataclass(frozen=True)
class CompatibilityReport:
    compatible: bool
    differences: tuple[str, ...]

@dataclass(frozen=True)
class UpgradeResult:
    backup_created: bool
    backup_path: Path | None
    report: CompatibilityReport
```

It must not contain account IDs, order IDs, terminal IDs, absolute paths, review content, custom value content, or screenshot names.

- [x] **Step 5: Implement backup, transaction, audit, and rollback**

`upgrade_with_backup` closes active connections, creates one SQLite Backup API snapshot in the configured backup directory, performs idempotent schema work in a transaction, runs `PRAGMA integrity_check`, builds the after fingerprint, and returns success only when compatibility rules pass. Any exception closes connections and leaves the original database bytes unchanged.

- [x] **Step 6: Test v2, v3, and v4 fixtures**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_data_compatibility tests.test_campaign_storage tests.test_classification_options -v`

Expected: PASS for all three source schemas, repeated upgrades, and injected failure.

- [x] **Step 7: Run the complete backend suite and commit**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

```powershell
git add mt5-review-system/server/app/data/compatibility.py mt5-review-system/server/app/data/migrations.py mt5-review-system/server/tests
git commit -m "test: add historical data compatibility audit"
```

### Task 2: Finalize Runtime and Future Windows Data-Root Boundaries

**Files:**
- Modify: `mt5-review-system/server/app/core/config.py`
- Modify: `mt5-review-system/server/app/bridge_sync.py`
- Modify: `mt5-review-system/run.py`
- Modify: `mt5-review-system/start.ps1`
- Modify: `一键启动MT5复盘仪表盘.bat`
- Create: `mt5-review-system/server/tests/test_runtime_paths.py`
- Modify: `mt5-review-system/server/tests/test_server_payload.py`

**Interfaces:**
- Produces: optional `MT5_REVIEW_DATA_DIR` and `MT5_REVIEW_CONFIG_FILE` overrides, while preserving project-relative defaults for the browser version.
- Consumes: `RuntimePaths` and `RuntimeConfig` from the backend plan.

- [x] **Step 1: Add runtime path and binding tests**

```python
def test_explicit_data_directory_does_not_move_project_files(self):
    config = RuntimeConfig.from_environment({"MT5_REVIEW_DATA_DIR": str(self.root / "user-data")})
    self.assertEqual(config.paths.database, self.root / "user-data" / "journal.sqlite")
    self.assertEqual(config.paths.screenshots, self.root / "user-data" / "screenshots")

def test_lan_binding_requires_explicit_value(self):
    self.assertEqual(RuntimeConfig.from_environment({}).host, "127.0.0.1")
    self.assertEqual(RuntimeConfig.from_environment({"MT5_REVIEW_HOST": "0.0.0.0"}).host, "0.0.0.0")
```

- [x] **Step 2: Run runtime tests and verify the data-root test fails**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_runtime_paths tests.test_server_payload -v`

Expected: FAIL because explicit data/config roots are not fully supported.

- [x] **Step 3: Implement explicit paths without automatic data movement**

Resolve environment overrides as absolute paths, create missing user-data subdirectories only at normal initialization, and never copy or delete old data automatically in v0.6.0. `bridge_sync` reads only `RuntimePaths.config_file`.

- [x] **Step 4: Change launchers to loopback by default**

Remove automatic `0.0.0.0` defaults from both launchers. Continue printing a LAN URL only when `MT5_REVIEW_HOST=0.0.0.0` was explicitly supplied. Keep `MT5_REVIEW_PYTHON` support.

- [x] **Step 5: Run runtime and startup tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_runtime_paths tests.test_server_payload tests.test_bridge_sync -v`

Expected: PASS.

- [x] **Step 6: Run a temporary-root startup smoke check**

Create a temporary directory, set `MT5_REVIEW_DATA_DIR` and `MT5_REVIEW_CONFIG_FILE` to paths inside it, start the server on port 0 inside a test process, request `/api/health`, and assert all created files remain inside the temporary root.

- [x] **Step 7: Commit runtime boundaries**

```powershell
git add mt5-review-system/server/app/core/config.py mt5-review-system/server/app/bridge_sync.py mt5-review-system/server/tests mt5-review-system/run.py mt5-review-system/start.ps1 '一键启动MT5复盘仪表盘.bat'
git commit -m "refactor: prepare local runtime for desktop packaging"
```

### Task 3: Add a Repeatable 10,000-Trade Performance Benchmark

**Files:**
- Create: `mt5-review-system/tools/benchmark_synthetic.py`
- Create: `mt5-review-system/server/tests/test_benchmark_tool.py`
- Modify: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/data/campaign_repository.py`

**Interfaces:**
- Produces: `run_benchmark(trade_count=10000, repeats=20) -> BenchmarkResult` with per-endpoint median and p95 milliseconds.
- Consumes: temporary RuntimePaths, local `ThreadingHTTPServer`, repositories, and synthetic data generator.

- [ ] **Step 1: Add benchmark safety and result tests**

```python
@dataclass(frozen=True)
class EndpointTiming:
    median_ms: float
    p95_ms: float

@dataclass(frozen=True)
class BenchmarkResult:
    trade_count: int
    runtime_root: Path
    endpoints: dict[str, EndpointTiming]

def test_benchmark_uses_only_its_temporary_root(self):
    result = run_benchmark(trade_count=100, repeats=2)
    self.assertEqual(result.trade_count, 100)
    self.assertFalse(result.runtime_root.exists())
    self.assertIn("/api/analysis", result.endpoints)
    self.assertIn("/api/campaigns", result.endpoints)
```

- [ ] **Step 2: Run benchmark-tool tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_benchmark_tool -v`

Expected: FAIL because the benchmark tool does not exist.

- [ ] **Step 3: Implement deterministic synthetic seeding**

Use a fixed random seed and bulk parameterized inserts inside one transaction. Generate closed trades across symbols, directions, dates, classifications, reviews, and R completeness. Do not invoke event ingestion 10,000 times. Build derived Campaign data once after seeding.

- [ ] **Step 4: Benchmark real local HTTP endpoints**

Start the server on `127.0.0.1:0`, warm each endpoint twice, then time 20 requests for:

- `/api/analysis?start=2026-01-01&end=2026-12-31&equity_days=30`;
- `/api/campaigns?page=1&page_size=50`;
- `/api/campaigns?q=XAU&page=3&page_size=50`;
- `/api/review-album?page=1&page_size=24`;
- `/api/status` and `/api/custom-fields`.

Use `statistics.median` and an inclusive percentile calculation. Print aggregate timings only; print no records or paths.

- [ ] **Step 5: Add only measured indexes**

Capture `EXPLAIN QUERY PLAN` for filters and add idempotent indexes only when the plan shows full scans on filter/order columns. Record each added index and its query in a code comment in `migrations.py`.

- [ ] **Step 6: Run the full benchmark**

Run: `..\.venv\Scripts\python.exe ..\tools\benchmark_synthetic.py --trades 10000 --repeats 20 --json artifacts\benchmark-v0.6.0.json`

Expected: each primary endpoint reports p95 at or below 200ms. If one misses, optimize and rerun; do not change the acceptance threshold or omit the result.

- [ ] **Step 7: Run backend tests and commit**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

```powershell
git add mt5-review-system/tools/benchmark_synthetic.py mt5-review-system/server
git commit -m "perf: add synthetic workspace benchmarks"
```

The benchmark JSON remains under the ignored `artifacts/` directory. Include its aggregate p95 values in the final handoff, but do not stage the generated file.

### Task 4: Add Desktop and 390px Playwright Verification

**Files:**
- Create: `mt5-review-system/package.json`
- Create: `mt5-review-system/package-lock.json`
- Create: `mt5-review-system/playwright.config.mjs`
- Create: `mt5-review-system/web/tests/browser/workspaces.spec.mjs`
- Create: `mt5-review-system/web/tests/browser/fixtures.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run test:ui` and Playwright projects `desktop-chromium` and `mobile-390`.
- Consumes: a server started with a temporary synthetic database; never the default project database.

- [ ] **Step 1: Define development-only browser dependencies**

```json
{
  "private": true,
  "scripts": {
    "test:unit": "node --test web/tests/*.test.js web/tests/*.test.mjs",
    "test:ui": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.55.0"
  }
}
```

Generate and commit the lockfile. Ignore `node_modules/`, `test-results/`, `playwright-report/`, and browser binaries.

- [ ] **Step 2: Add a synthetic Playwright server fixture**

The fixture creates a temporary runtime root, seeds synthetic trades and placeholder PNGs, starts `run.py` on an available loopback port, waits for `/api/health`, and terminates the child process in teardown. It exposes only the temporary server URL.

- [ ] **Step 3: Write workspace workflow tests**

Cover:

```javascript
test("desktop navigation and workspaces remain isolated", async ({page}) => {
  await page.goto("/dashboard/");
  await expect(page.getByRole("navigation", {name: "主导航"})).toBeVisible();
  await expect(page.getByRole("heading", {name: "复盘仪表盘"})).toBeVisible();
  await page.getByRole("link", {name: "订单列表"}).click();
  await expect(page).toHaveURL(/\/orders\//);
  await expect(page.getByRole("heading", {name: "订单列表"})).toBeVisible();
});
```

Also test filter URL restoration, order selection/edit, screenshot placeholder, album-to-order link, settings threshold validation, regional retry, modal Escape, and mobile drawer focus return.

- [ ] **Step 4: Add overflow and console assertions**

For every page in both projects:

```javascript
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
expect(consoleErrors).toEqual([]);
expect(pageErrors).toEqual([]);
```

Capture screenshots for dashboard, orders list/detail, album, and settings at 1440x1000 and 390x844. Store only synthetic screenshots under ignored `test-results/`; do not commit them.

- [ ] **Step 5: Install the pinned browser tooling**

Run: `npm install`

Run: `npx playwright install chromium`

Expected: lockfile remains unchanged after the second `npm install`.

- [ ] **Step 6: Run unit and browser tests**

Run: `npm run test:unit`

Run: `npm run test:ui`

Expected: PASS in desktop and mobile projects with no console errors or overflow.

- [ ] **Step 7: Commit browser verification**

```powershell
git add .gitignore mt5-review-system/package.json mt5-review-system/package-lock.json mt5-review-system/playwright.config.mjs mt5-review-system/web/tests/browser
git commit -m "test: add responsive workspace browser checks"
```

### Task 5: Add the One-Command Release Check and Rollback Drill

**Files:**
- Create: `mt5-review-system/tools/check_release.py`
- Create: `mt5-review-system/server/tests/test_release_check.py`
- Modify: `mt5-review-system/start.ps1`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `check_release.py --skip-browser` for CI without installed Chromium and full `check_release.py` for local release acceptance.
- Consumes: Python suite, Node suite, syntax checks, synthetic benchmark artifact, compatibility tests, and Playwright.

- [ ] **Step 1: Add release command-construction tests**

```python
def test_release_check_includes_required_gates(self):
    names = [gate.name for gate in build_gates(skip_browser=False)]
    self.assertEqual(names, ["python", "node", "syntax", "compatibility", "benchmark", "browser"])
```

- [ ] **Step 2: Run release-check tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_release_check -v`

Expected: FAIL because the release tool does not exist.

- [ ] **Step 3: Implement fail-fast release gates**

Use `subprocess.run` argument arrays with explicit working directories. Stream normal test output, but redact resolved workspace and temporary-root paths from failure summaries. Return nonzero immediately on the first failed gate.

- [ ] **Step 4: Add a synthetic rollback drill**

The compatibility gate creates a v3 fixture, saves its hash, injects a migration failure, verifies the hash and active counts are unchanged, then runs a successful upgrade and verifies the backup can be opened with `PRAGMA integrity_check = ok`.

- [ ] **Step 5: Update CI with non-browser verification**

CI installs Node dependencies from the lockfile and runs Python, Node, syntax, compatibility, and the small 1,000-trade benchmark. The full 10,000-trade benchmark and Chromium projects remain local release gates to avoid hiding slow or unavailable browser infrastructure behind CI exceptions.

- [ ] **Step 6: Run the full release check**

Run from `mt5-review-system`: `.\.venv\Scripts\python.exe .\tools\check_release.py`

Expected: all six gates pass.

- [ ] **Step 7: Commit release automation**

```powershell
git add mt5-review-system/tools/check_release.py mt5-review-system/server/tests/test_release_check.py mt5-review-system/start.ps1 .github/workflows/ci.yml
git commit -m "chore: add v0.6.0 release verification"
```

### Task 6: Update v0.6.0 Documentation and Perform Final Acceptance

**Files:**
- Modify: `VERSION`
- Modify: `README.md`
- Modify: `mt5-review-system/README.md`
- Modify: `docs/VERSION-ROUTE.md`
- Create: `docs/adr/0001-use-modular-monolith.md`
- Create: `docs/adr/0002-use-native-multi-page-ui.md`
- Create: `docs/adr/0003-preserve-sqlite-v4-data.md`
- Create: `docs/adr/0004-defer-windows-wrapper.md`

**Interfaces:**
- Produces: v0.6.0 user and maintainer documentation with exact run, test, migration, rollback, and page ownership instructions.
- Consumes: accepted implementation and measured verification output.

- [ ] **Step 1: Update version metadata consistently**

Set `VERSION` to `0.6.0`. Update both README files and the version route to state the same current version and the four workspace URLs.

- [ ] **Step 2: Document user-visible changes**

Explain in ordinary Chinese:

- the new left navigation;
- separate dashboard, orders, album, and settings pages;
- faster page-specific loading;
- unchanged historical data and metrics;
- loopback-only default and explicit LAN opt-in;
- old link redirection;
- Windows desktop packaging remains the next phase.

- [ ] **Step 3: Extract accepted ADRs from the design spec**

Use the four decisions listed in the file map. Each ADR states status, context, decision, positive/negative consequences, rejected alternatives, and links back to the v0.6.0 design.

- [ ] **Step 4: Run all verification from a clean process**

Run: `.\.venv\Scripts\python.exe .\tools\check_release.py`

Expected: all gates pass.

- [ ] **Step 5: Inspect the final diff for sensitive or generated data**

Run:

```powershell
git status --short
git diff --check
git diff --name-only
```

Expected: no `data/`, `backups/`, `config.local.json`, screenshots, raw JSONL, browser output, local absolute paths, SQLite files, logs, or generated binaries.

- [ ] **Step 6: Create the focused v0.6.0 release commit**

```powershell
git add VERSION README.md mt5-review-system/README.md docs/VERSION-ROUTE.md docs/adr
git commit -m "release: prepare v0.6.0 architecture redesign"
```

- [ ] **Step 7: Record final acceptance results**

In the handoff, report exact Python test count, Node test count, Playwright project count, performance p95 values, schema fixtures verified, desktop/mobile overflow result, and any residual risk. Do not report or display real data counts or private paths.

## v0.6.0 Release Completion Gate

The architecture redesign is complete only when:

- Historical v2, v3, and v4 synthetic fixtures upgrade and audit successfully.
- Injected migration failure leaves the original fixture unchanged.
- Runtime data/config roots can be redirected without moving old data.
- Service binds to loopback unless LAN is explicitly enabled.
- 10,000-trade synthetic API p95 is at or below 200ms for every primary workspace endpoint.
- Python, Node, syntax, compatibility, benchmark, and Playwright gates pass.
- All four workspaces pass 1440px and 390px checks with no console errors or horizontal overflow.
- No sensitive or generated user data appears in Git status or diff.
- Version and documentation consistently identify v0.6.0.
- The previous stable version and pre-migration backup remain recoverable.

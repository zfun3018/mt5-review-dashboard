# v0.6.0 Backend Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Python backend into explicit data, domain, application, and HTTP presentation boundaries without changing historical data, public behavior, or trading metrics.

**Architecture:** Keep one standard-library Python process and one SQLite database. Introduce focused modules behind a compatibility facade, move filtering and pagination into SQL, and make Campaign rebuild an explicit write-side operation instead of a hidden read side effect.

**Tech Stack:** Python 3.11+, Python standard library, SQLite, `unittest`, `http.server`

**Spec:** `docs/superpowers/specs/2026-09-02-architecture-redesign-design.md`

## Global Constraints

- Do not read or modify `mt5-review-system/data/`, `backups/`, `config.local.json`, screenshots, raw MT5 JSONL events, or generated binaries.
- Keep SQLite and the standard-library HTTP server; add no runtime dependency.
- Preserve Campaign, Position, R multiple, cash PnL, win-rate, SQN, and Z-score definitions exactly.
- Keep existing API paths compatible while the frontend is migrated.
- Reads must not write to SQLite or trigger Campaign reconstruction.
- All migration and storage tests use temporary directories and synthetic data.
- Default network binding remains `127.0.0.1`; LAN access is opt-in.
- Run Python tests from `mt5-review-system/server` with `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`.

---

## File Map

Create these focused backend modules:

- `server/app/core/config.py`: immutable runtime paths and bind configuration.
- `server/app/core/errors.py`: stable application error types.
- `server/app/data/database.py`: SQLite connections and transaction context.
- `server/app/data/migrations.py`: schema creation, version checks, and pre-migration backup.
- `server/app/data/trade_repository.py`: trade queries and trade writes.
- `server/app/data/campaign_repository.py`: persisted Campaign/Position reads and writes.
- `server/app/data/catalog_repository.py`: classifications, custom fields, and settings.
- `server/app/data/media_repository.py`: screenshot and backup file lifecycle.
- `server/app/domain/r_metrics.py`: R metric calculations moved from `campaigns.py`.
- `server/app/application/dashboard_service.py`: dashboard query orchestration.
- `server/app/application/orders_service.py`: order-list and order-detail use cases.
- `server/app/application/album_service.py`: album query orchestration.
- `server/app/application/settings_service.py`: settings and status use cases.
- `server/app/presentation/http/router.py`: method/path dispatch.
- `server/app/presentation/http/routes/*.py`: parameter parsing and response calls by feature.

Keep `server/app/storage.py`, `analytics.py`, `campaigns.py`, `server.py`, `importer.py`, and `bridge_sync.py` as compatibility entry points until all existing tests and callers use the new modules.

### Task 1: Freeze Backend Contracts with Synthetic Fixtures

**Files:**
- Create: `mt5-review-system/server/tests/support.py`
- Create: `mt5-review-system/server/tests/test_architecture_contract.py`
- Modify: `mt5-review-system/server/tests/test_campaign_storage.py`

**Interfaces:**
- Produces: `TemporaryStorageCase`, `insert_trade(storage_module, **overrides)`, and a fixed expected analysis/campaign contract.
- Consumes: current `app.storage` public functions only.

- [ ] **Step 1: Add a reusable temporary storage test base**

```python
class TemporaryStorageCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.originals = {
            "PROJECT_ROOT": storage.PROJECT_ROOT,
            "DATA_DIR": storage.DATA_DIR,
            "SCREENSHOT_DIR": storage.SCREENSHOT_DIR,
            "RAW_EVENTS_DIR": storage.RAW_EVENTS_DIR,
            "BACKUP_DIR": storage.BACKUP_DIR,
            "DB_PATH": storage.DB_PATH,
        }
        storage.PROJECT_ROOT = self.root
        storage.DATA_DIR = self.root / "data"
        storage.SCREENSHOT_DIR = storage.DATA_DIR / "screenshots"
        storage.RAW_EVENTS_DIR = storage.DATA_DIR / "raw-events"
        storage.BACKUP_DIR = self.root / "backups"
        storage.DB_PATH = storage.DATA_DIR / "journal.sqlite"
        storage.init_db(seed=False)

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()
```

- [ ] **Step 2: Add a full synthetic behavior contract**

Create two closed Positions in one Campaign, one soft-deleted trade, one custom field, one screenshot-relative path, and equity snapshots. Assert exact values for:

```python
self.assertEqual(page["total"], 1)
self.assertEqual(page["campaigns"][0]["position_count"], 2)
self.assertEqual(analysis["metrics"]["net_pnl"], 6.0)
self.assertEqual(analysis["r_metrics"]["complete_count"], 1)
self.assertEqual(detail["positions"][0]["source_trade"]["review_text"], "按计划执行")
self.assertEqual(detail["positions"][0]["source_trade"]["screenshot_path"], "screenshots/synthetic.png")
```

- [ ] **Step 3: Run the new contract test**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_architecture_contract -v`

Expected: PASS against the current compatibility API.

- [ ] **Step 4: Keep the existing suite green**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: all existing tests plus the new characterization tests pass.

- [ ] **Step 5: Commit the characterization tests**

```powershell
git add mt5-review-system/server/tests/support.py mt5-review-system/server/tests/test_architecture_contract.py mt5-review-system/server/tests/test_campaign_storage.py
git commit -m "test: freeze v0.5 backend behavior"
```

### Task 2: Extract Runtime Configuration, Database Connections, and Migrations

**Files:**
- Create: `mt5-review-system/server/app/core/__init__.py`
- Create: `mt5-review-system/server/app/core/config.py`
- Create: `mt5-review-system/server/app/core/errors.py`
- Create: `mt5-review-system/server/app/data/__init__.py`
- Create: `mt5-review-system/server/app/data/database.py`
- Create: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/server.py`
- Test: `mt5-review-system/server/tests/test_architecture_contract.py`
- Test: `mt5-review-system/server/tests/test_campaign_storage.py`

**Interfaces:**
- Produces: `RuntimePaths`, `RuntimeConfig`, `get_runtime_paths()`, `set_runtime_paths(paths)`, `connect(paths)`, `transaction(paths)`, and `ensure_schema(paths, seed)`.
- Compatibility: `app.storage.RuntimePaths`, `runtime_paths()`, `configure_runtime_paths()`, `connect()`, `db()`, and `init_db()` remain callable.

- [ ] **Step 1: Add configuration tests**

```python
def test_runtime_paths_are_derived_from_one_root(self):
    paths = RuntimePaths.from_root(Path("C:/synthetic/mt5-review"))
    self.assertEqual(paths.database, paths.data / "journal.sqlite")
    self.assertEqual(paths.screenshots, paths.data / "screenshots")
    self.assertEqual(paths.backups, paths.root / "backups")

def test_default_bind_is_loopback(self):
    config = RuntimeConfig.from_environment({})
    self.assertEqual(config.host, "127.0.0.1")
```

- [ ] **Step 2: Run the configuration tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_architecture_contract -v`

Expected: FAIL because `app.core.config` does not exist.

- [ ] **Step 3: Implement immutable runtime configuration**

```python
@dataclass(frozen=True)
class RuntimePaths:
    root: Path
    data: Path
    database: Path
    screenshots: Path
    raw_events: Path
    backups: Path
    config_file: Path

    @classmethod
    def from_root(cls, root: Path) -> "RuntimePaths":
        root = root.resolve()
        data = root / "data"
        return cls(root, data, data / "journal.sqlite", data / "screenshots", data / "raw-events", root / "backups", root / "config.local.json")
```

Implement `RuntimeConfig.from_environment(env)` with `127.0.0.1` and port `8787` defaults. Preserve explicit `MT5_REVIEW_HOST` and `MT5_REVIEW_PORT` overrides.

```python
@dataclass(frozen=True)
class RuntimeConfig:
    host: str
    port: int
    paths: RuntimePaths

    @classmethod
    def from_environment(
        cls,
        env: Mapping[str, str],
        project_root: Path = PROJECT_ROOT,
    ) -> "RuntimeConfig":
        host = env.get("MT5_REVIEW_HOST", "127.0.0.1")
        port = int(env.get("MT5_REVIEW_PORT", "8787"))
        return cls(host=host, port=port, paths=RuntimePaths.from_root(project_root))
```

- [ ] **Step 4: Move connection and migration code behind the new modules**

`database.py` owns `sqlite3.connect`, `row_factory`, WAL, foreign keys, and transaction boundaries. `migrations.py` owns schema SQL, version reads, the v4 backup rule, and seed invocation. `storage.py` delegates through compatibility functions and mirrors legacy path constants only for old tests.

- [ ] **Step 5: Run migration and server configuration tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_architecture_contract tests.test_campaign_storage tests.test_server_payload -v`

Expected: PASS, including the one-time pre-v4 snapshot test and loopback default.

- [ ] **Step 6: Run the entire backend suite**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

- [ ] **Step 7: Commit configuration and database boundaries**

```powershell
git add mt5-review-system/server/app/core mt5-review-system/server/app/data/database.py mt5-review-system/server/app/data/migrations.py mt5-review-system/server/app/storage.py mt5-review-system/server/app/server.py mt5-review-system/server/tests
git commit -m "refactor: isolate runtime and database infrastructure"
```

### Task 3: Separate Domain Calculations from Persistence

**Files:**
- Create: `mt5-review-system/server/app/domain/__init__.py`
- Create: `mt5-review-system/server/app/domain/r_metrics.py`
- Move/Modify: `mt5-review-system/server/app/campaigns.py`
- Move/Modify: `mt5-review-system/server/app/analytics.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Test: `mt5-review-system/server/tests/test_campaigns.py`
- Test: `mt5-review-system/server/tests/test_metrics.py`
- Test: `mt5-review-system/server/tests/test_analytics.py`

**Interfaces:**
- Produces: `reconstruct_positions(deals)`, `group_campaigns(positions)`, `calculate_position_risk(position)`, `calculate_campaign_r(positions)`, and `build_r_metrics(campaigns, scratch_threshold_r)` under `app.domain`.
- Compatibility: imports from `app.campaigns` and `app.analytics` continue to work through re-exports.

- [ ] **Step 1: Add dependency-boundary tests**

```python
def test_domain_modules_do_not_import_storage_or_sqlite(self):
    for module_path in DOMAIN_FILES:
        source = module_path.read_text(encoding="utf-8")
        self.assertNotIn("import sqlite3", source)
        self.assertNotIn("from . import storage", source)
        self.assertNotIn("from app import storage", source)
```

- [ ] **Step 2: Run the boundary test and verify it fails before extraction**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_architecture_contract.DomainBoundaryTest -v`

Expected: FAIL because the target `app/domain` modules do not exist.

- [ ] **Step 3: Move pure R calculations into `domain/r_metrics.py`**

Move `_calculate_r_runs_z` and `build_r_metrics` with no formula changes. Import `calculate_campaign_r` from `domain.campaigns`. Keep return keys and missing-data rules byte-for-byte compatible with existing metric tests.

- [ ] **Step 4: Move Campaign reconstruction and analytics pure functions**

Move only functions whose inputs and outputs are ordinary values. Leave SQL serialization, labels tied to API payloads, and file paths outside the domain layer. Add compatibility re-exports:

```python
from .domain.campaigns import calculate_campaign_r, calculate_position_risk, group_campaigns, reconstruct_positions
from .domain.r_metrics import build_r_metrics
```

- [ ] **Step 5: Run pure domain tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_campaigns tests.test_metrics tests.test_analytics -v`

Expected: PASS with the same exact numeric assertions.

- [ ] **Step 6: Run the entire backend suite and commit**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

```powershell
git add mt5-review-system/server/app/domain mt5-review-system/server/app/campaigns.py mt5-review-system/server/app/analytics.py mt5-review-system/server/app/storage.py mt5-review-system/server/tests
git commit -m "refactor: isolate trading domain calculations"
```

### Task 4: Create Focused Repositories and Remove Read-Side Rebuilds

**Files:**
- Create: `mt5-review-system/server/app/data/trade_repository.py`
- Create: `mt5-review-system/server/app/data/campaign_repository.py`
- Create: `mt5-review-system/server/app/data/catalog_repository.py`
- Create: `mt5-review-system/server/app/data/media_repository.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/importer.py`
- Test: `mt5-review-system/server/tests/test_repository_queries.py`
- Test: `mt5-review-system/server/tests/test_campaign_storage.py`
- Test: `mt5-review-system/server/tests/test_importer.py`

**Interfaces:**
- Produces: `TradeRepository.query(filters, page, page_size)`, `CampaignRepository.query(filters, page, page_size)`, `CampaignRepository.get(id)`, and `CampaignRepository.rebuild(affected_accounts=None)`.
- Consumes: `RuntimePaths`, `transaction()`, and domain Campaign functions.

- [ ] **Step 1: Add tests that reads do not write**

Patch `CampaignRepository.rebuild` with a spy, call Campaign list/detail and dashboard analysis, then assert:

```python
rebuild.assert_not_called()
self.assertEqual(before_total_changes, after_total_changes)
```

Add a SQL pagination test with 125 synthetic trades and assert page 2 returns 50 rows and the repository does not call `list_trades()`.

- [ ] **Step 2: Run repository tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_repository_queries -v`

Expected: FAIL because repositories do not exist and current Campaign reads rebuild models.

- [ ] **Step 3: Implement SQL filtering and pagination**

Use parameterized SQL for query, exact symbol, side, classification, Beijing date boundaries, deleted state, and `LIMIT ? OFFSET ?`. Run a separate `COUNT(*)` with the same predicates. Fetch custom values only for the page of trade IDs.

The query interface is:

```python
@dataclass(frozen=True)
class Page:
    items: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
```

- [ ] **Step 4: Make Campaign reconstruction explicit**

Remove `_rebuild_campaign_models_conn(conn)` from `_campaign_records_conn`. Call repository rebuild after successful event/trade writes, soft delete, restore, and at the end of one importer batch. An initial-stop update persists the stop and re-reads the affected Campaign to recalculate R, but does not rebuild Position/Campaign topology. Add a `model_revision` schema metadata key so startup repair only runs when the persisted revision differs from the code revision.

- [ ] **Step 5: Change importer batching to rebuild once**

Add an `ingest_mt5_event(..., rebuild=False)` internal option. `import_bridge_dir` processes all new events, then calls `CampaignRepository.rebuild()` once when at least one domain event changed. Direct HTTP ingestion retains `rebuild=True`.

- [ ] **Step 6: Run repository, importer, and Campaign tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_repository_queries tests.test_importer tests.test_campaign_storage tests.test_campaign_api -v`

Expected: PASS; list/detail/analysis reads call no rebuild and a multi-event import calls rebuild once.

- [ ] **Step 7: Run the entire backend suite and commit**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

```powershell
git add mt5-review-system/server/app/data mt5-review-system/server/app/storage.py mt5-review-system/server/app/importer.py mt5-review-system/server/tests
git commit -m "refactor: add repositories and explicit campaign rebuilds"
```

### Task 5: Introduce Page-Oriented Application Services

**Files:**
- Create: `mt5-review-system/server/app/application/__init__.py`
- Create: `mt5-review-system/server/app/application/dashboard_service.py`
- Create: `mt5-review-system/server/app/application/orders_service.py`
- Create: `mt5-review-system/server/app/application/album_service.py`
- Create: `mt5-review-system/server/app/application/settings_service.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Test: `mt5-review-system/server/tests/test_application_services.py`

**Interfaces:**
- Produces: `DashboardService.get_analysis(window)`, `OrdersService.list_campaigns(filters, page)`, `OrdersService.get_campaign(id)`, `AlbumService.query(filters, page)`, `SettingsService.get_classifications()`, `SettingsService.get_custom_fields()`, `SettingsService.get_analysis_settings()`, `SettingsService.get_status()`, and `SettingsService.list_backups()`.
- Consumes: repositories plus pure domain calculations.

- [ ] **Step 1: Write service orchestration tests with repository fakes**

```python
class FakeTradeRepository:
    def query_analysis_rows(self, start_date, end_date):
        self.calls.append((start_date, end_date))
        return FIXED_TRADES

def test_dashboard_service_does_not_load_order_detail(self):
    service = DashboardService(trades, campaigns, catalogs, settings)
    payload = service.get_analysis(AnalysisWindow("2026-08-01", "2026-08-31", 30))
    self.assertNotIn("trades", payload)
    self.assertNotIn("campaigns", payload)
    self.assertEqual(campaigns.get_calls, [])
```

- [ ] **Step 2: Run service tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_application_services -v`

Expected: FAIL because `app.application` does not exist.

- [ ] **Step 3: Implement dashboard and order services**

Define immutable request values:

```python
@dataclass(frozen=True)
class AnalysisWindow:
    start_date: str | None
    end_date: str | None
    equity_days: int = 30

@dataclass(frozen=True)
class PageRequest:
    page: int = 1
    page_size: int = 50
```

Application services validate cross-field rules, call repositories, invoke domain functions, and assemble stable response dictionaries. They do not parse URLs or open SQLite directly.

- [ ] **Step 4: Implement album and settings services**

Keep album tag semantics: OR within one dimension and AND across dimensions. Settings service methods delegate to the catalog, settings, status, and backup repositories without loading dashboard analytics or order rows.

- [ ] **Step 5: Delegate legacy storage entry points to services**

Keep `get_analysis`, `list_campaigns`, `get_campaign`, and `query_review_album` public signatures. Construct default services in a small composition function and delegate, preserving existing response keys.

- [ ] **Step 6: Run application and full backend tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_application_services tests.test_storage_presentation tests.test_review_album tests.test_campaign_storage -v`

Expected: PASS.

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

- [ ] **Step 7: Commit application services**

```powershell
git add mt5-review-system/server/app/application mt5-review-system/server/app/storage.py mt5-review-system/server/tests
git commit -m "refactor: add page-oriented application services"
```

### Task 6: Split HTTP Routing from Request Handling

**Files:**
- Create: `mt5-review-system/server/app/presentation/__init__.py`
- Create: `mt5-review-system/server/app/presentation/http/__init__.py`
- Create: `mt5-review-system/server/app/presentation/http/router.py`
- Create: `mt5-review-system/server/app/presentation/http/responses.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/dashboard.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/orders.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/album.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/settings.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/ingestion.py`
- Modify: `mt5-review-system/server/app/server.py`
- Test: `mt5-review-system/server/tests/test_http_routes.py`
- Test: `mt5-review-system/server/tests/test_campaign_api.py`

**Interfaces:**
- Produces: `Router.dispatch(method, path, query, body) -> ApiResponse` and `ApiResponse(status, payload, headers)`.
- Consumes: application services and ingestion service; `ReviewRequestHandler` remains the `http.server` adapter.

- [ ] **Step 1: Add router unit tests independent of a socket**

```python
response = router.dispatch("GET", "/api/campaigns", {"page": ["2"]}, None)
self.assertEqual(response.status, HTTPStatus.OK)
self.assertEqual(fake_orders.last_page.page, 2)

response = router.dispatch("GET", "/api/review-album", {"unknown": ["x"]}, None)
self.assertEqual(response.status, HTTPStatus.BAD_REQUEST)
```

- [ ] **Step 2: Run route tests and verify they fail**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_http_routes -v`

Expected: FAIL because the router modules do not exist.

- [ ] **Step 3: Implement explicit route registration**

```python
router.add("GET", "/api/analysis", dashboard.get_analysis)
router.add("GET", "/api/campaigns", orders.list_campaigns)
router.add_prefix("GET", "/api/campaigns/", orders.get_campaign)
router.add("GET", "/api/review-album", album.get_album)
```

Route functions parse primitive values, reject unsupported filters, call one application service method, and return `ApiResponse`. Convert `ValueError` to 400, not-found application errors to 404, and unexpected errors to a generic 500 payload without local paths.

- [ ] **Step 4: Reduce `ReviewRequestHandler` to an adapter**

The handler reads the request, delegates API calls to `Router`, serves static/media files through existing safe-path checks, and writes responses. Keep trailing-null MQL5 JSON support.

- [ ] **Step 5: Run route and live HTTP tests**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_http_routes tests.test_campaign_api tests.test_server_payload tests.test_screenshot_management -v`

Expected: PASS with unchanged public API status codes and payload keys.

- [ ] **Step 6: Run the entire backend suite and commit**

Run: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

```powershell
git add mt5-review-system/server/app/presentation mt5-review-system/server/app/server.py mt5-review-system/server/tests
git commit -m "refactor: split HTTP routes from server adapter"
```

### Task 7: Remove the Storage God Module and Verify the Backend Boundary

**Files:**
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/bridge_sync.py`
- Modify: `mt5-review-system/server/app/importer.py`
- Modify: `mt5-review-system/server/tests/test_architecture_contract.py`
- Modify: `mt5-review-system/README.md`

**Interfaces:**
- Produces: a compatibility-only `storage.py` that re-exports stable functions and owns no domain formulas, HTTP behavior, or bulk SQL implementations.
- Consumes: all modules established in Tasks 2-6.

- [ ] **Step 1: Add final source-boundary assertions**

```python
def test_storage_is_a_compatibility_facade(self):
    source = STORAGE.read_text(encoding="utf-8")
    self.assertLess(len(source.splitlines()), 500)
    self.assertNotIn("CREATE TABLE", source)
    self.assertNotIn("def build_r_metrics", source)
    self.assertNotIn("def query_review_album", source)
```

- [ ] **Step 2: Run the boundary test and verify it fails**

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_architecture_contract -v`

Expected: FAIL because `storage.py` still contains implementations.

- [ ] **Step 3: Replace implementations with explicit imports and small adapters**

Remove code already owned by data, domain, application, and presentation modules. Do not use wildcard imports. Preserve only the public functions still used by older tests/tools, each delegating to a named service or repository.

- [ ] **Step 4: Update backend architecture documentation**

Document the four dependency layers, module ownership, read/write flow, and the rule that Campaign rebuild occurs only after writes or model-revision repair.

- [ ] **Step 5: Run all backend tests twice**

Run twice: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS both times, demonstrating idempotent startup and migration behavior.

- [ ] **Step 6: Check imports and compile all backend modules**

Run: `..\.venv\Scripts\python.exe -m compileall -q app tests`

Expected: exit code 0.

- [ ] **Step 7: Commit the backend architecture milestone**

```powershell
git add mt5-review-system/server mt5-review-system/README.md
git commit -m "refactor: complete backend architecture boundary"
```

## Backend Plan Completion Gate

Before starting the frontend plan:

- All backend tests pass from a clean process twice.
- `storage.py` is a compatibility facade under 500 lines.
- Domain modules import neither SQLite nor storage.
- Campaign list, detail, and analysis reads perform no write or rebuild.
- Import batches rebuild Campaign models once.
- Existing public API tests pass unchanged.
- No real user data path was read or modified.

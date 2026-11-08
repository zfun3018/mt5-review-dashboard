# Dashboard Layout Single Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the MT5 and domestic-futures dashboard layouts in SQLite so every browser reads and saves one platform-scoped project layout.

**Architecture:** Add a `dashboard_layouts` SQLite table keyed by platform, storing normalized GridStack JSON and a monotonically increasing revision. Add GET/PUT HTTP routes. The dashboard loads the server layout before GridStack initialization and saves edits through the server; localStorage remains a cache only. When no row exists, the client seeds the server with the deterministic project default. A revision check rejects stale concurrent saves instead of silently creating divergent layouts.

**Tech Stack:** Python standard-library HTTP server, SQLite, native ES modules, GridStack, Node test runner, Python unittest.

**Spec:** `docs/superpowers/plans/2026-11-07-dashboard-layout-single-source.md`

## Global Constraints

- The database is the single source of truth; layout preferences are platform-scoped and are not business records.
- Existing MT5 and domestic-futures module IDs, metric payloads, and layout editor interactions remain unchanged.
- When the server has no row, it initializes the record from the deterministic project default; a browser's localStorage never decides the project-wide first layout.
- Invalid or incomplete layout JSON is normalized against the platform's current definitions and falls back to the code default.
- Do not read or commit private data under `data/`, `backups/`, `config.local.json`, or screenshots.
- Release, tag, and GitHub push remain paused until the user explicitly resumes them.

**Entity owner:** `dashboard_layouts(platform)` owns layout preference JSON and revision metadata.

**Data source:** GridStack module IDs, positions, sizes, and visibility emitted by the frontend editor.

**Rebuild rule:** No derived business data; read-time normalization rebuilds the stored projection when module definitions change.

**Platform scope:** One row for `mt5`, one row for `domestic_futures`.

**Cross-browser test path:** Save through one browser/API client, load through a second isolated browser context, assert identical layout JSON and revision; stale PUT returns conflict without changing the stored layout.

---

### Task 1: Lock the persistence and HTTP contract with failing tests

**Files:**
- Modify: `mt5-review-system/server/tests/test_http_routes.py`
- Modify: `mt5-review-system/server/tests/test_application_services.py`
- Modify: `mt5-review-system/web/tests/dashboard-gridstack.test.mjs`

**Interfaces:**
- `GET /api/dashboard-layout?platform=<platform>` returns `{platform, revision, layout}`.
- `PUT /api/dashboard-layout?platform=<platform>` accepts `{revision, layout}` and returns the updated record; a stale revision returns HTTP 409.
- Frontend layout loading and saving receive injected `requestJson` functions so tests can model two isolated clients.

- [ ] **Step 1: Write failing server tests** for first-read defaults, platform isolation, revision increments, and stale PUT conflict.
- [ ] **Step 2: Run the focused Python tests** and verify they fail because the route and repository do not exist.
- [ ] **Step 3: Write failing frontend tests** proving server layout wins over localStorage and saves use the returned revision.
- [ ] **Step 4: Run the focused Node test** and verify it fails because the async server-backed layout functions do not exist.

### Task 2: Add SQLite layout storage and routes

**Files:**
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Modify: `mt5-review-system/server/app/data/catalog_repository.py`
- Modify: `mt5-review-system/server/app/application/settings_service.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/settings.py`
- Modify: `mt5-review-system/server/app/presentation/http/router.py` only if route registration requires it
- Modify: `mt5-review-system/server/tests/test_http_routes.py`

**Interfaces:**
- Repository methods: `get_dashboard_layout(platform)`, `put_dashboard_layout(platform, layout, expected_revision=None)`.
- Service methods validate platform and JSON shape, normalize revision values, and raise a conflict exception for stale writes.
- Routes validate `platform` in `{mt5, domestic_futures}` and return JSON-safe errors.

- [ ] **Step 1: Add the table and repository methods** with an integer revision starting at 1.
- [ ] **Step 2: Add GET and PUT route handlers** with 409 conflict responses.
- [ ] **Step 3: Run the failing Python tests** until the persistence contract passes.

### Task 3: Make the frontend use the server as the single source

**Files:**
- Modify: `mt5-review-system/web/dashboard/dashboard-layout.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard-layout-editor-mode.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-layout-editor.mjs` if its save path is separate
- Modify: `mt5-review-system/web/tests/dashboard-gridstack.test.mjs`
- Modify: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`

**Interfaces:**
- `loadLayoutFromServer({api, storage, platform})` returns `{layout, revision}` and migrates localStorage only when the API reports no stored row.
- `saveLayoutToServer({api, layout, revision, platform})` returns the new `{layout, revision}` or throws a conflict error.
- GridStack initialization waits for the server load; edit-mode save updates the server record before leaving edit mode.

- [ ] **Step 1: Implement server-load fallback behavior** and remove the heuristic that treats a browser default snapshot as stale.
- [ ] **Step 2: Implement revision-aware save behavior** and preserve the existing editor UI.
- [ ] **Step 3: Run focused Node tests** and confirm server data wins over browser-local data.

### Task 4: Seed the preview layouts and verify two-browser behavior

**Files:**
- Modify: `mt5-review-system/web/dashboard/dashboard-layout.mjs` only for explicit default seed geometry if needed
- Modify: `mt5-review-system/server/tests/test_http_routes.py`
- Create: `mt5-review-system/web/tests/browser/dashboard-layout-persistence.spec.mjs`

- [x] **Step 1: Use the current project preview geometry as the deterministic default** for both platforms; initialize an empty server record from that default.
- [ ] **Step 2: Add a browser test with two isolated contexts**: save in context A, reload context B, assert equal geometry and revision; save from B and assert A receives the new revision on reload.
- [ ] **Step 3: Add stale-save coverage** proving a 409 leaves the stored layout unchanged.
- [ ] **Step 4: Run desktop and 390px browser checks** and confirm no missing modules, no horizontal overflow, and one layout record per platform.

### Task 5: Documentation and verification

**Files:**
- Modify: `docs/PROJECT-GUIDE.md`
- Modify: `mt5-review-system/README.md`
- Modify: `docs/VERSION-ROUTE.md` only when release work resumes

- [ ] **Step 1: Document the database ownership, migration behavior, and conflict rule.**
- [ ] **Step 2: Run Python route tests, focused Node tests, syntax checks, and `git diff --check`.**
- [ ] **Step 3: Run the full release check only after the user resumes release work; do not commit, tag, or push during this task.**

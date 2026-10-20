# MT5 Dashboard Platform Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the original MT5 dashboard modules and statistics while adding the domestic-futures workspace's platform-isolated layout editor and unified visual shell.

**Architecture:** A shared layout schema will expose separate MT5 and domestic-futures module definitions, storage keys, defaults, and normalization. The existing domestic controller will consume the domestic configuration; the existing MT5 controller will continue rendering its original payload and apply the MT5 configuration to one grid container. The service will return domestic-futures-only extensions only for that platform, while both platforms use Campaign rows for shared analytics.

**Tech Stack:** Python standard-library HTTP and SQLite, native HTML/CSS/ES modules, vendored GridStack, Node `node:test`, Python `unittest`.

**Spec:** User request in the current thread and `AGENTS.md` shared-data invariants.

## Global Constraints

- Do not read, stage, commit, or expose `mt5-review-system/data/`, `backups/`, `config.local.json`, raw MT5 JSONL, screenshots, or generated binaries.
- Preserve existing MT5 dashboard features and Campaign-based statistics.
- Keep layout persistence platform-isolated: `mt5-dashboard-layout-v1` and `domestic-futures-dashboard-layout-v3`.
- Use the existing GridStack editor and native frontend architecture; do not add a build system.
- Run frontend syntax/unit tests and Python tests before completion; report browser verification separately if Chromium remains blocked by `spawn EPERM`.

---

### Task 1: Add platform-specific layout schema

**Files:**
- Create: `mt5-review-system/web/dashboard/dashboard-layout.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-layout.mjs`
- Test: `mt5-review-system/web/tests/domestic-futures-layout.test.mjs`

- [x] Add shared schema APIs `getLayoutConfig(platform)`, `getModuleDefinitions(platform)`, `cloneDefaultLayout(platform)`, `normalizeLayout(value, platform)`, `loadLayout(storage, platform)`, `saveLayout(storage, layout, platform)`, and `layoutItem(layout, id)`.
- [x] Define MT5 modules for `r-metrics`, `equity`, `calendar`, `heatmap`, `sessions`, `system-evaluation`, and `mode-evaluation`; define domestic-futures modules without MT5-only entries.
- [x] Keep the existing domestic module exports as compatibility wrappers and update tests to assert both platform counts and isolated keys.

### Task 2: Restore platform controller routing and MT5 layout application

**Files:**
- Modify: `mt5-review-system/web/dashboard/index.html`
- Modify: `mt5-review-system/web/dashboard/dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard.css`
- Test: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`
- Test: `mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`

- [x] Route `domestic_futures` to the domestic controller and MT5 to the original controller.
- [x] Keep the legacy MT5 DOM visible only for MT5 and the domestic dashboard DOM visible only for domestic futures.
- [x] Wrap the original MT5 modules in a single responsive grid and add stable module IDs for layout application.
- [x] Apply MT5 layout positions, visibility, titles, and subtitles after shell mounting without changing the analysis rendering functions.
- [x] Add an MT5 link to the shared standalone editor with `platform=mt5`; keep the domestic link and route intact.

### Task 3: Make the standalone editor consume the selected platform

**Files:**
- Modify: `mt5-review-system/web/dashboard/mock-domestic-futures-layout.html`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-layout-editor.mjs`
- Test: `mt5-review-system/web/tests/domestic-futures-layout.test.mjs`

- [x] Read `platform` from the query string and use the matching schema, storage key, module list, default layout, and import/export filename.
- [x] Add MT5 preview markup while retaining the current domestic preview cards.
- [x] Preserve drag, resize, visibility, title/subtitle editing, import, export, reset, and return behavior for both platforms.

### Task 4: Restrict domestic-only backend extensions while preserving Campaign analytics

**Files:**
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`
- Modify: `mt5-review-system/server/app/application/dashboard_assembly.py` only where compatibility requires it
- Test: `mt5-review-system/server/tests/test_application_services.py`
- Test: `mt5-review-system/server/tests/test_domestic_futures_dashboard.py`

- [x] Return `fixed_periods`, `monthly_pnl`, `contract_rankings`, `domestic_system_evaluation`, `review_coverage`, and `risk_summary` only for domestic futures.
- [x] Keep MT5's original analysis payload shape and make its shared metrics, curve, calendar, heatmap, sessions, system evaluation, and mode evaluation use Campaign rows.
- [x] Ensure net P/L remains trade P/L plus commission, swap, and fee at the Campaign level.
- [x] Add assertions that MT5 does not receive domestic-only extensions and domestic futures still does.

### Task 5: Verify cross-view and frontend behavior

**Files:**
- Modify: relevant existing tests only
- Modify: `docs/VERSION-ROUTE.md` only if the user-visible upgrade is recorded in this worktree's release route

- [x] Run frontend unit tests and syntax checks.
- [x] Run the complete Python unittest suite.
- [x] Run `git diff --check` and inspect changed files for accidental sensitive-data access.
- [x] Attempt the browser checks at desktop and 390px; Chromium failed to launch with `spawn EPERM`, so that environmental limitation is reported.

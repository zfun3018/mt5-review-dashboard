# Platform Workspaces and Domestic Futures Data Import Implementation Plan

> Status: superseded by `docs/superpowers/plans/2026-10-19-dual-platform-workspace-data-pipeline.md`; retained as an implementation history record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add isolated MT5/domestic-futures workspaces and import closed domestic-futures trades from supported source files while keeping screenshots manual.

**Architecture:** Store a normalized `platform` on every domain row and pass the active platform through API query/body context. Keep the existing local SQLite/native frontend architecture; add a focused CSV parser/importer and shared shell workspace selector.

**Tech Stack:** Python standard library `csv`/`sqlite3`, SQLite migrations, native HTML/CSS/JavaScript, Node test runner.

**Spec:** `docs/plans/2026-10-19-platform-workspaces-design.md`

## Global Constraints

- Default platform is `mt5`; domestic futures uses `domestic_futures` with `tonghuashun_futures` retained only as a compatibility alias.
- Platform data is isolated in every dashboard, order, album, campaign, and equity query.
- Screenshots remain manual uploads through the existing order detail workflow.
- Never read or modify `mt5-review-system/data/`, backups, local config, raw events, or real screenshots.
- Preserve unrelated user changes already present in the working tree.

---

### Task 1: Platform domain and CSV normalization

**Files:**
- Create: `mt5-review-system/server/app/platforms.py`
- Create: `mt5-review-system/server/app/data/tonghuashun_csv.py`
- Test: `mt5-review-system/server/tests/test_tonghuashun_csv.py`

**Interfaces:**
- `normalize_platform(value: str | None) -> str`
- `parse_tonghuashun_csv(csv_text: str, filename: str = "") -> dict[str, Any]`
- Result contains `trades`, `unpaired_rows`, `invalid_rows`, `headers`, and `warnings`.

- [ ] Write failing tests for Chinese headers, GBK/BOM-friendly text, long-side and short-side FIFO pairing, fee/pnl mapping, and unpaired rows.
- [ ] Run the focused test and confirm failure because the parser is absent.
- [ ] Implement alias-based CSV parsing and deterministic trade IDs.
- [ ] Run the focused test and confirm it passes.

### Task 2: Schema and backend platform isolation

**Files:**
- Modify: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/data/ingestion_repository.py`
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/data/campaign_repository.py`
- Modify: `mt5-review-system/server/app/data/catalog_repository.py`
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`
- Modify: `mt5-review-system/server/app/application/album_service.py`
- Modify: `mt5-review-system/server/app/application/orders_service.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Test: `mt5-review-system/server/tests/test_platform_isolation.py`

- [ ] Add failing tests proving MT5 and Tonghuashun trades do not cross list, analysis, album, or campaign results.
- [ ] Run tests and confirm failure.
- [ ] Add schema migration/defaults, platform-aware legacy deal reconstruction, repository filters, and platform-aware upserts.
- [ ] Run tests and confirm platform isolation.

### Task 3: CSV import API

**Files:**
- Create: `mt5-review-system/server/app/platform_importer.py`
- Modify: `mt5-review-system/server/app/presentation/http/router.py`
- Create: `mt5-review-system/server/app/presentation/http/routes/platforms.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/__init__.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Test: `mt5-review-system/server/tests/test_platform_import_api.py`

- [ ] Add failing route/import tests for successful import and invalid platform.
- [ ] Run tests and confirm failure.
- [ ] Implement local JSON CSV upload with size/encoding/row validation and one transaction per import.
- [ ] Run tests and confirm import response and duplicate behavior.

### Task 4: Shared platform workspace UI

**Files:**
- Modify: `mt5-review-system/web/shared/js/shell.mjs`
- Modify: `mt5-review-system/web/shared/js/api.mjs`
- Modify: `mt5-review-system/web/shared/css/shell.css`
- Modify: `mt5-review-system/web/settings/index.html`
- Modify: `mt5-review-system/web/settings/settings.mjs`
- Modify: `mt5-review-system/web/settings/settings.css`
- Test: `mt5-review-system/web/tests/platform-workspace-ui.test.mjs`

- [ ] Add failing tests for platform URL state, request scoping, selector rendering, and CSV import control.
- [ ] Run tests and confirm failure.
- [ ] Implement shared selector, platform-aware request helper, and settings import panel.
- [ ] Run frontend tests and syntax checks.

### Task 5: Release documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `mt5-review-system/README.md`
- Modify: `docs/VERSION-ROUTE.md`
- Modify: `CHANGELOG.md`
- Modify: `VERSION`

- [ ] Document CSV preparation, platform switching, manual screenshots, and unsupported/unpaired rows.
- [ ] Run all available frontend tests and static checks.
- [ ] Run the prescribed Python test command and report if the environment lacks Python.

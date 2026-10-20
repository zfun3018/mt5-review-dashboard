# Domestic Futures Workspace Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the domestic-futures workspace visibly and behaviorally distinct from MT5 by removing MT5 session widgets, exposing data-import actions and latest imported order time, and showing Chinese futures product/contract names without weakening stable import identity.

**Architecture:** Keep the shared application shell and the existing SQLite `platform` discriminator, but inject workspace-specific navigation/action/dashboard configuration instead of embedding more platform branches in shared rendering code. Keep the original exchange symbol in `trades.symbol` for deduplication, matching, and stable queries; add nullable display fields for Chinese product and contract names, populated by a domestic-futures mapping module during normalization/import. All order-detail mutations must carry the active platform through the route and repository command boundary.

**Tech Stack:** Python standard library, SQLite migrations/bootstrap, native HTML/CSS/ES modules, Node built-in test runner, Python `unittest`.

**Spec:** `docs/superpowers/specs/2026-10-19-dual-platform-workspace-architecture.md`

## Global Constraints

- The canonical domestic-futures platform id is `domestic_futures`; user-facing import terminology is always `数据导入`, while Tonghuashun is source metadata only.
- MT5 and domestic-futures dashboard, navigation, orders, album, settings, and statistics remain platform-scoped and must not cross-read or cross-write.
- `trades.symbol` remains the stable source/exchange code; Chinese names are display and aggregation fields.
- Domestic-futures screenshots remain manual uploads; no automatic desktop capture is added.
- Preserve all existing uncommitted user changes and never read or modify protected runtime data, backups, local config, raw MT5 JSONL, or real screenshots.

---

### Task 1: Add the domestic-futures contract display mapping

**Files:**
- Create: `mt5-review-system/server/app/platform_modules/domestic_futures_contracts.py`
- Modify: `mt5-review-system/server/app/data/normalized_import.py`
- Test: `mt5-review-system/server/tests/test_domestic_futures_contracts.py`

**Interfaces:**
- Produce `contract_display(symbol: str) -> dict[str, str]` with `symbol`, `product_code`, `product_name`, and `contract_name`.
- Unknown codes return the original code as `product_code`, `product_name`, and `contract_name` fallback values and never fail an import.

- [x] Write tests for `IF2611`, common commodity codes such as `RB`, a symbol with lowercase/whitespace, and an unknown code.
- [x] Run the focused test and observe failure because the mapping module is absent.
- [x] Implement a static code-to-Chinese-product map and parse the alphabetic product prefix from a contract code while preserving the original code.
- [x] Apply the mapping when a domestic-futures execution is normalized, storing display metadata in the raw normalized row context for the trade builder.
- [x] Run the focused tests and confirm the mapped and fallback values.

### Task 2: Persist Chinese product and contract display fields

**Files:**
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/data/normalized_import.py`
- Test: `mt5-review-system/server/tests/test_domestic_futures_contracts.py`
- Test: `mt5-review-system/server/tests/test_platform_import.py`

**Interfaces:**
- Add nullable/default `product_name` and `contract_name` columns to `trades` through bootstrap/migration-compatible schema setup.
- Domestic-futures imported trade rows expose both fields while MT5 rows retain empty/default values.

- [x] Extend the import test to assert that an imported `IF2611` trade exposes the common product code `IF` and contract name `IF2611`.
- [x] Run the focused test and confirm the fields are missing.
- [x] Add schema defaults and bind the display fields through `_build_trade` and `_upsert_trade_conn` without changing the stable `symbol` value.
- [x] Run the focused import/migration tests and confirm existing MT5 upserts remain compatible.

### Task 3: Add a platform-scoped latest-imported-order summary API

**Files:**
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/platform_facade.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/platforms.py`
- Test: `mt5-review-system/server/tests/test_import_summary_api.py`

**Interfaces:**
- Add `latest_import_summary(platform: str = "mt5") -> dict[str, Any]` at the storage/facade boundary.
- `GET /api/platforms/import-summary?platform=domestic_futures` returns `platform`, `latest_trade`, `latest_imported_at`, `latest_batch`, and platform-scoped counts.
- `latest_trade` is selected by the latest imported trade close/成交 time, not by batch creation time, and is `null` when no trade exists.

- [x] Write route/repository tests with MT5 and domestic-futures rows proving the domestic response cannot select an MT5 trade.
- [x] Run the focused test and observe the missing route/API failure.
- [x] Implement the query, facade, storage wrapper, and route with canonical platform normalization.
- [x] Run the focused test and verify latest trade time, display names, batch timestamp, and zero-data behavior.

### Task 4: Make the shared shell and dashboard workspace-aware

**Files:**
- Modify: `mt5-review-system/web/shared/js/shell.mjs`
- Modify: `mt5-review-system/web/dashboard/index.html`
- Modify: `mt5-review-system/web/dashboard/dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard.css`
- Test: `mt5-review-system/web/tests/domestic-futures-dashboard.test.mjs`
- Modify: `mt5-review-system/web/tests/app-shell-ui.test.js`

**Interfaces:**
- `mountShell` accepts `refreshLabel`, `refreshIcon`, and `onRefresh` action semantics without changing MT5 defaults.
- The dashboard controller receives the active platform and only renders `marketClock` and `sessions` for MT5.
- Domestic-futures dashboard displays `最近导入订单：<北京时间>` or `最近导入订单：暂无` and its shell action is `导入数据`, navigating to `/settings/?platform=domestic_futures&tab=data`.

- [x] Write frontend tests for MT5 session visibility/default refresh copy and domestic-futures hidden session sections/import action/latest-summary rendering.
- [x] Run the focused Node tests and observe failure.
- [x] Add shell action configuration, platform-specific dashboard configuration, summary loading, and a compact futures import status region without changing MT5 DOM behavior.
- [x] Add responsive styling for the status region and hidden futures-only sections, with stable layout at desktop and 390px widths.
- [x] Run focused Node tests and all dashboard/shell syntax checks.

### Task 5: Propagate platform context through order-detail writes

**Files:**
- Modify: `mt5-review-system/server/app/presentation/http/routes/orders.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/data/catalog_commands.py`
- Modify: `mt5-review-system/server/app/data/campaign_commands.py`
- Test: `mt5-review-system/server/tests/test_order_soft_delete_platform.py`

**Interfaces:**
- Screenshot, review, archive, custom-field, position initial-stop, campaign initial-stop, and campaign review mutations accept and enforce `platform` like list/delete/restore operations.

- [x] Add failing tests that attempt to mutate an MT5 id through the domestic-futures query and assert a not-found/error without changing the MT5 row.
- [x] Run the focused test and observe the current cross-platform write behavior.
- [x] Add platform arguments at each route/storage/command boundary and include `platform = ?` in the target-row update predicates.
- [x] Run platform isolation and existing order/campaign tests.

### Task 6: Verify, document, and report remaining boundaries

**Files:**
- Modify: `README.md`
- Modify: `docs/VERSION-ROUTE.md`
- Modify: `CHANGELOG.md`

- [x] Update user-facing documentation to describe the domestic-futures dashboard, data-import action, latest imported order display, and common contract-name display fields.
- [x] Run `python -m unittest discover -s tests -p "test_*.py"` from `mt5-review-system/server` using the project Python runtime; 219 tests pass.
- [x] Run the relevant Node tests, `node --check` for changed modules, and `git diff --check`; 125 Node tests pass and syntax/whitespace checks pass.
- [x] Inspect the diff to confirm no protected runtime data or screenshots were added. The release checker remains blocked only by 28 Playwright browser tests failing to launch Chromium with `spawn EPERM` on this machine.

# Data Cleanup And Domestic Dashboard Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a confirmed account/date-range data cleanup workflow and correct domestic-futures fixed-period metrics and contract ranking names.

**Architecture:** The database remains the single source of truth. Cleanup selects source `trades` by platform/account/date semantics, removes dependent import facts and native event facts in one transaction, rebuilds campaign projections, and removes only orphaned derived records. Fixed-period metrics use the latest available closed campaign as their data anchor, independent of the active dashboard filter. Contract labels are always derived from the stable domestic symbol code, so persisted placeholder names cannot leak into the dashboard.

**Tech Stack:** Python standard library, SQLite, native HTML/CSS/ES modules, unittest.

**Spec:** The approved domestic-futures data-management and dashboard optimization requirements in the current conversation.

## Global Constraints

- Domestic-futures trade dates are exchange trading dates and must not be shifted; only displayed time ordering accounts for night sessions.
- Domestic-futures order date is the opening trade date; realized P/L metrics use closing time/date.
- Cleanup is permanently destructive for selected database facts and requires an explicit confirmation request.
- MT5 and domestic-futures records remain platform-isolated; unrelated accounts and dates must survive cleanup.
- Do not read, stage, commit, or delete private data directories, screenshots, raw JSONL events, or local configuration files.
- Every behavior change gets a failing test before production code.

---

### Task 1: Lock down fixed-period and contract-name behavior

**Files:**
- Modify: `mt5-review-system/server/tests/test_domestic_futures_dashboard.py`
- Modify: `mt5-review-system/server/tests/test_analysis_reconciliation.py`
- Modify: `mt5-review-system/server/app/domain/domestic_futures_dashboard.py`
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`

- [x] Add a regression test proving a historical domestic dataset uses its latest closed trading date as the fixed-period anchor even when the machine date is later.
- [x] Add a regression test proving a persisted `未命名合约` value is replaced by the display derived from `symbol`, and that both ranking lists include `product_name`.
- [x] Run the focused tests and verify they fail for the current implementation.
- [x] Implement the latest-reference-campaign anchor without changing the active filter anchor used by range-sensitive metrics.
- [x] Implement symbol-derived contract display in the ranking builder and application decoration.
- [x] Run focused dashboard and reconciliation tests.

### Task 2: Implement transactional cleanup service and API

**Files:**
- Create: `mt5-review-system/server/app/data/data_cleanup_repository.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/settings.py`
- Modify: `mt5-review-system/server/tests/test_data_cleanup.py`
- Modify: `mt5-review-system/server/tests/test_http_routes.py`

- [x] Add synthetic data covering two platforms, two accounts, inside/outside date ranges, import executions, matches, native deal events, campaigns, and review links.
- [x] Add failing tests for account/date/platform isolation, domestic `trade_date` selection, MT5 Beijing close-date selection, preview counts, and removal of import metadata.
- [x] Run the focused tests and verify they fail because no cleanup service/route exists.
- [x] Implement account listing and a preview/confirm cleanup command in one SQLite transaction.
- [x] Delete selected source trades, matching import facts and batch links, selected native deal events, and orphaned derived campaign/position records; rebuild campaigns before final orphan cleanup.
- [x] Expose `GET /api/data/accounts`, `POST /api/data/cleanup/preview`, and `POST /api/data/cleanup`.
- [x] Run the focused cleanup and route tests.

### Task 3: Add the settings UI workflow

**Files:**
- Modify: `mt5-review-system/web/settings/index.html`
- Modify: `mt5-review-system/web/settings/settings.mjs`
- Modify: `mt5-review-system/web/settings/settings.css`
- Modify: `mt5-review-system/web/tests/settings-workspace.test.mjs`

- [x] Add account selector, start/end date inputs, preview action, impact summary, and explicit destructive confirmation.
- [x] Add a regression test for the API calls, confirmation state, and refresh after successful cleanup.
- [x] Run the frontend test and syntax check before implementation.
- [x] Implement the two-step controller behavior and responsive layout without changing existing settings tabs.
- [x] Run the frontend tests and `node --check`.

### Task 4: Full verification

- [x] Run all Python tests from `mt5-review-system/server`.
- [x] Run the prescribed frontend tests and syntax checks.
- [x] Run release checks and inspect the final diff for private-data paths.
- [ ] Verify desktop and 390px settings layout behavior; Playwright could not launch Chromium because the environment returned `spawn EPERM`.

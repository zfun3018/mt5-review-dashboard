# Project AI Instructions

## Project scope

This is a local MT5 trade review dashboard. The server uses Python standard-library HTTP APIs and SQLite. The frontend is native HTML, CSS, and JavaScript. Keep the existing architecture unless a change has a clear, tested benefit.

## Sensitive data boundary

- Never read, upload, stage, or commit `mt5-review-system/data/`, `backups/`, `config.local.json`, screenshots, raw MT5 JSONL events, or generated binaries.
- Treat account numbers, order numbers, terminal IDs, local paths, and screenshots as private user data.
- Do not expose the local service to the public internet. It has no authentication.

## Before editing

1. Read `README.md`, `docs/VERSION-ROUTE.md`, and the relevant tests.
2. Trace the existing data flow and state the root cause before changing behavior.
3. Keep changes scoped to the requested feature.

## Shared data invariants

- The database is the single source of truth. Dashboard, orders, album, settings, and future pages are different views of the same platform-scoped business records; a page must not maintain an independent copy of the same business data.
- The same business concept must use the same canonical field name, value format, and stable ID in SQLite, HTTP payloads, application objects, and frontend state. Do not create page-specific aliases or generated IDs for shared entities.
- Every field has one owning entity. Campaign-level review classifications, strategy, mistake tags, review text, and campaign custom fields belong to `trade_campaigns`; source Trade and Position records may reference or derive them, but must not silently become a second source of truth.
- A view that displays a related entity must resolve it through the persisted relationship (`campaign_id`, `position_id`, or `trade_id`) and read the owning record. If a derived projection is required for performance, document its owner, refresh/rebuild rule, and invalidation path.
- Any change to shared data must include a cross-view test: write through the owning workflow, then read the same value through orders, album, dashboard, and relevant APIs. Tests that seed each page's table independently are insufficient.

## Analysis governance

- `Campaign` remains the only business-order entity and the database is the single source of truth.
- 每个新增字段和派生视图必须先声明实体所有者（entity owner）、数据来源、重建规则、平台范围和跨页面测试路径（cross-view test path）。
- Before adding a field or derived view, state its entity owner, data source, rebuild rule, platform scope, and cross-view test path.
- Before adding an analysis module, add a metric specification, a manually checkable synthetic dataset, and the corresponding server and API tests.
- Dashboard metrics must declare their statistical unit, fact time field, timezone, definition version, sample quality, and drill-down filter.
- Do not persist dashboard results as a second business-data source. A derived projection must document its owner, refresh rule, and invalidation path.

## Codex change protocol

- Inspect the relevant data flow and state the root cause before editing behavior.
- Write a narrow failing test or architecture check first, implement the smallest change, then run the focused test before moving to the next task.
- Keep the current order review layout and interaction unchanged unless the user explicitly requests a redesign.
- Keep platform-specific capabilities explicit; do not spread platform-name branches through shared metric formulas.
- Stop after each planned task, report the changed files and verification result, and wait for the next task instruction.

## Verification

Run Python tests from `mt5-review-system/server`:

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

Run frontend tests from `mt5-review-system`:

```powershell
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
node --check web/app.js
node --check web/album.js
```

For UI changes, verify desktop and 390px mobile layouts and check for console errors or horizontal overflow.

## Git rules

- Do not use destructive reset/checkout/clean commands without explicit approval.
- Do not force-push.
- Use a focused commit message and update the version route for user-visible releases.

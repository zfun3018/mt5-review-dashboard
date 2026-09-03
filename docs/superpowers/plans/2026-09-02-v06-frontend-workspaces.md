# v0.6.0 Frontend Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coupled dashboard/order page with independent dashboard, order, album, and settings workspaces using one responsive left navigation and shared UI system.

**Architecture:** Use native multi-page HTML and browser ES Modules. Each workspace owns its URL-backed page state and only calls its own APIs; shared modules provide the application shell, API transport, formatting, feedback, tokens, and common controls.

**Tech Stack:** Native HTML, CSS, JavaScript ES Modules, Node.js 20+ test runner, Python static server, local Lucide icon distribution

**Spec:** `docs/superpowers/specs/2026-09-02-architecture-redesign-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-09-02-v06-backend-architecture.md` first.
- Do not read or modify real databases, screenshots, raw events, backups, or local configuration.
- Add no frontend framework and no build step required at application runtime.
- Keep UI work-focused, dense, restrained, and consistent across all pages.
- Use local Lucide icons; do not depend on a public CDN.
- Use fixed type scales rather than viewport-scaled font sizes.
- Desktop navigation is left-sided; 390px uses a closable overlay drawer.
- No horizontal page overflow at desktop or 390px.
- Every async region has loading, empty, error, retry, and stale-request handling.
- Preserve existing editing, screenshot, custom field, R explanation, and album behavior.

---

## File Map

- `web/shared/css/tokens.css`: color, spacing, type, radius, elevation, and size tokens.
- `web/shared/css/base.css`: reset, typography, focus, form, button, and status primitives.
- `web/shared/css/shell.css`: left navigation, page header, content frame, and mobile drawer.
- `web/shared/css/components.css`: tables, filters, modal, popover, toast, empty/error/loading states.
- `web/shared/js/api.mjs`: fetch, cancellation, typed HTTP failure, and JSON handling.
- `web/shared/js/shell.mjs`: navigation, active route, drawer, focus return, and version display.
- `web/shared/js/url-state.mjs`: query-string read/write helpers.
- `web/shared/js/formatters.mjs`: money, time, percentage, R, price, and escaping.
- `web/shared/js/feedback.mjs`: toast, regional error, and retry helpers.
- `web/vendor/lucide.min.js`: pinned official local Lucide browser distribution.
- `web/dashboard/*`: analysis-only page.
- `web/orders/*`: Campaign list and review editing page.
- `web/album/*`: review album page.
- `web/settings/*`: classifications, custom fields, status, backup, and analysis settings.

Retain `/styles.css`, `/app.js`, `/album.html`, `/album.css`, and `/album.js` only as temporary compatibility assets until Task 7 removes or redirects their callers.

### Task 1: Build the Shared UI System and Responsive Application Shell

**Files:**
- Create: `mt5-review-system/web/shared/css/tokens.css`
- Create: `mt5-review-system/web/shared/css/base.css`
- Create: `mt5-review-system/web/shared/css/shell.css`
- Create: `mt5-review-system/web/shared/css/components.css`
- Create: `mt5-review-system/web/shared/js/shell.mjs`
- Create: `mt5-review-system/web/shared/js/url-state.mjs`
- Create: `mt5-review-system/web/shared/js/feedback.mjs`
- Create: `mt5-review-system/web/vendor/lucide.min.js`
- Create: `mt5-review-system/web/tests/app-shell-ui.test.js`
- Modify: `mt5-review-system/server/app/server.py`
- Modify: `mt5-review-system/server/tests/test_server_payload.py`

**Interfaces:**
- Produces: `mountShell({activeRoute, title, actions})`, `openNavigation()`, `closeNavigation()`, `readQuery(schema)`, and `replaceQuery(values)`.
- Produces routes `/dashboard/`, `/orders/`, `/album/`, and `/settings/` that resolve directory `index.html` files.

- [ ] **Step 1: Add static-directory and shell contract tests**

```python
def test_static_directory_resolves_index_html(self):
    self.assertEqual(resolve_static_path("/dashboard/", web_root), web_root / "dashboard" / "index.html")
```

```javascript
test("shell defines four left navigation destinations", () => {
  assert.deepEqual(NAV_ITEMS.map((item) => item.href), ["/dashboard/", "/orders/", "/album/", "/settings/"]);
});
```

Assert CSS contains a 224px desktop navigation track, a 64px collapsed track, an overlay drawer at `max-width: 720px`, `:focus-visible`, and no `font-size: clamp(`.

- [ ] **Step 2: Run tests and verify they fail**

Run from `mt5-review-system`: `node --test web/tests/app-shell-ui.test.js`

Run from `mt5-review-system/server`: `..\.venv\Scripts\python.exe -m unittest tests.test_server_payload -v`

Expected: FAIL because shell files and directory-index resolution do not exist.

- [ ] **Step 3: Define design tokens**

Use exact token groups:

```css
:root {
  --color-bg: #0b0d0e;
  --color-surface: #141817;
  --color-surface-raised: #1a201e;
  --color-border: #2a3431;
  --color-text: #edf3f0;
  --color-muted: #9aa9a3;
  --color-accent: #35c6d8;
  --color-positive: #52c878;
  --color-negative: #ef6a78;
  --color-warning: #e2b84c;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --radius-control: 5px;
  --radius-panel: 8px;
  --sidebar-width: 224px;
  --sidebar-collapsed-width: 64px;
}
```

Add a fixed type scale from 12px to 28px, 44px minimum touch targets on mobile, and visible 2px focus rings.

- [ ] **Step 4: Implement the shell and local icons**

Pin a named Lucide release in a source comment and include its license in `web/vendor/LICENSE-lucide.txt`. `mountShell` injects icon-only collapse/menu buttons with `title` and `aria-label`, applies the active link, and returns a cleanup function. The mobile drawer traps navigation focus only while open and returns focus to its trigger on close.

- [ ] **Step 5: Add safe directory-index resolution**

`resolve_static_path` maps an existing directory request to its `index.html`, still validates the resolved target is inside `WEB_DIR`, and retains the root compatibility behavior.

- [ ] **Step 6: Run shell, syntax, and server tests**

Run: `node --test web/tests/app-shell-ui.test.js`

Run: `node --check web/shared/js/shell.mjs`

Run: `..\.venv\Scripts\python.exe -m unittest tests.test_server_payload -v`

Expected: PASS.

- [ ] **Step 7: Commit the shared shell**

```powershell
git add mt5-review-system/web/shared mt5-review-system/web/vendor mt5-review-system/web/tests/app-shell-ui.test.js mt5-review-system/server/app/server.py mt5-review-system/server/tests/test_server_payload.py
git commit -m "feat: add responsive application shell"
```

### Task 2: Add Shared API, URL State, and Formatting Modules

**Files:**
- Create: `mt5-review-system/web/shared/js/api.mjs`
- Create: `mt5-review-system/web/shared/js/formatters.mjs`
- Create: `mt5-review-system/web/tests/shared-modules.test.mjs`
- Modify: `mt5-review-system/web/r-multiple.js`

**Interfaces:**
- Produces: `requestJson(path, {method, body, signal})`, `RequestGate.begin(key) -> AbortController`, `RequestGate.run(key, requestFactory)`, `RequestGate.abortAll()`, `HttpError`, URL helpers, and existing formatters.
- Consumes: browser `fetch`, `AbortController`, and `Intl` only.

- [ ] **Step 1: Add fetch cancellation and formatter tests**

```javascript
test("request gate aborts the older request in one region", async () => {
  const gate = new RequestGate();
  const first = gate.begin("analysis");
  const second = gate.begin("analysis");
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
});

test("formatters preserve current money and R output", () => {
  assert.equal(formatMoney(12.5), "$12.50");
  assert.equal(formatR(1.256), "+1.26R");
});
```

- [ ] **Step 2: Run shared module tests and verify they fail**

Run: `node --test web/tests/shared-modules.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement request handling**

`requestJson` sets JSON headers only when a body exists, parses JSON errors, maps non-2xx responses to `HttpError(status, message)`, and rethrows `AbortError` without showing a user error. `RequestGate` stores one controller per region and exposes `abortAll()` for page unload.

- [ ] **Step 4: Move pure formatters and R explanations**

Move money/time/percentage/price/escape functions to `formatters.mjs`. Convert `r-multiple.js` into an ES module or add an ES module wrapper while retaining CommonJS compatibility until existing tests are migrated.

- [ ] **Step 5: Run shared tests and syntax checks**

Run: `node --test web/tests/shared-modules.test.mjs web/tests/r-multiple-ui.test.js`

Run: `node --check web/shared/js/api.mjs`

Expected: PASS.

- [ ] **Step 6: Commit shared client infrastructure**

```powershell
git add mt5-review-system/web/shared/js mt5-review-system/web/r-multiple.js mt5-review-system/web/tests
git commit -m "refactor: add shared frontend infrastructure"
```

### Task 3: Create the Analysis-Only Dashboard Workspace

**Files:**
- Create: `mt5-review-system/web/dashboard/index.html`
- Create: `mt5-review-system/web/dashboard/dashboard.mjs`
- Create: `mt5-review-system/web/dashboard/dashboard.css`
- Create: `mt5-review-system/web/dashboard/dashboard-state.mjs`
- Create: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`
- Modify: `mt5-review-system/web/app.js`
- Modify: `mt5-review-system/web/index.html`

**Interfaces:**
- Produces: `createDashboardController({api, view, location})`, `readDashboardState(search)`, and `writeDashboardState(state)`.
- Consumes: `GET /api/analysis` only. Scratch threshold editing belongs exclusively to Settings.

- [ ] **Step 1: Add dashboard isolation tests**

```javascript
test("dashboard loads analysis without campaigns or bootstrap", async () => {
  const api = recordingApi({"/api/analysis?equity_days=30": ANALYSIS});
  const controller = createDashboardController({api, view, location});
  await controller.load();
  assert.deepEqual(api.paths, ["/api/analysis?equity_days=30"]);
  assert.equal(api.paths.some((path) => path.includes("campaigns") || path.includes("bootstrap")), false);
});
```

Add URL round-trip assertions for preset, start, end, equity days, year, and month.

- [ ] **Step 2: Run dashboard tests and verify they fail**

Run: `node --test web/tests/dashboard-workspace.test.mjs`

Expected: FAIL because dashboard modules do not exist.

- [ ] **Step 3: Build dashboard semantic markup**

Include the application shell mount point, compact page header, analysis filters, equity chart, monthly calendar, heatmap, session stats, system evaluation, mode evaluation, regional loading/error nodes, metric explanation dialog, and toast. Do not include order search, Campaign rows, detail editor, screenshot editor, field manager, backup, or status drawer.

- [ ] **Step 4: Extract dashboard state and rendering**

Move analysis-only functions from `app.js`. The controller uses `RequestGate` region `analysis`, ignores abort failures, updates URL before reload, and renders one regional retry button on failure. Calendar month navigation changes only year/month state and reloads the analysis payload.

- [ ] **Step 5: Style dashboard layout from shared tokens**

Use stable grid tracks and min/max sizes for charts and calendars. Avoid nested cards, decorative gradients, radial backgrounds, oversized headings, and viewport-scaled font sizes. At 390px, charts and calendar stay within the viewport and tables become labeled row blocks where necessary.

- [ ] **Step 6: Replace root page with a compatibility redirect**

`/index.html` contains a small script that maps `?trade=ID` to `/orders/?trade=ID`; otherwise it redirects to `/dashboard/`. Keep no dashboard implementation in root `app.js` after Tasks 3-6 finish.

- [ ] **Step 7: Run dashboard and existing metric tests**

Run: `node --test web/tests/dashboard-workspace.test.mjs web/tests/r-multiple-ui.test.js`

Run: `node --check web/dashboard/dashboard.mjs`

Expected: PASS.

- [ ] **Step 8: Commit dashboard workspace**

```powershell
git add mt5-review-system/web/dashboard mt5-review-system/web/index.html mt5-review-system/web/app.js mt5-review-system/web/tests
git commit -m "feat: split analysis dashboard workspace"
```

### Task 4: Create the Orders Workspace

**Files:**
- Create: `mt5-review-system/web/orders/index.html`
- Create: `mt5-review-system/web/orders/orders.mjs`
- Create: `mt5-review-system/web/orders/orders-state.mjs`
- Create: `mt5-review-system/web/orders/orders.css`
- Create: `mt5-review-system/web/orders/order-detail.mjs`
- Create: `mt5-review-system/web/orders/custom-fields.mjs`
- Create: `mt5-review-system/web/tests/orders-workspace.test.mjs`
- Modify: `mt5-review-system/web/tests/custom-fields-ui.test.js`
- Modify: `mt5-review-system/web/tests/r-multiple-ui.test.js`

**Interfaces:**
- Produces: `createOrdersController({api, view, location})`, `readOrdersState(search)`, `renderCampaignRows(page)`, and detail editing actions.
- Consumes: Campaign list/detail, Position initial stop, trade/campaign review, screenshot, and custom value APIs.

- [ ] **Step 1: Add order pagination, selection, and local refresh tests**

```javascript
test("order filters are sent to the server", async () => {
  const state = {q: "XAU", side: "long", page: 2, pageSize: 50, rMissing: true};
  await controller.loadList(state);
  assert.equal(api.paths[0], "/api/campaigns?q=XAU&side=long&r_missing=1&page=2&page_size=50");
});

test("saving a stop refreshes one campaign and the current page", async () => {
  await controller.saveInitialStop("P-1", 98);
  assert.deepEqual(api.methods, ["PATCH", "GET", "GET"]);
  assert.match(api.paths[1], /\/api\/campaigns\//);
  assert.match(api.paths[2], /\/api\/campaigns\?/);
});
```

Add tests for `?trade=` resolution, `?campaign=`, expandable multi-Position rows, screenshot replacement/delete, review save, custom choice creation, and soft delete.

- [ ] **Step 2: Run order tests and verify they fail**

Run: `node --test web/tests/orders-workspace.test.mjs`

Expected: FAIL because the order modules do not exist.

- [ ] **Step 3: Build the order list and detail markup**

Desktop uses a list/detail split with stable columns; mobile uses list first and a full-width detail view with a visible back command. Filters include query, side, trade type, strategy, date range, and R missing. Pagination shows total, current page, previous, and next controls.

- [ ] **Step 4: Extract list state and rendering**

Move Campaign row, Position child row, R status, stop editor, filtering, selection, and pagination from `app.js`. Remove client-side filtering of an in-memory 200-row list. Keep expanded IDs as temporary page state, while filters/page/selection live in URL.

- [ ] **Step 5: Extract detail, screenshot, review, and custom-field editors**

Move detail functions into `order-detail.mjs` and custom-field behavior into `custom-fields.mjs`. All saves disable their initiating control, show inline progress, restore focus, handle validation messages, and refresh only affected resources.

- [ ] **Step 6: Style responsive order workflows**

Keep stable table tracks on desktop and labeled blocks at 680px. Inputs must not resize rows on focus or save. Screenshot preview preserves aspect ratio. Long review text scrolls within the editor, not beneath action buttons.

- [ ] **Step 7: Run order, field, R, and syntax tests**

Run: `node --test web/tests/orders-workspace.test.mjs web/tests/custom-fields-ui.test.js web/tests/r-multiple-ui.test.js`

Run: `node --check web/orders/orders.mjs`

Expected: PASS.

- [ ] **Step 8: Commit orders workspace**

```powershell
git add mt5-review-system/web/orders mt5-review-system/web/tests mt5-review-system/web/app.js
git commit -m "feat: split order review workspace"
```

### Task 5: Move the Review Album into the Shared Shell

**Files:**
- Create: `mt5-review-system/web/album/index.html`
- Create: `mt5-review-system/web/album/album.mjs`
- Create: `mt5-review-system/web/album/album-state.mjs`
- Create: `mt5-review-system/web/album/album.css`
- Modify: `mt5-review-system/web/tests/review-album-ui.test.js`
- Remove after compatibility redirect exists: `mt5-review-system/web/album.html`
- Remove after tests migrate: `mt5-review-system/web/album.js`
- Remove after styles migrate: `mt5-review-system/web/album.css`

**Interfaces:**
- Produces: `createAlbumController({api, view, location})`, album URL state, date grouping, modal, and lazy-image interactions.
- Consumes: `GET /api/review-album` only.

- [ ] **Step 1: Update album behavior tests for the new route**

Assert `/album/` markup mounts the shared shell, `album.mjs` calls only `/api/review-album`, selected tags round-trip through URL, and order links point to `/orders/?trade=...`.

- [ ] **Step 2: Run album tests and verify they fail**

Run: `node --test web/tests/review-album-ui.test.js`

Expected: FAIL because the new album workspace does not exist.

- [ ] **Step 3: Move album logic into modules**

Reuse the existing API payload and exact OR-within/AND-across tag semantics. Preserve date grouping, missing screenshot placeholder, lazy loading, large preview, scrollable review content, and clear-filter empty action.

- [ ] **Step 4: Replace duplicate styles with shared tokens and components**

Keep only album-specific layout in `album/album.css`. Remove page-level color overrides, duplicate form styling, duplicate navigation styling, gradients, and radial backgrounds.

- [ ] **Step 5: Add compatibility redirect for `/album.html`**

Handle `/album.html` in static routing with an HTTP 302 or a minimal HTML redirect to `/album/`, preserving query parameters.

- [ ] **Step 6: Run album and syntax tests**

Run: `node --test web/tests/review-album-ui.test.js`

Run: `node --check web/album/album.mjs`

Expected: PASS.

- [ ] **Step 7: Commit album workspace**

```powershell
git add -A mt5-review-system/web/album mt5-review-system/web/album.html mt5-review-system/web/album.js mt5-review-system/web/album.css mt5-review-system/web/tests/review-album-ui.test.js mt5-review-system/server
git commit -m "feat: move review album into application shell"
```

### Task 6: Create the Settings and System Workspace

**Files:**
- Create: `mt5-review-system/web/settings/index.html`
- Create: `mt5-review-system/web/settings/settings.mjs`
- Create: `mt5-review-system/web/settings/settings.css`
- Create: `mt5-review-system/web/settings/classifications.mjs`
- Create: `mt5-review-system/web/settings/custom-field-schema.mjs`
- Create: `mt5-review-system/web/tests/settings-workspace.test.mjs`
- Modify: `mt5-review-system/web/tests/custom-fields-ui.test.js`

**Interfaces:**
- Produces: settings workspace for classification CRUD, custom-field schema CRUD, Scratch threshold, system status, and backup creation.
- Consumes: classification, custom-field, analysis-settings, status, and backup APIs only.

- [ ] **Step 1: Add settings ownership tests**

```javascript
test("settings loads configuration without analysis or campaigns", async () => {
  await controller.load();
  assert.deepEqual(new Set(api.paths), new Set([
    "/api/classification-options",
    "/api/custom-fields",
    "/api/analysis-settings",
    "/api/status",
    "/api/backups"
  ]));
});
```

Add tests for create/rename/archive classification, field type/options save, threshold validation, status retry, and backup success.

- [ ] **Step 2: Run settings tests and verify they fail**

Run: `node --test web/tests/settings-workspace.test.mjs`

Expected: FAIL because settings workspace modules do not exist.

- [ ] **Step 3: Build settings sections without nested cards**

Use tabbed sections for “分类与字段”, “分析设置”, and “数据与状态”. Commands use icon buttons where familiar and icon+text for create, save, backup, and destructive archive actions. Do not render absolute local paths returned by legacy status payloads; show configured state, counts, size, and last activity instead, and never copy private values into client logs.

- [ ] **Step 4: Move manager behavior from the old dashboard**

Extract classification and custom field schema code from `app.js`. After a successful mutation, refresh only the corresponding catalog. Confirm archive actions; do not hard-delete historical option values.

- [ ] **Step 5: Move Scratch, status, and backup operations**

Scratch threshold is owned only by Settings. Dashboard reads the effective threshold included in analysis responses. Backup success displays filename and size without exposing the absolute local path.

- [ ] **Step 6: Run settings and field tests**

Run: `node --test web/tests/settings-workspace.test.mjs web/tests/custom-fields-ui.test.js`

Run: `node --check web/settings/settings.mjs`

Expected: PASS.

- [ ] **Step 7: Commit settings workspace**

```powershell
git add mt5-review-system/web/settings mt5-review-system/web/tests mt5-review-system/web/app.js
git commit -m "feat: add settings and system workspace"
```

### Task 7: Remove Coupled Frontend Assets and Verify Workspace Isolation

**Files:**
- Remove: `mt5-review-system/web/app.js`
- Remove: `mt5-review-system/web/styles.css`
- Modify: `mt5-review-system/web/index.html`
- Create: `mt5-review-system/web/tests/workspace-isolation.test.mjs`
- Modify: all existing `mt5-review-system/web/tests/*.test.js`
- Modify: `mt5-review-system/README.md`

**Interfaces:**
- Produces: four independent workspace entry points plus root/legacy redirects.
- Consumes: all shared and page modules established in Tasks 1-6.

- [ ] **Step 1: Add workspace asset and endpoint isolation tests**

Read every HTML entry and assert:

```javascript
assert.doesNotMatch(html, /\/app\.js|\/styles\.css/);
assert.match(html, /shared\/css\/tokens\.css/);
assert.match(html, /shared\/js\/shell\.mjs/);
```

Inspect controllers and assert dashboard has no Campaign endpoints, album has no mutation method, settings has no analysis endpoint, and orders has no dashboard analysis endpoint.

- [ ] **Step 2: Run isolation tests and verify they fail**

Run: `node --test web/tests/workspace-isolation.test.mjs`

Expected: FAIL while old coupled assets remain referenced.

- [ ] **Step 3: Remove old assets and migrate every test**

Delete `app.js` and `styles.css` only after no HTML or test references them. Replace string assertions against monolithic sources with page-module or behavior assertions. Keep root `index.html` as the redirect entry.

- [ ] **Step 4: Check every JavaScript entry**

Run:

```powershell
node --check web/shared/js/api.mjs
node --check web/shared/js/shell.mjs
node --check web/dashboard/dashboard.mjs
node --check web/orders/orders.mjs
node --check web/album/album.mjs
node --check web/settings/settings.mjs
```

Expected: all exit 0.

- [ ] **Step 5: Run the complete frontend suite**

Run: `node --test web/tests/*.test.js web/tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Run the complete backend suite after frontend routing changes**

Run from `mt5-review-system/server`: `..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`

Expected: PASS.

- [ ] **Step 7: Document the workspace ownership map and commit**

```powershell
git add -A mt5-review-system/web mt5-review-system/server mt5-review-system/README.md
git commit -m "refactor: complete frontend workspace split"
```

## Frontend Plan Completion Gate

Before starting release integration:

- Dashboard, orders, album, and settings each have independent HTML/CSS/JS entry points.
- All pages use the same left navigation and shared tokens.
- Dashboard makes no order-list/detail request.
- Orders use server pagination rather than a 200-item in-memory list.
- Settings owns configuration, backup, and status workflows.
- Root and legacy album/order links redirect correctly.
- Old monolithic frontend assets are removed.
- All frontend and backend tests pass.
- Browser verification remains for the integration plan.

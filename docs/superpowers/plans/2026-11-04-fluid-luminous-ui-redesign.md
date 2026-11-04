# Fluid Luminous UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有三页面功能、API、数据契约和布局编辑能力的前提下，将仪表盘、订单复盘和设置统一升级为 Fluid Luminous 玻璃 UI。

**Architecture:** 以现有 `tokens.css`、`base.css`、`components.css` 和 `shell.css` 为共享视觉基础，不引入前端构建工具或新的 UI 框架。页面脚本继续负责服务端事实和现有交互，只补充统一的标签、菜单、浮卡和状态 class；页面 CSS 负责各自模块的空间层级与响应式覆盖。订单复盘优先改造，用它验证截图主视觉、列表详情联动、标签、下拉、复盘编辑和移动端抽屉。

**Tech Stack:** 原生 HTML/CSS/JavaScript modules、现有 Lucide、ECharts、GridStack、Node `node:test`、Playwright 浏览器回归。

**Spec:** `docs/superpowers/specs/2026-11-04-fluid-luminous-ui-redesign-design.md`

## Global Constraints

- 数据库仍是唯一业务事实来源；前端不得创建订单、Position、Campaign 或指标的页面副本。
- 不改变现有 API 路由、字段名称、稳定 ID、统计口径、时区和平台隔离。
- 订单复盘继续作为订单列表、订单详情、截图、复盘、精选、随机阅读、打卡和归档的统一工作区。
- 所有交易场景、交易策略、犯错标签、自定义字段标签和状态标签使用 Glow Pills。
- 所有平台、状态、排序、日期预设、字段类型、筛选和布局选择使用 Glass Menus，同时保留可访问的表单语义。
- 所有模块保留 loading、value、empty、warning、error、unavailable、insufficient、incomplete、estimated 和 not applicable 的服务端状态语义。
- 动效只使用 transform/opacity 等低成本属性；`prefers-reduced-motion: reduce` 时关闭持续流光、浮动和大范围入场动画。
- 桌面端和 390px 移动端不得出现横向溢出、内容重叠、布局跳动或不可操作控件。
- 不读取、修改、暂存或提交 `mt5-review-system/data/`、`backups/`、`config.local.json`、截图、原始 MT5 JSONL 或生成二进制。

---

### Task 1: Lock the shared visual contract

**Files:**
- Modify: `mt5-review-system/web/shared/css/tokens.css`
- Modify: `mt5-review-system/web/shared/css/base.css`
- Test: `mt5-review-system/web/tests/fluid-luminous-ui.test.mjs`

**Interfaces:**
- Produces CSS variables consumed by `components.css`, `shell.css`, `dashboard.css`, `orders.css`, `settings.css` and domestic futures CSS.
- Produces motion preference selectors consumed by all shared components.

- [ ] **Step 1: Write the failing token contract test**

  Create a Node test that reads `tokens.css` and asserts the presence of named layers and values: `--glass-atmosphere`, `--glass-base`, `--glass-clear`, `--glass-fluid`, `--glass-blur`, `--glass-saturation`, `--motion-duration-expand`, `--motion-duration-collapse`, `--motion-distance-float`, `--focus-ring-color`, `--color-tag-scene`, `--color-tag-strategy`, `--color-tag-mistake`, `--color-tag-success`, `--color-tag-warning`, and `@media (prefers-reduced-motion: reduce)` in `base.css`.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run from `mt5-review-system`:

  ```powershell
  node --test web/tests/fluid-luminous-ui.test.mjs
  ```

  Expected result: FAIL because the new layer and motion variables do not exist yet.

- [ ] **Step 3: Add the token layers and accessibility fallbacks**

  Add explicit variables for:

  - blue-black page background and atmosphere gradients;
  - Base Glass, Clear Glass and Fluid Luminous backgrounds, borders, blur and saturation;
  - semantic tag colors and their RGB components;
  - motion durations, float distance and easing;
  - fallback opaque surfaces for browsers without `backdrop-filter`;
  - focus ring color and shadow.

  Keep the existing variable names as aliases where current page CSS depends on them. Add a reduced-motion block in `base.css` that sets animation duration to near-zero and disables continuous background and floating animations without hiding state transitions.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run `node --test web/tests/fluid-luminous-ui.test.mjs` and expect PASS.

- [ ] **Step 5: Commit the shared token contract**

  ```powershell
  git add mt5-review-system/web/shared/css/tokens.css mt5-review-system/web/shared/css/base.css mt5-review-system/web/tests/fluid-luminous-ui.test.mjs
  git commit -m "feat: define Fluid Luminous visual tokens"
  ```

### Task 2: Build shared glass, tag, menu, state, modal and motion primitives

**Files:**
- Modify: `mt5-review-system/web/shared/css/components.css`
- Modify: `mt5-review-system/web/shared/css/shell.css`
- Modify: `mt5-review-system/web/shared/js/shell.mjs`
- Test: `mt5-review-system/web/tests/app-shell-ui.test.js`
- Test: `mt5-review-system/web/tests/fluid-luminous-ui.test.mjs`

**Interfaces:**
- `shell.mjs` continues exporting `NAV_ITEMS`, `mountShell`, `openNavigation` and `closeNavigation` with existing signatures.
- Shared CSS exposes reusable classes: `.glass-surface`, `.glass-surface--clear`, `.glass-surface--fluid`, `.glow-pill`, `.glass-menu`, `.glass-menu__option`, `.floating-context-card`, `.region-state`, `.modal-surface`.

- [ ] **Step 1: Extend the failing component tests**

  Add assertions that `components.css` contains the three glass surface classes, `.glow-pill`, `.glass-menu`, keyboard focus styling, reduced-motion handling and an opaque fallback. Add a shell test that verifies the navigation still renders the current route, platform button, refresh/import action and collapse control.

- [ ] **Step 2: Run the focused tests and verify the new assertions fail**

  ```powershell
  node --test web/tests/app-shell-ui.test.js web/tests/fluid-luminous-ui.test.mjs
  ```

  Expected result: existing shell assertions pass; new component assertions fail until the classes are added.

- [ ] **Step 3: Implement shared primitives**

  In `components.css`:

  - define Base/Clear/Fluid glass backgrounds, borders, top highlight, inner glow and shadows;
  - define `.glow-pill` with semantic `--pill-color`, selected, disabled and removable states;
  - define `.glass-menu` and `.glass-menu__option` with active, focused, disabled and error states;
  - preserve `.button`, `.button-primary`, `.button-danger`, inputs, tables, `.region-state`, feedback toast and modal behavior;
  - add `@supports not (backdrop-filter: blur(1px))` fallback backgrounds;
  - ensure hover never changes element dimensions.

  In `shell.css`:

  - apply the atmosphere, shell glass and navigation focus treatment;
  - keep mobile drawer and collapsed desktop navigation behavior;
  - add a stable page-bar action area for platform, refresh/import and share actions.

  In `shell.mjs`:

  - keep existing DOM and event contracts;
  - add only stable modifier classes/data attributes needed by the shared CSS;
  - preserve `aria-current`, `aria-expanded`, `aria-controls`, inert mobile navigation and Esc handling;
  - do not introduce page-specific business data into the shell.

- [ ] **Step 4: Run focused tests and syntax checks**

  ```powershell
  node --test web/tests/app-shell-ui.test.js web/tests/fluid-luminous-ui.test.mjs
  node --check web/shared/js/shell.mjs
  ```

  Expected result: PASS.

- [ ] **Step 5: Commit shared components**

  ```powershell
  git add mt5-review-system/web/shared/css/components.css mt5-review-system/web/shared/css/shell.css mt5-review-system/web/shared/js/shell.mjs mt5-review-system/web/tests/app-shell-ui.test.js mt5-review-system/web/tests/fluid-luminous-ui.test.mjs
  git commit -m "feat: add shared glass components"
  ```

### Task 3: Restyle the orders master-detail workspace without changing behavior

**Files:**
- Modify: `mt5-review-system/web/orders/orders.css`
- Modify: `mt5-review-system/web/orders/order-detail.mjs`
- Modify: `mt5-review-system/web/orders/index.html`
- Modify: `mt5-review-system/web/orders/orders.mjs`
- Test: `mt5-review-system/web/tests/orders-workspace.test.mjs`
- Test: `mt5-review-system/web/tests/custom-fields-ui.test.js`
- Test: `mt5-review-system/web/tests/review-album-ui.test.js`
- Test: `mt5-review-system/web/tests/browser/order-review-workspace.spec.mjs`

**Interfaces:**
- `createOrderDetailModule()` continues returning `render`, `renderCampaignDetail`, `renderPositionDetail`, `saveReview` and `dispose`.
- Existing order API requests, URL state, screenshot endpoints, review autosave, check-in endpoints and custom field payloads remain unchanged.

- [ ] **Step 1: Add failing UI contract assertions**

  Extend the existing order tests to assert that rendered detail markup contains the shared modifier classes for screenshot stage, Fluid Luminous summary card, Glow Pills and Glass Menu triggers; assert the order page still contains the list, detail host, check-in calendar and image modal. Add a browser assertion that desktop keeps list and detail visible together and 390px switches to a single readable column without horizontal overflow.

- [ ] **Step 2: Run focused order tests and verify the new assertions fail**

  ```powershell
  node --test web/tests/orders-workspace.test.mjs web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
  ```

  Expected result: existing behavior tests pass; new visual contract assertions fail.

- [ ] **Step 3: Add semantic visual modifiers to existing markup**

  In `order-detail.mjs`:

  - keep all existing fields and event data attributes;
  - mark the screenshot editor as the primary visual stage;
  - render transaction scene, strategy and mistake values with `.glow-pill` and `--pill-color` from existing server-provided option colors;
  - retain the existing tag picker trigger and option semantics, adding the shared menu classes and `aria-expanded` state;
  - mark summary, import sources, stop-loss and execution rows as secondary context sections;
  - keep review draft/autosave, screenshot paste/drop/undo/replace/delete, check-in and navigation controls unchanged.

  In `orders.mjs` and `index.html`:

  - keep the current filters, all/featured tabs, infinite loading, detail host, check-in calendar and image modal;
  - add only visual hooks for list selection, detail stage, floating summary and mobile detail state.

- [ ] **Step 4: Implement desktop and mobile CSS**

  In `orders.css`:

  - preserve the existing list/detail grid and make the screenshot stage the dominant region;
  - apply Clear Glass to the detail surface and Fluid Luminous to the selected order, summary card, tags and active controls;
  - keep list scrolling independent from detail scrolling;
  - keep review editor independently scrollable for 10,000-character text;
  - style the image modal with the high-level glass surface and preserve original image proportions;
  - at 720px and below, stack the list selector above the detail stage, then place metadata and review controls below it;
  - at 390px, ensure tags wrap, action buttons fit, screenshot controls remain reachable and no horizontal overflow occurs.

- [ ] **Step 5: Run focused tests and browser checks**

  ```powershell
  node --test web/tests/orders-workspace.test.mjs web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
  node --check web/orders/orders.mjs
  node --check web/orders/order-detail.mjs
  ```

  Run the order browser spec at desktop and 390px. Expected result: list/detail linkage, screenshot interactions, autosave, tags, check-in and modal behavior remain passing with no console errors or overflow.

- [ ] **Step 6: Commit orders UI**

  ```powershell
  git add mt5-review-system/web/orders/index.html mt5-review-system/web/orders/orders.css mt5-review-system/web/orders/orders.mjs mt5-review-system/web/orders/order-detail.mjs mt5-review-system/web/tests/orders-workspace.test.mjs mt5-review-system/web/tests/custom-fields-ui.test.js mt5-review-system/web/tests/review-album-ui.test.js mt5-review-system/web/tests/browser/order-review-workspace.spec.mjs
  git commit -m "feat: apply Fluid Luminous order review UI"
  ```

### Task 4: Restyle MT5 and domestic futures dashboard modules

**Files:**
- Modify: `mt5-review-system/web/dashboard/dashboard.css`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.css`
- Modify: `mt5-review-system/web/shared/css/domestic-futures-workspace.css`
- Modify: `mt5-review-system/web/dashboard/index.html`
- Modify: `mt5-review-system/web/dashboard/dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard-layout.mjs`
- Test: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`
- Test: `mt5-review-system/web/tests/dashboard-gridstack.test.mjs`
- Test: `mt5-review-system/web/tests/mt5-dashboard-charts.test.mjs`
- Test: `mt5-review-system/web/tests/domestic-futures-dashboard.test.mjs`
- Test: `mt5-review-system/web/tests/browser/dashboard-a-upgrade.spec.mjs`
- Test: `mt5-review-system/web/tests/browser/workspaces.spec.mjs`

**Interfaces:**
- Existing dashboard module registry, runtime state, GridStack layout persistence, ECharts data and platform capability declarations remain unchanged.
- Existing metric state renderer remains the authority for value, empty, warning, error, unavailable and insufficient states.

- [ ] **Step 1: Add failing dashboard visual contract assertions**

  Extend dashboard tests to assert every registered MT5 and domestic futures module receives the shared glass module class, that loading/error/insufficient states retain explicit state attributes, and that layout edit controls remain discoverable. Add browser assertions for desktop grid readability and 390px single-column flow.

- [ ] **Step 2: Run dashboard tests and verify new assertions fail**

  ```powershell
  node --test web/tests/dashboard-workspace.test.mjs web/tests/dashboard-gridstack.test.mjs web/tests/mt5-dashboard-charts.test.mjs web/tests/domestic-futures-dashboard.test.mjs
  ```

  Expected result: existing metric and layout tests pass; new visual hook assertions fail.

- [ ] **Step 3: Add shared visual hooks without deriving metrics**

  In dashboard controllers and `index.html`, add only class names/data attributes for module layer, state, chart host, metric explanation trigger and layout-editing mode. Do not compute or rename metric values in the frontend. Keep server-provided state metadata and platform-specific module registration intact.

- [ ] **Step 4: Implement dashboard glass hierarchy**

  In `dashboard.css`, `domestic-futures-dashboard.css` and `domestic-futures-workspace.css`:

  - style page filters and cost notes with Base Glass;
  - style key R metrics, period snapshots and risk states with Clear Glass;
  - style selected module explanations and metric popovers with Fluid Luminous;
  - keep ECharts canvases stable with fixed minimum dimensions and no animated container resizing;
  - preserve GridStack drag/resize handles and make edit mode visibly distinct;
  - maintain desktop density and convert to single-column modules at 390px;
  - ensure chart legends, labels and status text remain readable over light regions.

- [ ] **Step 5: Run dashboard tests and browser checks**

  ```powershell
  node --test web/tests/dashboard-workspace.test.mjs web/tests/dashboard-gridstack.test.mjs web/tests/mt5-dashboard-charts.test.mjs web/tests/domestic-futures-dashboard.test.mjs
  node --check web/dashboard/dashboard.mjs
  node --check web/dashboard/dashboard-layout.mjs
  node --check web/dashboard/domestic-futures-dashboard.mjs
  ```

  Run dashboard browser specs at desktop and 390px. Expected result: all modules keep their server-owned states, layout editing persists, charts render nonblank, and no horizontal overflow occurs.

- [ ] **Step 6: Commit dashboard UI**

  ```powershell
  git add mt5-review-system/web/dashboard/index.html mt5-review-system/web/dashboard/dashboard.css mt5-review-system/web/dashboard/domestic-futures-dashboard.css mt5-review-system/web/shared/css/domestic-futures-workspace.css mt5-review-system/web/dashboard/dashboard.mjs mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs mt5-review-system/web/dashboard/dashboard-layout.mjs mt5-review-system/web/tests/dashboard-workspace.test.mjs mt5-review-system/web/tests/dashboard-gridstack.test.mjs mt5-review-system/web/tests/mt5-dashboard-charts.test.mjs mt5-review-system/web/tests/domestic-futures-dashboard.test.mjs mt5-review-system/web/tests/browser/dashboard-a-upgrade.spec.mjs mt5-review-system/web/tests/browser/workspaces.spec.mjs
  git commit -m "feat: apply Fluid Luminous dashboard UI"
  ```

### Task 5: Restyle settings tabs, forms, import audit and destructive workflows

**Files:**
- Modify: `mt5-review-system/web/settings/settings.css`
- Modify: `mt5-review-system/web/settings/index.html`
- Modify: `mt5-review-system/web/settings/settings.mjs`
- Modify: `mt5-review-system/web/settings/classifications.mjs`
- Modify: `mt5-review-system/web/settings/custom-field-schema.mjs`
- Test: `mt5-review-system/web/tests/settings-workspace.test.mjs`
- Test: `mt5-review-system/web/tests/browser/workspaces.spec.mjs`

**Interfaces:**
- Existing settings controller methods, API paths, classification IDs, custom field schema and import/cleanup/backup payloads remain unchanged.
- Existing three settings tabs remain the only settings navigation states.

- [ ] **Step 1: Add failing settings visual contract assertions**

  Extend settings tests to assert shared tab, Glow Pills, Glass Menus, result-state and confirmation-surface classes while preserving all existing API path assertions. Add browser checks that import issues and cleanup preview remain readable at 390px.

- [ ] **Step 2: Run settings tests and verify new assertions fail**

  ```powershell
  node --test web/tests/settings-workspace.test.mjs
  ```

  Expected result: existing behavior tests pass; new visual hook assertions fail.

- [ ] **Step 3: Add visual hooks without changing settings state or payloads**

  In the settings HTML and render modules, add class names/data attributes for tab state, field rows, classification pills, custom field option pills, import summary/status, issue rows, unmatched execution selection, cleanup preview, status items and backups. Preserve every current element ID used by `settings.mjs` and tests.

- [ ] **Step 4: Implement settings CSS and interaction states**

  - style tabs as Glow Pills with a clear selected state;
  - style text, number, date and file controls consistently with Glass Menus and Base Glass;
  - use stable high-density panels for classifications, analysis and data/status;
  - use amber/red surfaces for import conflicts, unmatched rows and destructive cleanup;
  - keep backup and status rows readable without revealing private absolute paths;
  - reduce continuous animation in import, cleanup and backup flows;
  - stack field controls and issue details at 390px without clipping.

- [ ] **Step 5: Run settings tests and browser checks**

  ```powershell
  node --test web/tests/settings-workspace.test.mjs
  node --check web/settings/settings.mjs
  node --check web/settings/classifications.mjs
  node --check web/settings/custom-field-schema.mjs
  ```

  Run the settings browser workspace spec at desktop and 390px. Expected result: tab switching, classification editing, custom fields, threshold save, import audit, matching, cleanup preview and backups retain behavior with no overflow.

- [ ] **Step 6: Commit settings UI**

  ```powershell
  git add mt5-review-system/web/settings/index.html mt5-review-system/web/settings/settings.css mt5-review-system/web/settings/settings.mjs mt5-review-system/web/settings/classifications.mjs mt5-review-system/web/settings/custom-field-schema.mjs mt5-review-system/web/tests/settings-workspace.test.mjs mt5-review-system/web/tests/browser/workspaces.spec.mjs
  git commit -m "feat: apply Fluid Luminous settings UI"
  ```

### Task 6: Complete responsive, accessibility and motion regression coverage

**Files:**
- Modify: `mt5-review-system/web/shared/css/base.css`
- Modify: `mt5-review-system/web/shared/css/components.css`
- Modify: `mt5-review-system/web/shared/css/shell.css`
- Modify: `mt5-review-system/web/tests/browser/a-ui-visual-consistency.spec.mjs`
- Modify: `mt5-review-system/web/tests/browser/workspaces.spec.mjs`
- Modify: `mt5-review-system/web/tests/browser/order-review-workspace.spec.mjs`
- Test: `mt5-review-system/web/tests/browser/fluid-luminous-accessibility.spec.mjs`

- [ ] **Step 1: Add browser regression tests before final CSS adjustments**

  Create Playwright scenarios that visit all three pages at desktop and 390px, assert `document.documentElement.scrollWidth <= document.documentElement.clientWidth`, verify visible focus rings on keyboard navigation, verify Escape closes menus/modals/floating cards, and emulate `prefers-reduced-motion: reduce` to assert no continuous animation remains on atmosphere or floating cards.

- [ ] **Step 2: Run the new browser tests and record baseline failures**

  Run the focused Playwright file with the existing browser fixture. Expected result: baseline failures identify remaining overflow, focus, menu or motion behavior.

- [ ] **Step 3: Fix shared responsive and accessibility issues**

  Adjust only shared styles and existing event hooks. Keep controls within viewport, preserve minimum chart/table sizes through intentional scrolling, add `aria-expanded`/`aria-controls` where missing, and ensure menus/modals/floating cards return focus to their trigger on close.

- [ ] **Step 4: Run all frontend verification commands**

  ```powershell
  node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js web/tests/app-shell-ui.test.js web/tests/fluid-luminous-ui.test.mjs
  node --check web/shared/js/shell.mjs
  node --check web/dashboard/dashboard.mjs
  node --check web/dashboard/domestic-futures-dashboard.mjs
  node --check web/orders/orders.mjs
  node --check web/orders/order-detail.mjs
  node --check web/settings/settings.mjs
  ```

  Run the complete browser suite required by the repository and the new accessibility file. Expected result: no console errors, no horizontal overflow at desktop/390px, and all existing interactions pass.

- [ ] **Step 5: Commit responsive and accessibility coverage**

  ```powershell
  git add mt5-review-system/web/shared/css/base.css mt5-review-system/web/shared/css/components.css mt5-review-system/web/shared/css/shell.css mt5-review-system/web/tests/browser/a-ui-visual-consistency.spec.mjs mt5-review-system/web/tests/browser/workspaces.spec.mjs mt5-review-system/web/tests/browser/order-review-workspace.spec.mjs mt5-review-system/web/tests/browser/fluid-luminous-accessibility.spec.mjs
  git commit -m "test: cover Fluid Luminous responsive states"
  ```

### Task 7: Run cross-view verification and prepare release documentation

**Files:**
- Verify: `mt5-review-system/server/tests/`
- Verify: `mt5-review-system/web/tests/`
- Verify: `mt5-review-system/tools/check_release.py`
- Modify only for release preparation: `docs/VERSION-ROUTE.md`, `CHANGELOG.md`, `VERSION`

- [ ] **Step 1: Run the server test suite**

  From `mt5-review-system/server`:

  ```powershell
  python -m unittest discover -s tests -p "test_*.py"
  ```

  Expected result: PASS; UI work must not change server behavior.

- [ ] **Step 2: Run the complete frontend and release checks**

  From `mt5-review-system`:

  ```powershell
  node --test web/tests/*.test.js web/tests/*.test.mjs
  python .\tools\check_release.py
  ```

  Expected result: PASS with no sensitive files staged or included.

- [ ] **Step 3: Perform the cross-view manual check**

  Use one existing test fixture or synthetic non-sensitive record to write through the owning order/review workflow, then verify the same stable ID and value in order list, order detail, dashboard drill-down/related view and compatibility entry. Confirm MT5 and domestic futures platform separation remains intact.

- [ ] **Step 4: Capture visual acceptance evidence**

  Verify desktop and 390px screenshots for dashboard, orders and settings, checking Fluid Luminous hierarchy, tag/menu consistency, screenshot-first order detail, no overlap, no horizontal overflow and reduced-motion behavior. Do not save or commit screenshots containing private user data.

- [ ] **Step 5: Prepare release metadata only after user-facing acceptance**

  Keep `VERSION`, `docs/VERSION-ROUTE.md` and `CHANGELOG.md` unchanged during implementation commits. After visual and functional acceptance selects the release version, update those files together and rerun `check_release.py` before creating the release commit.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-11-04-fluid-luminous-ui-redesign.md`. Two execution options:

1. **Subagent-Driven (recommended):** dispatch a fresh implementation agent per task, review after each task, and keep commits isolated.
2. **Inline Execution:** execute the plan in this session with checkpoints after each task.

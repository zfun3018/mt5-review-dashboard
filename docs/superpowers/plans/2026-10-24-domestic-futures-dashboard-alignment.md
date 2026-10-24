# Domestic Futures Dashboard Alignment Implementation Plan

> **For agentic workers:** Execute the tasks in order. Each task ends with focused tests before moving to the next task.

**Goal:** Make the domestic futures dashboard visually consistent with the shared glass UI and ensure its live GridStack editor, ECharts containers, saved layout, sizing, and content-fit behavior stay aligned.

**Architecture:** Keep the current native HTML/CSS/JavaScript architecture. The live dashboard DOM remains the single module structure for both normal and edit mode; ECharts owns chart rendering and resizing, while GridStack owns position and size. Shared layout definitions, module registry, and live DOM must expose the same module IDs, and each module declares its minimum size and content-fit policy.

**Tech Stack:** Native JavaScript modules, CSS custom properties, ECharts, GridStack, Node test runner, Playwright.

**Spec:** User request in the active conversation; existing dashboard contracts in `docs/plans/2026-10-23-a-plan-progressive-upgrade-proposal.md`.

## Global Constraints

- Keep A-plan dashboard data and metrics sourced from the existing platform-scoped analysis API.
- Keep tables and metric cards as native HTML; every plotted visualization uses ECharts.
- Keep the live domestic dashboard and its editor on the same GridStack module DOM and real chart containers.
- Preserve shared dark glass tokens and current filter behavior.
- Do not read or modify private data, backups, local configuration, screenshots, or raw MT5 events.

---

### Task 1: Lock module, calendar, and layout contracts with tests

**Files:**
- Modify: `mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`
- Modify: `mt5-review-system/web/tests/domestic-futures-charts.test.mjs`
- Modify: `mt5-review-system/web/tests/domestic-futures-layout.test.mjs`
- Modify: `mt5-review-system/web/tests/browser/domestic-futures-dashboard.spec.mjs`

- [x] Assert the domestic dashboard config, module registry, layout definitions, and live module roots contain the same IDs.
- [x] Assert the calendar has no colored cell fills or grid borders, colors P/L labels by sign, and keeps order count/win rate in the tooltip.
- [x] Assert the calendar can use a compact 4×5 minimum and browser checks cover all module fit policies, chart containment, and saved-layout rendering.
- [x] Run the focused Node and desktop Playwright tests and confirm the new assertions fail against current behavior.

### Task 2: Align module definitions and compact calendar rendering

**Files:**
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/dashboard-layout.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-charts.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.css`

- [x] Derive the domestic module ID list from its live module registry and remove the unused heatmap instance from the domestic chart lifecycle.
- [x] Reduce the calendar default and enforced minimum to 4×5 GridStack cells, and migrate the previous default 4×7 footprint while preserving custom heights.
- [x] Render calendar P/L labels in semantic green/red with no cell fill or borders; retain day labels and tooltip details.
- [x] Keep ECharts resizing tied to real container sizes and preserve shared glass tokens.
- [x] Run focused Node tests until the module and chart contracts pass.

### Task 3: Verify real editor and dashboard rendering at minimum sizes

**Files:**
- Modify: `mt5-review-system/web/tests/browser/domestic-futures-dashboard.spec.mjs`

- [x] Resize each module to its declared minimum in edit mode and verify fit/overflow and canvas bounds.
- [x] Save, load the normal dashboard, and compare visible module geometry, content-fit settings, and chart containers with the persisted layout.
- [x] Run desktop and 390px browser checks; confirm there are no console errors or horizontal page overflow.

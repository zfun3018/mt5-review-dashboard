# Domestic Futures Calendar Targets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the domestic futures calendar as a glass monthly review panel with independent daily and monthly P/L targets configured in Settings.

**Architecture:** Keep closed campaigns as the source of truth and extend the existing calendar analysis response with target settings and derived progress. Persist only the two platform-specific target settings in `analysis_settings`; render the left summary and progress with native HTML and the monthly day/P&L grid with the existing ECharts calendar renderer.

**Tech Stack:** Python standard-library HTTP/SQLite services, native HTML/CSS/JavaScript, ECharts, Node tests, Python unittest, Playwright.

---

## Metric and ownership specification

- **Entity owner:** `analysis_settings` owns `domestic_futures_monthly_target_pnl` and `domestic_futures_daily_target_pnl`. These are user preferences, not trade fields.
- **Data source:** Settings API values plus `trade_campaigns` closed analysis rows already used by the calendar metric.
- **Derived view:** Monthly P/L and per-day P/L come from the existing `build_month_calendar`; daily target days count dates with at least one closed campaign whose net P/L meets or exceeds the independently configured daily target. Month completion is calendar month net P/L divided by monthly target. No progress result is persisted.
- **Rebuild rule:** Recompute on every analysis request from current closed campaigns and current settings. Import, correction, deletion, or target changes therefore appear on the next request without a cache invalidation job.
- **Platform scope:** Target settings and target progress apply only to `domestic_futures`. Existing MT5 analysis settings and calendar remain unchanged.
- **Statistical unit:** Closed `trade_campaigns` campaign, aggregated by Beijing close date.
- **Fact time and timezone:** `trade_campaigns.closed_at_utc`, displayed and grouped in `Asia/Shanghai`.
- **Definition version:** Calendar metric version 2 after adding target progress semantics.
- **Sample quality:** `sample_count` is the number of closed campaign rows in the calendar reference population; target-day denominator includes only dates with at least one closed campaign. With no campaigns, progress is unavailable/empty rather than fabricated.
- **Drill-down filter:** `platform=domestic_futures` and selected Beijing calendar month; a day corresponds to the same platform and Beijing close date.

## Manually checkable synthetic dataset

Configure daily target = 100 and monthly target = 500. Use four closed campaigns in Beijing time:

| Beijing close date | Campaign net P/L | Expected day result |
| --- | ---: | --- |
| 2026-10-01 | 120 | Meets daily target |
| 2026-10-01 | -20 | Same day total is 100, meets target |
| 2026-10-03 | 80 | Does not meet target |
| 2026-10-07 | 350 | Meets target |

Expected October month P/L is 530, two of three active trading days meet the daily target, and monthly completion is 106%. The visual bar caps at 100% while its accessible/value label reports 106%. A UTC close at `2026-10-01T16:30:00Z` belongs to Beijing date `2026-10-02` and must not affect October 1.

## Task 1: Persist and validate platform-specific targets

**Files:**
- Modify `mt5-review-system/server/app/data/bootstrap.py`
- Modify `mt5-review-system/server/app/data/catalog_repository.py`
- Modify `mt5-review-system/server/app/data/campaign_commands.py`
- Test `mt5-review-system/server/tests/test_campaign_storage.py`
- Test `mt5-review-system/server/tests/test_campaign_api.py`

Add zero defaults, return both numeric values from GET, and let PATCH update supplied analysis settings without resetting omitted settings. Reject non-finite, negative, and excessively large target values. Keep existing Scratch validation and behavior.

## Task 2: Extend calendar analysis with target progress

**Files:**
- Modify `mt5-review-system/server/app/domain/metrics/calendar.py`
- Modify `mt5-review-system/server/app/application/dashboard_service.py`
- Test `mt5-review-system/server/tests/test_metrics.py`
- Test relevant dashboard API coverage

Add target values and derived completion/day counts to the existing calendar result only for domestic futures. Validate the metric with the synthetic dataset above and include an API assertion that saved targets and derived progress are returned together.

## Task 3: Add Settings controls

**Files:**
- Modify `mt5-review-system/web/settings/index.html`
- Modify `mt5-review-system/web/settings/settings.mjs`
- Modify `mt5-review-system/web/settings/settings.css`
- Test `mt5-review-system/web/tests/settings-workspace.test.mjs`

Add monthly and daily target inputs to Analysis Settings, show them only in the domestic futures workspace, load them from the existing API, validate them, and save them without changing Scratch settings.

## Task 4: Rebuild the monthly calendar panel

**Files:**
- Modify `mt5-review-system/web/dashboard/index.html`
- Modify `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify `mt5-review-system/web/dashboard/domestic-futures-charts.mjs`
- Modify `mt5-review-system/web/dashboard/domestic-futures-dashboard.css`
- Modify `mt5-review-system/web/dashboard/dashboard-layout.mjs`
- Test `mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`
- Test `mt5-review-system/web/tests/domestic-futures-charts.test.mjs`
- Test `mt5-review-system/web/tests/domestic-futures-layout.test.mjs`
- Test `mt5-review-system/web/tests/browser/domestic-futures-dashboard.spec.mjs`

Use a left metrics/targets pane and a right simple horizontal month grid. Apply the shared glass rim/fill/shadow tokens, place the panel in a 6×8 default footprint, and ensure title, target states, day labels, and chart all adapt to desktop and 390px layouts without internal overflow.

## Verification

Run focused Python settings/metrics/API tests, focused Node settings/dashboard/layout/chart tests, `node --check` on changed modules, and the domestic futures Playwright suite on desktop Chromium and mobile-390. Finish with `git diff --check`.

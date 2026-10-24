import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("real domestic futures dashboard defines the account-level module set", async () => {
  const {getDomesticDashboardConfig} = await import(moduleUrl("dashboard/domestic-futures-dashboard.mjs"));
  const config = getDomesticDashboardConfig();
  assert.deepEqual(config.moduleIds, [
    "period-overview",
    "net-performance",
    "risk-health",
    "monthly-pnl",
    "daily-calendar",
    "contract-contribution",
    "contract-losses",
    "data-health",
    "review-coverage",
    "system-evaluation",
    "mode-evaluation",
  ]);
  assert.deepEqual(config.periodLabels, ["昨日", "最近 1 周", "最近 1 月", "最近 3 月", "最近 1 年"]);
  assert.deepEqual(config.filterPresets, [
    {value: "all", label: "全部时间"},
    {value: "today", label: "今日"},
    {value: "7d", label: "近 7 天"},
    {value: "30d", label: "本月"},
    {value: "custom", label: "自定义"},
  ]);
});

test("domestic module config, registry, layout, and live DOM share the same module IDs", async () => {
  const {getDomesticDashboardConfig} = await import(moduleUrl("dashboard/domestic-futures-dashboard.mjs"));
  const {DOMESTIC_FUTURES_DASHBOARD_MODULES} = await import(moduleUrl("dashboard/dashboard-module-registry.mjs"));
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const actualRoots = [...html.matchAll(/<section class="domestic-module[^>]*data-module="([^"]+)"/g)].map((match) => match[1]);
  const configured = getDomesticDashboardConfig().moduleIds;
  const registered = DOMESTIC_FUTURES_DASHBOARD_MODULES.map((item) => item.id);
  const laidOut = getModuleDefinitions("domestic_futures").map((item) => item.id);

  assert.deepEqual(configured, registered);
  assert.deepEqual(configured, laidOut);
  assert.deepEqual(configured, actualRoots);
});

test("risk assessment reports insufficient samples and exposes explainable pressure factors", async () => {
  const {calculateRiskAssessment} = await import(moduleUrl("dashboard/domestic-futures-dashboard.mjs"));

  assert.deepEqual(calculateRiskAssessment({order_count: 0}, {}), {
    level: "insufficient",
    label: "样本不足",
    score: null,
    factors: [],
  });

  const assessment = calculateRiskAssessment(
    {
      order_count: 12,
      trade_pnl: 1000,
      fee_total: -260,
      profit_factor: 0.82,
      win_rate: 0.42,
      gross_loss: 1800,
      max_loss: -900,
    },
    {max_drawdown: 1200, longest_loss_streak: 4},
  );
  assert.equal(assessment.level, "high");
  assert.equal(assessment.label, "压力偏高");
  assert.ok(assessment.factors.some((factor) => factor.key === "drawdown"));
  assert.ok(assessment.factors.some((factor) => factor.key === "fees"));
  assert.ok(assessment.factors.some((factor) => factor.key === "loss_streak"));

  assert.equal(calculateRiskAssessment({order_count: 10, trade_pnl: 500, fee_total: -10, profit_factor: 1.8}, {}).label, "样本有限");
});

test("real dashboard mounts domestic futures modules and opens the live editor", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const css = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-dashboard.css"), "utf8");
  assert.match(html, /id="domesticDashboard"/);
  assert.match(html, /data-domestic-filter/);
  assert.match(html, /index\.html\?platform=domestic_futures&amp;layout=edit/);
  assert.match(html, /id="domesticFixedPeriods"/);
  assert.match(html, /id="domesticMonthlyChart"/);
  assert.match(html, /id="domesticContractContribution" class="domestic-contract-chart"/);
  assert.match(html, /id="domesticCalendarChart"/);
  assert.match(html, /id="domesticRiskGauge"/);
  assert.match(html, /id="domesticRiskFactors"/);
  assert.doesNotMatch(html, /domestic-risk-meter/);
  assert.match(html, /id="domesticContractLosses"/);
  assert.match(html, /data-domestic-preset="all"/);
  assert.match(html, /data-domestic-custom-dates/);
  assert.match(html, /document\.body\.dataset\.platform = platform/);
  assert.match(css, /--domestic-ink:\s*var\(--color-text\)/);
  assert.match(css, /--domestic-panel:\s*var\(--color-surface\)/);
  assert.doesNotMatch(css, /color-scheme:\s*light|#f5f8f7|background:\s*#fbfcfc/);
  assert.doesNotMatch(css, /domestic-risk-meter/);
});

test("dashboard routes each platform to its matching controller", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  assert.match(html, /import \{ createDashboardController \} from "\.\/dashboard\.mjs"/);
  assert.match(html, /createDomesticFuturesDashboardController/);
  assert.match(html, /platform === "domestic_futures"\s*\n\s*\? createDomesticFuturesDashboardController\s*\n\s*:\s*createDashboardController/);
  assert.match(html, /id="mt5DashboardLayout"/);
  assert.match(html, /data-layout-module="equity"/);
});

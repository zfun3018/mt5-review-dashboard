import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

import {renderDashboardModules, setDashboardModulesLoading} from "../dashboard/dashboard-module-runtime.mjs";
import {
  DOMESTIC_FUTURES_DASHBOARD_MODULES,
  MT5_DASHBOARD_MODULES,
} from "../dashboard/dashboard-module-registry.mjs";

test("dashboard module render failures are isolated and reported on the owning module", () => {
  const roots = new Map(["summary", "equity", "calendar"].map((id) => [id, {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  }]));
  const rendered = [];
  const states = renderDashboardModules([
    {id: "summary", rootSelector: "summary"},
    {id: "equity", rootSelector: "equity"},
    {id: "calendar", rootSelector: "calendar"},
  ], {
    findRoot: (selector) => roots.get(selector),
    renderers: {
      summary: () => rendered.push("summary"),
      equity: () => { throw new Error("module error"); },
      calendar: () => rendered.push("calendar"),
    },
  });

  assert.deepEqual(rendered, ["summary", "calendar"]);
  assert.deepEqual(states, {summary: "value", equity: "error", calendar: "value"});
  assert.equal(roots.get("equity").attributes.get("data-module-state"), "error");
  assert.equal(roots.get("summary").attributes.get("data-module-state"), "value");
});

test("a successful retry clears the prior dashboard module error state", () => {
  const root = {
    attributes: new Map([["data-module-state", "error"]]),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };

  renderDashboardModules([{id: "calendar", rootSelector: "calendar"}], {
    findRoot: () => root,
    renderers: {calendar() {}},
  });

  assert.equal(root.attributes.get("data-module-state"), "value");
});

test("platform dashboard registries keep stable module IDs and declare their payload requirements", () => {
  assert.deepEqual(MT5_DASHBOARD_MODULES.map(({id}) => id), [
    "r-metrics", "equity", "calendar", "monthly-pnl", "heatmap", "sessions", "period-overview", "daily-evaluation", "mode-evaluation",
  ]);
  assert.deepEqual(DOMESTIC_FUTURES_DASHBOARD_MODULES.map(({id}) => id), [
    "period-overview", "net-performance", "risk-health", "monthly-pnl", "daily-calendar",
    "contract-contribution", "contract-losses", "data-health", "review-coverage", "system-evaluation", "mode-evaluation",
  ]);
  assert.ok(MT5_DASHBOARD_MODULES.every((item) => item.rootSelector && item.dataRequirements.length));
  assert.ok(DOMESTIC_FUTURES_DASHBOARD_MODULES.every((item) => item.rootSelector && item.dataRequirements.length));

  const dashboardHtml = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dashboard/index.html"), "utf8");
  const metricCatalog = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/metrics/README.md"), "utf8");
  for (const item of [...MT5_DASHBOARD_MODULES, ...DOMESTIC_FUTURES_DASHBOARD_MODULES]) {
    assert.ok(dashboardHtml.includes(item.rootSelector.slice(1, -1)), `missing module host for ${item.id}`);
    if (item.metricKey) assert.ok(metricCatalog.includes(`| ${item.metricKey} |`), `missing metric contract for ${item.metricKey}`);
  }
});

test("module states use server metric status and expose loading while a request is pending", () => {
  const root = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const registry = [{id: "risk", rootSelector: "risk", metricKey: "risk_summary"}];
  const findRoot = () => root;

  setDashboardModulesLoading(registry, {findRoot});
  assert.equal(root.attributes.get("data-module-state"), "loading");
  const states = renderDashboardModules(registry, {
    findRoot,
    metricMeta: {risk_summary: {status: "insufficient_data"}},
    renderers: {risk() {}},
  });
  assert.deepEqual(states, {risk: "insufficient"});
  assert.equal(root.attributes.get("data-module-state"), "insufficient");
});

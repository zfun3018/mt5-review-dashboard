import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MT5 calendar uses its ECharts canvas and no HTML calendar grid", () => {
  const dashboard = fs.readFileSync(path.join(webRoot, "dashboard/dashboard.mjs"), "utf8");
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const styles = fs.readFileSync(path.join(webRoot, "dashboard/dashboard.css"), "utf8");
  const charts = fs.readFileSync(path.join(webRoot, "dashboard/mt5-dashboard-charts.mjs"), "utf8");

  assert.match(html, /id="calendarChart" class="calendar-chart"/);
  assert.match(dashboard, /updateModule\("calendar", payload/);
  assert.match(charts, /coordinateSystem: "calendar"/);
  assert.match(styles, /\.calendar-chart\s*\{/);
  assert.doesNotMatch(html + dashboard, /calendarGrid|day-cell/);
});

test("MT5 evaluation table sticky headers paint an opaque surface above scrolling rows", () => {
  const styles = fs.readFileSync(path.join(webRoot, "dashboard/dashboard.css"), "utf8");
  const headerRule = styles.match(/html\[data-platform="mt5"\] \.evaluation-table thead th\s*\{([^}]+)\}/)?.[1] || "";

  assert.match(headerRule, /position:\s*sticky/);
  assert.match(headerRule, /background:\s*#[\da-f]{6}/i);
  assert.match(headerRule, /z-index:\s*[2-9]\d*/);
});

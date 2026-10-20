import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("net performance chart uses cumulative net pnl as a zero-based time series", async () => {
  const {buildNetPerformanceOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildNetPerformanceOption({
    equity: [
      {time_bj: "2026-10-01T09:00:00", cumulative_return: 120},
      {time_bj: "2026-10-02T09:00:00", cumulative_return: -80},
      {time_bj: "2026-10-03T09:00:00", cumulative_return: 260},
    ],
  });

  assert.deepEqual(option.xAxis.data, ["10-01", "10-02", "10-03"]);
  assert.deepEqual(option.series[0].data, [120, -80, 260]);
  assert.ok(option.yAxis.min < -80);
  assert.ok(option.yAxis.max > 260);
  assert.equal(option.series[0].type, "line");
  assert.equal(option.series[0].smooth, 0.5);
  assert.equal(option.series[0].smoothMonotone, "x");
  assert.equal(option.series[0].sampling, "lttb");
});

test("monthly pnl chart uses a category axis and keeps negative values below zero", async () => {
  const {buildMonthlyPnlOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildMonthlyPnlOption({
    monthly_pnl: [
      {month: "2026-08", net_pnl: 2400},
      {month: "2026-09", net_pnl: -1800},
      {month: "2026-10", net_pnl: 0},
    ],
  });

  assert.deepEqual(option.xAxis.data, ["08月", "09月", "10月"]);
  assert.deepEqual(option.series[0].data, [2400, -1800, 0]);
  assert.ok(option.yAxis.min < -1800);
  assert.ok(option.yAxis.max > 2400);
  assert.equal(option.series[0].type, "bar");
  assert.equal(option.series[0].markLine.data[0].yAxis, 0);
});

test("chart lifecycle initializes, resizes, updates, and disposes chart instances", async () => {
  const {createDomesticFuturesCharts} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const containers = new Map([
    ["domesticNetChart", {id: "domesticNetChart"}],
    ["domesticMonthlyChart", {id: "domesticMonthlyChart"}],
  ]);
  const instances = [];
  const echarts = {
    init(node) {
      const instance = {
        node,
        options: [],
        setOption(option) { this.options.push(option); },
        resizeCount: 0,
        resize() { this.resizeCount += 1; },
        disposeCount: 0,
        dispose() { this.disposeCount += 1; },
      };
      instances.push(instance);
      return instance;
    },
  };
  const observers = [];
  const ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.node = node; }
    disconnect() { this.disconnected = true; }
  };
  const view = {getElementById: (id) => containers.get(id)};
  const charts = createDomesticFuturesCharts({view, echarts, ResizeObserver});

  charts.update({equity: [{time_bj: "2026-10-01", cumulative_return: 10}, {time_bj: "2026-10-02", cumulative_return: 20}], monthly_pnl: [{month: "2026-10", net_pnl: 20}]});
  assert.equal(instances.length, 2);
  assert.equal(instances[0].options.length, 1);
  assert.equal(instances[1].options.length, 1);
  observers.forEach((observer) => observer.callback());
  assert.ok(instances[0].resizeCount >= 2);
  assert.ok(instances[1].resizeCount >= 2);

  charts.dispose();
  assert.equal(instances[0].disposeCount, 1);
  assert.equal(instances[1].disposeCount, 1);
  assert.ok(observers.every((observer) => observer.disconnected));
});

test("dashboard loads the local chart library before the chart controller", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const controller = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-dashboard.mjs"), "utf8");
  const vendor = path.join(webRoot, "vendor/echarts.min.js");
  assert.equal(fs.existsSync(vendor), true);
  assert.match(html, /vendor\/echarts\.min\.js/);
  assert.match(controller, /domestic-futures-charts\.mjs/);
});

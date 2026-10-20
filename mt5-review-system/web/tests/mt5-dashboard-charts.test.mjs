import assert from "node:assert/strict";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("MT5 cumulative chart sorts points by close time before building the option", async () => {
  const {buildMt5EquityOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5EquityOption({
    equity: [
      {time_bj: "2026-10-03T10:00:00+08:00", cumulative_return: 30},
      {time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: 10},
      {time_bj: "2026-10-02T10:00:00+08:00", cumulative_return: -5},
    ],
  });

  assert.deepEqual(option.xAxis.data, [
    "2026-10-01T10:00:00+08:00",
    "2026-10-02T10:00:00+08:00",
    "2026-10-03T10:00:00+08:00",
  ]);
  assert.deepEqual(option.series[0].data, [
    ["2026-10-01T10:00:00+08:00", 10],
    ["2026-10-02T10:00:00+08:00", -5],
    ["2026-10-03T10:00:00+08:00", 30],
  ]);
  assert.ok(option.yAxis.min < -5);
  assert.ok(option.yAxis.max > 30);
  assert.equal(option.series[0].type, "line");
  assert.equal(option.series[0].smooth, 0.5);
  assert.equal(option.series[0].smoothMonotone, "x");
  assert.equal(option.series[0].sampling, "lttb");
});

test("MT5 cumulative chart uses a time axis for ordered points", async () => {
  const {buildMt5EquityOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5EquityOption({
    equity: [{time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: -100}],
  });

  assert.equal(option.xAxis.type, "time");
  assert.deepEqual(option.series[0].data, [["2026-10-01T10:00:00+08:00", -100]]);
});

test("MT5 cumulative chart reduces dense intraday points to daily display closes", async () => {
  const {buildMt5EquityOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5EquityOption({
    equity: [
      {time_bj: "2026-10-01T09:59:59+08:00", cumulative_return: 0, trade_id: "baseline"},
      {time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: 80, trade_id: "T-1"},
      {time_bj: "2026-10-01T11:00:00+08:00", cumulative_return: 20, trade_id: "T-2"},
      {time_bj: "2026-10-02T10:00:00+08:00", cumulative_return: -30, trade_id: "T-3"},
    ],
  });

  assert.deepEqual(option.series[0].data, [
    ["2026-10-01T09:59:59+08:00", 0],
    ["2026-10-01T11:00:00+08:00", 20],
    ["2026-10-02T10:00:00+08:00", -30],
  ]);
});

test("MT5 cumulative chart formats time-axis timestamps as Beijing dates", async () => {
  const {buildMt5EquityOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5EquityOption({
    equity: [{time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: 10}],
  });

  assert.equal(option.xAxis.axisLabel.formatter(Date.parse("2026-10-01T02:00:00Z")), "10-01");
});

test("MT5 monthly chart uses a zero-centered positive and negative bar axis", async () => {
  const {buildMt5MonthlyPnlOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5MonthlyPnlOption({
    monthly_pnl: [
      {month: "2026-08", net_pnl: 2400},
      {month: "2026-09", net_pnl: -1800},
    ],
  });

  assert.deepEqual(option.xAxis.data, ["08月", "09月"]);
  assert.deepEqual(option.series[0].data, [2400, -1800]);
  assert.ok(option.yAxis.min < -1800);
  assert.ok(option.yAxis.max > 2400);
  assert.equal(option.series[0].type, "bar");
});

test("MT5 chart lifecycle uses ECharts and responds to container resize", async () => {
  const {createMt5DashboardCharts} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const containers = new Map([
    ["equityChart", {id: "equityChart"}],
    ["monthlyPnlChart", {id: "monthlyPnlChart"}],
    ["heatmapChart", {id: "heatmapChart"}],
  ]);
  const instances = [];
  const observers = [];
  const echarts = {
    init(node) {
      const instance = {
        node,
        options: [],
        resizeCount: 0,
        setOption(option) { this.options.push(option); },
        resize() { this.resizeCount += 1; },
        disposeCount: 0,
        dispose() { this.disposeCount += 1; },
      };
      instances.push(instance);
      return instance;
    },
  };
  const ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(node) { this.node = node; }
    disconnect() { this.disconnected = true; }
  };
  const view = {getElementById: (id) => containers.get(id)};
  const charts = createMt5DashboardCharts({view, echarts, ResizeObserver});

  charts.update({
    equity: [{time_bj: "2026-10-02", cumulative_return: 20}, {time_bj: "2026-10-01", cumulative_return: 10}],
    monthly_pnl: [{month: "2026-10", net_pnl: 20}],
    heatmap: {days: [], max_abs_pnl: 0},
  });

  assert.equal(instances.length, 3);
  assert.equal(instances[0].options[0].xAxis.data[0], "2026-10-01");
  observers.forEach((observer) => observer.callback());
  assert.ok(instances.every((instance) => instance.resizeCount >= 2));
  charts.dispose();
  assert.ok(instances.every((instance) => instance.disposeCount === 1));
  assert.ok(observers.every((observer) => observer.disconnected));
});

test("MT5 heatmap uses a high-contrast red-white-green scale", async () => {
  const {buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildHeatmapOption({
    heatmap: {
      max_abs_pnl: 100,
      days: [{label: "周一", hours: [{hour: 9, net_pnl: -50, order_count: 2}]}],
    },
  });

  assert.deepEqual(option.visualMap.inRange.color, ["#b4233f", "#ffffff", "#007f73"]);
  assert.equal(option.visualMap.dimension, 2);
});

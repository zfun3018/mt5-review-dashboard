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
  assert.equal(option.yAxis.axisLabel.formatter(1500), "$1.5k");
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

test("charts omit missing equity and monthly values instead of plotting zero", async () => {
  const {buildMt5EquityOption, buildMt5MonthlyPnlOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const equity = buildMt5EquityOption({
    equity: [
      {time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: 10},
      {time_bj: "2026-10-02T10:00:00+08:00", cumulative_return: null},
      {time_bj: "2026-10-03T10:00:00+08:00"},
    ],
  });
  const monthly = buildMt5MonthlyPnlOption({
    monthly_pnl: [
      {month: "2026-10", net_pnl: 20},
      {month: "2026-11", net_pnl: null},
    ],
  });

  assert.deepEqual(equity.series[0].data, [["2026-10-01T10:00:00+08:00", 10]]);
  assert.deepEqual(monthly.series[0].data, [20]);
  assert.deepEqual(monthly.xAxis.data, ["10月"]);
});

test("heatmap omits cells with missing server values instead of plotting zero", async () => {
  const {buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildHeatmapOption({
    heatmap: {
      max_abs_pnl: 100,
      days: [{
        label: "周一",
        hours: [
          {hour: 9, net_pnl: 50, order_count: 2},
          {hour: 10, net_pnl: null, order_count: 2},
          {hour: 11, net_pnl: -20},
        ],
      }],
    },
  });

  assert.deepEqual(option.series[0].data, [[9, 0, 50, 2]]);
});

test("chart metric states suppress zero placeholders and show the server state", async () => {
  const {buildMt5EquityOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const {buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const equity = buildMt5EquityOption({
    equity: [{time_bj: "2026-10-01T10:00:00+08:00", cumulative_return: 0}],
    metric_meta: {equity_curve: {status: "insufficient_data"}},
  });
  const heatmap = buildHeatmapOption({
    heatmap: {max_abs_pnl: 100, days: [{label: "周一", hours: [{hour: 9, net_pnl: 50, order_count: 1}]}]},
    metric_meta: {hour_heatmap: {status: "not_applicable"}},
  });

  assert.deepEqual(equity.series[0].data, []);
  assert.match(equity.graphic[0].style.text, /样本不足/);
  assert.deepEqual(heatmap.series[0].data, []);
  assert.match(heatmap.graphic[0].style.text, /不适用/);
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

test("MT5 trading system evaluation uses six independent ECharts small multiples with readable period values", async () => {
  const {buildMt5SystemEvaluationOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5SystemEvaluationOption({periods: {
    yesterday: {net_pnl: -40, order_count: 3, payoff_ratio: 0.8, r_metrics: {complete_count: 3, decisive_win_rate: 1 / 3, expectancy_r: -0.2, sqn: null, sqn_status: "insufficient_sample"}},
    last_7_days: {net_pnl: 120, order_count: 8, payoff_ratio: 1.8, r_metrics: {complete_count: 8, decisive_win_rate: 0.625, expectancy_r: 0.4, sqn: null, sqn_status: "insufficient_sample"}},
    last_30_days: {net_pnl: 80, order_count: 20, payoff_ratio: 1.2, r_metrics: {complete_count: 20, decisive_win_rate: 0.55, expectancy_r: 0.15, sqn: null, sqn_status: "insufficient_sample"}},
    last_365_days: {net_pnl: -250, order_count: 140, payoff_ratio: 0.9, r_metrics: {complete_count: 140, decisive_win_rate: 0.48, expectancy_r: -0.05, sqn: 1.12, sqn_status: "available"}},
  }});

  const labels = ["总盈亏", "交易笔数", "净盈亏比", "净胜率", "数学期望", "收益稳定度"];
  const periods = ["昨日", "近 7 天", "近 30 天", "近 365 天"];
  assert.equal(option.grid.length, 6);
  assert.equal(option.title.length, 6);
  assert.deepEqual(option.title.map((item) => item.text), labels);
  assert.equal(option.xAxis.length, 6);
  assert.equal(option.yAxis.length, 6);
  assert.equal(option.series.length, 6);
  for (const [index, series] of option.series.entries()) {
    assert.equal(series.type, "bar");
    assert.equal(series.xAxisIndex, index);
    assert.equal(series.yAxisIndex, index);
    assert.equal(series.data.length, 4);
    assert.deepEqual(series.data.map((item) => item.periodLabel), periods);
    assert.ok(series.data.every((item) => item.label));
  }
  const pnl = option.series[0];
  assert.ok(option.xAxis[0].min < 0 && option.xAxis[0].max > 0);
  assert.equal(pnl.data.find((item) => item.periodKey === "last_7_days").label, "$120.00");
  const count = option.series[1].data.find((item) => item.periodKey === "last_7_days");
  assert.equal(count.label, "8");
  assert.equal(count.itemStyle.color, "rgba(118, 178, 255, 0.72)");
  assert.equal(option.series[2].markLine.data[0].xAxis, 1);
  assert.equal(option.series[3].data.find((item) => item.periodKey === "last_7_days").label, "63%");
  assert.equal(option.series[4].data.find((item) => item.periodKey === "last_7_days").label, "+0.40R");
  const insufficientSqn = option.series[5].data.find((item) => item.periodKey === "last_7_days");
  assert.equal(insufficientSqn.label, "样本不足");
  assert.equal(insufficientSqn.value, 0);
  assert.equal(insufficientSqn.itemStyle.opacity, 0);
  const narrowOption = buildMt5SystemEvaluationOption({periods: {
    yesterday: {net_pnl: -40, order_count: 3, payoff_ratio: 0.8, r_metrics: {complete_count: 3, decisive_win_rate: 1 / 3, expectancy_r: -0.2, sqn_status: "insufficient_sample"}},
    last_7_days: {net_pnl: 120, order_count: 8, payoff_ratio: 1.8, r_metrics: {complete_count: 8, decisive_win_rate: 0.625, expectancy_r: 0.4, sqn_status: "insufficient_sample"}},
    last_30_days: {net_pnl: 80, order_count: 20, payoff_ratio: 1.2, r_metrics: {complete_count: 20, decisive_win_rate: 0.55, expectancy_r: 0.15, sqn_status: "insufficient_sample"}},
    last_365_days: {net_pnl: -250, order_count: 140, payoff_ratio: 0.9, r_metrics: {complete_count: 140, decisive_win_rate: 0.48, expectancy_r: -0.05, sqn: 1.12, sqn_status: "available"}},
  }}, 390);
  assert.ok(narrowOption.grid.every((grid) => grid.left === "0%"));
  assert.ok(Number.parseFloat(narrowOption.grid[1].top) > Number.parseFloat(narrowOption.grid[0].top));
  const tooltip = option.tooltip.formatter({data: option.series[5].data.find((item) => item.periodKey === "last_365_days")});
  assert.match(tooltip, /近 365 天/);
  assert.match(tooltip, /收益稳定度/);
  assert.match(tooltip, /SQN；至少需要 30 个有效 R 样本/);
  assert.match(tooltip, /1\.12/);
});

test("MT5 trading system evaluation marks an unavailable period payload instead of showing fake zeros", async () => {
  const {buildMt5SystemEvaluationOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5SystemEvaluationOption({periods: {today: {}, week: {}, month: {}, year: {}}});

  assert.equal(option.series.length, 6);
  assert.ok(option.series.every((series) => series.data.length === 4));
  assert.ok(option.series.every((series) => series.data.every((item) => item.label === "—" && item.available === false && item.itemStyle.opacity === 0)));
  assert.match(option.graphic[0].style.text, /周期数据尚未加载/);
});

test("MT5 calendar is rendered by ECharts and preserves the full monthly day range", async () => {
  const {buildMt5CalendarOption} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const option = buildMt5CalendarOption({calendar: {
    year: 2026,
    month: 10,
    days: {
      "2026-10-01": {label: "2026-10-01", net_pnl: 5.5, order_count: 4, win_rate: 0.75},
      "2026-10-02": {label: "2026-10-02", net_pnl: -6.4, order_count: 3, win_rate: 2 / 3},
    },
  }});

  assert.deepEqual(option.calendar.range, ["2026-10-01", "2026-10-31"]);
  assert.equal(option.calendar.orient, "vertical");
  assert.equal(option.calendar.cellSize[0], "auto");
  assert.equal(option.calendar.cellSize[1], 26);
  assert.equal(option.calendar.splitLine.show, false);
  assert.equal(option.calendar.itemStyle.color, "transparent");
  assert.equal(option.series[0].type, "heatmap");
  assert.equal(option.series[0].coordinateSystem, "calendar");
  assert.deepEqual(option.series[0].data.slice(0, 2), [
    ["2026-10-01", 5.5, 4, 0.75],
    ["2026-10-02", -6.4, 3, 2 / 3],
  ]);
  assert.equal(option.tooltip.trigger, "item");
  const tooltip = option.tooltip.formatter({value: ["2026-10-02", -6.4, 3, 2 / 3]});
  assert.match(tooltip, /\$6/);
  assert.match(tooltip, /3 单/);
  assert.match(tooltip, /胜率：67%/);
  assert.equal(option.series[0].label.show, true);
  const label = option.series[0].label.formatter({value: ["2026-10-02", -6.4, 3, 2 / 3]});
  assert.equal(label, "{day|02}\n{loss|-$6}");
  assert.doesNotMatch(label, /\\n/);
  assert.equal(option.series[0].label.rich.loss.color, "#ff7d88");
  assert.equal(option.series[0].label.rich.profit.color, "#69d6ab");
  assert.equal(option.series[0].itemStyle.color, "transparent");
  assert.equal(option.series[0].itemStyle.borderWidth, 0);
  assert.equal(option.series[0].label.formatter({value: ["2026-10-01", 5.5, 4, 0.75]}), "{day|01}\n{profit|$6}");
  assert.equal(option.series[0].label.formatter({value: ["2026-10-03", 0, 0, 0]}), "{day|03}\n{flat|—}");
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

test("one failed chart renderer does not prevent other dashboard charts from updating", async () => {
  const {createMt5DashboardCharts} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const containers = new Map(["equityChart", "monthlyPnlChart", "heatmapChart"].map((id) => [id, {
    id,
    dataset: {},
    textContent: "",
    replaceChildren() {},
  }]));
  const instances = [];
  const echarts = {
    init(node) {
      const instance = {
        node,
        options: [],
        setOption(option) {
          if (node.id === "equityChart") throw new Error("chart renderer unavailable");
          this.options.push(option);
        },
        resize() {},
        dispose() {},
      };
      instances.push(instance);
      return instance;
    },
  };
  const charts = createMt5DashboardCharts({
    view: {getElementById: (id) => containers.get(id)},
    echarts,
    ResizeObserver: null,
  });

  assert.doesNotThrow(() => charts.update({equity: [], monthly_pnl: [], heatmap: {days: []}}));
  assert.equal(instances[1].options.length, 1);
  assert.equal(instances[2].options.length, 1);
  assert.equal(containers.get("equityChart").dataset.chartState, "error");
  assert.deepEqual(charts.getStates(), {equity: "error", monthlyPnl: "value", heatmap: "value"});

  charts.dispose();
});

test("MT5 chart disposal isolates cleanup failures and remains idempotent", async () => {
  const {createMt5DashboardCharts} = await import(moduleUrl("dashboard/mt5-dashboard-charts.mjs"));
  const containers = new Map(["equityChart", "monthlyPnlChart", "heatmapChart"].map((id) => [id, {id, dataset: {}}]));
  const disposed = [];
  const echarts = {
    init(node) {
      return {
        setOption() {},
        resize() {},
        dispose() {
          disposed.push(node.id);
          if (node.id === "equityChart") throw new Error("dispose failed");
        },
      };
    },
  };
  const charts = createMt5DashboardCharts({view: {getElementById: (id) => containers.get(id)}, echarts, ResizeObserver: null});

  assert.doesNotThrow(() => charts.dispose());
  assert.doesNotThrow(() => charts.dispose());
  assert.deepEqual(disposed.sort(), ["equityChart", "heatmapChart", "monthlyPnlChart"]);
});

test("MT5 heatmap uses the shared high-contrast dark red-neutral-green scale", async () => {
  const {buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildHeatmapOption({
    heatmap: {
      max_abs_pnl: 100,
      days: [{label: "周一", hours: [{hour: 9, net_pnl: -50, order_count: 2}]}],
    },
  });

  assert.deepEqual(option.visualMap.inRange.color, ["#a84856", "#222831", "#69d6ab"]);
  assert.equal(option.visualMap.dimension, 2);
});

test("MT5 heatmap uses the backend date and weekday labels", async () => {
  const {buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildHeatmapOption({
    heatmap: {
      max_abs_pnl: 100,
      days: [
        {date: "2026-10-19", label: "10月19日 周一", hours: [{hour: 9, net_pnl: 50, order_count: 1}]},
        {date: "2026-10-20", label: "10月20日 周二", hours: [{hour: 9, net_pnl: -25, order_count: 1}]},
      ],
    },
  });

  assert.deepEqual(option.yAxis.data, ["10月19日 周一", "10月20日 周二"]);
  assert.match(option.tooltip.formatter({value: [9, 0, 50, 1]}), /10月19日 周一/);
});

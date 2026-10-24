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

test("A-plan charts use the dark graphite palette with readable axis contrast", async () => {
  const {buildNetPerformanceOption, buildHeatmapOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const equity = buildNetPerformanceOption({
    equity: [
      {time_bj: "2026-10-01T09:00:00", cumulative_return: 0},
      {time_bj: "2026-10-02T09:00:00", cumulative_return: 120},
    ],
  });
  const heatmap = buildHeatmapOption({heatmap: {max_abs_pnl: 100, days: []}});

  assert.equal(equity.xAxis.axisLabel.color, "#8d96a3");
  assert.equal(equity.series[0].lineStyle.color, "#69d6ab");
  assert.equal(equity.series[0].areaStyle.color, "rgba(105, 214, 171, 0.13)");
  assert.deepEqual(heatmap.visualMap.inRange.color, ["#a84856", "#222831", "#69d6ab"]);
  assert.equal(heatmap.xAxis.axisLine.lineStyle.color, "rgba(255, 255, 255, 0.12)");
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

test("monthly futures chart separates profitable and losing product stacks and overlays net pnl", async () => {
  const {buildMonthlyPnlOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildMonthlyPnlOption({monthly_pnl: [
    {month: "2026-08", net_pnl: 1900, product_pnl: [
      {product_name: "玻璃", net_pnl: 2000},
      {product_name: "螺纹钢", net_pnl: -100},
    ]},
    {month: "2026-09", net_pnl: -1800, product_pnl: [
      {product_name: "玻璃", net_pnl: -2000},
      {product_name: "螺纹钢", net_pnl: 200},
    ]},
  ]});

  const profitBars = option.series.filter((series) => series.stack === "monthly-profit");
  const lossBars = option.series.filter((series) => series.stack === "monthly-loss");
  const netLine = option.series.find((series) => series.name === "月度净盈亏");
  const totals = option.series.filter((series) => ["盈利汇总金额", "亏损汇总金额"].includes(series.name));

  assert.deepEqual(option.legend.data, ["玻璃", "螺纹钢", "月度净盈亏"]);
  assert.equal(profitBars.length, 2);
  assert.equal(lossBars.length, 2);
  assert.equal(profitBars.every((series) => series.type === "bar"), true);
  assert.equal(lossBars.every((series) => series.type === "bar"), true);
  assert.deepEqual(profitBars.map((series) => series.data.map((item) => item.value)), [[2000, 0], [0, 200]]);
  assert.deepEqual(lossBars.map((series) => series.data.map((item) => item.value)), [[0, -2000], [-100, 0]]);
  assert.deepEqual(profitBars.map((series) => series.label.formatter), ["玻璃", "螺纹钢"]);
  assert.deepEqual(lossBars.map((series) => series.label.formatter), ["玻璃", "螺纹钢"]);
  assert.deepEqual(profitBars.map((series) => series.data.map((item) => item.label.show)), [[true, false], [false, true]]);
  assert.deepEqual(lossBars.map((series) => series.data.map((item) => item.label.show)), [[false, true], [true, false]]);
  assert.deepEqual(totals.map((series) => series.name), ["盈利汇总金额", "亏损汇总金额"]);
  assert.deepEqual(totals.map((series) => series.data.map((item) => item.value[1])), [[2000, 200], [-100, -2000]]);
  assert.equal(totals[0].data[0].label.formatter, "+¥2,000");
  assert.equal(totals[1].data[0].label.formatter, "−¥100");
  assert.equal(netLine.type, "line");
  assert.deepEqual(netLine.data, [1900, -1800]);
  assert.deepEqual(option.xAxis.data, ["08月", "09月"]);
  assert.equal(option.tooltip.trigger, "item");
  const positiveTooltip = option.tooltip.formatter({dataIndex: 0, seriesIndex: 0, seriesName: "玻璃", value: 2000});
  assert.equal(positiveTooltip, "+¥2,000");
  const negativeTooltip = option.tooltip.formatter({dataIndex: 1, seriesIndex: 1, seriesName: "玻璃", value: -2000});
  assert.equal(negativeTooltip, "−¥2,000");
});

test("monthly futures chart folds long product tails into both stacks and conserves monthly pnl", async () => {
  const {buildMonthlyPnlOption} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const products = Array.from({length: 9}, (_, index) => ({product_name: `品种${index + 1}`, net_pnl: index + 1}));
  const option = buildMonthlyPnlOption({monthly_pnl: [{month: "2026-10", net_pnl: 45, product_pnl: products}]});

  const otherBars = option.series.filter((series) => series.name === "其他品种");
  assert.equal(option.series.length, 21);
  assert.equal(otherBars.length, 2);
  assert.equal(otherBars.find((series) => series.stack === "monthly-profit").data[0].value, 1);
  assert.equal(otherBars.find((series) => series.stack === "monthly-loss").data[0].value, 0);
  assert.equal(option.series.find((series) => series.name === "月度净盈亏").data[0], 45);
});

test("risk assessment is rendered as an ECharts pressure gauge without fabricating a score", async () => {
  const {buildRiskGaugeOption, DOMESTIC_CHART_DEFINITIONS} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const gauge = buildRiskGaugeOption({level: "high", label: "压力偏高", score: 88});
  const empty = buildRiskGaugeOption({level: "insufficient", label: "样本不足", score: null});

  assert.equal(gauge.series[0].type, "gauge");
  assert.equal(gauge.series[0].max, 100);
  assert.equal(gauge.series[0].data[0].value, 88);
  assert.equal(gauge.series[0].progress.show, true);
  assert.equal(gauge.series[0].progress.itemStyle.color, "#ff7d88");
  assert.deepEqual(empty.series[0].data, []);
  assert.match(empty.graphic[0].style.text, /样本不足/);
  assert.deepEqual(DOMESTIC_CHART_DEFINITIONS.map((item) => item.key), ["netPerformance", "monthlyPnl", "calendar", "riskGauge", "contractContribution", "contractLosses"]);
});

test("contract contribution uses a basic Nightingale rose chart with signed values in its tooltip", async () => {
  const {buildContractContributionOption, DOMESTIC_CHART_DEFINITIONS} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildContractContributionOption({contract_rankings: {contribution: [
    {contract_name: "豆粕2701", product_name: "豆粕", order_count: 2, net_pnl: 173.96},
    {contract_name: "PVC2701", product_name: "PVC", order_count: 7, net_pnl: -344.14},
    {contract_name: "玉米2611", product_name: "玉米", order_count: 1, net_pnl: 0},
  ]}});
  const series = option.series[0];

  assert.equal(series.type, "pie");
  assert.equal(series.roseType, "radius");
  assert.equal(series.data.length, 1);
  assert.deepEqual(series.data.map(({name, value}) => [name, value]), [["豆粕2701", 173.96]]);
  assert.ok(series.data.every(({netPnl}) => netPnl > 0));
  assert.equal(series.data[0].netPnl, 173.96);
  assert.equal(series.data[0].orderCount, 2);
  assert.equal(series.data[0].itemStyle.color, "#69d6ab");
  assert.equal(series.label.formatter({data: series.data[0]}), "豆粕2701\n+¥173.96");
  assert.match(option.tooltip.formatter({data: series.data[0]}), /豆粕2701.*2 笔.*\+¥173.96/);
  assert.equal(DOMESTIC_CHART_DEFINITIONS.find(({key}) => key === "contractContribution").elementId, "domesticContractContribution");

  const empty = buildContractContributionOption({contract_rankings: {contribution: [
    {contract_name: "玉米2611", net_pnl: 0},
    {contract_name: "PVC2701", net_pnl: -344.14},
  ]}});
  assert.deepEqual(empty.series[0].data, []);
  assert.match(empty.graphic[0].style.text, /暂无盈利合约/);
});

test("contract losses use a product-colored treemap with loss magnitude as area", async () => {
  const {buildContractLossesTreemapOption, DOMESTIC_CHART_DEFINITIONS} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const option = buildContractLossesTreemapOption({contract_rankings: {losses: [
    {contract_name: "PVC2701", product_name: "PVC", order_count: 7, net_pnl: -344.14},
    {contract_name: "乙烯2611", product_name: "苯乙烯", order_count: 2, net_pnl: -149.04},
    {contract_name: "PVC2705", product_name: "PVC", order_count: 1, net_pnl: -18},
  ]}});
  const series = option.series[0];

  assert.equal(series.type, "treemap");
  assert.deepEqual(series.data.map(({name, value}) => [name, value]), [["PVC2701", 344.14], ["乙烯2611", 149.04], ["PVC2705", 18]]);
  assert.equal(series.data[0].itemStyle.color, series.data[2].itemStyle.color);
  assert.notEqual(series.data[0].itemStyle.color, series.data[1].itemStyle.color);
  assert.equal(series.data[0].productName, "PVC");
  assert.equal(series.data[0].orderCount, 7);
  assert.match(option.tooltip.formatter({data: series.data[0]}), /PVC.*PVC2701.*7 笔.*−¥344.14/);
  assert.equal(DOMESTIC_CHART_DEFINITIONS.find(({key}) => key === "contractLosses").elementId, "domesticContractLosses");

  const empty = buildContractLossesTreemapOption({contract_rankings: {losses: [{contract_name: "豆粕2701", net_pnl: 10}]}});
  assert.deepEqual(empty.series[0].data, []);
  assert.match(empty.graphic[0].style.text, /暂无亏损合约/);
});

test("domestic calendar uses clean colored P/L labels and keeps counts in the tooltip", async () => {
  const {buildDomesticCalendarOption, DOMESTIC_CHART_DEFINITIONS} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const calendar = buildDomesticCalendarOption({calendar: {
    year: 2026, month: 10, month_net_pnl: 120, month_order_count: 2, month_win_rate: 0.5,
    days: {
      "2026-10-03": {label: "2026-10-03", net_pnl: 120, order_count: 2, win_rate: 0.5},
      "2026-10-04": {label: "2026-10-04", net_pnl: -50, order_count: 1, win_rate: 0},
    },
  }});

  assert.equal(calendar.calendar.range[0], "2026-10-01");
  assert.equal(calendar.calendar.orient, "vertical");
  assert.equal(calendar.calendar.dayLabel.firstDay, 1);
  assert.equal(calendar.calendar.dayLabel.fontSize, 12);
  assert.equal(calendar.series[0].coordinateSystem, "calendar");
  assert.deepEqual(calendar.series[0].data[0], ["2026-10-03", 120, 2, 0.5]);
  assert.equal(calendar.calendar.splitLine.show, false);
  assert.equal(calendar.calendar.itemStyle.color, "transparent");
  assert.equal(calendar.calendar.itemStyle.borderWidth, 0);
  assert.equal(calendar.series[0].itemStyle.color, "transparent");
  assert.equal(calendar.series[0].itemStyle.borderWidth, 0);
  assert.equal(calendar.series[0].label.rich.profit.color, "#69d6ab");
  assert.equal(calendar.series[0].label.rich.loss.color, "#ff7d88");
  assert.equal(calendar.series[0].label.rich.day.fontSize, 11);
  assert.equal(calendar.series[0].label.rich.profit.fontSize, 11);
  assert.equal(calendar.series[0].label.formatter({value: ["2026-10-03", 120, 2, 0.5]}), "{day|03}\n{profit|+¥120}");
  assert.equal(calendar.series[0].label.formatter({value: ["2026-10-04", -50, 1, 0]}), "{day|04}\n{loss|-¥50}");
  assert.match(calendar.tooltip.formatter({value: ["2026-10-03", 120, 2, 0.5]}), /2 笔 · 胜率 50%/);
  assert.deepEqual(DOMESTIC_CHART_DEFINITIONS.map((item) => item.key), ["netPerformance", "monthlyPnl", "calendar", "riskGauge", "contractContribution", "contractLosses"]);
});

test("chart lifecycle initializes, resizes, updates, and disposes chart instances", async () => {
  const {createDomesticFuturesCharts} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const containers = new Map([
    ["domesticNetChart", {id: "domesticNetChart"}],
    ["domesticMonthlyChart", {id: "domesticMonthlyChart"}],
    ["domesticCalendarChart", {id: "domesticCalendarChart"}],
    ["domesticRiskGauge", {id: "domesticRiskGauge"}],
    ["domesticContractContribution", {id: "domesticContractContribution"}],
    ["domesticContractLosses", {id: "domesticContractLosses"}],
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

  charts.update({
    equity: [{time_bj: "2026-10-01", cumulative_return: 10}, {time_bj: "2026-10-02", cumulative_return: 20}],
    monthly_pnl: [{month: "2026-10", net_pnl: 20}],
    calendar: {year: 2026, month: 10, days: {}},
  });
  assert.equal(instances.length, 6);
  assert.equal(instances[0].options.length, 1);
  assert.equal(instances[1].options.length, 1);
  assert.equal(instances[4].options.length, 1);
  assert.equal(instances[5].options.length, 1);
  observers.forEach((observer) => observer.callback());
  assert.ok(instances[0].resizeCount >= 2);
  assert.ok(instances.every((instance) => instance.resizeCount >= 2));

  charts.dispose();
  assert.equal(instances[0].disposeCount, 1);
  assert.equal(instances[1].disposeCount, 1);
  assert.ok(observers.every((observer) => observer.disconnected));
});

test("one failed domestic chart renderer does not block the other module", async () => {
  const {createDomesticFuturesCharts} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const containers = new Map(["domesticNetChart", "domesticMonthlyChart", "domesticCalendarChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"].map((id) => [id, {id, dataset: {}}]));
  const instances = [];
  const echarts = {
    init(node) {
      const instance = {
        node,
        options: [],
        setOption(option) {
          if (node.id === "domesticNetChart") throw new Error("renderer unavailable");
          this.options.push(option);
        },
        resize() {},
        dispose() {},
      };
      instances.push(instance);
      return instance;
    },
  };
  const charts = createDomesticFuturesCharts({
    view: {getElementById: (id) => containers.get(id)},
    echarts,
    ResizeObserver: null,
  });

  assert.doesNotThrow(() => charts.update({equity: [], monthly_pnl: []}));
  assert.equal(instances[1].options.length, 1);
  assert.deepEqual(charts.getStates(), {netPerformance: "error", monthlyPnl: "value", calendar: "value", riskGauge: "value", contractContribution: "value", contractLosses: "value"});
  charts.dispose();
});

test("domestic chart disposal isolates cleanup failures and remains idempotent", async () => {
  const {createDomesticFuturesCharts} = await import(moduleUrl("dashboard/domestic-futures-charts.mjs"));
  const containers = new Map(["domesticNetChart", "domesticMonthlyChart", "domesticCalendarChart", "domesticRiskGauge", "domesticContractContribution", "domesticContractLosses"].map((id) => [id, {id, dataset: {}}]));
  const disposed = [];
  const echarts = {
    init(node) {
      return {
        setOption() {},
        resize() {},
        dispose() {
          disposed.push(node.id);
          if (node.id === "domesticNetChart") throw new Error("dispose failed");
        },
      };
    },
  };
  const charts = createDomesticFuturesCharts({view: {getElementById: (id) => containers.get(id)}, echarts, ResizeObserver: null});

  assert.doesNotThrow(() => charts.dispose());
  assert.doesNotThrow(() => charts.dispose());
  assert.deepEqual(disposed.sort(), ["domesticCalendarChart", "domesticContractContribution", "domesticContractLosses", "domesticMonthlyChart", "domesticNetChart", "domesticRiskGauge"]);
});

test("dashboard loads the local chart library before the chart controller", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const controller = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-dashboard.mjs"), "utf8");
  const vendor = path.join(webRoot, "vendor/echarts.min.js");
  assert.equal(fs.existsSync(vendor), true);
  assert.match(html, /vendor\/echarts\.min\.js/);
  assert.match(controller, /domestic-futures-charts\.mjs/);
});

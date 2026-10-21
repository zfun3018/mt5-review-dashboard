import {
  buildHeatmapOption,
  buildMonthlyPnlOption,
  chartMetricState,
  collapseEquityPointsByBeijingDay,
  formatEquityAxisDate,
} from "./domestic-futures-charts.mjs";

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function sortByTime(rows = []) {
  return [...rows].sort((left, right) => Date.parse(String(left?.time_bj || left?.time_utc || "")) - Date.parse(String(right?.time_bj || right?.time_utc || "")));
}

function axisBounds(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return {min: -1, max: 1};
  const min = Math.min(...finite, 0);
  const max = Math.max(...finite, 0);
  const padding = Math.max(max - min, 1) * 0.08;
  return {min: min - padding, max: max + padding};
}

function compactAxisValue(value) {
  const amount = toFiniteNumber(value);
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  if (absolute >= 10000) return `${sign}¥${(absolute / 10000).toFixed(1)}万`;
  if (absolute >= 1000) return `${sign}¥${(absolute / 1000).toFixed(1)}k`;
  return `${sign}¥${Math.round(absolute).toLocaleString("zh-CN")}`;
}

export function buildMt5EquityOption(payload = {}) {
  const state = chartMetricState(payload, "equity_curve");
  const points = state ? [] : collapseEquityPointsByBeijingDay(sortByTime(Array.isArray(payload.equity) ? payload.equity : []));
  const values = points.map((point) => toFiniteNumber(point.cumulative_return));
  const bounds = axisBounds(values);
  return {
    animation: false,
    grid: {left: 54, right: 18, top: 20, bottom: 32, containLabel: true},
    tooltip: {trigger: "axis", axisPointer: {type: "line"}, valueFormatter: compactAxisValue},
    xAxis: {
      type: "time",
      data: points.map((point) => String(point.time_bj || point.time_utc || "")),
      boundaryGap: false,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "#dbe6e4"}},
      axisLabel: {color: "#91a1a3", hideOverlap: true, formatter: formatEquityAxisDate},
    },
    yAxis: {
      type: "value",
      min: bounds.min,
      max: bounds.max,
      axisLabel: {color: "#91a1a3", formatter: compactAxisValue},
      axisLine: {show: false},
      axisTick: {show: false},
      splitLine: {lineStyle: {color: "#e8efed", type: "dashed"}},
    },
    series: [{
      name: "累计净盈亏",
      type: "line",
      data: points.map((point) => [String(point.time_bj || point.time_utc || ""), toFiniteNumber(point.cumulative_return)]),
      smooth: 0.5,
      smoothMonotone: "x",
      sampling: "lttb",
      symbol: "none",
      emphasis: {symbol: "circle", symbolSize: 6},
      itemStyle: {color: "#069d91"},
      lineStyle: {color: "#069d91", width: 3},
      areaStyle: {color: "rgba(6, 157, 145, 0.13)"},
      markLine: {silent: true, symbol: "none", label: {show: false}, lineStyle: {color: "#b8c9c5", type: "dashed"}, data: [{yAxis: 0}]},
    }],
    graphic: points.length < 2 ? [{type: "text", left: "center", top: "middle", style: {text: state?.label || "当前范围暂无累计曲线", fill: "#6d7e83", fontSize: 12}}] : [],
  };
}

export const MT5_CHART_DEFINITIONS = Object.freeze([
  {key: "equity", elementId: "equityChart", buildOption: buildMt5EquityOption},
  {key: "monthlyPnl", elementId: "monthlyPnlChart", buildOption: buildMonthlyPnlOption},
  {key: "heatmap", elementId: "heatmapChart", buildOption: buildHeatmapOption},
]);

export function buildMt5MonthlyPnlOption(payload = {}) {
  return buildMonthlyPnlOption(payload);
}

export function createMt5DashboardCharts({
  view = globalThis.document,
  echarts = globalThis.echarts,
  ResizeObserver = globalThis.ResizeObserver,
} = {}) {
  const entries = MT5_CHART_DEFINITIONS
    .map((definition) => ({...definition, node: view?.getElementById?.(definition.elementId)}))
    .filter((entry) => entry.node && !entry.node.closest?.("[hidden]"));
  const instances = new Map();
  const observers = [];
  const resizeTarget = globalThis.window;

  if (!echarts?.init) return {update() {}, resize() {}, dispose() {}};

  entries.forEach((entry) => {
    const instance = echarts.init(entry.node, null, {renderer: "canvas"});
    instances.set(entry.key, instance);
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => instance.resize({animation: false}));
      observer.observe(entry.node);
      observers.push(observer);
    }
  });

  const resize = () => instances.forEach((instance) => instance.resize({animation: false}));
  if (!observers.length && resizeTarget?.addEventListener) resizeTarget.addEventListener("resize", resize);

  return {
    update(payload = {}) {
      entries.forEach((entry) => {
        instances.get(entry.key)?.setOption(entry.buildOption(payload), {notMerge: true, lazyUpdate: false});
      });
      resize();
    },
    resize,
    dispose() {
      observers.forEach((observer) => observer.disconnect());
      if (!observers.length && resizeTarget?.removeEventListener) resizeTarget.removeEventListener("resize", resize);
      instances.forEach((instance) => instance.dispose());
      instances.clear();
    },
  };
}

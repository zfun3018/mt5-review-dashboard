import {
  buildHeatmapOption,
  buildMonthlyPnlOption,
  chartMetricState,
  collapseEquityPointsByBeijingDay,
  formatEquityAxisDate,
} from "./domestic-futures-charts.mjs";
import {formatMoney} from "../shared/js/formatters.mjs";

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
  if (absolute >= 10000) return `${sign}$${Math.round(absolute / 1000)}k`;
  if (absolute >= 1000) return `${sign}$${(absolute / 1000).toFixed(1)}k`;
  return `${sign}$${Math.round(absolute).toLocaleString("en-US")}`;
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
      axisLine: {show: false},
      axisLabel: {color: "#8d96a3", hideOverlap: true, formatter: formatEquityAxisDate},
    },
    yAxis: {
      type: "value",
      min: bounds.min,
      max: bounds.max,
      axisLabel: {color: "#8d96a3", formatter: compactAxisValue},
      axisLine: {show: false},
      axisTick: {show: false},
      splitLine: {show: false},
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
      itemStyle: {color: "#69d6ab"},
      lineStyle: {color: "#69d6ab", width: 3},
      areaStyle: {color: "rgba(105, 214, 171, 0.13)"},
      markLine: {silent: true, symbol: "none", label: {show: false}, lineStyle: {color: "rgba(255, 255, 255, 0.42)", width: 1.5, type: "solid"}, data: [{yAxis: 0}]},
    }],
    graphic: points.length < 2 ? [{type: "text", left: "center", top: "middle", style: {text: state?.label || "当前范围暂无累计曲线", fill: "#8d96a3", fontSize: 12}}] : [],
  };
}

export function buildMt5CalendarOption(payload = {}) {
  const calendar = payload.calendar || {};
  const year = Number(calendar.year);
  const month = Number(calendar.month);
  const monthKey = String(year) + "-" + String(month).padStart(2, "0");
  const daysInMonth = Number.isInteger(year) && Number.isInteger(month)
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  const data = Object.entries(calendar.days || {})
    .map(([key, item]) => [String(item.label || key).slice(0, 10), item])
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(monthKey + "-"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, item]) => [day, toFiniteNumber(item.net_pnl), toFiniteNumber(item.order_count), toFiniteNumber(item.win_rate)]);
  const state = chartMetricState(payload, "calendar");
  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const [day, pnl = 0, count = 0, winRate = 0] = params?.value || [];
        return day + "<br/>净盈亏：" + compactAxisValue(pnl) + "<br/>订单：" + count + " 单<br/>胜率：" + Math.round(winRate * 100) + "%";
      },
    },
    calendar: {
      range: daysInMonth ? [monthKey + "-01", monthKey + "-" + String(daysInMonth).padStart(2, "0")] : monthKey,
      orient: "vertical",
      // Let ECharts use the available height. A fixed row height left a large
      // empty band in the compact GridStack footprint and made the amounts
      // hard to read.
      cellSize: ["auto", "auto"],
      left: 24,
      right: 12,
      top: 16,
      bottom: 4,
      splitLine: {show: false},
      itemStyle: {borderWidth: 0, borderColor: "transparent", color: "transparent"},
      dayLabel: {firstDay: 1, nameMap: ["日", "一", "二", "三", "四", "五", "六"], color: "#aab4c2", fontSize: 14, fontWeight: 650, margin: 8},
      monthLabel: {show: false},
      yearLabel: {show: false},
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data,
      itemStyle: {
        borderWidth: 0,
        borderColor: "transparent",
        color: "transparent",
      },
      label: {
        show: true,
        align: "center",
        verticalAlign: "middle",
        formatter: (params) => {
          const [day, pnl = 0, count = 0, winRate = 0] = params?.value || [];
          const amount = toFiniteNumber(pnl);
          const tone = amount > 0 ? "profit" : amount < 0 ? "loss" : "flat";
          return `{day|${String(day).slice(-2)}}\n{${tone}|${count ? compactAxisValue(amount) : "—"}}`;
        },
        rich: {
          day: {color: "#c0cbd7", fontSize: 15, lineHeight: 18},
          profit: {color: "#69d6ab", fontSize: 18, fontWeight: 700, lineHeight: 21},
          loss: {color: "#ff7d88", fontSize: 18, fontWeight: 700, lineHeight: 21},
          flat: {color: "#aab4c2", fontSize: 16, lineHeight: 20},
        },
      },
    }],
    graphic: state ? [{type: "text", left: "center", top: "middle", style: {text: state.label, fill: "#8d96a3", fontSize: 12}}] : [],
  };
}

export const MT5_CHART_DEFINITIONS = Object.freeze([
  {key: "equity", elementId: "equityChart", buildOption: buildMt5EquityOption},
  {key: "calendar", elementId: "calendarChart", buildOption: buildMt5CalendarOption},
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
  const observers = new Map();
  const states = new Map(entries.map((entry) => [entry.key, "loading"]));
  const resizeTarget = globalThis.window;
  let latestPayload = {};
  let disposed = false;

  if (!echarts?.init) return {update() {}, updateModule() {}, resize() {}, getStates: () => ({}), dispose() {}};

  function markState(entry, state) {
    states.set(entry.key, state);
    if (entry.node.dataset) entry.node.dataset.chartState = state;
  }

  function mount(entry) {
    if (disposed) throw new Error("chart controller disposed");
    if (instances.has(entry.key)) return instances.get(entry.key);
    const instance = echarts.init(entry.node, null, {renderer: "canvas"});
    instances.set(entry.key, instance);
    markState(entry, "loading");
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        try {
          instances.get(entry.key)?.resize({animation: false});
        } catch {
          markState(entry, "error");
        }
      });
      observer.observe(entry.node);
      observers.set(entry.key, observer);
    }
    return instance;
  }

  entries.forEach((entry) => {
    try {
      mount(entry);
    } catch {
      markState(entry, "error");
    }
  });

  const resize = () => entries.forEach((entry) => {
    try {
      instances.get(entry.key)?.resize({animation: false});
    } catch {
      markState(entry, "error");
    }
  });
  if (!observers.size && resizeTarget?.addEventListener) resizeTarget.addEventListener("resize", resize);

  function updateEntry(entry, payload) {
    try {
      const instance = mount(entry);
      const width = Number(entry.node.clientWidth) || 720;
      instance.setOption(entry.buildOption(payload, width), {notMerge: true, lazyUpdate: false});
      markState(entry, "value");
    } catch {
      markState(entry, "error");
    }
  }

  return {
    update(payload = {}) {
      latestPayload = payload;
      entries.forEach((entry) => updateEntry(entry, payload));
      resize();
    },
    updateModule(key, payload = {}) {
      latestPayload = payload;
      const entry = entries.find((candidate) => candidate.key === key);
      if (!entry) return;
      updateEntry(entry, payload);
      try {
        instances.get(key)?.resize({animation: false});
      } catch {
        markState(entry, "error");
      }
      return states.get(key) || "error";
    },
    resize,
    getStates: () => Object.fromEntries(states),
    dispose() {
      if (disposed) return;
      disposed = true;
      observers.forEach((observer) => {
        try { observer.disconnect(); } catch {}
      });
      if (!observers.size && resizeTarget?.removeEventListener) {
        try { resizeTarget.removeEventListener("resize", resize); } catch {}
      }
      instances.forEach((instance) => {
        try { instance.dispose(); } catch {}
      });
      instances.clear();
      observers.clear();
      states.clear();
    },
  };
}

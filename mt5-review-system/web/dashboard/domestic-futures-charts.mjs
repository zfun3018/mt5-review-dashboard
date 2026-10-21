const EMPTY_GRAPHIC = (message) => ({
  type: "text",
  left: "center",
  top: "middle",
  style: {
    text: message,
    fill: "#6d7e83",
    fontSize: 12,
    fontFamily: "system-ui, sans-serif",
  },
});

const CHART_STATE_LABELS = Object.freeze({
  insufficient_data: "样本不足",
  incomplete_data: "数据不完整",
  not_applicable: "不适用",
});

export function chartMetricState(payload = {}, key) {
  const status = String(payload?.metric_meta?.[key]?.status || "");
  return CHART_STATE_LABELS[status] ? {status, label: CHART_STATE_LABELS[status]} : null;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hasFiniteValue(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function shortDate(value, fallback) {
  const text = String(value || "");
  return text.length >= 10 ? text.slice(5, 10) : fallback;
}

function sortByTime(rows = []) {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(String(left?.time_bj || left?.time_utc || ""));
    const rightTime = Date.parse(String(right?.time_bj || right?.time_utc || ""));
    if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
    if (!Number.isFinite(leftTime)) return 1;
    if (!Number.isFinite(rightTime)) return -1;
    return leftTime - rightTime;
  });
}

function beijingDateKey(point) {
  const timeBj = String(point?.time_bj || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(timeBj)) return timeBj.slice(0, 10);
  const timestamp = Date.parse(String(point?.time_utc || ""));
  if (!Number.isFinite(timestamp)) return timeBj.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export function collapseEquityPointsByBeijingDay(points = []) {
  const result = [];
  const dayIndexes = new Map();
  points.filter((point) => {
    const timestamp = String(point?.time_bj || point?.time_utc || "");
    return Number.isFinite(Date.parse(timestamp)) && hasFiniteValue(point?.cumulative_return);
  }).forEach((point, index) => {
    const isBaseline = index === 0 && (point?.trade_id === "baseline" || Number(point?.cumulative_return) === 0);
    if (isBaseline) {
      result.push(point);
      return;
    }
    const key = beijingDateKey(point);
    const existingIndex = dayIndexes.get(key);
    if (existingIndex === undefined) {
      dayIndexes.set(key, result.length);
      result.push(point);
    } else {
      result[existingIndex] = point;
    }
  });
  return result;
}

export function formatEquityAxisDate(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  const timestamp = Number.isFinite(numeric) && String(value).trim() !== ""
    ? numeric
    : Date.parse(String(value || ""));
  if (!Number.isFinite(timestamp)) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return month && day ? `${month}-${day}` : "";
}

function compactAxisValue(value) {
  const amount = toFiniteNumber(value);
  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);
  if (absolute >= 10000) return `${sign}¥${(absolute / 10000).toFixed(1)}万`;
  if (absolute >= 1000) return `${sign}¥${(absolute / 1000).toFixed(1)}k`;
  return `${sign}¥${Math.round(absolute).toLocaleString("zh-CN")}`;
}

function axisBounds(values) {
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return {min: -1, max: 1};
  const rawMin = Math.min(...finiteValues, 0);
  const rawMax = Math.max(...finiteValues, 0);
  const spread = Math.max(rawMax - rawMin, 1);
  const padding = spread * 0.08;
  return {min: rawMin - padding, max: rawMax + padding};
}

export function buildNetPerformanceOption(payload = {}) {
  const state = chartMetricState(payload, "equity_curve");
  const points = state ? [] : collapseEquityPointsByBeijingDay(sortByTime(Array.isArray(payload.equity) ? payload.equity : []));
  const labels = points.map((point, index) => shortDate(point.time_bj, `点 ${index + 1}`));
  const values = points.map((point) => toFiniteNumber(point.cumulative_return));
  const bounds = axisBounds(values);
  const empty = points.length < 2;

  return {
    animation: false,
    grid: {left: 54, right: 18, top: 20, bottom: 32, containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "line"},
      valueFormatter: (value) => compactAxisValue(value),
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "#dbe6e4"}},
      axisLabel: {color: "#91a1a3", hideOverlap: true},
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
      data: values,
      smooth: 0.5,
      smoothMonotone: "x",
      sampling: "lttb",
      symbol: "none",
      emphasis: {symbol: "circle", symbolSize: 6},
      itemStyle: {color: "#069d91"},
      lineStyle: {color: "#069d91", width: 3},
      areaStyle: {color: "rgba(6, 157, 145, 0.13)"},
      markLine: {
        silent: true,
        symbol: "none",
        label: {show: false},
        lineStyle: {color: "#b8c9c5", type: "dashed"},
        data: [{yAxis: 0}],
      },
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "当前范围暂无累计曲线")] : [],
  };
}

export function buildMonthlyPnlOption(payload = {}) {
  const state = chartMetricState(payload, "monthly_pnl");
  const rows = [...(Array.isArray(payload.monthly_pnl) ? payload.monthly_pnl : [])]
    .filter((row) => !state && String(row?.month || "").trim() && hasFiniteValue(row?.net_pnl))
    .sort((left, right) => String(left?.month || "").localeCompare(String(right?.month || "")));
  const labels = rows.map((row, index) => {
    const month = String(row.month || "");
    return month.length >= 7 ? `${month.slice(5, 7)}月` : month || `第 ${index + 1} 月`;
  });
  const values = rows.map((row) => toFiniteNumber(row.net_pnl));
  const bounds = axisBounds(values);
  const empty = rows.length === 0;

  return {
    animation: false,
    grid: {left: 54, right: 18, top: 24, bottom: 32, containLabel: true},
    tooltip: {
      trigger: "axis",
      axisPointer: {type: "shadow"},
      valueFormatter: (value) => compactAxisValue(value),
    },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "#dbe6e4"}},
      axisLabel: {color: "#91a1a3", hideOverlap: true},
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
      name: "月度净盈亏",
      type: "bar",
      data: values,
      barMaxWidth: 34,
      itemStyle: {
        borderRadius: [5, 5, 2, 2],
        color: (params) => (params.value < 0 ? "#f05778" : params.value > 0 ? "#069d91" : "#c9d8d5"),
      },
      markLine: {
        silent: true,
        symbol: "none",
        label: {show: false},
        lineStyle: {color: "#8ea7a2", width: 1},
        data: [{yAxis: 0}],
      },
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "暂无月度盈亏数据")] : [],
  };
}

export function buildHeatmapOption(payload = {}) {
  const state = chartMetricState(payload, "hour_heatmap");
  const rows = Array.isArray(payload.heatmap?.days) ? payload.heatmap.days : [];
  const hours = Array.from({length: 24}, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  const dates = rows.map((row) => row.label || row.weekday_label || shortDate(row.date, ""));
  const data = [];
  rows.forEach((row, rowIndex) => {
    if (state) return;
    (row.hours || []).forEach((cell) => {
      if (!hasFiniteValue(cell?.hour) || !hasFiniteValue(cell?.net_pnl) || !hasFiniteValue(cell?.order_count)) return;
      data.push([Number(cell.hour), rowIndex, Number(cell.net_pnl), Number(cell.order_count)]);
    });
  });
  const maxAbs = Math.max(toFiniteNumber(payload.heatmap?.max_abs_pnl), 1);
  const empty = !rows.length || !data.some((cell) => cell[3] > 0);
  return {
    animation: false,
    grid: {left: 50, right: 18, top: 18, bottom: 34, containLabel: true},
    tooltip: {
      position: "top",
      formatter: (params) => {
        const [hour, row, pnl, count] = params.value || [];
        return `${dates[row] || ""} ${hours[hour] || ""}<br/>${compactAxisValue(pnl)} · ${count} 笔`;
      },
    },
    xAxis: {
      type: "category",
      data: hours,
      axisLabel: {color: "#6d7e83", interval: 2, fontSize: 12},
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "#dbe6e4"}},
    },
    yAxis: {
      type: "category",
      data: dates,
      axisLabel: {color: "#6d7e83", fontSize: 12, interval: 0},
      axisTick: {show: false},
      axisLine: {show: false},
    },
    visualMap: {show: false, dimension: 2, min: -maxAbs, max: maxAbs, calculable: false, inRange: {color: ["#b4233f", "#ffffff", "#007f73"]}},
    series: [{
      name: "时段净盈亏",
      type: "heatmap",
      data,
      itemStyle: {borderColor: "#f4f8f7", borderWidth: 2, borderRadius: 3},
      emphasis: {itemStyle: {shadowBlur: 8, shadowColor: "rgba(6, 157, 145, .24)"}},
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "当前范围暂无时段数据")] : [],
  };
}

export const DOMESTIC_CHART_DEFINITIONS = Object.freeze([
  {key: "netPerformance", elementId: "domesticNetChart", buildOption: buildNetPerformanceOption},
  {key: "monthlyPnl", elementId: "domesticMonthlyChart", buildOption: buildMonthlyPnlOption},
]);

function isHidden(node) {
  return Boolean(node?.closest?.("[hidden]"));
}

export function createDomesticFuturesCharts({
  view = globalThis.document,
  echarts = globalThis.echarts,
  ResizeObserver = globalThis.ResizeObserver,
} = {}) {
  const entries = DOMESTIC_CHART_DEFINITIONS
    .map((definition) => ({...definition, node: view?.getElementById?.(definition.elementId)}))
    .filter((entry) => entry.node && !isHidden(entry.node));
  const instances = new Map();
  const observers = [];
  const resizeTarget = globalThis.window;

  if (!echarts?.init) {
    return {update() {}, resize() {}, dispose() {}};
  }

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
        const instance = instances.get(entry.key);
        if (!instance) return;
        instance.setOption(entry.buildOption(payload), {notMerge: true, lazyUpdate: false});
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

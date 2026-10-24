import {
  buildHeatmapOption,
  buildMonthlyPnlOption,
  chartMetricState,
  collapseEquityPointsByBeijingDay,
  formatEquityAxisDate,
} from "./domestic-futures-charts.mjs";
import {formatMoney, formatPercent, formatRatio, formatRValue} from "../shared/js/formatters.mjs";

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
      axisLine: {lineStyle: {color: "rgba(255, 255, 255, 0.12)"}},
      axisLabel: {color: "#8d96a3", hideOverlap: true, formatter: formatEquityAxisDate},
    },
    yAxis: {
      type: "value",
      min: bounds.min,
      max: bounds.max,
      axisLabel: {color: "#8d96a3", formatter: compactAxisValue},
      axisLine: {show: false},
      axisTick: {show: false},
      splitLine: {lineStyle: {color: "rgba(255, 255, 255, 0.08)", type: "dashed"}},
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
      markLine: {silent: true, symbol: "none", label: {show: false}, lineStyle: {color: "rgba(255, 255, 255, 0.34)", type: "dashed"}, data: [{yAxis: 0}]},
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
      cellSize: ["auto", 26],
      left: 16,
      right: 16,
      top: 24,
      bottom: 12,
      splitLine: {show: false},
      itemStyle: {borderWidth: 0, borderColor: "transparent", color: "transparent"},
      dayLabel: {firstDay: 1, nameMap: ["日", "一", "二", "三", "四", "五", "六"], color: "#8d96a3", margin: 10},
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
          day: {color: "#8d96a3", fontSize: 9, lineHeight: 12},
          profit: {color: "#69d6ab", fontSize: 11, fontWeight: 600, lineHeight: 14},
          loss: {color: "#ff7d88", fontSize: 11, fontWeight: 600, lineHeight: 14},
          flat: {color: "#8d96a3", fontSize: 10, lineHeight: 14},
        },
      },
    }],
    graphic: state ? [{type: "text", left: "center", top: "middle", style: {text: state.label, fill: "#8d96a3", fontSize: 12}}] : [],
  };
}

const SYSTEM_EVALUATION_PERIODS = Object.freeze([
  ["yesterday", "昨日"],
  ["last_7_days", "近 7 天"],
  ["last_30_days", "近 30 天"],
  ["last_365_days", "近 365 天"],
]);

const SYSTEM_EVALUATION_METRICS = Object.freeze([
  {key: "net_pnl", label: "总盈亏", description: "交易净盈亏合计，已计入费用"},
  {key: "trade_count", label: "交易笔数", description: "按合并后的 Campaign 计数"},
  {key: "payoff_ratio", label: "净盈亏比", description: "平均盈利 Campaign 与平均亏损 Campaign 的净盈亏之比"},
  {key: "net_win_rate", label: "净胜率", description: "基于有效 R 值，剔除打平后的胜率"},
  {key: "expectancy_r", label: "数学期望", description: "有效 Campaign 的平均 R 值"},
  {key: "sqn", label: "收益稳定度", description: "SQN；至少需要 30 个有效 R 样本"},
]);

function metricForSystemEvaluation(period, metric) {
  const rMetrics = period?.r_metrics || {};
  const completeCount = Number(rMetrics.complete_count || 0);
  if (metric.key === "net_pnl") {
    return {raw: period?.net_pnl, label: period?.net_pnl == null ? "—" : formatMoney(period.net_pnl)};
  }
  if (metric.key === "trade_count") {
    return {raw: period?.order_count, label: period?.order_count == null ? "—" : String(period.order_count)};
  }
  if (metric.key === "payoff_ratio") {
    return {raw: period?.payoff_ratio, label: formatRatio(period?.payoff_ratio)};
  }
  if (metric.key === "net_win_rate") {
    return completeCount ? {raw: rMetrics.decisive_win_rate, label: formatPercent(rMetrics.decisive_win_rate)} : {raw: null, label: "—"};
  }
  if (metric.key === "expectancy_r") {
    return {raw: rMetrics.expectancy_r, label: formatRValue(rMetrics.expectancy_r)};
  }
  if (metric.key === "sqn") {
    if (rMetrics.sqn_status === "available" && Number.isFinite(Number(rMetrics.sqn))) {
      return {raw: rMetrics.sqn, label: Number(rMetrics.sqn).toFixed(2)};
    }
    const label = rMetrics.sqn_status === "zero_variance" ? "无波动" : "样本不足";
    return {raw: null, label};
  }
  return {raw: null, label: "—"};
}

function systemEvaluationMetricColor(metricKey, value) {
  if (metricKey === "trade_count" || metricKey === "net_win_rate") return "rgba(118, 178, 255, 0.72)";
  if (!Number.isFinite(Number(value))) return "rgba(255, 255, 255, 0.25)";
  const amount = Number(value);
  if (metricKey === "payoff_ratio") {
    if (amount === 1) return "rgba(255, 255, 255, 0.40)";
    return amount > 1 ? "#69d6ab" : "#ff7d88";
  }
  if (amount === 0) return "rgba(255, 255, 255, 0.40)";
  return amount > 0 ? "#69d6ab" : "#ff7d88";
}

function systemEvaluationAxisBounds(metricKey, entries) {
  const values = entries
    .filter((entry) => entry.available)
    .map((entry) => Number(entry.value))
    .filter(Number.isFinite);
  if (!values.length) return {min: 0, max: 1};
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (metricKey === "net_win_rate") return {min: 0, max: Math.max(1, max) * 1.05};
  if (metricKey === "trade_count") return {min: 0, max: Math.max(1, max) * 1.4};
  if (metricKey === "payoff_ratio") return {min: 0, max: Math.max(1, max) * 1.35};
  if (metricKey === "sqn" && min >= 0) return {min: 0, max: Math.max(1, max) * 1.35};
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  const span = Math.max(high - low, Math.abs(low), Math.abs(high), 0.01);
  const padding = span * 0.22;
  return {min: low < 0 ? low - padding : 0, max: high > 0 ? high + padding : padding};
}

const SYSTEM_EVALUATION_UNITS = Object.freeze([
  "USD · 零轴区分盈亏方向",
  "笔 · 仅比较数量",
  "倍 · 1.00 为盈亏平衡",
  "% · 排除打平交易",
  "R / 笔 · 零轴区分正负期望",
  "SQN · 至少 30 个有效 R 样本",
]);

export function buildMt5SystemEvaluationOption(payload = {}, chartWidth = 720) {
  const state = chartMetricState(payload, "periods");
  const periods = payload.periods || {};
  const payloadReady = SYSTEM_EVALUATION_PERIODS.every(([key]) => periods[key] && typeof periods[key] === "object");
  const columns = Number(chartWidth) < 600 ? 1 : 2;
  const rows = Math.ceil(SYSTEM_EVALUATION_METRICS.length / columns);
  const columnGap = 4;
  const rowGap = 2;
  const panelWidth = (100 - columnGap * (columns - 1)) / columns;
  const panelHeight = (100 - rowGap * (rows - 1)) / rows;
  const panels = SYSTEM_EVALUATION_METRICS.map((metric, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = column * (panelWidth + columnGap);
    const top = row * (panelHeight + rowGap);
    const entries = SYSTEM_EVALUATION_PERIODS.map(([periodKey, periodLabel]) => {
      const result = payloadReady && !state
        ? metricForSystemEvaluation(periods[periodKey], metric)
        : {raw: null, label: "—"};
      const available = result.raw !== null && result.raw !== undefined && Number.isFinite(Number(result.raw));
      const rMetrics = periods[periodKey]?.r_metrics || {};
      return {
        value: available ? Number(result.raw) : 0,
        available,
        label: result.label,
        periodKey,
        periodLabel,
        metricKey: metric.key,
        metricLabel: metric.label,
        description: metric.description,
        sampleCount: Number(rMetrics.complete_count || 0),
        itemStyle: {
          color: available ? systemEvaluationMetricColor(metric.key, result.raw) : "rgba(255, 255, 255, 0.18)",
          opacity: available ? 1 : 0,
        },
      };
    });
    const title = {
      text: metric.label,
      subtext: SYSTEM_EVALUATION_UNITS[index],
      left: `${left}%`,
      top: `${top}%`,
      itemGap: 1,
      textStyle: {color: "#e5ebf4", fontSize: 10, fontWeight: 600},
      subtextStyle: {color: "#798596", fontSize: 8},
    };
    const grid = {
      left: `${left}%`,
      top: `${top + Math.min(8, panelHeight * 0.24)}%`,
      width: `${panelWidth}%`,
      height: `${Math.max(10, panelHeight - Math.min(11, panelHeight * 0.32))}%`,
      containLabel: true,
    };
    const bounds = systemEvaluationAxisBounds(metric.key, entries);
    const xAxis = {
      type: "value",
      gridIndex: index,
      min: bounds.min,
      max: bounds.max,
      axisLabel: {show: false},
      axisLine: {show: false},
      axisTick: {show: false},
      splitLine: {show: false},
    };
    const yAxis = {
      type: "category",
      gridIndex: index,
      data: SYSTEM_EVALUATION_PERIODS.map(([, label]) => label),
      inverse: true,
      axisLabel: {color: "#9eabba", fontSize: 8, margin: 6, hideOverlap: true},
      axisLine: {show: false},
      axisTick: {show: false},
      splitLine: {show: false},
    };
    const series = {
      name: metric.label,
      type: "bar",
      xAxisIndex: index,
      yAxisIndex: index,
      data: entries,
      barMaxWidth: 9,
      barMinHeight: 1,
      itemStyle: {borderRadius: [0, 4, 4, 0]},
      label: {
        show: true,
        position: "right",
        distance: 4,
        color: "#dce4ef",
        fontSize: 8,
        fontWeight: 600,
        formatter: ({data}) => data?.label || "—",
      },
      labelLayout: {hideOverlap: true},
      emphasis: {disabled: true},
    };
    if (metric.key === "net_pnl" || metric.key === "expectancy_r") {
      series.markLine = {silent: true, symbol: "none", label: {show: false}, lineStyle: {color: "rgba(225, 235, 248, 0.30)", type: "dashed", width: 1}, data: [{xAxis: 0}]};
    } else if (metric.key === "payoff_ratio") {
      series.markLine = {silent: true, symbol: "none", label: {show: false}, lineStyle: {color: "rgba(225, 235, 248, 0.30)", type: "dashed", width: 1}, data: [{xAxis: 1}]};
    }
    return {title, grid, xAxis, yAxis, series};
  });
  const unavailableMessage = !payloadReady ? "周期数据尚未加载，请重启本地服务" : state?.label;
  return {
    animation: false,
    grid: panels.map((panel) => panel.grid),
    title: panels.map((panel) => panel.title),
    tooltip: {
      trigger: "item",
      formatter: ({data = {}} = {}) => [
        `<strong>${data.periodLabel || ""} · ${data.metricLabel || ""}</strong>`,
        `数值：${data.label || "—"}`,
        `<span style="color:#8d96a3">${data.description || ""}</span>`,
        data.metricKey === "sqn" ? `<span style="color:#8d96a3">有效 R 样本：${data.sampleCount || 0}</span>` : "",
      ].join("<br/>"),
    },
    xAxis: panels.map((panel) => panel.xAxis),
    yAxis: panels.map((panel) => panel.yAxis),
    series: panels.map((panel) => panel.series),
    graphic: unavailableMessage ? [{type: "text", left: "center", top: "middle", style: {text: unavailableMessage, fill: "#8d96a3", fontSize: 12}}] : [],
  };
}

export const MT5_CHART_DEFINITIONS = Object.freeze([
  {key: "equity", elementId: "equityChart", buildOption: buildMt5EquityOption},
  {key: "systemEvaluation", elementId: "systemEvaluationChart", buildOption: buildMt5SystemEvaluationOption},
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
  let systemEvaluationColumns = null;
  let disposed = false;

  if (!echarts?.init) return {update() {}, updateModule() {}, resize() {}, getStates: () => ({}), dispose() {}};

  function markState(entry, state) {
    states.set(entry.key, state);
    if (entry.node.dataset) entry.node.dataset.chartState = state;
  }

  function chartColumns(width) {
    return Number(width) < 600 ? 1 : 2;
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
          const width = Number(entry.node.clientWidth) || 720;
          if (entry.key === "systemEvaluation" && systemEvaluationColumns !== chartColumns(width)) {
            updateEntry(entry, latestPayload);
          }
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
      const width = Number(entry.node.clientWidth) || 720;
      if (entry.key === "systemEvaluation" && systemEvaluationColumns !== chartColumns(width)) {
        updateEntry(entry, latestPayload);
      }
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
      if (entry.key === "systemEvaluation") systemEvaluationColumns = chartColumns(width);
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

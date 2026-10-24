const EMPTY_GRAPHIC = (message) => ({
  type: "text",
  left: "center",
  top: "middle",
  style: {
    text: message,
    fill: "#8d96a3",
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
  const aliases = {hour_heatmap: ["hour_heatmap", "heatmap"]};
  const meta = (aliases[key] || [key]).map((candidate) => payload?.metric_meta?.[candidate]).find(Boolean);
  const status = String(meta?.status || "");
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
      axisLine: {lineStyle: {color: "rgba(255, 255, 255, 0.12)"}},
      axisLabel: {color: "#8d96a3", hideOverlap: true},
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
      data: values,
      smooth: 0.5,
      smoothMonotone: "x",
      sampling: "lttb",
      symbol: "none",
      emphasis: {symbol: "circle", symbolSize: 6},
      itemStyle: {color: "#69d6ab"},
      lineStyle: {color: "#69d6ab", width: 3},
      areaStyle: {color: "rgba(105, 214, 171, 0.13)"},
      markLine: {
        silent: true,
        symbol: "none",
        label: {show: false},
        lineStyle: {color: "rgba(255, 255, 255, 0.34)", type: "dashed"},
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
  const empty = rows.length === 0;
  const hasProductBreakdown = rows.some((row) => Array.isArray(row.product_pnl));
  let series = [{
    name: "月度净盈亏",
    type: "bar",
    data: values,
    barMaxWidth: 34,
    itemStyle: {
      borderRadius: [5, 5, 2, 2],
      color: (params) => (params.value < 0 ? "#ff7d88" : params.value > 0 ? "#69d6ab" : "#64707d"),
    },
  }];
  let legend;
  let bounds = axisBounds(values);
  let tooltip = {
    trigger: "axis",
    axisPointer: {type: "shadow"},
    valueFormatter: (value) => compactAxisValue(value),
  };

  if (hasProductBreakdown) {
    const totalsByProduct = new Map();
    rows.forEach((row) => (row.product_pnl || []).forEach((item) => {
      const name = String(item?.product_name || "未命名品种");
      totalsByProduct.set(name, (totalsByProduct.get(name) || 0) + Math.abs(toFiniteNumber(item?.net_pnl)));
    }));
    const rankedProducts = [...totalsByProduct.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"));
    const productNames = rankedProducts.slice(0, 8).map(([name]) => name);
    const hasOther = rankedProducts.length > productNames.length;
    const seriesNames = hasOther ? [...productNames, "其他品种"] : productNames;
    const palette = ["#69d6ab", "#70b8ff", "#f0bd68", "#c7a0ff", "#ff7d88", "#69cad0", "#c2d77a", "#ff9c70"];
    const productValues = rows.map((row) => new Map(
      (row.product_pnl || []).map((item) => [String(item?.product_name || "未命名品种"), toFiniteNumber(item?.net_pnl)]),
    ));
    const productSeries = seriesNames.map((name, seriesIndex) => {
      const amounts = rows.map((row, rowIndex) => {
        const byProduct = productValues[rowIndex];
        if (name === "其他品种") {
          return roundCurrency([...byProduct.entries()].reduce((total, [product, amount]) => (
            total + (productNames.includes(product) ? 0 : amount)
          ), 0));
        }
        return byProduct.get(name) || 0;
      });
      const color = name === "其他品种" ? "#8793a1" : palette[seriesIndex % palette.length];
      return [
        {
          name,
          type: "bar",
          stack: "monthly-profit",
          barMaxWidth: 26,
          barGap: "25%",
          barCategoryGap: "35%",
          data: amounts.map((amount) => ({
            value: amount > 0 ? amount : 0,
            label: {show: amount > 0},
          })),
          itemStyle: {color},
          label: {
            show: true,
            position: "inside",
            formatter: name,
            color: "#111820",
            fontSize: 9,
            fontWeight: 700,
            overflow: "truncate",
            width: 48,
          },
          labelLayout: ({rect}) => ({hide: !rect || rect.height < 18 || rect.width < 30}),
          emphasis: {focus: "series"},
        },
        {
          name,
          type: "bar",
          stack: "monthly-loss",
          barMaxWidth: 26,
          barGap: "25%",
          barCategoryGap: "35%",
          data: amounts.map((amount) => ({
            value: amount < 0 ? amount : 0,
            label: {show: amount < 0},
          })),
          itemStyle: {color},
          label: {
            show: true,
            position: "inside",
            formatter: name,
            color: "#111820",
            fontSize: 9,
            fontWeight: 700,
            overflow: "truncate",
            width: 48,
          },
          labelLayout: ({rect}) => ({hide: !rect || rect.height < 18 || rect.width < 30}),
          emphasis: {focus: "series"},
        },
      ];
    }).flat();
    const seriesAmount = (item, rowIndex) => toFiniteNumber(item.data[rowIndex]?.value ?? item.data[rowIndex]);
    const profitTotals = rows.map((_, rowIndex) => roundCurrency(productSeries
      .filter((item) => item.stack === "monthly-profit")
      .reduce((total, item) => total + seriesAmount(item, rowIndex), 0)));
    const lossTotals = rows.map((_, rowIndex) => roundCurrency(productSeries
      .filter((item) => item.stack === "monthly-loss")
      .reduce((total, item) => total + seriesAmount(item, rowIndex), 0)));
    const buildStackTotalLabels = (name, totals, offset, position, color) => ({
      name,
      type: "scatter",
      data: rows.flatMap((row, rowIndex) => totals[rowIndex] === 0 ? [] : [{
        name: row.month,
        value: [labels[rowIndex], totals[rowIndex]],
        label: {
          show: true,
          formatter: signedCurrency(totals[rowIndex]),
          position,
          offset: [offset, 0],
          distance: 5,
          color,
          backgroundColor: "rgba(15, 20, 28, .88)",
          padding: [2, 5],
          borderRadius: 5,
          fontSize: 9,
          fontWeight: 700,
        },
      }]),
      symbolSize: 1,
      itemStyle: {color: "transparent"},
      tooltip: {show: false},
      silent: true,
      z: 6,
    });
    series = [...productSeries, {
      name: "月度净盈亏",
      type: "line",
      data: values,
      symbol: "circle",
      symbolSize: 7,
      showSymbol: true,
      smooth: false,
      z: 5,
      lineStyle: {color: "#f0bd68", width: 2.5},
      itemStyle: {color: "#f0bd68", borderColor: "#151b23", borderWidth: 2},
      emphasis: {focus: "series", scale: 1.25},
    },
    buildStackTotalLabels("盈利汇总金额", profitTotals, -12, "top", "#69d6ab"),
    buildStackTotalLabels("亏损汇总金额", lossTotals, 12, "bottom", "#ff7d88")];
    legend = {
      show: true,
      type: "scroll",
      top: 0,
      left: 54,
      right: 18,
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: {color: "#8d96a3", fontSize: 9},
      data: [...seriesNames, "月度净盈亏"],
    };
    bounds = axisBounds([...profitTotals, ...lossTotals, ...values]);
    tooltip = {
      trigger: "item",
      formatter: (params) => signedCurrency(params?.value),
    };
  }

  return {
    animation: false,
    grid: {left: 54, right: 18, top: hasProductBreakdown ? 38 : 24, bottom: 32, containLabel: true},
    legend,
    tooltip,
    xAxis: {
      type: "category",
      data: labels,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "rgba(255, 255, 255, 0.12)"}},
      axisLabel: {color: "#8d96a3", hideOverlap: true},
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
    series: series.map((item, index) => ({
      ...item,
      ...(index === 0 ? {markLine: {
        silent: true,
        symbol: "none",
        label: {show: false},
        lineStyle: {color: "#8ea7a2", width: 1},
        data: [{yAxis: 0}],
      }} : {}),
    })),
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "暂无月度盈亏数据")] : [],
  };
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function signedCurrency(value) {
  const amount = toFiniteNumber(value);
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  return `${sign}¥${Math.abs(amount).toLocaleString("zh-CN", {maximumFractionDigits: 2})}`;
}

function escapeChartHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

export function buildContractContributionOption(payload = {}) {
  const state = chartMetricState(payload, "contract_rankings");
  const rows = state || !Array.isArray(payload.contract_rankings?.contribution)
    ? []
    : payload.contract_rankings.contribution;
  const data = rows.map((row) => {
    const netPnl = toFiniteNumber(row?.net_pnl);
    return {
      name: String(row?.contract_name || row?.symbol || "未命名合约"),
      value: netPnl,
      netPnl,
      orderCount: toFiniteNumber(row?.order_count),
      itemStyle: {color: "#69d6ab"},
    };
  }).filter((item) => item.netPnl > 0);
  const empty = data.length === 0;

  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: ({data: item = {}}) => `${escapeChartHtml(item.name)}<br/>${toFiniteNumber(item.orderCount)} 笔<br/>净盈亏：${signedCurrency(item.netPnl)}`,
    },
    series: [{
      name: "合约贡献",
      type: "pie",
      roseType: "radius",
      radius: ["24%", "72%"],
      center: ["50%", "52%"],
      minAngle: 4,
      stillShowZeroSum: false,
      avoidLabelOverlap: true,
      itemStyle: {borderColor: "rgba(15, 20, 28, .8)", borderWidth: 2, borderRadius: 4},
      label: {
        show: true,
        position: "outside",
        formatter: ({data: item = {}}) => `${item.name || ""}\n${signedCurrency(item.netPnl)}`,
        color: "#69d6ab",
        fontSize: 11,
        fontWeight: 700,
      },
      labelLine: {show: true, length: 8, length2: 5, lineStyle: {color: "rgba(216, 224, 231, .42)"}},
      labelLayout: {hideOverlap: true},
      emphasis: {scale: true, scaleSize: 4, focus: "self"},
      data,
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "暂无盈利合约")] : [],
  };
}

export function buildContractLossesTreemapOption(payload = {}) {
  const state = chartMetricState(payload, "contract_rankings");
  const rows = state || !Array.isArray(payload.contract_rankings?.losses)
    ? []
    : payload.contract_rankings.losses;
  const productColors = new Map();
  const palette = ["#31b7a4", "#4b8ce0", "#e5a53b", "#a56bd1", "#e4616d", "#27a7c1", "#a3b640", "#dc7842", "#6575d0", "#d25398"];
  const data = rows.map((row) => {
    const netPnl = toFiniteNumber(row?.net_pnl);
    const productName = String(row?.product_name || row?.symbol || "未分类");
    if (!productColors.has(productName)) productColors.set(productName, palette[productColors.size % palette.length]);
    return {
      name: String(row?.contract_name || row?.symbol || "未命名合约"),
      productName,
      value: Math.abs(netPnl),
      netPnl,
      orderCount: toFiniteNumber(row?.order_count),
      itemStyle: {color: productColors.get(productName)},
    };
  }).filter((item) => item.netPnl < 0 && item.value > 0);
  const empty = data.length === 0;

  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter: ({data: item = {}}) => `${escapeChartHtml(item.productName)}<br/>${escapeChartHtml(item.name)}<br/>${toFiniteNumber(item.orderCount)} 笔<br/>净亏损：${signedCurrency(item.netPnl)}`,
    },
    series: [{
      name: "合约亏损榜",
      type: "treemap",
      roam: false,
      nodeClick: false,
      breadcrumb: {show: false},
      squareRatio: 1,
      visibleMin: 12,
      itemStyle: {borderColor: "rgba(9, 13, 19, .9)", borderWidth: 3, gapWidth: 3},
      label: {
        show: true,
        formatter: ({data: item = {}}) => `${item.productName || ""}\n${item.name || ""}\n${signedCurrency(item.netPnl)}`,
        color: "#f5f7fa",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 14,
        overflow: "truncate",
      },
      upperLabel: {show: false},
      emphasis: {itemStyle: {borderColor: "rgba(255, 255, 255, .9)", borderWidth: 2, shadowBlur: 12, shadowColor: "rgba(0, 0, 0, .32)"}},
      data,
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "暂无亏损合约")] : [],
  };
}

export function buildDomesticCalendarOption(payload = {}) {
  const calendar = payload.calendar || {};
  const year = Number(calendar.year);
  const month = Number(calendar.month);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const daysInMonth = Number.isInteger(year) && Number.isInteger(month)
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;
  const state = chartMetricState(payload, "calendar");
  const data = Object.entries(calendar.days || {})
    .map(([key, item]) => [String(item?.label || key).slice(0, 10), item])
    .filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day.startsWith(`${monthKey}-`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, item]) => [day, toFiniteNumber(item?.net_pnl), toFiniteNumber(item?.order_count), toFiniteNumber(item?.win_rate)]);

  return {
    animation: false,
    tooltip: {
      formatter: (params) => {
        const [day, pnl = 0, count = 0, winRate = 0] = params?.value || [];
        return `${day}<br/>净盈亏：${compactAxisValue(pnl)}<br/>交易：${count} 笔 · 胜率 ${Math.round(winRate * 100)}%`;
      },
    },
    calendar: {
      range: daysInMonth ? [`${monthKey}-01`, `${monthKey}-${String(daysInMonth).padStart(2, "0")}`] : monthKey,
      orient: "vertical",
      cellSize: ["auto", "auto"],
      left: 12,
      right: 12,
      top: 24,
      bottom: 4,
      splitLine: {show: false},
      itemStyle: {borderWidth: 0, borderColor: "transparent", color: "transparent"},
      dayLabel: {firstDay: 1, nameMap: ["日", "一", "二", "三", "四", "五", "六"], color: "#8d96a3", fontSize: 12, margin: 8},
      monthLabel: {show: false},
      yearLabel: {show: false},
    },
    series: [{
      type: "heatmap",
      coordinateSystem: "calendar",
      data,
      itemStyle: {borderWidth: 0, borderColor: "transparent", color: "transparent"},
      label: {
        show: true,
        color: "#f1f4f6",
        fontSize: 11,
        lineHeight: 15,
        rich: {
          day: {color: "#8d96a3", fontSize: 11, lineHeight: 13},
          profit: {color: "#69d6ab", fontSize: 11, fontWeight: 700, lineHeight: 15},
          loss: {color: "#ff7d88", fontSize: 11, fontWeight: 700, lineHeight: 15},
          flat: {color: "#b7bec8", fontSize: 11, fontWeight: 600, lineHeight: 15},
          empty: {color: "#64707d", fontSize: 11, lineHeight: 15},
        },
        formatter: (params) => {
          const [day, pnl = 0, count = 0] = params?.value || [];
          const amount = count ? `${Number(pnl) > 0 ? "+" : ""}${compactAxisValue(pnl)}` : "—";
          const tone = !count ? "empty" : Number(pnl) > 0 ? "profit" : Number(pnl) < 0 ? "loss" : "flat";
          return `{day|${String(day).slice(-2)}}\n{${tone}|${amount}}`;
        },
      },
    }],
    graphic: state ? [EMPTY_GRAPHIC(state.label)] : [],
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
      axisLabel: {color: "#8d96a3", interval: 2, fontSize: 12},
      axisTick: {show: false},
      axisLine: {lineStyle: {color: "rgba(255, 255, 255, 0.12)"}},
    },
    yAxis: {
      type: "category",
      data: dates,
      axisLabel: {color: "#8d96a3", fontSize: 12, interval: 0},
      axisTick: {show: false},
      axisLine: {show: false},
    },
    visualMap: {show: false, dimension: 2, min: -maxAbs, max: maxAbs, calculable: false, inRange: {color: ["#a84856", "#222831", "#69d6ab"]}},
    series: [{
      name: "时段净盈亏",
      type: "heatmap",
      data,
      itemStyle: {borderColor: "#11151c", borderWidth: 2, borderRadius: 3},
      emphasis: {itemStyle: {shadowBlur: 8, shadowColor: "rgba(105, 214, 171, .24)"}},
    }],
    graphic: empty ? [EMPTY_GRAPHIC(state?.label || "当前范围暂无时段数据")] : [],
  };
}

export function buildRiskGaugeOption(assessment = {}) {
  const score = Number(assessment.score);
  const hasScore = assessment.score !== null && assessment.score !== undefined && assessment.score !== ""
    && Number.isFinite(score) && score >= 0 && score <= 100;
  const color = assessment.level === "high" ? "#ff7d88"
    : assessment.level === "warn" ? "#f0bd68"
      : "#69d6ab";
  return {
    animation: false,
    series: [{
      type: "gauge",
      min: 0,
      max: 100,
      startAngle: 210,
      endAngle: -30,
      center: ["50%", "58%"],
      radius: "92%",
      pointer: {show: false},
      anchor: {show: false},
      axisLine: {
        roundCap: true,
        lineStyle: {
          width: 10,
          color: [[0.35, "rgba(105, 214, 171, .32)"], [0.65, "rgba(240, 189, 104, .3)"], [1, "rgba(255, 125, 136, .28)"]],
        },
      },
      progress: {show: hasScore, roundCap: true, width: 10, itemStyle: {color}},
      splitLine: {show: false},
      axisTick: {show: false},
      axisLabel: {show: false},
      title: {show: false},
      detail: hasScore ? {
        valueAnimation: false,
        offsetCenter: [0, "8%"],
        formatter: "{score|{value}}\n{unit|/ 100}",
        rich: {
          score: {fontSize: 25, fontWeight: 700, lineHeight: 28, color: "#f1f4f6"},
          unit: {fontSize: 10, lineHeight: 14, color: "#8d96a3"},
        },
      } : {show: false},
      data: hasScore ? [{value: Math.round(score)}] : [],
    }],
    graphic: hasScore ? [] : [{
      type: "text",
      left: "center",
      top: "middle",
      style: {text: assessment.label || "样本不足", fill: "#8d96a3", fontSize: 12, fontFamily: "system-ui, sans-serif"},
    }],
  };
}

export const DOMESTIC_CHART_DEFINITIONS = Object.freeze([
  {key: "netPerformance", elementId: "domesticNetChart", buildOption: buildNetPerformanceOption},
  {key: "monthlyPnl", elementId: "domesticMonthlyChart", buildOption: buildMonthlyPnlOption},
  {key: "calendar", elementId: "domesticCalendarChart", buildOption: buildDomesticCalendarOption},
  {key: "riskGauge", elementId: "domesticRiskGauge", buildOption: buildRiskGaugeOption},
  {key: "contractContribution", elementId: "domesticContractContribution", buildOption: buildContractContributionOption},
  {key: "contractLosses", elementId: "domesticContractLosses", buildOption: buildContractLossesTreemapOption},
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
  const observers = new Map();
  const states = new Map(entries.map((entry) => [entry.key, "loading"]));
  const resizeTarget = globalThis.window;
  let disposed = false;

  if (!echarts?.init) {
    return {update() {}, updateModule() {}, resize() {}, getStates: () => ({}), dispose() {}};
  }

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
      instance.setOption(entry.buildOption(payload), {notMerge: true, lazyUpdate: false});
      markState(entry, "value");
    } catch {
      markState(entry, "error");
    }
  }

  return {
    update(payload = {}) {
      entries.forEach((entry) => updateEntry(entry, payload));
      resize();
    },
    updateModule(key, payload = {}) {
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

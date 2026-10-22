const COLORS = Object.freeze({
  text: "#a8b0bd",
  grid: "rgba(255,255,255,0.075)",
  profit: "#29c78b",
  loss: "#f0646b",
  accent: "#d6a84b",
  cyan: "#5db7c4",
});

const base = {
  animationDuration: 420,
  textStyle: {fontFamily: "Segoe UI, Arial, sans-serif", color: COLORS.text},
  tooltip: {
    trigger: "axis",
    backgroundColor: "#171b21",
    borderColor: "#343b45",
    textStyle: {color: "#f2f4f7"},
  },
};

function money(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}¥${Number(value).toLocaleString("zh-CN")}`;
}
export function equityOption(dataset) {
  return {
    ...base,
    grid: {left: 66, right: 54, top: 18, bottom: 32},
    legend: {right: 8, top: 0, textStyle: {color: COLORS.text}, itemWidth: 16, itemHeight: 6},
    xAxis: {
      type: "category",
      data: dataset.equity.map((point) => point.date.slice(5)),
      boundaryGap: false,
      axisLine: {lineStyle: {color: COLORS.grid}},
      axisLabel: {color: COLORS.text, interval: 14},
      axisTick: {show: false},
    },
    yAxis: [
      {
        type: "value",
        axisLabel: {color: COLORS.text, formatter: (value) => `${Math.round(value / 1000)}k`},
        splitLine: {lineStyle: {color: COLORS.grid}},
      },
      {
        type: "value",
        min: -10,
        max: 0,
        axisLabel: {color: COLORS.text, formatter: "{value}%"},
        splitLine: {show: false},
      },
    ],
    series: [
      {
        name: "账户权益",
        type: "line",
        data: dataset.equity.map((point) => point.equity),
        showSymbol: false,
        smooth: 0.18,
        lineStyle: {width: 2, color: COLORS.profit},
        areaStyle: {color: "rgba(41,199,139,0.10)"},
      },
      {
        name: "回撤",
        type: "line",
        yAxisIndex: 1,
        data: dataset.equity.map((point) => point.drawdown),
        showSymbol: false,
        lineStyle: {width: 1.3, color: COLORS.loss},
      },
    ],
  };
}

export function monthlyOption(dataset) {
  return {
    ...base,
    grid: {left: 60, right: 14, top: 18, bottom: 32},
    xAxis: {
      type: "category",
      data: dataset.monthly.map((item) => item.month),
      axisLine: {lineStyle: {color: COLORS.grid}},
      axisLabel: {color: COLORS.text},
      axisTick: {show: false},
    },
    yAxis: {
      type: "value",
      axisLabel: {color: COLORS.text, formatter: (value) => `${value / 1000}k`},
      splitLine: {lineStyle: {color: COLORS.grid}},
    },
    tooltip: {...base.tooltip, valueFormatter: money},
    series: [{
      type: "bar",
      data: dataset.monthly.map((item) => ({
        value: item.pnl,
        itemStyle: {color: item.pnl >= 0 ? COLORS.profit : COLORS.loss, borderRadius: item.pnl >= 0 ? [2, 2, 0, 0] : [0, 0, 2, 2]},
      })),
      barMaxWidth: 24,
    }],
  };
}

export function strategyOption(dataset) {
  const items = [...dataset.strategies].reverse();
  return {
    ...base,
    grid: {left: 80, right: 46, top: 10, bottom: 24},
    xAxis: {
      type: "value",
      axisLabel: {color: COLORS.text, formatter: (value) => `${value / 1000}k`},
      splitLine: {lineStyle: {color: COLORS.grid}},
    },
    yAxis: {
      type: "category",
      data: items.map((item) => item.name),
      axisLine: {show: false},
      axisTick: {show: false},
      axisLabel: {color: COLORS.text},
    },
    series: [{
      type: "bar",
      data: items.map((item) => ({
        value: item.pnl,
        itemStyle: {color: item.pnl >= 0 ? COLORS.cyan : COLORS.loss, borderRadius: 2},
      })),
      label: {show: true, position: "right", color: COLORS.text, formatter: ({value}) => money(value)},
      barMaxWidth: 18,
    }],
  };
}

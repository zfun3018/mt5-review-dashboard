import {chartMetricState} from "./domestic-futures-charts.mjs";
import {formatMoney, formatPercent, formatRatio, formatRValue} from "../shared/js/formatters.mjs";

const PERIODS = Object.freeze([
  ["yesterday", "昨日"],
  ["last_7_days", "近 7 天"],
  ["last_30_days", "近 30 天"],
  ["last_365_days", "近 365 天"],
]);

const METRICS = Object.freeze([
  {key: "net_pnl", label: "总盈亏", unit: "USD"},
  {key: "trade_count", label: "交易笔数", unit: "笔"},
  {key: "payoff_ratio", label: "净盈亏比", unit: "倍"},
  {key: "net_win_rate", label: "净胜率", unit: "%"},
  {key: "expectancy_r", label: "数学期望", unit: "R / 笔"},
  {key: "sqn", label: "收益稳定度", unit: "SQN"},
]);

function metricValue(period, metric) {
  const rMetrics = period?.r_metrics || {};
  const completeCount = Number(rMetrics.complete_count || 0);
  if (metric.key === "net_pnl") return {raw: period?.net_pnl, label: period?.net_pnl == null ? "—" : formatMoney(period.net_pnl)};
  if (metric.key === "trade_count") return {raw: period?.order_count, label: period?.order_count == null ? "—" : String(period.order_count)};
  if (metric.key === "payoff_ratio") return {raw: period?.payoff_ratio, label: formatRatio(period?.payoff_ratio)};
  if (metric.key === "net_win_rate") return completeCount ? {raw: rMetrics.decisive_win_rate, label: formatPercent(rMetrics.decisive_win_rate)} : {raw: null, label: "—"};
  if (metric.key === "expectancy_r") return {raw: rMetrics.expectancy_r, label: formatRValue(rMetrics.expectancy_r)};
  if (metric.key === "sqn") {
    if (rMetrics.sqn_status === "available" && Number.isFinite(Number(rMetrics.sqn))) return {raw: rMetrics.sqn, label: Number(rMetrics.sqn).toFixed(2)};
    return {raw: null, label: rMetrics.sqn_status === "zero_variance" ? "无波动" : "样本不足"};
  }
  return {raw: null, label: "—"};
}

function valueTone(metricKey, value) {
  if (metricKey === "trade_count" || metricKey === "net_win_rate") return "neutral";
  if (!Number.isFinite(Number(value))) return "muted";
  const amount = Number(value);
  if (metricKey === "payoff_ratio") return amount === 1 ? "neutral" : amount > 1 ? "positive" : "negative";
  return amount === 0 ? "neutral" : amount > 0 ? "positive" : "negative";
}

export function buildMt5SystemEvaluationCards(payload = {}) {
  const periods = payload.periods || {};
  const state = chartMetricState(payload, "periods");
  const payloadReady = PERIODS.every(([key]) => periods[key] && typeof periods[key] === "object");
  return {
    stateLabel: !payloadReady ? "周期数据尚未加载，请重启本地服务" : state?.label || "",
    cards: PERIODS.map(([periodKey, periodLabel]) => ({
      key: periodKey,
      label: periodLabel,
      values: METRICS.map((metric) => {
        const result = payloadReady && !state ? metricValue(periods[periodKey], metric) : {raw: null, label: "—"};
        const available = result.raw !== null && result.raw !== undefined && Number.isFinite(Number(result.raw));
        return {...metric, value: result.label, available, tone: available ? valueTone(metric.key, result.raw) : "muted"};
      }),
    })),
  };
}

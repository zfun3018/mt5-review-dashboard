import {RequestGate} from "../shared/js/api.mjs";
import {escapeHtml, formatPercent, formatRatio, profitClass} from "../shared/js/formatters.mjs";
import {mountShell} from "../shared/js/shell.mjs";
import {normalizePlatform, readPlatform} from "../shared/js/platform.mjs";
import {buildAnalysisQuery, readDashboardState, resolveAnalysisWindow, writeDashboardState} from "./dashboard-state.mjs";
import {createDomesticFuturesCharts} from "./domestic-futures-charts.mjs";
import {loadLayout} from "./domestic-futures-layout.mjs";
import {createDashboardGrid} from "./dashboard-grid.mjs";

const PERIODS = [
  ["today", "昨日", "北京时间"],
  ["week", "最近 1 周", "滚动 7 天"],
  ["month", "最近 1 月", "滚动 30 天"],
  ["quarter", "最近 3 月", "滚动 90 天"],
  ["year", "最近 1 年", "滚动 365 天"],
];

const FILTER_PRESETS = [
  {value: "all", label: "全部时间"},
  {value: "today", label: "今日"},
  {value: "7d", label: "近 7 天"},
  {value: "30d", label: "本月"},
  {value: "custom", label: "自定义"},
];

export function getDomesticDashboardConfig() {
  return {
    moduleIds: [
      "period-overview", "net-performance", "risk-health", "monthly-pnl",
      "daily-calendar", "contract-contribution", "contract-losses", "data-health",
      "review-coverage", "system-evaluation", "mode-evaluation",
      "r-metrics", "heatmap", "sessions",
    ],
    periodLabels: PERIODS.map(([, label]) => label),
    filterPresets: FILTER_PRESETS,
  };
}

function money(value) {
  if (value === null || value === undefined || value === "") return "-";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${amount >= 0 ? "+" : "-"}¥${Math.abs(amount).toLocaleString("zh-CN", {maximumFractionDigits: 2})}`;
}

function percentOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : formatPercent(value);
}

function countOrDash(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

export function calculateRiskAssessment(metrics = {}, risk = {}) {
  const sampleCount = Number(metrics.order_count ?? risk.sample_count ?? 0);
  if (!sampleCount) return {level: "insufficient", label: "样本不足", score: null, factors: []};

  const factors = [];
  let pressurePoints = 0;
  const addFactor = (key, label, detail, points) => {
    factors.push({key, label, detail, points});
    pressurePoints += points;
  };
  const feePressure = Number(risk.fee_pressure ?? Math.abs(Number(metrics.fee_total || 0)) / Math.max(Math.abs(Number(metrics.trade_pnl || 0)), 1));
  const profitFactor = Number(risk.profit_factor ?? metrics.profit_factor);
  const grossLoss = Math.max(Math.abs(Number(risk.gross_loss ?? metrics.gross_loss ?? 0)), 1);
  const maxDrawdown = Math.max(0, Number(risk.max_drawdown || 0));
  const maxLoss = Math.abs(Number(risk.max_loss ?? metrics.max_loss ?? 0));
  const lossStreak = Number(risk.longest_loss_streak || 0);
  if (maxDrawdown / grossLoss >= 0.5) addFactor("drawdown", "已实现最大回撤", money(-maxDrawdown), 2);
  if (feePressure >= 0.2) addFactor("fees", "手续费压力", formatPercent(feePressure), 2);
  if (Number.isFinite(profitFactor) && profitFactor < 1) addFactor("profit_factor", "净盈亏比", formatRatio(profitFactor), 3);
  else if (Number.isFinite(profitFactor) && profitFactor < 1.3) addFactor("profit_factor", "净盈亏比", formatRatio(profitFactor), 1);
  if (maxLoss / grossLoss >= 0.5) addFactor("loss_concentration", "最大亏损集中度", formatPercent(maxLoss / grossLoss), 1);
  if (lossStreak >= 3) addFactor("loss_streak", "最长连续亏损", `${lossStreak} 笔`, 2);
  if (sampleCount < 20) factors.push({key: "sample", label: "样本量", detail: `${sampleCount} 笔，仅供观察`, points: 0});

  const score = Math.min(100, pressurePoints * 12.5);
  const level = pressurePoints >= 5 ? "high" : pressurePoints >= 2 || sampleCount < 20 ? "warn" : "low";
  return {
    level,
    label: level === "high" ? "压力偏高" : level === "warn" && sampleCount < 20 && pressurePoints < 2 ? "样本有限" : level === "warn" ? "需要留意" : "压力可控",
    score: Math.round(score),
    factors,
  };
}

function compactMoney(value) {
  const amount = Number(value || 0);
  const sign = amount >= 0 ? "+" : "-";
  const absolute = Math.abs(amount);
  if (absolute >= 10000) return `${sign}¥${(absolute / 10000).toFixed(1)}万`;
  if (absolute >= 1000) return `${sign}¥${(absolute / 1000).toFixed(1)}k`;
  return money(amount);
}

function safe(value) {
  return escapeHtml(value ?? "");
}

function setHtml(view, id, html) {
  const node = view.getElementById(id);
  if (node) node.innerHTML = html;
}

function setText(view, id, value) {
  const node = view.getElementById(id);
  if (node) node.textContent = value;
}

function renderEmpty(view, id, message = "当前范围暂无数据") {
  setHtml(view, id, `<div class="domestic-empty">${safe(message)}</div>`);
}

function renderPeriodCards(view, payload) {
  const periods = payload?.fixed_periods || {};
  setHtml(view, "domesticFixedPeriods", PERIODS.map(([key, label, note], index) => {
    const item = periods[key] || {};
    const hasData = Number(item.order_count || 0) > 0;
    const fee = Number(item.fee_total || 0);
    const tradePnl = Number(item.trade_pnl || 0);
    return `<article class="domestic-period-card period-accent-${index}${hasData ? "" : " domestic-period-card--empty"}">
      <div class="domestic-period-head"><strong>${label}</strong><span>${note}</span></div>
      <div class="domestic-period-net ${hasData ? profitClass(item.net_pnl) : ""}">${hasData ? money(item.net_pnl) : "暂无数据"}</div>
      <div class="domestic-period-metrics">
        <span>交易盈亏<strong>${hasData ? money(tradePnl) : "-"}</strong></span>
        <span>手续费<strong class="domestic-fee">${hasData ? money(fee) : "-"}</strong></span>
        <span>交易笔数<strong>${countOrDash(item.order_count)}</strong></span>
        <span>盈亏比<strong>${hasData ? formatRatio(item.profit_factor) : "-"}</strong></span>
        <span>胜率<strong>${hasData ? percentOrDash(item.win_rate) : "-"}</strong></span>
        <span>打平占比<strong>${hasData ? formatPercent((item.breakeven_count || 0) / item.order_count) : "-"}</strong></span>
      </div>
    </article>`;
  }).join(""));
}

function renderPerformanceSummary(view, payload) {
  const metrics = payload?.metrics || {};
  setHtml(view, "domesticNetSummary", `<span>交易盈亏 <strong>${money(metrics.trade_pnl)}</strong></span><span>手续费 <strong class="domestic-fee">${money(metrics.fee_total)}</strong></span><span>净盈亏 <strong class="${profitClass(metrics.net_pnl)}">${money(metrics.net_pnl)}</strong></span>`);
}

function renderRisk(view, payload) {
  const metrics = payload?.metrics || {};
  const risk = payload?.risk_summary || {};
  const assessment = calculateRiskAssessment(metrics, risk);
  if (assessment.level === "insufficient") {
    return renderEmpty(view, "domesticRiskHealth", "当前范围暂无已实现交易，无法评估风险压力");
  }
  const feePressure = Number(risk.fee_pressure || 0);
  const tone = assessment.level === "low" ? "good" : assessment.level === "warn" ? "warn" : "bad";
  const factorHtml = assessment.factors.filter((factor) => factor.key !== "sample").map((factor) => `<div><span>${safe(factor.label)}</span><strong class="${factor.points >= 2 ? "loss-text" : ""}">${safe(factor.detail)}</strong></div>`).join("");
  const sampleNote = assessment.factors.find((factor) => factor.key === "sample");
  setHtml(view, "domesticRiskHealth", `<div class="domestic-risk-score"><div><span>风险压力评分</span><strong>${assessment.score} / 100</strong></div><em class="${tone}">${assessment.label}</em></div>
    <div class="domestic-risk-list">${factorHtml || `<div><span>主要风险因子</span><strong>未发现明显压力</strong></div>`}</div>
    <div class="domestic-risk-meter"><i style="width:${assessment.score}%"></i></div><small>仅基于已实现交易结果：最大回撤、手续费压力、盈亏比、亏损集中度和连续亏损；${sampleNote ? sampleNote.detail + "。" : ""}不代表保证金或实时净值风险。</small>`);
}

function renderCalendar(view, payload) {
  const calendar = payload?.calendar;
  if (!calendar) return renderEmpty(view, "domesticCalendar");
  const days = Object.values(calendar.days || {});
  const first = (new Date(calendar.year, calendar.month - 1, 1).getDay() + 6) % 7;
  const cells = Array.from({length: first}, () => `<span class="domestic-day empty"></span>`);
  days.forEach((day) => {
    const amount = Number(day.net_pnl || 0);
    cells.push(`<span class="domestic-day ${amount > 0 ? "positive" : amount < 0 ? "negative" : "flat"}" title="${safe(day.label)} ${safe(money(amount))}"><b>${safe(day.label.slice(-2))}</b><small>${amount ? safe(compactMoney(amount)) : "-"}</small></span>`);
  });
  setHtml(view, "domesticCalendar", `<div class="domestic-calendar-summary"><strong class="${profitClass(calendar.month_net_pnl)}">${money(calendar.month_net_pnl)}</strong><span>${calendar.year}年${calendar.month}月 · ${calendar.month_order_count || 0} 笔 · 胜率 ${formatPercent(calendar.month_win_rate)}</span></div><div class="domestic-calendar-grid">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span class="weekday">${day}</span>`).join("")}${cells.join("")}</div>`);
}

function renderContracts(view, payload) {
  const rankings = payload?.contract_rankings || {};
  const table = (rows, empty, losses = false) => rows?.length ? `<table class="domestic-table"><thead><tr><th>合约</th><th>笔数</th><th>${losses ? "净亏损" : "净盈亏"}</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${safe(row.contract_name || row.symbol)}</strong><small>${safe(row.product_name || row.symbol)}</small></td><td>${row.order_count || 0}</td><td class="${profitClass(row.net_pnl)}">${money(row.net_pnl)}</td></tr>`).join("")}</tbody></table>` : `<div class="domestic-empty">${empty}</div>`;
  setHtml(view, "domesticContractContribution", table(rankings.contribution, "暂无合约贡献数据"));
  setHtml(view, "domesticContractLosses", table(rankings.losses, "暂无亏损合约", true));
}

function renderDataHealth(view, payload, importSummary, platform = "domestic_futures") {
  const metrics = payload?.metrics || {};
  const latest = importSummary?.latest_trade;
  const status = platform === "mt5"
    ? (metrics.order_count ? "已读取本地组合" : "等待 MT5 同步")
    : (latest ? "最近导入成功" : "等待数据导入");
  const note = platform === "mt5"
    ? (metrics.order_count ? "统计以合并后的交易组合为单位" : "可在 MT5 工作区执行同步")
    : (latest ? safe(String(latest.time_bj || "").replace("T", " ").slice(0, 16)) : "可在设置页导入成交记录");
  setHtml(view, "domesticDataHealth", `<div class="domestic-health-status"><span class="health-dot"></span><div><strong>${status}</strong><small>${note}</small></div></div><div class="domestic-health-list"><span>分析交易<strong>${metrics.order_count || 0}</strong></span><span>盈利笔数<strong>${metrics.win_count || 0}</strong></span><span>亏损笔数<strong>${metrics.loss_count || 0}</strong></span><span>费用记录<strong>${metrics.fee_total ? "已计入" : "暂无"}</strong></span></div>`);
}

function renderReviewCoverage(view, payload) {
  const coverage = payload?.review_coverage || {};
  const total = Number(coverage.total || payload?.metrics?.order_count || 0);
  const reviewed = Number(coverage.reviewed || 0);
  const percent = total ? Math.round(reviewed / total * 100) : 0;
  setHtml(view, "domesticReviewCoverage", `<p>填写初始止损即视为复盘完成</p><div class="domestic-review-meter"><i style="width:${percent}%"></i></div><div class="domestic-review-meta"><strong>${percent}%</strong><span>${reviewed} / ${total} 笔已完成</span></div><div class="domestic-review-note">尚未填写初始止损：${Math.max(0, total - reviewed)} 笔</div>`);
}

function renderSystemEvaluation(view, payload) {
  const rows = [...(payload?.domestic_system_evaluation || [])].reverse();
  setHtml(view, "domesticSystemEvaluation", rows.length ? `<table class="domestic-table domestic-evaluation-table"><thead><tr><th>交易日</th><th>交易盈亏</th><th>手续费</th><th>净盈亏</th><th>笔数</th><th>盈亏比</th><th>胜率</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${safe(row.date)}</td><td>${money(row.trade_pnl)}</td><td class="domestic-fee">${money(row.fee_total)}</td><td class="${profitClass(row.net_pnl)}">${money(row.net_pnl)}</td><td>${row.order_count || 0}</td><td>${formatRatio(row.profit_factor)}</td><td>${formatPercent(row.win_rate)}</td></tr>`).join("")}</tbody></table>` : `<div class="domestic-empty">当前范围暂无交易日评估</div>`);
}

function renderModeEvaluation(view, payload) {
  const evaluation = payload?.mode_evaluation || {};
  const groups = [["交易类型", evaluation.trade_type || []], ["交易策略", evaluation.strategy || []]];
  setHtml(view, "domesticModeEvaluation", groups.map(([title, rows]) => `<section class="domestic-mode-group"><header><strong>${title}</strong><span>净盈亏</span><span>盈亏比</span><span>胜率</span></header>${rows.length ? rows.map((row) => `<div class="domestic-mode-row"><span>${safe(row.label || row.key)}</span><b class="${profitClass(row.net_pnl)}">${money(row.net_pnl)}</b><small>${formatRatio(row.profit_factor)}</small><small>${row.order_count || 0} 笔 · ${formatPercent(row.cash_win_rate ?? row.win_rate)}</small></div>`).join("") : `<div class="domestic-empty">暂无分类数据</div>`}</section>`).join(""));
}

function renderRMetrics(view, payload) {
  const metrics = payload?.r_metrics || {};
  const cash = payload?.metrics || {};
  const values = [
    ["总净盈亏", money(cash.net_pnl), profitClass(cash.net_pnl)],
    ["交易笔数", countOrDash(cash.order_count), ""],
    ["净盈亏比", formatRatio(cash.payoff_ratio), ""],
    ["净胜率", percentOrDash(metrics.decisive_win_rate), ""],
    ["平均 ER", metrics.expectancy_r == null ? "-" : Number(metrics.expectancy_r).toFixed(2), ""],
    ["SQN", metrics.sqn_status === "available" ? Number(metrics.sqn).toFixed(2) : "样本不足", ""],
    ["R 完整度", percentOrDash(metrics.coverage_rate), ""],
  ];
  setHtml(view, "domesticRMetrics", `<div class="domestic-r-grid">${values.map(([label, value, tone]) => `<div><span>${label}</span><strong class="${tone}">${value}</strong></div>`).join("")}</div><small class="domestic-module-note">已完成 R 计算：${metrics.complete_count || 0} / ${metrics.sample_count || 0} 笔组合</small>`);
}

function heatColor(pnl, maxAbs) {
  const value = Number(pnl || 0);
  if (!value || !maxAbs) return "#f1f5f4";
  const intensity = Math.min(1, Math.abs(value) / maxAbs);
  return value > 0 ? `rgba(6,157,145,${0.12 + intensity * 0.68})` : `rgba(240,87,120,${0.12 + intensity * 0.68})`;
}

function renderHeatmap(view, payload) {
  const heatmap = payload?.heatmap;
  if (!heatmap) return renderEmpty(view, "domesticHeatmap");
  const cells = (heatmap.days || []).map((day) => `<div class="domestic-heatmap-row"><strong>${safe(day.date.slice(5))}</strong><div class="domestic-heatmap-hours">${(day.hours || []).map((cell) => `<i style="background:${heatColor(cell.net_pnl, heatmap.max_abs_pnl)}" title="${safe(`${day.date} ${String(cell.hour).padStart(2, "0")}:00 ${money(cell.net_pnl)} ${cell.order_count || 0} 笔`)}">${cell.order_count ? `<b>${cell.order_count}</b>` : ""}</i>`).join("")}</div><span class="${profitClass(day.hours?.reduce((sum, cell) => sum + Number(cell.net_pnl || 0), 0))}">${money(day.hours?.reduce((sum, cell) => sum + Number(cell.net_pnl || 0), 0))}</span></div>`).join("");
  setHtml(view, "domesticHeatmap", `<div class="domestic-heatmap-axis"><span></span><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div><div class="domestic-heatmap">${cells || `<div class="domestic-empty">当前范围暂无时段数据</div>`}</div>`);
}

function renderSessions(view, payload) {
  const labels = {asia: "亚盘", europe: "欧盘", us: "美盘"};
  const rows = Object.entries(payload?.sessions || {}).map(([key, item]) => `<div class="domestic-session-row"><div><strong>${labels[key] || safe(item.label)}</strong><small>${safe(item.window)} 北京时间</small></div><b class="${profitClass(item.net_pnl)}">${money(item.net_pnl)}</b><span>${item.order_count || 0} 笔 · 胜率 ${formatPercent(item.win_rate)}</span></div>`).join("");
  setHtml(view, "domesticSessions", rows || `<div class="domestic-empty">当前范围暂无时段数据</div>`);
}

export function createDomesticFuturesDashboardController({api, view = globalThis.document, location = globalThis.location, history = globalThis.history, onRefresh = null, platform = readPlatform(location)} = {}) {
  platform = normalizePlatform(platform);
  const gate = new RequestGate();
  let state = readDashboardState(location.search);
  let payload = null;
  let importSummary = null;
  let charts = null;
  let gridController = null;
  const root = view.getElementById("domesticDashboard");

  async function load() {
    state = readDashboardState(location.search);
    const windowState = resolveAnalysisWindow(state);
    const query = buildAnalysisQuery(state, windowState);
    const analysisQuery = `${query}&platform=${encodeURIComponent(platform)}`;
    try {
      const analysis = gate.run("domestic-analysis", (signal) => api.requestJson(`/api/analysis?${analysisQuery}`, {signal}));
      const imports = platform === "domestic_futures"
        ? api.requestJson("/api/platforms/import-summary?platform=domestic_futures").catch(() => null)
        : Promise.resolve(null);
      [payload, importSummary] = await Promise.all([analysis, imports]);
      renderAll();
    } catch (error) {
      if (error?.name === "AbortError") return;
      root?.removeAttribute("hidden");
      setText(view, "domesticDashboardStatus", error?.message || "读取账户分析数据失败");
    }
  }

  function renderAll() {
    if (!root) return;
    root.removeAttribute("hidden");
    const legacy = view.getElementById("legacyDashboard");
    if (legacy) legacy.hidden = true;
    const stage = root.querySelector?.(".domestic-dashboard-stage");
    if (!gridController) {
      gridController = createDashboardGrid({
        root: stage,
        layout: loadLayout(),
        selector: "[data-module]",
        editable: false,
        GridStack: globalThis.GridStack,
        document: view,
      });
    }
    charts ||= createDomesticFuturesCharts({view});
    renderPeriodCards(view, payload);
    charts.update(payload);
    renderPerformanceSummary(view, payload);
    renderRisk(view, payload);
    renderCalendar(view, payload);
    renderContracts(view, payload);
    renderDataHealth(view, payload, importSummary, platform);
    renderReviewCoverage(view, payload);
    renderSystemEvaluation(view, payload);
    renderModeEvaluation(view, payload);
    renderRMetrics(view, payload);
    renderHeatmap(view, payload);
    renderSessions(view, payload);
    const rangeLabel = state.preset === "all"
      ? "全部时间"
      : (FILTER_PRESETS.find((item) => item.value === state.preset)?.label || "自定义");
    setText(view, "domesticDashboardStatus", `当前范围：${rangeLabel} · 固定周期指标不受上方范围影响`);
    if (globalThis.lucide) globalThis.lucide.createIcons();
  }

  function bindFilters() {
    const presets = [...view.querySelectorAll("[data-domestic-preset]")];
    const customDates = view.querySelector("[data-domestic-custom-dates]");
    const start = view.getElementById("domesticStartDate");
    const end = view.getElementById("domesticEndDate");
    const syncPresetUi = () => {
      presets.forEach((button) => {
        const active = button.dataset.domesticPreset === state.preset;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
      });
      if (customDates) customDates.hidden = state.preset !== "custom";
    };
    presets.forEach((button) => button.addEventListener("click", () => {
      const next = button.dataset.domesticPreset;
      commitState({preset: next, start: next === "custom" ? state.start : "", end: next === "custom" ? state.end : ""});
      syncPresetUi();
      load();
    }));
    if (start) start.value = state.start || "";
    if (end) end.value = state.end || "";
    start?.addEventListener("change", (event) => { commitState({preset: "custom", start: event.target.value}); load(); });
    end?.addEventListener("change", (event) => { commitState({preset: "custom", end: event.target.value}); load(); });
    syncPresetUi();
  }

  function commitState(next) {
    state = {...state, ...next};
    writeDashboardState(state, {location, history});
  }

  function init() {
    const legacy = view.getElementById("legacyDashboard");
    if (legacy) legacy.hidden = true;
    root?.removeAttribute("hidden");
    mountShell({activeRoute: "/dashboard/", title: "复盘仪表盘", onRefresh, refreshLabel: platform === "domestic_futures" ? "导入数据" : "刷新数据", refreshIcon: platform === "domestic_futures" ? "upload" : "refresh-cw", refreshErrorMessage: platform === "domestic_futures" ? "打开数据导入失败" : "刷新数据失败", share: true, location});
    bindFilters();
  }

  function dispose() { gate.abortAll(); charts?.dispose(); gridController?.destroy?.(); }

  return {init, load, dispose, getState: () => state};
}

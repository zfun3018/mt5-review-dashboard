import { RequestGate } from "../shared/js/api.mjs";
import {
  escapeAttr,
  escapeHtml,
  formatMoney,
  formatPercent,
  formatR,
  formatRatio,
  formatRValue,
  formatZoneTime,
  formatZScore,
  profitClass,
} from "../shared/js/formatters.mjs";
import { renderRegionState } from "../shared/js/feedback.mjs";
import { mountShell } from "../shared/js/shell.mjs";
import { normalizePlatform, readPlatform } from "../shared/js/platform.mjs";
import {
  buildAnalysisQuery,
  readDashboardState,
  resolveAnalysisWindow,
  writeDashboardState,
} from "./dashboard-state.mjs";
import {loadLayout} from "./dashboard-layout.mjs";
import {createDashboardGrid} from "./dashboard-grid.mjs";
import {createMt5DashboardCharts} from "./mt5-dashboard-charts.mjs";

function minutesInZone(date, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour").value);
  const minute = Number(parts.find((part) => part.type === "minute").value);
  return (hour % 24) * 60 + minute;
}

function inSession(current, start, end) {
  if (start <= end) return current >= start && current < end;
  return current >= start || current < end;
}

function sessionProgress(current, start, end) {
  if (!inSession(current, start, end)) return 0;
  const duration = start <= end ? end - start : 24 * 60 - start + end;
  const elapsed = current >= start ? current - start : 24 * 60 - start + current;
  return Math.max(4, Math.min(100, Math.round((elapsed / duration) * 100)));
}

function nextSession(sessions, current) {
  return sessions
    .map((session) => {
      const distance = session.start >= current ? session.start - current : 24 * 60 - current + session.start;
      return { ...session, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
}

function minutesToClock(minutes) {
  const hour = Math.floor(minutes / 60) % 24;
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const METRIC_STATE_LABELS = Object.freeze({
  insufficient_data: {label: "样本不足", tone: "insufficient"},
  incomplete_data: {label: "数据不完整", tone: "incomplete"},
  estimated: {label: "估算", tone: "estimated"},
  not_applicable: {label: "不适用", tone: "not-applicable"},
});

function metricState(meta = {}) {
  const state = METRIC_STATE_LABELS[String(meta?.status || "")];
  return state ? {...state, status: String(meta.status)} : null;
}

function metricValue(value, formatter, meta = {}) {
  const state = metricState(meta);
  if (state && !["available", "estimated"].includes(state.status)) return state.label;
  return formatter(value);
}

function metricQualityBadge(meta = {}) {
  const state = metricState(meta);
  if (!state) return "";
  return `<em class="metric-quality metric-quality-${state.tone}" title="${state.label}">${state.label}</em>`;
}

function compactMetricText(value) {
  return value === "样本不足" ? "!" : value;
}

function metricExplanation(metricKey, context) {
  const rMultipleUI = globalThis.RMultipleUI;
  if (rMultipleUI && typeof rMultipleUI.metricExplanation === "function") {
    return rMultipleUI.metricExplanation(metricKey, context);
  }
  return { title: metricKey, formula: "-", threshold: "-", sample: "-", missing: "-", limitation: "-" };
}

function metricContext(metrics = {}, extra = {}) {
  const context = {
    scratchThresholdR: Number(metrics.scratch_threshold_r ?? 0.15),
    sampleCount: Number(metrics.sample_count || 0),
    completeCount: Number(metrics.complete_count || 0),
    missingCount: Number(metrics.missing_count || 0),
    missingPositionCount: Number(extra.missingPositionCount || 0),
  };
  if (extra.metricMeta) context.metricMeta = extra.metricMeta;
  return context;
}

function formatMetricCoverage(value) {
  if (value === null || value === undefined || value === "") return "未提供";
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1
    ? `${Math.round(numeric * 100)}%`
    : String(value);
}

function renderMetricMetadata(meta = {}) {
  if (!meta || typeof meta !== "object" || !Object.keys(meta).length) return "";
  const status = METRIC_STATE_LABELS[String(meta.status || "")];
  const version = meta.definition_version ?? meta.formula_version;
  const warnings = Array.isArray(meta.warnings) ? meta.warnings : meta.warnings ? [meta.warnings] : [];
  const rows = [
    status ? `<div><dt>状态</dt><dd>${escapeHtml(status.label)}</dd></div>` : "",
    version !== undefined && version !== null ? `<div><dt>公式版本</dt><dd>${escapeHtml(version)}</dd></div>` : "",
    meta.sample_count !== undefined && meta.sample_count !== null ? `<div><dt>样本数</dt><dd>${escapeHtml(meta.sample_count)}</dd></div>` : "",
    meta.coverage !== undefined ? `<div><dt>覆盖范围</dt><dd>${escapeHtml(formatMetricCoverage(meta.coverage))}</dd></div>` : "",
  ].filter(Boolean).join("");
  const warningMarkup = warnings.length
    ? `<div><dt>警告</dt><dd><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></dd></div>`
    : "";
  return rows || warningMarkup ? `<dl class="metric-meta-list">${rows}${warningMarkup}</dl>` : "";
}

export function getDashboardWorkspaceConfig(platform = "mt5") {
  if (normalizePlatform(platform) === "domestic_futures") {
    return {
      showMarketClock: false,
      showSessions: false,
      actionLabel: "导入数据",
      actionIcon: "upload",
    };
  }
  return {
    showMarketClock: true,
    showSessions: true,
    actionLabel: "刷新数据",
    actionIcon: "refresh-cw",
  };
}

export function createDashboardController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  onRefresh = null,
  platform = readPlatform(location),
} = {}) {
  const gate = new RequestGate();
  let state = readDashboardState(location.search);
  let payload = null;
  let metricExplanationTrigger = null;
  let calendarYear = null;
  let calendarMonth = null;
  const workspace = getDashboardWorkspaceConfig(platform);
  let importSummary = null;
  let gridController = null;
  let chartController = null;

  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function metricMetaFor(key) {
    return payload?.metric_meta?.[key] || {};
  }

  function metricMetaForKey(key) {
    const summaryKeys = new Set(["net_pnl", "campaign_count", "cash_profit_factor", "cash_win_rate", "payoff_ratio"]);
    return metricMetaFor(summaryKeys.has(key) ? "summary" : "r_metrics");
  }

  function setHtml(id, html) {
    const node = getElement(id);
    if (node) node.innerHTML = html;
  }

  function setText(id, text) {
    const node = getElement(id);
    if (node) node.textContent = text;
  }

  function renderLatestImportSummary() {
    const node = getElement("latestImportSummary");
    if (!node) return;
    if (workspace.showMarketClock) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    const latest = importSummary?.latest_trade;
    if (!latest) {
      node.textContent = "最近导入订单：暂无";
      return;
    }
    const time = String(latest.time_bj || "").replace("T", " ").slice(0, 16);
    const contract = latest.contract_name || latest.symbol || "未知合约";
    node.textContent = `最近导入订单：${time} · ${contract}`;
  }

  function applyWorkspaceVisibility() {
    const marketClock = getElement("marketClock");
    const sessionPanel = getElement("sessionPanel");
    if (marketClock) marketClock.hidden = !workspace.showMarketClock;
    if (sessionPanel) sessionPanel.hidden = !workspace.showSessions;
  }

  function applyDashboardLayout() {
    const domesticRoot = getElement("domesticDashboard");
    const legacyRoot = getElement("legacyDashboard");
    if (domesticRoot) domesticRoot.hidden = true;
    if (legacyRoot) legacyRoot.hidden = false;
    if (normalizePlatform(platform) !== "mt5") return;
    const layoutRoot = getElement("mt5DashboardLayout");
    gridController?.destroy?.();
    gridController = createDashboardGrid({
      root: layoutRoot,
      layout: loadLayout(globalThis.localStorage, "mt5"),
      selector: "[data-layout-module]",
      editable: false,
      GridStack: globalThis.GridStack,
      document: view,
    });
  }

  function renderRegion(regionId, options) {
    const node = getElement(regionId);
    if (!node || typeof node.replaceChildren !== "function") return;
    renderRegionState(node, options);
  }

  function commitState(partial) {
    state = { ...state, ...partial };
    writeDashboardState(state, { location, history });
  }

  // --- rendering ---

  function renderMarketClock() {
    if (!workspace.showMarketClock) return;
    const now = new Date();
    const bj = minutesInZone(now, "Asia/Shanghai");
    const sessions = [
      { key: "asia", name: "亚盘", city: "Tokyo", zone: "Asia/Tokyo", window: "08:00-15:00 BJT", start: 8 * 60, end: 15 * 60, note: "流动性中等，日内方向初现", volatile: "10:00-11:30 常见第一波" },
      { key: "europe", name: "欧盘", city: "London", zone: "Europe/London", window: "15:00-20:00 BJT", start: 15 * 60, end: 20 * 60, note: "欧盘开盘，波动开始放大", volatile: "15:00-17:00 高波动" },
      { key: "us", name: "美盘", city: "New York", zone: "America/New_York", window: "20:00-02:00 BJT", start: 20 * 60, end: 2 * 60, note: "美盘开盘，新闻与成交集中", volatile: "20:30-23:00 高波动" },
    ];
    const active = sessions.filter((session) => inSession(bj, session.start, session.end));
    const next = nextSession(sessions, bj);
    const alertTitle = active.length
      ? `当前 ${active.map((item) => item.name).join(" / ")}`
      : `下一盘 ${next.name} ${minutesToClock(next.start)}`;
    const alertText = active.length
      ? active.map((item) => item.volatile).join("；")
      : `${next.name}开盘前留意价差和流动性变化`;
    const cards = sessions
      .map((session) => {
        const activeNow = inSession(bj, session.start, session.end);
        const progress = sessionProgress(bj, session.start, session.end);
        return `
          <article class="market-card ${activeNow ? "active" : ""}">
            <header><strong>${session.name}</strong><span>${session.city} ${formatZoneTime(now, session.zone)}</span></header>
            <div class="market-time">${session.window}</div>
            <div class="market-progress"><span style="width:${progress}%"></span></div>
            <span>${activeNow ? "进行中" : session.note} · ${session.volatile}</span>
          </article>
        `;
      })
      .join("");
    setHtml("marketClock", `
      <article class="market-alert">
        <span>WORLD SESSION</span>
        <strong>${escapeHtml(alertTitle)}</strong>
        <span>${escapeHtml(alertText)}</span>
      </article>
      ${cards}
    `);
  }

  function renderRMetricSummary() {
    const metrics = payload?.r_metrics || {};
    const cash = payload?.metrics || payload || {};
    const summaryMeta = metricMetaFor("summary");
    const rMeta = metricMetaFor("r_metrics");
    const formatSqn = (value) => metrics.sqn_status === "available" ? Number(value).toFixed(2) : "!";
    const items = [
      ["net_pnl", "总盈利", metricValue(cash.net_pnl, formatMoney, summaryMeta), metricState(summaryMeta) ? "" : profitClass(cash.net_pnl), summaryMeta],
      ["campaign_count", "交易笔数", metricValue(cash.order_count ?? metrics.sample_count ?? 0, String, summaryMeta), "", summaryMeta],
      ["payoff_ratio", "净盈亏比", metricValue(cash.payoff_ratio, formatRatio, summaryMeta), "", summaryMeta],
      ["decisive_win_rate", "净胜率（剔除打平）", metricValue(metrics.decisive_win_rate, formatPercent, rMeta), "", rMeta],
      ["expectancy_r", "平均数学期望（ER）", metricValue(metrics.expectancy_r, formatRValue, rMeta), "", rMeta],
      ["sqn", "收益稳定度（SQN）", metricValue(metrics.sqn, formatSqn, rMeta), "", rMeta],
      ["z_score", "Z 分数", metricValue(metrics.z_score, (value) => compactMetricText(formatZScore(value)), rMeta), "", rMeta],
    ];
    setHtml(
      "rMetricSummary",
      items
        .map(
          ([key, label, value, tone = "", meta = {}]) => `
            <div class="r-metric-item">
              <span>${escapeHtml(label)} ${metricInfoButton(key, label, metrics, {metricMeta: meta})}</span>
              <strong class="${tone}">${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join(""),
    );
  }

  function renderEquity() {
    const sourcePoints = payload?.equity || [];
    const equityMeta = metricMetaFor("equity_curve");
    const rawDelta = sourcePoints.at(-1)?.cumulative_return;
    const delta = Number(rawDelta);
    const deltaText = metricValue(rawDelta, (value) => {
      const amount = Number(value);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      return `${safeAmount >= 0 ? "+" : ""}${formatMoney(safeAmount)} 区间回报`;
    }, equityMeta);
    const deltaNode = getElement("equityDelta");
    if (deltaNode) {
      deltaNode.textContent = deltaText;
      deltaNode.className = `status-pill ${metricState(equityMeta) ? "" : profitClass(delta)}`;
    }
  }

  function renderSystemEvaluationSummary() {
    const periods = payload?.periods || {};
    const periodsMeta = metricMetaFor("periods");
    const items = [
      ["本日", periods.today],
      ["本周", periods.week],
      ["本月", periods.month],
      ["本年", periods.year],
    ].filter(([, item]) => item);
    setHtml(
      "systemEvaluationSummary",
      items
        .map(([label, item]) => {
          const r = item.r_metrics || {};
          const sqn = metricValue(r.sqn, (value) => r.sqn_status === "available" ? Number(value).toFixed(2) : "!", periodsMeta);
          return `
            <article class="evaluation-summary-card">
              <header><span>${escapeHtml(label)}</span><strong class="${metricState(periodsMeta) ? "" : profitClass(item.net_pnl)}">${escapeHtml(metricValue(item.net_pnl, formatMoney, periodsMeta))}</strong></header>
              <div class="evaluation-summary-grid-inner">
                <span>交易笔数<strong>${metricValue(r.sample_count, String, periodsMeta)}</strong></span>
                <span>总盈亏比<strong>${metricValue(item.profit_factor, formatRatio, periodsMeta)}</strong></span>
                <span>净盈亏比<strong>${metricValue(item.payoff_ratio, formatRatio, periodsMeta)}</strong></span>
                <span>总胜率<strong>${metricValue(item.cash_win_rate ?? item.win_rate, formatPercent, periodsMeta)}</strong></span>
                <span>净胜率（剔除打平）<strong>${metricValue(r.decisive_win_rate, formatPercent, periodsMeta)}</strong></span>
                <span>平均数学期望（ER）<strong>${metricValue(r.expectancy_r, (value) => compactMetricText(formatRValue(value)), periodsMeta)}</strong></span>
                <span>收益稳定度（SQN）<strong>${sqn}</strong></span>
                <span class="evaluation-z-row"><span>交易结果连续性（Z 分数） ${metricInfoButton("z_score", "交易结果连续性（Z 分数）", r, {metricMeta: periodsMeta})}</span><strong>${escapeHtml(metricValue(r.z_score || item.z_score, (value) => compactMetricText(formatZScore(value)), periodsMeta))}</strong></span>
              </div>
            </article>
          `;
        })
        .join("") || `<div class="detail-empty">当前范围暂无交易</div>`,
    );
  }

  function renderSystemEvaluation() {
    const allRows = [...(payload?.system_evaluation || [])];
    const evaluationMeta = metricMetaFor("system_evaluation");
    const rows = allRows.slice(-30).reverse();
    setHtml(
      "systemEvaluationRows",
      rows
        .map((row) => {
          const r = row.r_metrics || {};
          const sqn = metricValue(r.sqn, (value) => r.sqn_status === "available" ? Number(value).toFixed(2) : "!", evaluationMeta);
          return `
            <tr>
              <td><strong>${escapeHtml(row.date)}</strong></td>
              <td class="${metricState(evaluationMeta) ? "" : profitClass(row.net_pnl)}">${metricValue(row.net_pnl, formatMoney, evaluationMeta)}</td>
              <td>${metricValue(row.order_count, String, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(row.profit_factor, formatRatio, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(row.payoff_ratio, formatRatio, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(row.cash_win_rate ?? row.win_rate, formatPercent, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(r.decisive_win_rate, formatPercent, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(r.scratch_rate, formatPercent, evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${metricValue(r.expectancy_r, (value) => compactMetricText(formatRValue(value)), evaluationMeta)} ${metricQualityBadge(evaluationMeta)}</td>
              <td>${sqn} ${metricQualityBadge(evaluationMeta)}</td>
            </tr>
          `;
        })
        .join("") || `<tr><td colspan="10">当前范围暂无交易</td></tr>`,
    );
    setHtml(
      "systemEvaluationPagination",
      rows.length ? `<span>显示最近 ${rows.length} / ${allRows.length} 个交易日 · 可在表格内滚动查看</span>` : "",
    );
  }

  function renderModeEvaluation() {
    const modeMeta = metricMetaFor("mode_evaluation");
    const modeState = metricState(modeMeta);
    if (modeState && modeState.status !== "estimated") {
      setHtml("modeEvaluation", `<div class="detail-empty metric-state-${modeState.tone}">${modeState.label}</div>`);
      return;
    }
    const evaluation = payload?.mode_evaluation || { trade_type: [], strategy: [] };
    const groups = [
      ["交易场景", evaluation.trade_type || []],
      ["交易策略", evaluation.strategy || []],
    ];
    setHtml(
      "modeEvaluation",
      groups
        .map(
          ([title, rows]) => `
            <section class="mode-group">
              <h3>${title}</h3>
              <div class="mode-card-grid mode-card-grid--${rows.length}">
                ${rows.map((row) => `
                  <article class="mode-card">
                    <header><strong>${escapeHtml(row.label || row.key)}</strong><span>${formatPercent(row.share)}</span></header>
                    <div class="${profitClass(row.net_pnl)}">${formatMoney(row.net_pnl)}</div>
                    <small>${row.order_count} 笔交易 · 总胜率 ${formatPercent(row.cash_win_rate ?? row.win_rate)} · 总盈亏比 ${formatRatio(row.profit_factor)}</small>
                    <dl class="mode-r-metrics">
                      <div><dt>净胜率（剔除打平）</dt><dd>${formatPercent(row.r_metrics?.decisive_win_rate)}</dd></div>
                      <div><dt>有效胜率</dt><dd>${formatPercent(row.r_metrics?.all_sample_win_rate)}</dd></div>
                      <div><dt>打平占比</dt><dd>${formatPercent(row.r_metrics?.scratch_rate)}</dd></div>
                      <div><dt>平均数学期望（ER）</dt><dd>${compactMetricText(formatRValue(row.r_metrics?.expectancy_r))}</dd></div>
                      <div><dt>收益稳定度（SQN）</dt><dd>${row.r_metrics?.sqn_status === "available" ? Number(row.r_metrics.sqn).toFixed(2) : "!"}</dd></div>
                    </dl>
                  </article>
                `).join("") || `<div class="detail-empty">当前范围暂无数据</div>`}
              </div>
            </section>
          `,
        )
        .join(""),
    );
  }

  function renderCalendar() {
    const calendar = payload?.calendar;
    if (!calendar) return;
    const calendarMeta = metricMetaFor("calendar");
    const calendarState = metricState(calendarMeta);
    setText("calendarMonthLabel", `${calendar.year} 年 ${String(calendar.month).padStart(2, "0")} 月`);
    if (calendarState && calendarState.status !== "estimated") {
      setHtml("calendarStats", `<div class="detail-empty metric-state-${calendarState.tone}">${calendarState.label}</div>`);
      setHtml("calendarGrid", "");
      return;
    }
    setHtml(
      "calendarStats",
      [
        ["净盈亏", formatMoney(calendar.month_net_pnl), profitClass(calendar.month_net_pnl)],
        ["月胜率", formatPercent(calendar.month_win_rate)],
        ["订单数", String(calendar.month_order_count)],
      ]
        .map(
          ([label, value, cls = ""]) => `
            <div class="calendar-stat">
              <span>${escapeHtml(label)}</span>
              <strong class="${cls}">${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join(""),
    );

    const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
    const days = Object.values(calendar.days || {});
    const firstWeekday = (new Date(calendar.year, calendar.month - 1, 1).getDay() + 6) % 7;
    const blanks = Array.from({ length: firstWeekday }, () => `<div class="day-cell empty"></div>`);
    const cells = days.map((day) => {
      const dayNumber = Number(day.label.slice(-2));
      const pnl = Number(day.net_pnl);
      const hasTrades = Number(day.order_count) > 0;
      const tone = pnl < 0 ? "loss-day" : pnl > 0 ? "profit-day" : "";
      return `
        <div class="day-cell ${tone} ${hasTrades ? "has-trades" : ""}" data-calendar-day="${escapeAttr(day.label)}">
          <span class="date">${dayNumber}</span>
          <span class="pnl ${profitClass(pnl)}">${pnl === 0 ? "-" : formatMoney(pnl)}</span>
          <span class="date">${day.order_count} 单 ${formatPercent(day.win_rate)}</span>
        </div>
      `;
    });
    setHtml("calendarGrid", dayNames.map((day) => `<div class="day-name">${day}</div>`).join("") + blanks.join("") + cells.join(""));
    bindCalendarInteractions();
  }

  function renderSessions() {
    if (!workspace.showSessions) return;
    const labels = { asia: "亚盘", europe: "欧盘", us: "美盘" };
    const sessionsMeta = metricMetaFor("sessions");
    const state = metricState(sessionsMeta);
    if (state && state.status !== "estimated") {
      setHtml("sessions", `<div class="detail-empty metric-state-${state.tone}">${state.label}</div>`);
      return;
    }
    const sessions = payload?.sessions || {};
    setHtml(
      "sessions",
      Object.entries(sessions)
        .map(([key, item]) => {
          const pct = Math.round(Number(item.win_rate) * 100);
          return `
            <div class="session-item">
              <div><strong>${labels[key] || escapeHtml(item.label)}</strong><p class="eyebrow">${escapeHtml(item.window)} 北京时间</p></div>
              <div class="${profitClass(item.net_pnl)}">${formatMoney(item.net_pnl)}</div>
              <div class="bar"><span style="width:${pct}%"></span></div>
              <small>${item.order_count} 单 · 胜率 ${formatPercent(item.win_rate)} · 均值 ${formatMoney(item.avg_pnl)}</small>
            </div>
          `;
        })
        .join(""),
    );
  }

  function renderAll() {
    applyWorkspaceVisibility();
    renderLatestImportSummary();
    renderMarketClock();
    renderRMetricSummary();
    renderEquity();
    renderSystemEvaluationSummary();
    renderSystemEvaluation();
    renderModeEvaluation();
    renderCalendar();
    renderSessions();
    chartController?.update(payload || {});
    bindMetricInfoButtons();
  }

  // --- metric explanation ---

  function metricInfoButton(metricKey, label, metrics = {}, extra = {}) {
    const context = escapeAttr(JSON.stringify(metricContext(metrics, extra)));
    return `<button class="metric-info-btn" type="button" data-metric-info="${escapeAttr(metricKey)}" data-metric-context="${context}" aria-label="解释 ${escapeAttr(label)}" aria-expanded="false">i</button>`;
  }

  function bindMetricInfoButtons() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const button of view.querySelectorAll("[data-metric-info]")) {
      if (!button || !button.dataset || !button.dataset.metricInfo) continue;
      if (button.dataset.metricBound) continue;
      button.dataset.metricBound = "1";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        openMetricExplanation(button);
      });
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMetricExplanation(button);
        }
      });
    }
  }

  function openMetricExplanation(button) {
    const popover = getElement("metricExplanationPopover");
    if (!popover) return;
    let context = {};
    try {
      context = JSON.parse(button.dataset.metricContext || "{}");
    } catch (_error) {
      context = {};
    }
    const explanation = metricExplanation(button.dataset.metricInfo, context);
    setText("metricExplanationTitle", explanation.title);
    setHtml("metricExplanationMeta", renderMetricMetadata(context.metricMeta || metricMetaForKey(button.dataset.metricInfo)));
    setHtml(
      "metricExplanationBody",
      `<p><strong>公式</strong>${escapeHtml(explanation.formula)}</p>
       <p><strong>阈值</strong>${escapeHtml(explanation.threshold)}</p>
       <p><strong>样本</strong>${escapeHtml(explanation.sample)}</p>
       <p><strong>缺失</strong>${escapeHtml(explanation.missing)}</p>
       <p><strong>限制</strong>${escapeHtml(explanation.limitation)}</p>`,
    );
    if (typeof view.querySelectorAll === "function") {
      for (const node of view.querySelectorAll("[data-metric-info][aria-expanded='true']")) {
        node.setAttribute("aria-expanded", "false");
      }
    }
    button.setAttribute("aria-expanded", "true");
    metricExplanationTrigger = button;
    popover.hidden = false;
    if (typeof popover.classList?.add === "function") popover.classList.add("open");
    const windowInnerWidth = globalThis.window?.innerWidth ?? 0;
    const windowInnerHeight = globalThis.window?.innerHeight ?? 0;
    const rect = typeof button.getBoundingClientRect === "function" ? button.getBoundingClientRect() : { left: 0, bottom: 0 };
    const left = Math.min(windowInnerWidth - 432, Math.max(12, rect.left - 180));
    popover.style.left = `${Math.max(12, left)}px`;
    popover.style.top = `${Math.min(windowInnerHeight - 320, rect.bottom + 8)}px`;
    getElement("metricExplanationClose")?.focus();
  }

  function closeMetricExplanation() {
    const popover = getElement("metricExplanationPopover");
    if (!popover || popover.hidden) return;
    popover.hidden = true;
    if (typeof popover.classList?.remove === "function") popover.classList.remove("open");
    if (metricExplanationTrigger) {
      metricExplanationTrigger.setAttribute("aria-expanded", "false");
      if (typeof metricExplanationTrigger.focus === "function") metricExplanationTrigger.focus();
    }
    metricExplanationTrigger = null;
  }

  // --- calendar tooltip ---

  function bindCalendarInteractions() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const cell of view.querySelectorAll("[data-calendar-day]")) {
      if (!cell || !cell.dataset || !cell.dataset.calendarDay) continue;
      const date = cell.dataset.calendarDay;
      cell.addEventListener("mouseenter", (event) => showCalendarTooltip(date, event));
      cell.addEventListener("mousemove", (event) => positionCalendarTooltip(event));
      cell.addEventListener("mouseleave", hideCalendarTooltip);
    }
  }

  function showCalendarTooltip(date, event) {
    const tooltip = getElement("calendarTooltip");
    if (!tooltip) return;
    tooltip.innerHTML = buildCalendarTooltip(date);
    if (typeof tooltip.classList?.add === "function") tooltip.classList.add("open");
    positionCalendarTooltip(event);
  }

  function hideCalendarTooltip() {
    const tooltip = getElement("calendarTooltip");
    if (tooltip && typeof tooltip.classList?.remove === "function") tooltip.classList.remove("open");
  }

  function positionCalendarTooltip(event) {
    const tooltip = getElement("calendarTooltip");
    if (!tooltip || typeof tooltip.classList?.contains !== "function" || !tooltip.classList.contains("open")) return;
    const margin = 14;
    const rect = typeof tooltip.getBoundingClientRect === "function" ? tooltip.getBoundingClientRect() : { width: 0, height: 0 };
    const windowInnerWidth = globalThis.window?.innerWidth ?? 0;
    const windowInnerHeight = globalThis.window?.innerHeight ?? 0;
    let left = event.clientX + 16;
    let top = event.clientY + 16;
    if (left + rect.width + margin > windowInnerWidth) left = event.clientX - rect.width - 16;
    if (top + rect.height + margin > windowInnerHeight) top = event.clientY - rect.height - 16;
    tooltip.style.left = `${Math.max(margin, left)}px`;
    tooltip.style.top = `${Math.max(margin, top)}px`;
  }

  function buildCalendarTooltip(date) {
    const day = payload?.calendar?.days?.[date] || { net_pnl: 0, order_count: 0, win_rate: 0 };
    return `
      <div class="tooltip-head">
        <div><span class="eyebrow">TRADE DAY</span><strong>${escapeHtml(date)}</strong></div>
        <strong class="${profitClass(day.net_pnl)}">${formatMoney(day.net_pnl)}</strong>
      </div>
      <div class="tooltip-grid">
        <div class="tooltip-stat"><span>订单</span><strong>${day.order_count}</strong></div>
        <div class="tooltip-stat"><span>胜率</span><strong>${formatPercent(day.win_rate)}</strong></div>
        <div class="tooltip-stat"><span>净盈亏</span><strong class="${profitClass(day.net_pnl)}">${formatMoney(day.net_pnl)}</strong></div>
      </div>
    `;
  }

  // --- lifecycle ---

  async function load() {
    state = readDashboardState(location.search);
    const analysisWindow = resolveAnalysisWindow(state);
    const query = buildAnalysisQuery(state, analysisWindow);
    renderRegion("analysisRegion", { state: "loading", message: "正在读取分析数据" });
    try {
      const analysisRequest = gate.run("analysis", (signal) => api.requestJson(query ? `/api/analysis?${query}` : "/api/analysis", { signal }));
      const importRequest = workspace.showMarketClock
        ? Promise.resolve(null)
        : api.requestJson(`/api/platforms/import-summary?platform=${encodeURIComponent(normalizePlatform(platform))}`)
          .catch(() => null);
      [payload, importSummary] = await Promise.all([analysisRequest, importRequest]);
      calendarYear = payload?.calendar?.year ?? null;
      calendarMonth = payload?.calendar?.month ?? null;
      renderAll();
    } catch (error) {
      if (error && error.name === "AbortError") return;
      renderRegion("analysisRegion", {
        state: "error",
        message: error?.message || "读取分析数据失败",
        onRetry: load,
      });
    }
  }

  function shiftMonth(delta) {
    const now = new Date();
    let year = state.year ?? calendarYear ?? now.getFullYear();
    let month = (state.month ?? calendarMonth ?? now.getMonth() + 1) + delta;
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    while (month > 12) {
      month -= 12;
      year += 1;
    }
    commitState({ year, month });
    load();
  }

  function init() {
    applyWorkspaceVisibility();
    renderLatestImportSummary();
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/dashboard/", title: "复盘仪表盘", onRefresh, refreshLabel: workspace.actionLabel, refreshIcon: workspace.actionIcon, refreshErrorMessage: workspace.showMarketClock ? "刷新数据失败" : "打开数据导入失败", share: true })
      : null;
    applyDashboardLayout();
    chartController = createMt5DashboardCharts({view});
    const layoutLink = getElement("mt5DashboardLayoutLink");
    if (layoutLink) {
      layoutLink.hidden = normalizePlatform(platform) !== "mt5";
      layoutLink.setAttribute(
        "href",
        `./mock-domestic-futures-layout.html?platform=mt5&return=${encodeURIComponent("/dashboard/?platform=mt5")}`,
      );
    }

    const timePreset = getElement("timePreset");
    const startDateFilter = getElement("startDateFilter");
    const endDateFilter = getElement("endDateFilter");
    const prevMonth = getElement("prevMonth");
    const nextMonth = getElement("nextMonth");
    const metricExplanationClose = getElement("metricExplanationClose");

    if (timePreset) {
      timePreset.value = state.preset;
      timePreset.addEventListener("change", (event) => {
        state.preset = event.target.value;
        if (state.preset !== "custom") {
          state.start = "";
          state.end = "";
          if (startDateFilter) startDateFilter.value = "";
          if (endDateFilter) endDateFilter.value = "";
        }
        commitState({ preset: state.preset, start: state.start, end: state.end });
        load();
      });
    }
    if (startDateFilter) {
      startDateFilter.value = state.start || "";
      startDateFilter.addEventListener("change", (event) => {
        commitState({ start: event.target.value, preset: "custom" });
        if (timePreset) timePreset.value = "custom";
        load();
      });
    }
    if (endDateFilter) {
      endDateFilter.value = state.end || "";
      endDateFilter.addEventListener("change", (event) => {
        commitState({ end: event.target.value, preset: "custom" });
        if (timePreset) timePreset.value = "custom";
        load();
      });
    }
    if (prevMonth) prevMonth.addEventListener("click", () => shiftMonth(-1));
    if (nextMonth) nextMonth.addEventListener("click", () => shiftMonth(1));
    if (metricExplanationClose) metricExplanationClose.addEventListener("click", closeMetricExplanation);

    if (typeof view.addEventListener === "function") {
      view.addEventListener("click", (event) => {
        if (!event.target?.closest?.(".metric-explanation-popover, [data-metric-info]")) {
          closeMetricExplanation();
        }
      });
      view.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMetricExplanation();
      });
    }

    return cleanup;
  }

  function dispose() {
    gate.abortAll();
    chartController?.dispose?.();
    gridController?.destroy?.();
  }

  return {
    load,
    init,
    shiftMonth,
    closeMetricExplanation,
    dispose,
    getState: () => state,
  };
}

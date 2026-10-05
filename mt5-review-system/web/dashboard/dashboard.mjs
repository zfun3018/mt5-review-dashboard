import { RequestGate } from "../shared/js/api.mjs";
import {
  escapeAttr,
  escapeHtml,
  formatCurveTime,
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
import {
  buildAnalysisQuery,
  readDashboardState,
  resolveAnalysisWindow,
  writeDashboardState,
} from "./dashboard-state.mjs";

function smoothPath(points) {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }
  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] || current;
    const following = points[index + 2] || next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (following.x - current.x) / 6;
    const cp2y = next.y - (following.y - current.y) / 6;
    commands.push(
      `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`,
    );
  }
  return commands.join(" ");
}

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

function sampleCurvePoints(points, maxPoints = 140) {
  if (points.length <= maxPoints) return points;
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * (points.length - 1));
    return points[sourceIndex];
  });
}

function metricQuality(metricKey, value, context = {}) {
  const hasValue = value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const numeric = Number(value);
  if (metricKey === "campaign_count") {
    if (!Number.isFinite(numeric) || numeric < 30) return { label: "样本不足", tone: "insufficient" };
    if (numeric < 100) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  if (!hasValue) return { label: "样本不足", tone: "insufficient" };
  const rMetricKeys = ["scratch", "decisive_win_rate", "all_sample_win_rate", "expectancy_r", "sqn"];
  const rSampleSize = Number(context.completeCount ?? context.sampleCount);
  if (rMetricKeys.includes(metricKey) && Number.isFinite(rSampleSize) && rSampleSize <= 0) {
    return { label: "样本不足", tone: "insufficient" };
  }
  if (["cash_profit_factor", "payoff_ratio"].includes(metricKey)) {
    if (numeric < 1) return { label: "差", tone: "bad" };
    if (numeric < 1.5) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  if (["cash_win_rate", "decisive_win_rate", "all_sample_win_rate"].includes(metricKey)) {
    if (numeric < 0.4) return { label: "差", tone: "bad" };
    if (numeric < 0.5) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  if (metricKey === "expectancy_r") {
    if (numeric < 0) return { label: "差", tone: "bad" };
    if (numeric === 0) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  if (metricKey === "sqn") {
    if (context.sqn_status && context.sqn_status !== "available") return { label: "样本不足", tone: "insufficient" };
    if (numeric < 1) return { label: "差", tone: "bad" };
    if (numeric < 2) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  if (metricKey === "scratch") {
    if (numeric > 0.3) return { label: "差", tone: "bad" };
    if (numeric > 0.15) return { label: "一般", tone: "average" };
    return { label: "好", tone: "good" };
  }
  return { label: "一般", tone: "average" };
}

function metricQualityBadge(metricKey, value, context = {}) {
  const result = metricQuality(metricKey, value, context);
  const label = result.tone === "insufficient" ? "!" : result.label;
  return `<em class="metric-quality metric-quality-${result.tone}" title="${result.label}">${label}</em>`;
}

function compactMetricText(value) {
  return value === "样本不足" ? "!" : value;
}

function heatColor(pnl, maxAbs) {
  if (!pnl || !maxAbs) return "transparent";
  const strength = Math.min(Math.abs(pnl) / maxAbs, 1);
  const alpha = 0.3 + strength * 0.62;
  return pnl > 0 ? `rgba(36, 190, 255, ${alpha})` : `rgba(255, 92, 122, ${alpha})`;
}

function calendarColor(pnl, monthNet) {
  const base = Math.max(Math.abs(monthNet), Math.abs(pnl), 1);
  const alpha = 0.18 + Math.min(Math.abs(pnl) / base, 1) * 0.36;
  return pnl > 0 ? `rgba(26, 92, 112, ${alpha})` : `rgba(112, 28, 44, ${alpha})`;
}

function metricExplanation(metricKey, context) {
  const rMultipleUI = globalThis.RMultipleUI;
  if (rMultipleUI && typeof rMultipleUI.metricExplanation === "function") {
    return rMultipleUI.metricExplanation(metricKey, context);
  }
  return { title: metricKey, formula: "-", threshold: "-", sample: "-", missing: "-", limitation: "-" };
}

function metricContext(metrics = {}, extra = {}) {
  return {
    scratchThresholdR: Number(metrics.scratch_threshold_r ?? 0.15),
    sampleCount: Number(metrics.sample_count || 0),
    completeCount: Number(metrics.complete_count || 0),
    missingCount: Number(metrics.missing_count || 0),
    missingPositionCount: Number(extra.missingPositionCount || 0),
  };
}

export function createDashboardController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  onRefresh = null,
} = {}) {
  const gate = new RequestGate();
  let state = readDashboardState(location.search);
  let payload = null;
  let metricExplanationTrigger = null;
  let calendarYear = null;
  let calendarMonth = null;
  let systemPage = 1;
  const systemPageSize = 12;

  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function setHtml(id, html) {
    const node = getElement(id);
    if (node) node.innerHTML = html;
  }

  function setText(id, text) {
    const node = getElement(id);
    if (node) node.textContent = text;
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
    const sqn = metrics.sqn_status === "available" ? Number(metrics.sqn).toFixed(2) : "!";
    const items = [
      ["net_pnl", "总盈利", formatMoney(cash.net_pnl), profitClass(cash.net_pnl)],
      ["campaign_count", "交易笔数", String(cash.order_count ?? metrics.sample_count ?? 0), ""],
      ["payoff_ratio", "净盈亏比", formatRatio(cash.payoff_ratio), ""],
      ["decisive_win_rate", "净胜率（剔除打平）", formatPercent(metrics.decisive_win_rate)],
      ["expectancy_r", "平均数学期望（ER）", formatRValue(metrics.expectancy_r)],
      ["sqn", "收益稳定度（SQN）", sqn],
      ["z_score", "Z 分数", compactMetricText(formatZScore(metrics.z_score))],
    ];
    setHtml(
      "rMetricSummary",
      items
        .map(
          ([key, label, value, tone = ""]) => `
            <div class="r-metric-item">
              <span>${escapeHtml(label)} ${metricInfoButton(key, label, metrics)}</span>
              <strong class="${tone}">${escapeHtml(value)}</strong>
              <small>R 完整 ${metrics.complete_count || 0} / 共 ${metrics.sample_count || 0} 个交易组合</small>
            </div>
          `,
        )
        .join(""),
    );
  }

  function renderEquity() {
    const sourcePoints = payload?.equity || [];
    const baselineEquity = sourcePoints.length ? Number(sourcePoints[0].equity || 0) : 0;
    const points = sampleCurvePoints(sourcePoints, 140);
    const returns = points.map((point) => Number(point.cumulative_return ?? (Number(point.equity) - baselineEquity)));
    const rates = points.map((point, index) => Number(point.return_rate ?? (baselineEquity ? (returns[index] / baselineEquity) * 100 : 0)));
    const delta = returns.at(-1) || 0;
    const deltaNode = getElement("equityDelta");
    if (deltaNode) {
      deltaNode.textContent = `${delta >= 0 ? "+" : ""}${formatMoney(delta)} 区间回报`;
      deltaNode.className = `status-pill ${profitClass(delta)}`;
    }

    if (points.length < 2) {
      setHtml("equityChart", `<div class="detail-empty">暂无收益快照</div>`);
      return;
    }

    const chartNode = getElement("equityChart");
    if (!chartNode) return;
    const width = Math.max(360, Math.min(2400, chartNode.clientWidth || 1200));
    const height = width < 520 ? 330 : 360;
    const padding = { top: 30, right: 84, bottom: 44, left: 106 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const amountRawMin = Math.min(...returns, 0);
    const amountRawMax = Math.max(...returns, 0);
    const amountSpread = Math.max(amountRawMax - amountRawMin, 0.01);
    const amountMin = amountRawMin - amountSpread * 0.16;
    const amountMax = amountRawMax + amountSpread * 0.16;
    const rateRawMin = Math.min(...rates, 0);
    const rateRawMax = Math.max(...rates, 0);
    const rateSpread = Math.max(rateRawMax - rateRawMin, 0.01);
    const rateMin = rateRawMin - rateSpread * 0.16;
    const rateMax = rateRawMax + rateSpread * 0.16;
    const yFor = (value, min, max) => padding.top + (1 - (value - min) / (max - min)) * plotHeight;
    const coords = points.map((point, index) => ({ x: padding.left + (index / (points.length - 1)) * plotWidth, y: yFor(returns[index], amountMin, amountMax), point }));
    const rateCoords = points.map((point, index) => ({ x: padding.left + (index / (points.length - 1)) * plotWidth, y: yFor(rates[index], rateMin, rateMax), point }));
    const returnLine = smoothPath(coords);
    const rateLine = smoothPath(rateCoords);
    const areaPath = `${returnLine} L ${coords.at(-1).x.toFixed(1)} ${yFor(0, amountMin, amountMax).toFixed(1)} L ${coords[0].x.toFixed(1)} ${yFor(0, amountMin, amountMax).toFixed(1)} Z`;
    const grid = Array.from({ length: 7 }, (_, index) => index / 6)
      .map((ratio) => {
        const y = padding.top + ratio * plotHeight;
        const amountTick = amountMax - ratio * (amountMax - amountMin);
        const rateTick = rateMax - ratio * (rateMax - rateMin);
        return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" /><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="axis-label left-axis-label">${escapeHtml(formatMoney(amountTick))}</text><text x="${width - padding.right + 10}" y="${y + 4}" class="axis-label right-axis-label">${escapeHtml(`${rateTick.toFixed(2)}%`)}</text>`;
      })
      .join("");
    const first = points[0];
    const middle = points[Math.floor(points.length / 2)];
    const last = points[points.length - 1];
    const timeTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => points[Math.round(ratio * (points.length - 1))]);
    const lastCoord = coords.at(-1);

    chartNode.innerHTML = `
      <svg class="equity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="收益累计曲线，左轴为回报，右轴为收益率">
        <g stroke="#2b4560" stroke-width="1">${grid}</g>
        <line x1="${padding.left}" y1="${yFor(0, amountMin, amountMax).toFixed(1)}" x2="${width - padding.right}" y2="${yFor(0, amountMin, amountMax).toFixed(1)}" stroke="#f2b84b" stroke-width="1.5" stroke-dasharray="5 6" opacity="0.95" />
        <path d="${areaPath}" fill="rgba(32, 199, 160, 0.13)"></path>
        <path d="${returnLine}" fill="none" stroke="#20c7a0" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
        <path d="${rateLine}" fill="none" stroke="#f2b84b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7 5"></path>
        <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="6" fill="#f2b84b"></circle>
        <text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" class="axis-title left-axis-title">回报</text>
        <text x="${width - 18}" y="${height / 2}" transform="rotate(90 ${width - 18} ${height / 2})" class="axis-title right-axis-title">收益率</text>
        ${timeTicks.map((point, index) => `<text x="${(padding.left + (index / 4) * plotWidth).toFixed(1)}" y="${height - 8}" text-anchor="${index === 0 ? "start" : index === 4 ? "end" : "middle"}" class="time-label">${escapeHtml(formatCurveTime(point.time_bj))}</text>`).join("")}
      </svg>
    `;
  }

  function renderSystemEvaluationSummary() {
    const periods = payload?.periods || {};
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
          const sqn = r.sqn_status === "available" ? Number(r.sqn).toFixed(2) : "!";
          return `
            <article class="evaluation-summary-card">
              <header><span>${escapeHtml(label)}</span><strong class="${profitClass(item.net_pnl)}">${escapeHtml(formatMoney(item.net_pnl))}</strong></header>
              <div class="evaluation-summary-grid-inner">
                <span>交易笔数<strong>${r.sample_count || 0}</strong></span>
                <span>总盈亏比<strong>${formatRatio(item.profit_factor)}</strong></span>
                <span>净盈亏比<strong>${formatRatio(item.payoff_ratio)}</strong></span>
                <span>总胜率<strong>${formatPercent(item.cash_win_rate ?? item.win_rate)}</strong></span>
                <span>净胜率（剔除打平）<strong>${formatPercent(r.decisive_win_rate)}</strong></span>
                <span>平均数学期望（ER）<strong>${compactMetricText(formatRValue(r.expectancy_r))}</strong></span>
                <span>收益稳定度（SQN）<strong>${sqn}</strong></span>
                <span class="evaluation-z-row"><span>交易结果连续性（Z 分数） ${metricInfoButton("z_score", "交易结果连续性（Z 分数）", r)}</span><strong>${escapeHtml(compactMetricText(formatZScore(r.z_score || item.z_score)))}</strong></span>
              </div>
            </article>
          `;
        })
        .join("") || `<div class="detail-empty">当前范围暂无交易</div>`,
    );
  }

  function renderSystemEvaluation() {
    const rows = [...(payload?.system_evaluation || [])].reverse();
    const pageCount = Math.max(1, Math.ceil(rows.length / systemPageSize));
    systemPage = Math.min(systemPage, pageCount);
    const pageRows = rows.slice((systemPage - 1) * systemPageSize, systemPage * systemPageSize);
    setHtml(
      "systemEvaluationRows",
      pageRows
        .map((row) => {
          const r = row.r_metrics || {};
          const sqn = r.sqn_status === "available" ? Number(r.sqn).toFixed(2) : "!";
          return `
            <tr>
              <td><strong>${escapeHtml(row.date)}</strong></td>
              <td class="${profitClass(row.net_pnl)}">${formatMoney(row.net_pnl)}</td>
              <td>${row.order_count} ${metricQualityBadge("campaign_count", row.order_count, r)}</td>
              <td>${formatRatio(row.profit_factor)} ${metricQualityBadge("cash_profit_factor", row.profit_factor, r)}</td>
              <td>${formatRatio(row.payoff_ratio)} ${metricQualityBadge("payoff_ratio", row.payoff_ratio, row)}</td>
              <td>${formatPercent(row.cash_win_rate ?? row.win_rate)} ${metricQualityBadge("cash_win_rate", row.cash_win_rate ?? row.win_rate, row)}</td>
              <td>${formatPercent(r.decisive_win_rate)} ${metricQualityBadge("decisive_win_rate", r.decisive_win_rate, r)}</td>
              <td>${formatPercent(r.scratch_rate)} ${metricQualityBadge("scratch", r.scratch_rate, r)}</td>
              <td>${compactMetricText(formatRValue(r.expectancy_r))} ${metricQualityBadge("expectancy_r", r.expectancy_r, r)}</td>
              <td>${sqn} ${metricQualityBadge("sqn", r.sqn, r)}</td>
            </tr>
          `;
        })
        .join("") || `<tr><td colspan="10">当前范围暂无交易</td></tr>`,
    );
    setHtml(
      "systemEvaluationPagination",
      rows.length > systemPageSize
        ? `<span>第 ${systemPage} / ${pageCount} 页 · 共 ${rows.length} 天</span><div><button class="button" type="button" data-system-page="prev" ${systemPage <= 1 ? "disabled" : ""}>上一页</button><button class="button" type="button" data-system-page="next" ${systemPage >= pageCount ? "disabled" : ""}>下一页</button></div>`
        : "",
    );
    bindSystemPagination();
  }

  function bindSystemPagination() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const button of view.querySelectorAll("[data-system-page]")) {
      if (button.dataset.pageBound) continue;
      button.dataset.pageBound = "1";
      button.addEventListener("click", () => {
        systemPage += button.dataset.systemPage === "next" ? 1 : -1;
        renderSystemEvaluation();
      });
    }
  }

  function renderModeEvaluation() {
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
    setText("calendarTitle", `日历 · ${calendar.year} 年 ${String(calendar.month).padStart(2, "0")} 月`);
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
      const style = pnl === 0 ? "" : `style="background:${calendarColor(pnl, calendar.month_net_pnl)}"`;
      const hasTrades = Number(day.order_count) > 0;
      const tone = pnl < 0 ? "loss-day" : pnl > 0 ? "profit-day" : "";
      return `
        <div class="day-cell ${tone} ${hasTrades ? "has-trades" : ""}" ${style} data-calendar-day="${escapeAttr(day.label)}">
          <span class="date">${dayNumber}</span>
          <span class="pnl ${profitClass(pnl)}">${pnl === 0 ? "-" : formatMoney(pnl)}</span>
          <span class="date">${day.order_count} 单 ${formatPercent(day.win_rate)}</span>
        </div>
      `;
    });
    setHtml("calendarGrid", dayNames.map((day) => `<div class="day-name">${day}</div>`).join("") + blanks.join("") + cells.join(""));
    bindCalendarInteractions();
  }

  function renderHeatmap() {
    const heatmap = payload?.heatmap;
    if (!heatmap) return;
    const hourLabels = `
      <div class="heatmap-row">
        <div></div>
        ${Array.from({ length: 24 }, (_, hour) => `<div class="heatmap-label">${hour}</div>`).join("")}
        <div class="heatmap-total">合计</div>
      </div>
    `;
    const rows = (heatmap.days || [])
      .map((day) => {
        const dayPnl = day.hours.reduce((sum, cell) => sum + Number(cell.net_pnl), 0);
        const dayOrders = day.hours.reduce((sum, cell) => sum + Number(cell.order_count), 0);
        const cells = day.hours
          .map((cell) => {
            const pnl = Number(cell.net_pnl);
            const count = Number(cell.order_count);
            return `<div class="heatmap-cell" style="background:${heatColor(pnl, heatmap.max_abs_pnl)}" title="${escapeAttr(
              `${day.date} ${String(cell.hour).padStart(2, "0")}:00 ${formatMoney(pnl)} ${cell.order_count}单 胜率${formatPercent(cell.win_rate)}`,
            )}">${count ? `<strong>${count}</strong>` : ""}</div>`;
          })
          .join("");
        return `
          <div class="heatmap-row">
            <div class="heatmap-label">${escapeHtml(day.date)}</div>
            ${cells}
            <div class="heatmap-total ${profitClass(dayPnl)}">${formatMoney(dayPnl)}<br><span>${dayOrders}单</span></div>
          </div>
        `;
      })
      .join("");
    setHtml("heatmap", hourLabels + rows);
  }

  function renderSessions() {
    const labels = { asia: "亚盘", europe: "欧盘", us: "美盘" };
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
    renderMarketClock();
    renderRMetricSummary();
    renderEquity();
    renderSystemEvaluationSummary();
    renderSystemEvaluation();
    renderModeEvaluation();
    renderCalendar();
    renderHeatmap();
    renderSessions();
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
      payload = await gate.run("analysis", (signal) => api.requestJson(`/api/analysis?${query}`, { signal }));
      systemPage = 1;
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
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/dashboard/", title: "复盘仪表盘", onRefresh, share: true })
      : null;

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

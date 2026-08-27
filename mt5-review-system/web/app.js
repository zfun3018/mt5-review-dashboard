const state = {
  data: null,
  analysis: null,
  campaigns: [],
  campaignDetail: null,
  selectedCampaignId: null,
  selectedTradeId: null,
  calendarYear: null,
  calendarMonth: null,
  search: "",
  side: "all",
  tradeType: "all",
  strategy: "all",
  equityDays: 30,
  timePreset: "all",
  startDate: "",
  endDate: "",
  calendarDateFilter: "",
  riskMissingOnly: false,
  analysisSettings: { scratch_threshold_r: 0.15 },
  metricExplanationTrigger: null,
  choiceEditor: null,
};

const money = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const CHOICE_COLORS = ["#2bd4ff", "#4ade80", "#ff5c7a", "#f97316", "#facc15", "#a78bfa", "#38bdf8", "#fb7185"];

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refreshBtn").addEventListener("click", () => loadDashboard());
  document.getElementById("backupBtn").addEventListener("click", createBackup);
  document.getElementById("statusBtn").addEventListener("click", openStatusDrawer);
  document.getElementById("statusClose").addEventListener("click", closeStatusDrawer);
  document.getElementById("fieldManagerBtn").addEventListener("click", openFieldDrawer);
  document.getElementById("fieldClose").addEventListener("click", closeFieldDrawer);
  document.getElementById("addCustomField").addEventListener("click", addCustomField);
  document.getElementById("imageClose").addEventListener("click", closeImageModal);
  document.getElementById("imageModal").addEventListener("click", (event) => {
    if (event.target.id === "imageModal") closeImageModal();
  });
  document.getElementById("prevMonth").addEventListener("click", () => shiftMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => shiftMonth(1));
  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.search = event.target.value.toLowerCase();
    renderTrades();
  });
  document.getElementById("timePreset").addEventListener("change", (event) => {
    state.timePreset = event.target.value;
    if (state.timePreset !== "custom") {
      state.startDate = "";
      state.endDate = "";
      document.getElementById("startDateFilter").value = "";
      document.getElementById("endDateFilter").value = "";
    }
    syncEquityDaysToAnalysisWindow();
    renderTrades();
    refreshAnalysis();
  });
  document.getElementById("startDateFilter").addEventListener("change", (event) => {
    state.startDate = event.target.value;
    state.timePreset = "custom";
    document.getElementById("timePreset").value = "custom";
    syncEquityDaysToAnalysisWindow();
    renderTrades();
    refreshAnalysis();
  });
  document.getElementById("endDateFilter").addEventListener("change", (event) => {
    state.endDate = event.target.value;
    state.timePreset = "custom";
    document.getElementById("timePreset").value = "custom";
    syncEquityDaysToAnalysisWindow();
    renderTrades();
    refreshAnalysis();
  });
  document.getElementById("sideFilter").addEventListener("change", (event) => {
    state.side = event.target.value;
    renderTrades();
  });
  document.getElementById("tradeTypeFilter").addEventListener("change", (event) => {
    state.tradeType = event.target.value;
    renderTrades();
  });
  document.getElementById("strategyFilter").addEventListener("change", (event) => {
    state.strategy = event.target.value;
    renderTrades();
  });
  document.getElementById("riskMissingOnly").addEventListener("change", async (event) => {
    state.riskMissingOnly = event.target.checked;
    const visible = filteredCampaigns();
    if (state.riskMissingOnly && !visible.some((campaign) => campaign.id === state.selectedCampaignId)) {
      state.selectedCampaignId = visible[0]?.id || null;
      await loadSelectedCampaignDetail();
      renderTradeDetail();
    }
    renderTrades();
    if (state.riskMissingOnly) focusFirstMissingStop();
  });
  document.getElementById("saveScratchThreshold").addEventListener("click", saveScratchThreshold);
  document.getElementById("metricExplanationClose").addEventListener("click", closeMetricExplanation);
  syncEquityDaysToAnalysisWindow();
  document.getElementById("clearDateFilter").addEventListener("click", () => {
    state.calendarDateFilter = "";
    renderTrades();
  });
  document.addEventListener("click", closeChoicePopover);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".metric-explanation-popover, [data-metric-info]")) {
      closeMetricExplanation();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeChoicePopover();
    if (event.key === "Escape") closeMetricExplanation();
  });
  window.addEventListener("resize", closeChoicePopover);
  window.setInterval(() => renderMarketClock(), 60_000);
  loadDashboard();
});

async function loadDashboard(year = state.calendarYear, month = state.calendarMonth) {
  const params = year && month ? `?year=${year}&month=${month}` : "";
  try {
    const [data, campaignPage, settings] = await Promise.all([
      api(`/api/bootstrap${params}`),
      api("/api/campaigns?page_size=200"),
      api("/api/analysis-settings"),
    ]);
    state.data = data;
    state.campaigns = campaignPage.campaigns || [];
    state.analysisSettings = settings;
    document.getElementById("scratchThresholdR").value = Number(settings.scratch_threshold_r ?? 0.15).toFixed(2);
    state.analysis = {
      equity: data.equity,
      periods: data.periods || {
        today: data.summary.today,
        week: data.summary.week,
        month: data.summary.month,
      },
      r_metrics: data.r_metrics || {},
      system_evaluation: data.system_evaluation || [],
      mode_evaluation: data.mode_evaluation || { trade_type: [], strategy: [] },
    };
    state.calendarYear = data.calendar.year;
    state.calendarMonth = data.calendar.month;
    const requestedTradeId = new URLSearchParams(window.location.search).get("trade");
    if (requestedTradeId) {
      const requestedCampaign = state.campaigns.find((campaign) =>
        (campaign.source_trade_ids || []).includes(requestedTradeId),
      );
      if (requestedCampaign) state.selectedCampaignId = requestedCampaign.id;
    }
    if (!state.selectedCampaignId || !state.campaigns.some((campaign) => campaign.id === state.selectedCampaignId)) {
      state.selectedCampaignId = state.campaigns[0]?.id || null;
    }
    await loadSelectedCampaignDetail();
    renderAll();
    toast("本地数据已刷新");
  } catch (error) {
    toast(error.message || "刷新失败");
  }
}

async function refreshAnalysis() {
  if (!state.data) return;
  const window = dateWindowForFilter();
  const params = new URLSearchParams();
  if (window.start) params.set("start", window.start);
  if (window.end) params.set("end", window.end);
  params.set("equity_days", String(state.equityDays));
  try {
    state.analysis = await api(`/api/analysis?${params.toString()}`);
    renderEquity();
    renderRMetricSummary();
    renderSystemEvaluationSummary();
    renderSystemEvaluation();
    renderModeEvaluation();
  } catch (error) {
    toast(error.message || "分析数据刷新失败");
  }
}

async function loadCampaigns() {
  const page = await api("/api/campaigns?page_size=200");
  state.campaigns = page.campaigns || [];
  if (!state.campaigns.some((campaign) => campaign.id === state.selectedCampaignId)) {
    state.selectedCampaignId = state.campaigns[0]?.id || null;
  }
}

async function loadSelectedCampaignDetail() {
  if (!state.selectedCampaignId) {
    state.campaignDetail = null;
    return;
  }
  state.campaignDetail = await api(`/api/campaigns/${encodeURIComponent(state.selectedCampaignId)}`);
}

async function saveScratchThreshold() {
  const input = document.getElementById("scratchThresholdR");
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0 || value > 5) {
    toast("Scratch 阈值必须在 0R 到 5R 之间");
    input.value = Number(state.analysisSettings.scratch_threshold_r ?? 0.15).toFixed(2);
    return;
  }
  try {
    state.analysisSettings = await api("/api/analysis-settings", {
      method: "PATCH",
      body: JSON.stringify({ scratch_threshold_r: value }),
    });
    input.value = Number(state.analysisSettings.scratch_threshold_r).toFixed(2);
    await refreshAnalysis();
    toast("Scratch 阈值已更新");
  } catch (error) {
    input.value = Number(state.analysisSettings.scratch_threshold_r ?? 0.15).toFixed(2);
    toast(error.message || "Scratch 阈值保存失败");
  }
}

function metricContext(metrics = {}, extra = {}) {
  return {
    scratchThresholdR: Number(metrics.scratch_threshold_r ?? state.analysisSettings.scratch_threshold_r ?? 0.15),
    sampleCount: Number(metrics.sample_count || 0),
    completeCount: Number(metrics.complete_count || 0),
    missingCount: Number(metrics.missing_count || 0),
    missingPositionCount: Number(extra.missingPositionCount || 0),
  };
}

function metricInfoButton(metricKey, label, metrics = {}, extra = {}) {
  const context = escapeAttr(JSON.stringify(metricContext(metrics, extra)));
  return `<button class="metric-info-btn" type="button" data-metric-info="${escapeAttr(metricKey)}" data-metric-context="${context}" aria-label="解释 ${escapeAttr(label)}" aria-expanded="false">i</button>`;
}

function bindMetricInfoButtons() {
  document.querySelectorAll("[data-metric-info]").forEach((button) => {
    if (button.dataset.metricBound) return;
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
  });
}

function openMetricExplanation(button) {
  const popover = document.getElementById("metricExplanationPopover");
  let context = {};
  try {
    context = JSON.parse(button.dataset.metricContext || "{}");
  } catch (_error) {
    context = {};
  }
  const explanation = RMultipleUI.metricExplanation(button.dataset.metricInfo, context);
  document.getElementById("metricExplanationTitle").textContent = explanation.title;
  document.getElementById("metricExplanationBody").innerHTML = `
    <p><strong>公式</strong>${escapeHtml(explanation.formula)}</p>
    <p><strong>阈值</strong>${escapeHtml(explanation.threshold)}</p>
    <p><strong>样本</strong>${escapeHtml(explanation.sample)}</p>
    <p><strong>缺失</strong>${escapeHtml(explanation.missing)}</p>
    <p><strong>限制</strong>${escapeHtml(explanation.limitation)}</p>
  `;
  document.querySelectorAll("[data-metric-info][aria-expanded='true']").forEach((node) => {
    node.setAttribute("aria-expanded", "false");
  });
  button.setAttribute("aria-expanded", "true");
  state.metricExplanationTrigger = button;
  popover.hidden = false;
  popover.classList.add("open");
  const rect = button.getBoundingClientRect();
  const left = Math.min(window.innerWidth - 432, Math.max(12, rect.left - 180));
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${Math.min(window.innerHeight - 320, rect.bottom + 8)}px`;
  document.getElementById("metricExplanationClose").focus();
}

function closeMetricExplanation() {
  const popover = document.getElementById("metricExplanationPopover");
  if (!popover || popover.hidden) return;
  popover.hidden = true;
  popover.classList.remove("open");
  if (state.metricExplanationTrigger) {
    state.metricExplanationTrigger.setAttribute("aria-expanded", "false");
    state.metricExplanationTrigger.focus();
  }
  state.metricExplanationTrigger = null;
}

function renderRMetricSummary() {
  const node = document.getElementById("rMetricSummary");
  if (!node) return;
  const metrics = state.analysis?.r_metrics || {};
  const sqn = metrics.sqn_status === "available" ? Number(metrics.sqn).toFixed(2) : "样本不足";
  const items = [
    ["decisive_win_rate", "净胜率", formatPercent(metrics.decisive_win_rate)],
    ["all_sample_win_rate", "全样本胜率", formatPercent(metrics.all_sample_win_rate)],
    ["scratch", "Scratch 占比", formatPercent(metrics.scratch_rate)],
    ["expectancy_r", "R 期望 E_R", formatRValue(metrics.expectancy_r)],
    ["sqn", "SQN", sqn],
    ["coverage", "R 数据覆盖率", formatPercent(metrics.coverage_rate)],
  ];
  node.innerHTML = items
    .map(
      ([key, label, value]) => `
        <div class="r-metric-item">
          <span>${escapeHtml(label)} ${metricInfoButton(key, label, metrics)}</span>
          <strong>${escapeHtml(value)}</strong>
          <small>${metrics.complete_count || 0} / ${metrics.sample_count || 0} 个 Campaign</small>
        </div>
      `,
    )
    .join("");
  bindMetricInfoButtons();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

function renderAll() {
  renderSummary();
  renderRMetricSummary();
  renderMarketClock();
  renderStatus();
  renderEquity();
  renderSystemEvaluationSummary();
  renderSystemEvaluation();
  renderModeEvaluation();
  renderCalendar();
  renderHeatmap();
  renderSessions();
  renderClassificationFilters();
  renderTrades();
  renderTradeDetail();
  renderClassificationManager();
  renderCustomFieldRows();
}

function renderSummary() {
  const summary = state.data.summary;
  const periods = [
    ["今日", "today", summary.today],
    ["本周", "week", summary.week],
    ["本月", "month", summary.month],
    ["本年", "year", summary.year],
  ];
  document.getElementById("summary").innerHTML = periods
    .map(
      ([label, key, item]) => {
        const r = state.analysis?.periods?.[key]?.r_metrics || {};
        return `
        <div class="metric">
          <span>${escapeHtml(label)}</span>
          <strong class="${profitClass(item.net_pnl)}">${escapeHtml(money.format(item.net_pnl))}</strong>
          <em>${item.order_count} 笔现金记录 · 现金胜率 ${formatPercent(item.win_rate)} · PF ${formatRatio(item.profit_factor)}</em>
          <em>R 期望 ${formatRValue(r.expectancy_r)} ${metricInfoButton("expectancy_r", "R 期望", r)} · 覆盖率 ${formatPercent(r.coverage_rate)} ${metricInfoButton("coverage", "R 数据覆盖率", r)}</em>
          <em>最大 ${money.format(item.max_profit)} / ${money.format(item.max_loss)} · 均值 ${money.format(item.avg_trade)}</em>
        </div>
      `;
      },
    )
    .join("");
  bindMetricInfoButtons();
}

function renderMarketClock() {
  const now = new Date();
  const bj = minutesInZone(now, "Asia/Shanghai");
  const sessions = [
    {
      key: "asia",
      name: "亚盘",
      city: "Tokyo",
      zone: "Asia/Tokyo",
      window: "08:00-15:00 BJT",
      start: 8 * 60,
      end: 15 * 60,
      note: "流动性中等，日内方向初现",
      volatile: "10:00-11:30 常见第一波",
    },
    {
      key: "europe",
      name: "欧盘",
      city: "London",
      zone: "Europe/London",
      window: "15:00-20:00 BJT",
      start: 15 * 60,
      end: 20 * 60,
      note: "欧盘开盘，波动开始放大",
      volatile: "15:00-17:00 高波动",
    },
    {
      key: "us",
      name: "美盘",
      city: "New York",
      zone: "America/New_York",
      window: "20:00-02:00 BJT",
      start: 20 * 60,
      end: 2 * 60,
      note: "美盘开盘，新闻与成交集中",
      volatile: "20:30-23:00 高波动",
    },
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
          <header>
            <strong>${session.name}</strong>
            <span>${session.city} ${formatZoneTime(now, session.zone)}</span>
          </header>
          <div class="market-time">${session.window}</div>
          <div class="market-progress"><span style="width:${progress}%"></span></div>
          <span>${activeNow ? "进行中" : session.note} · ${session.volatile}</span>
        </article>
      `;
    })
    .join("");
  document.getElementById("marketClock").innerHTML = `
    <article class="market-alert">
      <span>WORLD SESSION</span>
      <strong>${escapeHtml(alertTitle)}</strong>
      <span>${escapeHtml(alertText)}</span>
    </article>
    ${cards}
  `;
}

function renderStatus() {
  const status = state.data.status;
  const backup = status.latest_backup;
  const latestTrade = status.latest_trade;
  const items = [
    ["EA 接口", status.bridge_endpoint],
    ["数据库", status.database_path],
    ["数据目录", status.data_dir],
    ["截图/事件", `${status.screenshot_count} 张 · ${status.counts.raw_events} 条`],
    ["资金快照", `${status.counts.equity_snapshots} 条`],
    ["最近交易", latestTrade ? `${latestTrade.symbol} ${money.format(latestTrade.pnl)}` : "暂无"],
    ["最近备份", backup ? `${formatTime(backup.created_at)} · ${formatBytes(backup.size_bytes)}` : "暂无"],
    ["本地占用", formatBytes(status.data_size_bytes)],
  ];
  document.getElementById("localStatus").innerHTML = items
    .map(
      ([label, value]) => `
        <div class="status-item">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderEquity() {
  const sourcePoints = state.analysis?.equity || state.data.equity;
  const baselineEquity = sourcePoints.length ? Number(sourcePoints[0].equity || 0) : 0;
  const points = sampleCurvePoints(sourcePoints, 140);
  const returns = points.map((point) => Number(point.cumulative_return ?? (Number(point.equity) - baselineEquity)));
  const rates = points.map((point, index) => Number(point.return_rate ?? (baselineEquity ? (returns[index] / baselineEquity) * 100 : 0)));
  const delta = returns.at(-1) || 0;
  const deltaNode = document.getElementById("equityDelta");
  deltaNode.textContent = `${delta >= 0 ? "+" : ""}${money.format(delta)} 区间回报`;
  deltaNode.className = `status-pill ${profitClass(delta)}`;

  if (points.length < 2) {
    document.getElementById("equityChart").innerHTML = `<div class="detail-empty">暂无收益快照</div>`;
    return;
  }

  const chartNode = document.getElementById("equityChart");
  const width = Math.max(360, Math.min(1200, chartNode.clientWidth || 1200));
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
  const coords = points.map((point, index) => {
    const x = padding.left + (index / (points.length - 1)) * plotWidth;
    const y = yFor(returns[index], amountMin, amountMax);
    return { x, y, point };
  });
  const rateCoords = points.map((point, index) => ({
    x: padding.left + (index / (points.length - 1)) * plotWidth,
    y: yFor(rates[index], rateMin, rateMax),
    point,
  }));
  const returnLine = smoothPath(coords);
  const rateLine = smoothPath(rateCoords);
  const areaPath = `${returnLine} L ${coords.at(-1).x.toFixed(1)} ${yFor(0, amountMin, amountMax).toFixed(1)} L ${coords[0].x.toFixed(1)} ${yFor(0, amountMin, amountMax).toFixed(1)} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const y = padding.top + ratio * plotHeight;
      const amountTick = amountMax - ratio * (amountMax - amountMin);
      const rateTick = rateMax - ratio * (rateMax - rateMin);
      return `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" /><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" class="axis-label left-axis-label">${escapeHtml(money.format(amountTick))}</text><text x="${width - padding.right + 10}" y="${y + 4}" class="axis-label right-axis-label">${escapeHtml(`${rateTick.toFixed(2)}%`)}</text>`;
    })
    .join("");
  const first = points[0];
  const middle = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];
  const lastCoord = coords.at(-1);

  chartNode.innerHTML = `
    <svg class="equity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="收益累计曲线，左轴为回报，右轴为收益率">
      <g stroke="#25322f" stroke-width="1">${grid}</g>
      <line x1="${padding.left}" y1="${yFor(0, amountMin, amountMax).toFixed(1)}" x2="${width - padding.right}" y2="${yFor(0, amountMin, amountMax).toFixed(1)}" stroke="#f4c95d" stroke-width="1" stroke-dasharray="5 6" opacity="0.75" />
      <path d="${areaPath}" fill="rgba(43, 212, 255, 0.12)"></path>
      <path d="${returnLine}" fill="none" stroke="#2bd4ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${rateLine}" fill="none" stroke="#f4c95d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7 5"></path>
      <circle cx="${lastCoord.x.toFixed(1)}" cy="${lastCoord.y.toFixed(1)}" r="6" fill="#f4c95d"></circle>
      <text x="18" y="${height / 2}" transform="rotate(-90 18 ${height / 2})" class="axis-title left-axis-title">回报</text>
      <text x="${width - 18}" y="${height / 2}" transform="rotate(90 ${width - 18} ${height / 2})" class="axis-title right-axis-title">收益率</text>
      <text x="${padding.left}" y="${height - 8}" class="time-label">${escapeHtml(formatCurveTime(first.time_bj))}</text>
      <text x="${width / 2 - 28}" y="${height - 8}" class="time-label">${escapeHtml(formatCurveTime(middle.time_bj))}</text>
      <text x="${width - padding.right - 48}" y="${height - 8}" class="time-label">${escapeHtml(formatCurveTime(last.time_bj))}</text>
    </svg>
  `;
}

function sampleCurvePoints(points, maxPoints = 140) {
  if (points.length <= maxPoints) return points;
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round((index / (maxPoints - 1)) * (points.length - 1));
    return points[sourceIndex];
  });
}

function renderCalendar() {
  const calendar = state.data.calendar;
  document.getElementById("calendarTitle").textContent = `${calendar.year} 年 ${String(calendar.month).padStart(2, "0")} 月`;
  document.getElementById("calendarStats").innerHTML = [
    ["净盈亏", money.format(calendar.month_net_pnl), profitClass(calendar.month_net_pnl)],
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
    .join("");

  const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
  const days = Object.values(calendar.days);
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
        <span class="pnl ${profitClass(pnl)}">${pnl === 0 ? "-" : money.format(pnl)}</span>
        <span class="date">${day.order_count} 单 ${formatPercent(day.win_rate)}</span>
      </div>
    `;
  });
  document.getElementById("calendarGrid").innerHTML =
    dayNames.map((day) => `<div class="day-name">${day}</div>`).join("") + blanks.join("") + cells.join("");
  bindCalendarInteractions();
}

function bindCalendarInteractions() {
  document.querySelectorAll("[data-calendar-day]").forEach((cell) => {
    const date = cell.dataset.calendarDay;
    cell.addEventListener("mouseenter", (event) => showCalendarTooltip(date, event));
    cell.addEventListener("mousemove", (event) => positionCalendarTooltip(event));
    cell.addEventListener("mouseleave", hideCalendarTooltip);
    cell.addEventListener("click", () => {
      state.calendarDateFilter = date;
      renderTrades();
      toast(`已筛选 ${date} 的订单`);
    });
  });
}

function showCalendarTooltip(date, event) {
  const tooltip = document.getElementById("calendarTooltip");
  tooltip.innerHTML = buildCalendarTooltip(date);
  tooltip.classList.add("open");
  positionCalendarTooltip(event);
}

function hideCalendarTooltip() {
  document.getElementById("calendarTooltip").classList.remove("open");
}

function positionCalendarTooltip(event) {
  const tooltip = document.getElementById("calendarTooltip");
  if (!tooltip.classList.contains("open")) return;
  const margin = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + 16;
  let top = event.clientY + 16;
  if (left + rect.width + margin > window.innerWidth) left = event.clientX - rect.width - 16;
  if (top + rect.height + margin > window.innerHeight) top = event.clientY - rect.height - 16;
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function buildCalendarTooltip(date) {
  const day = state.data.calendar.days[date];
  const trades = tradesForDate(date);
  const profit = trades.filter((trade) => Number(trade.net_pnl) > 0).reduce((sum, trade) => sum + Number(trade.net_pnl), 0);
  const loss = trades.filter((trade) => Number(trade.net_pnl) < 0).reduce((sum, trade) => sum + Number(trade.net_pnl), 0);
  const best = trades.length ? trades.reduce((a, b) => (Number(a.net_pnl) > Number(b.net_pnl) ? a : b)) : null;
  const worst = trades.length ? trades.reduce((a, b) => (Number(a.net_pnl) < Number(b.net_pnl) ? a : b)) : null;
  return `
    <div class="tooltip-head">
      <div>
        <span class="eyebrow">TRADE DAY</span>
        <strong>${escapeHtml(date)}</strong>
      </div>
      <strong class="${profitClass(day.net_pnl)}">${money.format(day.net_pnl)}</strong>
    </div>
    <div class="tooltip-grid">
      <div class="tooltip-stat"><span>订单</span><strong>${day.order_count}</strong></div>
      <div class="tooltip-stat"><span>胜率</span><strong>${formatPercent(day.win_rate)}</strong></div>
      <div class="tooltip-stat"><span>净盈亏</span><strong class="${profitClass(day.net_pnl)}">${money.format(day.net_pnl)}</strong></div>
      <div class="tooltip-stat"><span>盈利</span><strong class="profit-text">${money.format(profit)}</strong></div>
      <div class="tooltip-stat"><span>亏损</span><strong class="loss-text">${money.format(loss)}</strong></div>
      <div class="tooltip-stat"><span>最佳/最差</span><strong>${best ? `${money.format(best.net_pnl)} / ${money.format(worst.net_pnl)}` : "-"}</strong></div>
    </div>
  `;
}

function renderHeatmap() {
  const heatmap = state.data.heatmap;
  const hourLabels = `
    <div class="heatmap-row">
      <div></div>
      ${Array.from({ length: 24 }, (_, hour) => `<div class="heatmap-label">${hour}</div>`).join("")}
      <div class="heatmap-total">合计</div>
    </div>
  `;
  const rows = heatmap.days
    .map((day) => {
      const dayPnl = day.hours.reduce((sum, cell) => sum + Number(cell.net_pnl), 0);
      const dayOrders = day.hours.reduce((sum, cell) => sum + Number(cell.order_count), 0);
      const cells = day.hours
        .map((cell) => {
          const pnl = Number(cell.net_pnl);
          const count = Number(cell.order_count);
          return `<div class="heatmap-cell" style="background:${heatColor(pnl, heatmap.max_abs_pnl)}" title="${escapeAttr(
            `${day.date} ${String(cell.hour).padStart(2, "0")}:00 ${money.format(pnl)} ${cell.order_count}单 胜率${formatPercent(cell.win_rate)}`,
          )}">${count ? `<strong>${count}</strong>` : ""}</div>`;
        })
        .join("");
      return `
        <div class="heatmap-row">
          <div class="heatmap-label">${escapeHtml(day.date)}</div>
          ${cells}
          <div class="heatmap-total ${profitClass(dayPnl)}">${money.format(dayPnl)}<br><span>${dayOrders}单</span></div>
        </div>
      `;
    })
    .join("");
  document.getElementById("heatmap").innerHTML = hourLabels + rows;
}

function renderSessions() {
  const labels = { asia: "亚盘", europe: "欧盘", us: "美盘" };
  const html = Object.entries(state.data.sessions)
    .map(([key, item]) => {
      const pct = Math.round(Number(item.win_rate) * 100);
      return `
        <div class="session-item">
          <div>
            <strong>${labels[key] || escapeHtml(item.label)}</strong>
            <p class="eyebrow">${escapeHtml(item.window)} 北京时间</p>
          </div>
          <div class="${profitClass(item.net_pnl)}">${money.format(item.net_pnl)}</div>
          <div class="bar"><span style="width:${pct}%"></span></div>
          <small>${item.order_count} 单 · 胜率 ${formatPercent(item.win_rate)} · 均值 ${money.format(item.avg_pnl)}</small>
        </div>
      `;
    })
    .join("");
  document.getElementById("sessions").innerHTML = html;
}

function renderSystemEvaluationSummary() {
  const periods = state.analysis?.periods || {};
  const items = [
    ["本日", periods.today],
    ["本周", periods.week],
    ["本月", periods.month],
  ].filter(([, item]) => item);
  const node = document.getElementById("systemEvaluationSummary");
  if (!node) return;
  node.innerHTML = items
    .map(
      ([label, item]) => {
        const r = item.r_metrics || {};
        const sqn = r.sqn_status === "available" ? Number(r.sqn).toFixed(2) : "样本不足";
        return `
        <article class="evaluation-summary-card">
          <header><span>${escapeHtml(label)}</span><strong class="${profitClass(item.net_pnl)}">${escapeHtml(money.format(item.net_pnl))}</strong></header>
          <div class="evaluation-summary-grid-inner">
            <span>Campaign 数<strong>${r.sample_count || 0}</strong></span>
            <span>现金 PF<strong>${formatRatio(item.profit_factor)}</strong></span>
            <span>现金胜率<strong>${formatPercent(item.cash_win_rate ?? item.win_rate)}</strong></span>
            <span>净胜率 ${metricInfoButton("decisive_win_rate", "净胜率", r)}<strong>${formatPercent(r.decisive_win_rate)}</strong></span>
            <span>全样本胜率 ${metricInfoButton("all_sample_win_rate", "全样本胜率", r)}<strong>${formatPercent(r.all_sample_win_rate)}</strong></span>
            <span>Scratch ${metricInfoButton("scratch", "Scratch 占比", r)}<strong>${formatPercent(r.scratch_rate)}</strong></span>
            <span>E_R ${metricInfoButton("expectancy_r", "R 期望", r)}<strong>${formatRValue(r.expectancy_r)}</strong></span>
            <span>SQN ${metricInfoButton("sqn", "SQN", r)}<strong>${sqn}</strong></span>
            <span>R 覆盖率 ${metricInfoButton("coverage", "R 数据覆盖率", r)}<strong>${formatPercent(r.coverage_rate)}</strong></span>
            <span class="evaluation-z-row">R 版 Z 分数<strong>${escapeHtml(formatZScore(r.z_score || item.z_score))}</strong></span>
          </div>
        </article>
      `;
      },
    )
    .join("") || `<div class="detail-empty">当前范围暂无交易</div>`;
  bindMetricInfoButtons();
}

function renderSystemEvaluation() {
  const rows = [...(state.analysis?.system_evaluation || [])].reverse();
  const node = document.getElementById("systemEvaluationRows");
  node.innerHTML = rows
    .map((row) => {
      const r = row.r_metrics || {};
      const sqn = r.sqn_status === "available" ? Number(r.sqn).toFixed(2) : "样本不足";
      return `
        <tr>
          <td><strong>${escapeHtml(row.date)}</strong></td>
          <td class="${profitClass(row.net_pnl)}">${money.format(row.net_pnl)}</td>
          <td>${row.order_count}</td>
          <td>${formatRatio(row.profit_factor)}</td>
          <td>${formatRValue(r.expectancy_r)} ${metricInfoButton("expectancy_r", "R 期望", r)}</td>
          <td>${sqn} ${metricInfoButton("sqn", "SQN", r)}</td>
          <td>${formatPercent(r.coverage_rate)} ${metricInfoButton("coverage", "R 数据覆盖率", r)}</td>
        </tr>
      `;
    })
    .join("") || `<tr><td colspan="7">当前范围暂无交易</td></tr>`;
  bindMetricInfoButtons();
}

function classificationOptions(dimension) {
  return (state.data?.classification_options || []).filter((option) => option.dimension === dimension);
}

function classificationOptionLabel(dimension, optionId) {
  return classificationOptions(dimension).find((option) => option.id === optionId)?.label || optionId || "未分类";
}

function classificationSelectOptions(dimension, currentId) {
  const available = classificationOptions(dimension).filter((option) => option.active || option.id === currentId);
  if (currentId && !available.some((option) => option.id === currentId)) {
    available.unshift({ id: currentId, label: currentId, active: false });
  }
  return available
    .map((option) => {
      const archived = option.active ? "" : "（已停用）";
      const selected = option.id === currentId ? "selected" : "";
      return `<option value="${escapeAttr(option.id)}" ${selected}>${escapeHtml(option.label)}${archived}</option>`;
    })
    .join("");
}

function renderClassificationFilters() {
  const configs = [
    ["tradeTypeFilter", "trade_type", "全部类型", "tradeType"],
    ["strategyFilter", "strategy", "全部策略", "strategy"],
  ];
  configs.forEach(([elementId, dimension, allLabel, stateKey]) => {
    const select = document.getElementById(elementId);
    const options = classificationOptions(dimension)
      .map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}${option.active ? "" : "（已停用）"}</option>`)
      .join("");
    select.innerHTML = `<option value="all">${allLabel}</option>${options}`;
    select.value = state[stateKey];
    if (select.value !== state[stateKey]) {
      state[stateKey] = "all";
      select.value = "all";
    }
  });
}

function renderModeEvaluation() {
  const evaluation = state.analysis?.mode_evaluation || { trade_type: [], strategy: [] };
  const groups = [
    ["交易类型", evaluation.trade_type || []],
    ["交易策略", evaluation.strategy || []],
  ];
  document.getElementById("modeEvaluation").innerHTML = groups
    .map(
      ([title, rows]) => `
        <section class="mode-group">
          <h3>${title}</h3>
          <div class="mode-card-grid">
            ${rows.map((row) => `
              <article class="mode-card">
                <header><strong>${escapeHtml(row.label || row.key)}</strong><span>${formatPercent(row.share)}</span></header>
                <div class="${profitClass(row.net_pnl)}">${money.format(row.net_pnl)}</div>
                <small>${row.order_count} 个 Campaign · 现金胜率 ${formatPercent(row.cash_win_rate ?? row.win_rate)} · 现金 PF ${formatRatio(row.profit_factor)}</small>
                <dl class="mode-r-metrics">
                  <div><dt>净胜率 ${metricInfoButton("decisive_win_rate", "净胜率", row.r_metrics || {})}</dt><dd>${formatPercent(row.r_metrics?.decisive_win_rate)}</dd></div>
                  <div><dt>全样本胜率 ${metricInfoButton("all_sample_win_rate", "全样本胜率", row.r_metrics || {})}</dt><dd>${formatPercent(row.r_metrics?.all_sample_win_rate)}</dd></div>
                  <div><dt>Scratch ${metricInfoButton("scratch", "Scratch 占比", row.r_metrics || {})}</dt><dd>${formatPercent(row.r_metrics?.scratch_rate)}</dd></div>
                  <div><dt>E_R ${metricInfoButton("expectancy_r", "R 期望", row.r_metrics || {})}</dt><dd>${formatRValue(row.r_metrics?.expectancy_r)}</dd></div>
                  <div><dt>SQN ${metricInfoButton("sqn", "SQN", row.r_metrics || {})}</dt><dd>${row.r_metrics?.sqn_status === "available" ? Number(row.r_metrics.sqn).toFixed(2) : "样本不足"}</dd></div>
                  <div><dt>覆盖率 ${metricInfoButton("coverage", "R 数据覆盖率", row.r_metrics || {})}</dt><dd>${formatPercent(row.r_metrics?.coverage_rate)}</dd></div>
                </dl>
              </article>
            `).join("") || `<div class="detail-empty">当前范围暂无数据</div>`}
          </div>
        </section>
      `,
    )
    .join("");
  bindMetricInfoButtons();
}

function renderClassificationManager() {
  const node = document.getElementById("classificationManager");
  if (!node || !state.data) return;
  const groups = [
    ["trade_type", "交易类型", "新增类型"],
    ["strategy", "交易策略", "新增策略"],
  ];
  node.innerHTML = groups
    .map(([dimension, title, placeholder]) => {
      const rows = classificationOptions(dimension)
        .map(
          (option) => `
            <div class="classification-option-row ${option.active ? "" : "archived"}" data-classification-row="${escapeAttr(option.id)}">
              <span class="classification-color" style="--option-color:${escapeAttr(option.color)}"></span>
              <input type="text" value="${escapeAttr(option.label)}" data-classification-label="${escapeAttr(option.id)}" />
              <span class="classification-state">${option.active ? "使用中" : "已停用"}</span>
              <button class="ghost-btn" type="button" data-classification-save="${escapeAttr(option.id)}">保存</button>
              ${option.active ? `<button class="ghost-btn danger-btn" type="button" data-classification-archive="${escapeAttr(option.id)}">删除</button>` : ""}
            </div>
          `,
        )
        .join("");
      return `
        <div class="classification-group">
          <h4>${title}</h4>
          <div class="classification-option-list">${rows}</div>
          <div class="classification-add-row">
            <input type="text" data-classification-new="${dimension}" placeholder="${placeholder}" maxlength="40" />
            <button class="primary-btn" type="button" data-classification-add="${dimension}">新增</button>
          </div>
        </div>
      `;
    })
    .join("");
  node.querySelectorAll("[data-classification-add]").forEach((button) => {
    button.addEventListener("click", () => createClassificationOption(button.dataset.classificationAdd));
  });
  node.querySelectorAll("[data-classification-save]").forEach((button) => {
    button.addEventListener("click", () => updateClassificationOption(button.dataset.classificationSave));
  });
  node.querySelectorAll("[data-classification-archive]").forEach((button) => {
    button.addEventListener("click", () => archiveClassificationOption(button.dataset.classificationArchive));
  });
  node.querySelectorAll("[data-classification-new]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") createClassificationOption(input.dataset.classificationNew);
    });
  });
}

async function createClassificationOption(dimension) {
  const input = document.querySelector(`[data-classification-new="${dimension}"]`);
  const label = input?.value.trim();
  if (!label) {
    toast("请填写分类名称");
    return;
  }
  try {
    await api("/api/classification-options", {
      method: "POST",
      body: JSON.stringify({ dimension, label }),
    });
    await loadDashboard();
    toast("分类已新增");
  } catch (error) {
    toast(error.message || "新增失败");
  }
}

async function updateClassificationOption(optionId) {
  const input = document.querySelector(`[data-classification-label="${CSS.escape(optionId)}"]`);
  const label = input?.value.trim();
  if (!label) {
    toast("分类名称不能为空");
    return;
  }
  try {
    await api(`/api/classification-options/${encodeURIComponent(optionId)}`, {
      method: "PUT",
      body: JSON.stringify({ label }),
    });
    await loadDashboard();
    toast("分类名称已更新，历史统计保持不变");
  } catch (error) {
    toast(error.message || "更新失败");
  }
}

async function archiveClassificationOption(optionId) {
  const option = (state.data?.classification_options || []).find((item) => item.id === optionId);
  if (!option || !window.confirm(`删除分类“${option.label}”？历史订单和统计仍会保留。`)) return;
  try {
    await api(`/api/classification-options/${encodeURIComponent(optionId)}`, { method: "DELETE" });
    await loadDashboard();
    toast("分类已停用，历史数据保持不变");
  } catch (error) {
    toast(error.message || "删除失败");
  }
}

function renderTradeHeader() {
  const customHeaders = customFields()
    .map((field) => `<th class="custom-col">${escapeHtml(field.name)}<span>${fieldTypeLabel(field.field_type)}</span></th>`)
    .join("");
  const metrics = state.analysis?.r_metrics || {};
  document.getElementById("tradeHead").innerHTML = `
    <tr>
      <th>交易组合</th>
      <th>品种</th>
      <th>Position</th>
      <th>北京时间</th>
      <th>执行结构</th>
      <th class="r-col">R ${metricInfoButton("campaign_r", "组合 R", metrics)}</th>
      <th>组合盈亏</th>
      ${customHeaders}
      <th>截图</th>
    </tr>
  `;
  bindMetricInfoButtons();
}

function renderTrades() {
  renderTradeHeader();
  const clearDate = document.getElementById("clearDateFilter");
  clearDate.classList.toggle("hidden", !state.calendarDateFilter);
  clearDate.textContent = state.calendarDateFilter ? `清除 ${state.calendarDateFilter}` : "清除日期";
  const fieldCount = customFields().length;
  const rows = filteredCampaigns()
    .map((campaign) => {
      const trade = campaignSourceTrade(campaign);
      const active = campaign.id === state.selectedCampaignId ? "active" : "";
      const riskClass = campaign.risk_status === "complete" ? "risk-complete" : `risk-${campaign.risk_status || "missing"}`;
      const shot = trade?.screenshot_url
        ? `<button class="shot-btn" data-shot="${escapeAttr(trade.screenshot_url)}" title="查看截图"><img src="${escapeAttr(trade.screenshot_url)}" alt="M5截图" /></button>`
        : `<span class="muted-mini">无</span>`;
      const customCells = customFields()
        .map(
          (field) => `
            <td class="custom-value-cell">
              ${trade ? renderCustomValueEditor(trade, field, "table") : `<span class="muted-mini">-</span>`}
            </td>
          `,
        )
        .join("");
      return `
        <tr class="campaign-row ${active} ${campaign.risk_status === "complete" ? "" : "has-risk-gap"}" data-campaign-id="${escapeAttr(campaign.id)}">
          <td>
            <div class="order-main">
              <strong>${escapeHtml(campaign.display_order_no || campaign.id.slice(0, 8))}</strong>
              <span>Campaign · ${escapeHtml(RMultipleUI.campaignActivityLabel(campaign))}</span>
            </div>
          </td>
          <td>
            <div class="symbol-cell">
              <span class="side ${campaign.side}">${campaign.side === "long" ? "多" : "空"}</span>
              <div class="order-main">
                <strong>${escapeHtml(campaign.symbol)}</strong>
                <span>${escapeHtml(classificationOptionLabel("trade_type", campaign.trade_type))}</span>
              </div>
            </div>
          </td>
          <td>${campaign.position_count} 个</td>
          <td>
            <div class="time-stack">
              <strong>${campaign.close_time_bj ? formatTime(campaign.close_time_bj) : "持仓中"}</strong>
              <span>进 ${formatTime(campaign.open_time_bj)}</span>
            </div>
          </td>
          <td>${escapeHtml(RMultipleUI.campaignActivityLabel(campaign))}</td>
          <td class="campaign-r-cell ${riskClass}">${escapeHtml(RMultipleUI.formatCampaignR(campaign))}</td>
          <td class="${profitClass(campaign.net_pnl)}">${money.format(campaign.net_pnl)}</td>
          ${customCells}
          <td>${shot}</td>
        </tr>
      `;
    })
    .join("");
  document.getElementById("tradeRows").innerHTML = rows || `<tr><td colspan="${8 + fieldCount}">没有匹配的交易组合</td></tr>`;
  document.querySelectorAll("[data-shot]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openImageModal(button.dataset.shot);
    });
  });
  document.querySelectorAll("tr[data-campaign-id]").forEach((row) => {
    row.addEventListener("click", async () => {
      state.selectedCampaignId = row.dataset.campaignId;
      renderTrades();
      try {
        await loadSelectedCampaignDetail();
      } catch (error) {
        toast(error.message || "交易组合详情加载失败");
      }
      renderTradeDetail();
      if (state.riskMissingOnly) focusFirstMissingStop();
    });
  });
  bindCustomValueInputs();
  bindChoiceTriggers();
}

function renderTradeDetail() {
  const campaign = selectedCampaign();
  const detail = state.campaignDetail?.id === campaign?.id ? state.campaignDetail : null;
  const trade = campaignSourceTrade(campaign);
  const node = document.getElementById("tradeDetail");
  if (!campaign) {
    node.innerHTML = `<div class="detail-empty">选择一个交易组合开始复盘</div>`;
    return;
  }
  if (!detail) {
    node.innerHTML = `<div class="detail-empty">正在加载交易组合详情</div>`;
    return;
  }
  const customFieldInputs = customFields()
    .map(
      (field) => `
        <div class="field compact-field">
          <label>${escapeHtml(field.name)}</label>
          ${trade ? renderCustomValueEditor(trade, field, "detail") : `<span class="muted-mini">无代表订单</span>`}
        </div>
      `,
    )
    .join("");
  const missingPositions = Math.max(0, Number(detail.risk_positions_total || 0) - Number(detail.risk_positions_complete || 0));
  const positionRows = (detail.positions || [])
    .map((position) => {
      const exits = (position.exit_deals || [])
        .map(
          (exitDeal) => `
            <li><span>${formatBeijingDateTime(exitDeal.time_utc)}</span><strong>${Number(exitDeal.volume).toFixed(2)} 手 @ ${escapeHtml(exitDeal.price)}</strong></li>
          `,
        )
        .join("");
      const positionR = position.position_r === null || position.position_r === undefined
        ? position.risk_missing_reason === "missing_initial_stop" ? "待补初始止损" : "R 不可用"
        : formatRValue(position.position_r);
      return `
        <section class="campaign-position ${position.risk_status === "complete" ? "" : "position-risk-gap"}">
          <div class="campaign-position-head">
            <div>
              <strong>Position ${escapeHtml(position.display_position_id || position.position_id)}</strong>
              <span>${formatBeijingDateTime(position.opened_at_utc)} · ${Number(position.entry_volume || 0).toFixed(2)} 手 @ ${formatPrice(position.weighted_entry_price)}</span>
            </div>
            <span class="position-r-status ${position.risk_status}">${escapeHtml(positionR)}</span>
          </div>
          <div class="initial-stop-editor">
            <label for="stop-${escapeAttr(position.id)}">初始计划止损</label>
            <input id="stop-${escapeAttr(position.id)}" data-position-stop="${escapeAttr(position.id)}" type="number" step="any" inputmode="decimal" value="${escapeAttr(position.initial_stop_price ?? "")}" placeholder="填写入场时止损价" />
            <button class="ghost-btn" type="button" data-position-save="${escapeAttr(position.id)}">保存</button>
          </div>
          <p class="position-risk-note">${escapeHtml(positionRiskMessage(position))}</p>
          <ul class="position-exits">${exits || `<li><span>尚未平仓</span></li>`}</ul>
        </section>
      `;
    })
    .join("");
  node.innerHTML = `
    <div class="detail-body dense-detail">
      <div class="detail-title">
        <div>
          <p class="eyebrow">${escapeHtml(campaign.symbol)} · Campaign ${escapeHtml(campaign.display_order_no || campaign.id.slice(0, 8))}</p>
          <h2>${campaign.side === "long" ? "多单" : "空单"} · ${campaign.position_count} 个 Position</h2>
        </div>
        <strong class="${profitClass(campaign.net_pnl)}">${money.format(campaign.net_pnl)}</strong>
      </div>
      <div class="campaign-risk-summary ${campaign.risk_status === "complete" ? "complete" : "missing"}">
        <div><span>组合 R ${metricInfoButton("campaign_r", "组合 R", state.analysis?.r_metrics || {}, { missingPositionCount: missingPositions })}</span><strong>${escapeHtml(RMultipleUI.formatCampaignR(campaign))}</strong></div>
        <small>${escapeHtml(RMultipleUI.campaignActivityLabel(campaign))} · 初始计划风险不代表实际最大浮亏</small>
      </div>
      <div class="campaign-position-list">${positionRows}</div>
      ${trade ? renderScreenshotEditor(trade) : ""}
      <div class="field-grid classification-grid">
        <div class="field compact-field">
          <label>交易类型</label>
          <select id="detailTradeType">
            ${classificationSelectOptions("trade_type", campaign.trade_type)}
          </select>
        </div>
        <div class="field compact-field">
          <label>交易策略</label>
          <select id="detailStrategy">
            ${classificationSelectOptions("strategy", campaign.strategy)}
          </select>
        </div>
      </div>
      ${customFieldInputs ? `<div class="field-grid">${customFieldInputs}</div>` : ""}
      <div class="field">
        <label>复盘</label>
        <textarea id="detailReview" class="review-editor" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(campaign.review_text || "")}</textarea>
      </div>
      <div class="detail-actions">
        <button id="saveReview" class="primary-btn">保存组合复盘</button>
      </div>
    </div>
  `;
  document.getElementById("saveReview").addEventListener("click", saveReview);
  document.getElementById("detailShot")?.addEventListener("click", (event) => {
    event.stopPropagation();
    openImageModal(event.currentTarget.dataset.shot);
  });
  bindScreenshotEditor();
  document.querySelectorAll("[data-position-save]").forEach((button) => {
    button.addEventListener("click", () => savePositionInitialStop(button.dataset.positionSave));
  });
  document.querySelectorAll("[data-position-stop]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") savePositionInitialStop(input.dataset.positionStop);
    });
  });
  bindCustomValueInputs();
  bindChoiceTriggers();
  bindMetricInfoButtons();
}

function renderScreenshotEditor(trade) {
  const preview = trade.screenshot_url
    ? `<button class="shot-btn snapshot compact-snapshot" id="detailShot" data-shot="${escapeAttr(trade.screenshot_url)}" title="放大截图"><img src="${escapeAttr(trade.screenshot_url)}" alt="5分钟K线截图" /></button>`
    : `<div class="screenshot-empty">暂无截图</div>`;
  return `
    <div class="screenshot-editor" id="screenshotEditor" tabindex="0" aria-label="交易截图">
      <div class="screenshot-preview">${preview}</div>
      <div class="screenshot-actions">
        <button id="replaceScreenshot" class="ghost-btn" type="button">替换图片</button>
        <input id="screenshotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
        <button id="deleteScreenshot" class="ghost-btn danger-btn" type="button" ${trade.screenshot_url ? "" : "disabled"}>删除图片</button>
      </div>
      <span class="screenshot-status">支持直接粘贴、拖入或选择本地图片</span>
    </div>
  `;
}

function bindScreenshotEditor() {
  const editor = document.getElementById("screenshotEditor");
  const fileInput = document.getElementById("screenshotFile");
  if (!editor || !fileInput) return;
  document.getElementById("replaceScreenshot")?.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) replaceScreenshotFile(file);
    fileInput.value = "";
  });
  document.getElementById("deleteScreenshot")?.addEventListener("click", deleteTradeScreenshot);
  editor.addEventListener("click", (event) => {
    if (!event.target.closest("button, input")) editor.focus();
  });
  editor.addEventListener("paste", (event) => {
    const file = imageFileFromClipboard(event.clipboardData);
    if (!file) return;
    event.preventDefault();
    replaceScreenshotFile(file);
  });
  editor.addEventListener("dragover", (event) => {
    if (Array.from(event.dataTransfer?.items || []).some((item) => item.type.startsWith("image/"))) {
      event.preventDefault();
      editor.classList.add("drag-over");
    }
  });
  editor.addEventListener("dragleave", () => editor.classList.remove("drag-over"));
  editor.addEventListener("drop", (event) => {
    editor.classList.remove("drag-over");
    const file = Array.from(event.dataTransfer?.files || []).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    replaceScreenshotFile(file);
  });
}

function imageFileFromClipboard(clipboard) {
  if (!clipboard) return null;
  const direct = Array.from(clipboard.files || []).find((file) => file.type.startsWith("image/"));
  if (direct) return direct;
  return Array.from(clipboard.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .find(Boolean) || null;
}

async function replaceScreenshotFile(file) {
  if (!file.type.startsWith("image/")) {
    toast("请选择图片文件");
    return;
  }
  if (file.size > 15 * 1024 * 1024) {
    toast("图片不能超过 15MB");
    return;
  }
  const trade = selectedTrade();
  if (!trade) return;
  try {
    const imageData = await readFileAsDataUrl(file);
    await api(`/api/trades/${encodeURIComponent(trade.id)}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ image_data: imageData, filename: file.name }),
    });
    toast("截图已替换，旧图片已清理");
    await loadDashboard();
  } catch (error) {
    toast(error.message || "截图替换失败");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function deleteTradeScreenshot() {
  const trade = selectedTrade();
  if (!trade?.screenshot_url || !window.confirm("删除这张交易截图？删除后原文件不可恢复。")) return;
  try {
    await api(`/api/trades/${encodeURIComponent(trade.id)}/screenshot`, { method: "DELETE" });
    toast("截图已删除，存储文件已清理");
    await loadDashboard();
  } catch (error) {
    toast(error.message || "截图删除失败");
  }
}
function renderCustomFieldRows() {
  const node = document.getElementById("customFieldRows");
  if (!node || !state.data) return;
  const fields = customFields();
  node.innerHTML = fields.length
    ? fields.map((field) => renderCustomFieldCard(field)).join("")
    : `<div class="detail-empty">还没有自定义字段</div>`;
  node.querySelectorAll("[data-custom-field-save]").forEach((button) => {
    button.addEventListener("click", () => updateCustomField(Number(button.dataset.customFieldSave)));
  });
  node.querySelectorAll("[data-custom-field-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteCustomField(Number(button.dataset.customFieldDelete)));
  });
  node.querySelectorAll("[data-option-add]").forEach((button) => {
    button.addEventListener("click", () => addCustomFieldOptionRow(Number(button.dataset.optionAdd)));
  });
  node.querySelectorAll("[data-option-delete]").forEach((button) => {
    button.addEventListener("click", () => button.closest("[data-option-row]")?.remove());
  });
  bindFieldTypeToggles();
}

function renderCustomFieldCard(field) {
  const typeOptions = ["text", "single", "multi"]
    .map((type) => `<option value="${type}" ${field.field_type === type ? "selected" : ""}>${fieldTypeLabel(type)}</option>`)
    .join("");
  const options = (field.options || []).map((option) => renderCustomOptionRow(field.id, option)).join("");
  return `
    <div class="custom-field-card" data-custom-field-row="${field.id}">
      <div class="field-row custom-field-main">
        <span>${field.sort_order}</span>
        <input type="text" value="${escapeAttr(field.name)}" data-custom-field-name="${field.id}" />
        <select data-custom-field-type="${field.id}" title="字段类型">${typeOptions}</select>
        <button class="ghost-btn" data-custom-field-save="${field.id}">保存</button>
        <button class="ghost-btn danger-btn" data-custom-field-delete="${field.id}">删除</button>
      </div>
      <div class="option-editor ${field.field_type === "text" ? "hidden" : ""}" data-option-editor="${field.id}">
        <div class="option-list" data-option-list="${field.id}">
          ${options || `<div class="detail-empty">暂无选项，可在表格里创建，也可以点下面新增</div>`}
        </div>
        <button class="ghost-btn option-add" data-option-add="${field.id}">新增选项</button>
      </div>
    </div>
  `;
}

function renderCustomOptionRow(fieldId, option = {}) {
  return `
    <div class="option-row" data-option-row="${fieldId}" data-option-id="${escapeAttr(option.id || "")}">
      <input type="color" value="${escapeAttr(option.color || choiceColor(0))}" data-option-color title="颜色" />
      <input type="text" value="${escapeAttr(option.label || "")}" data-option-label placeholder="选项名称" />
      <button class="ghost-btn danger-btn" data-option-delete type="button">删除</button>
    </div>
  `;
}

function bindFieldTypeToggles() {
  document.querySelectorAll("[data-custom-field-type]").forEach((select) => {
    select.addEventListener("change", () => {
      const id = Number(select.dataset.customFieldType);
      const editor = document.querySelector(`[data-option-editor="${id}"]`);
      if (!editor) return;
      editor.classList.toggle("hidden", select.value === "text");
      if (select.value !== "text" && !editor.querySelector("[data-option-row]")) {
        addCustomFieldOptionRow(id);
      }
    });
  });
}

async function addCustomField() {
  const input = document.getElementById("newCustomFieldName");
  const typeSelect = document.getElementById("newCustomFieldType");
  const name = input.value.trim();
  const type = typeSelect.value;
  if (!name) {
    toast("请先填写字段名");
    return;
  }
  await api("/api/custom-fields", {
    method: "POST",
    body: JSON.stringify({ name, field_type: type }),
  });
  input.value = "";
  typeSelect.value = "text";
  toast("字段已新增");
  await loadDashboard();
}

async function updateCustomField(id) {
  const input = document.querySelector(`[data-custom-field-name="${id}"]`);
  const type = document.querySelector(`[data-custom-field-type="${id}"]`).value;
  const name = input.value.trim();
  if (!name) {
    toast("字段名不能为空");
    return;
  }
  await api(`/api/custom-fields/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name,
      field_type: type,
      options: type === "text" ? [] : collectCustomFieldOptions(id),
    }),
  });
  toast("字段已更新");
  await loadDashboard();
}

function collectCustomFieldOptions(id) {
  return Array.from(document.querySelectorAll(`[data-option-row="${id}"]`))
    .map((row) => {
      const label = row.querySelector("[data-option-label]").value.trim();
      const color = row.querySelector("[data-option-color]").value || choiceColor(0);
      const option = { label, color };
      if (row.dataset.optionId) option.id = Number(row.dataset.optionId);
      return option;
    })
    .filter((option) => option.label);
}

function addCustomFieldOptionRow(id) {
  const list = document.querySelector(`[data-option-list="${id}"]`);
  if (!list) return;
  list.querySelector(".detail-empty")?.remove();
  const index = list.querySelectorAll("[data-option-row]").length;
  list.insertAdjacentHTML("beforeend", renderCustomOptionRow(id, { color: choiceColor(index) }));
  list.querySelector("[data-option-row]:last-child [data-option-delete]").addEventListener("click", (event) => {
    event.currentTarget.closest("[data-option-row]")?.remove();
  });
}
async function deleteCustomField(id) {
  if (!window.confirm("删除这个自定义字段？该字段在所有订单里的填写内容也会删除。")) return;
  await api(`/api/custom-fields/${id}`, { method: "DELETE" });
  toast("字段已删除");
  await loadDashboard();
}

function bindCustomValueInputs() {
  document.querySelectorAll("[data-custom-cell]").forEach((input) => {
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        input.value = input.dataset.original || "";
        input.blur();
      }
    });
    input.addEventListener("blur", () => saveCustomValue(input));
  });
}

async function saveCustomValue(input) {
  const value = input.value;
  if (value === (input.dataset.original || "")) return;
  const tradeId = input.dataset.tradeId;
  const fieldId = Number(input.dataset.fieldId);
  await api(`/api/trades/${encodeURIComponent(tradeId)}/custom-fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
  const trade = state.data.trades.find((item) => item.id === tradeId);
  if (trade) {
    trade.custom_fields = trade.custom_fields || {};
    trade.custom_fields[String(fieldId)] = value;
  }
  document.querySelectorAll(`[data-custom-cell][data-trade-id="${CSS.escape(tradeId)}"][data-field-id="${fieldId}"]`).forEach((node) => {
    if (node !== input) node.value = value;
    node.dataset.original = value;
  });
  input.dataset.original = value;
  toast("字段内容已保存");
}
async function saveReview() {
  const campaign = selectedCampaign();
  if (!campaign) return;
  const payload = {
    trade_type: document.getElementById("detailTradeType").value,
    strategy: document.getElementById("detailStrategy").value,
    review_text: document.getElementById("detailReview").value,
  };
  await api(`/api/campaigns/${encodeURIComponent(campaign.id)}/review`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  await loadCampaigns();
  await loadSelectedCampaignDetail();
  renderTrades();
  renderTradeDetail();
  toast("组合复盘已保存到本地");
}

async function savePositionInitialStop(positionId) {
  const input = document.querySelector(`[data-position-stop="${CSS.escape(positionId)}"]`);
  if (!input) return;
  const raw = input.value.trim();
  const initialStop = raw === "" ? null : Number(raw);
  if (initialStop !== null && !Number.isFinite(initialStop)) {
    toast("初始止损必须是有效数字");
    input.focus();
    return;
  }
  input.disabled = true;
  try {
    await api(`/api/positions/${encodeURIComponent(positionId)}/initial-stop`, {
      method: "PATCH",
      body: JSON.stringify({ initial_stop_price: initialStop }),
    });
    await loadCampaigns();
    await loadSelectedCampaignDetail();
    await refreshAnalysis();
    if (state.riskMissingOnly) {
      const visible = filteredCampaigns();
      if (!visible.some((campaign) => campaign.id === state.selectedCampaignId)) {
        state.selectedCampaignId = visible[0]?.id || null;
        await loadSelectedCampaignDetail();
      }
    }
    renderTrades();
    renderTradeDetail();
    toast(initialStop === null ? "初始止损已清空" : "初始止损已保存，R 已重新计算");
  } catch (error) {
    input.disabled = false;
    input.focus();
    toast(error.message || "初始止损保存失败");
  }
}

async function deleteSelectedTrade() {
  const trade = selectedTrade();
  if (!trade || !window.confirm(`确认删除订单 ${trade.display_order_no || trade.id}？删除后不会被同步文件自动恢复。`)) return;
  await api(`/api/trades/${encodeURIComponent(trade.id)}`, { method: "DELETE" });
  state.selectedTradeId = null;
  toast("订单已删除");
  await loadDashboard();
}


async function createBackup() {
  try {
    const backup = await api("/api/backups", { method: "POST", body: "{}" });
    toast(`备份已创建：${backup.size_bytes} bytes`);
    await loadDashboard();
  } catch (error) {
    toast(error.message || "备份失败");
  }
}

function openStatusDrawer() {
  document.getElementById("statusDrawer").classList.add("open");
  document.getElementById("statusDrawer").setAttribute("aria-hidden", "false");
}

function closeStatusDrawer() {
  document.getElementById("statusDrawer").classList.remove("open");
  document.getElementById("statusDrawer").setAttribute("aria-hidden", "true");
}

function openFieldDrawer() {
  renderClassificationManager();
  renderCustomFieldRows();
  document.getElementById("fieldDrawer").classList.add("open");
  document.getElementById("fieldDrawer").setAttribute("aria-hidden", "false");
}

function closeFieldDrawer() {
  document.getElementById("fieldDrawer").classList.remove("open");
  document.getElementById("fieldDrawer").setAttribute("aria-hidden", "true");
}

function openImageModal(src) {
  if (!src) return;
  const modal = document.getElementById("imageModal");
  document.getElementById("modalImage").src = src;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeImageModal() {
  const modal = document.getElementById("imageModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("modalImage").src = "";
}

function shiftMonth(delta) {
  let year = state.calendarYear;
  let month = state.calendarMonth + delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  loadDashboard(year, month);
}

function filteredTrades() {
  const window = dateWindowForFilter();
  return state.data.trades.filter((trade) => {
    const customText = customFields().map((field) => customValueLabel(trade, field)).join(" ");
    const typeLabel = classificationOptionLabel("trade_type", trade.trade_type);
    const strategyLabel = classificationOptionLabel("strategy", trade.strategy);
    const haystack = `${trade.symbol} ${trade.order_no} ${trade.id} ${trade.display_order_no || ""} ${trade.trade_type || ""} ${typeLabel} ${trade.strategy || ""} ${strategyLabel} ${customText}`.toLowerCase();
    const searchOk = !state.search || haystack.includes(state.search);
    const sideOk = state.side === "all" || trade.side === state.side;
    const typeOk = state.tradeType === "all" || trade.trade_type === state.tradeType;
    const strategyOk = state.strategy === "all" || trade.strategy === state.strategy;
    const tradeDate = trade.close_time_bj.slice(0, 10);
    const dateOk = !state.calendarDateFilter || tradeDate === state.calendarDateFilter;
    const startOk = !window.start || tradeDate >= window.start;
    const endOk = !window.end || tradeDate <= window.end;
    return searchOk && sideOk && typeOk && strategyOk && dateOk && startOk && endOk;
  });
}

function filteredCampaigns() {
  const window = dateWindowForFilter();
  const riskFiltered = RMultipleUI.filterRiskMissing(state.campaigns, state.riskMissingOnly);
  return riskFiltered.filter((campaign) => {
    const sourceTrade = campaignSourceTrade(campaign);
    const customText = sourceTrade
      ? customFields().map((field) => customValueLabel(sourceTrade, field)).join(" ")
      : "";
    const typeLabel = classificationOptionLabel("trade_type", campaign.trade_type);
    const strategyLabel = classificationOptionLabel("strategy", campaign.strategy);
    const haystack = `${campaign.symbol} ${campaign.id} ${(campaign.source_trade_ids || []).join(" ")} ${typeLabel} ${strategyLabel} ${customText}`.toLowerCase();
    const searchOk = !state.search || haystack.includes(state.search);
    const sideOk = state.side === "all" || campaign.side === state.side;
    const typeOk = state.tradeType === "all" || campaign.trade_type === state.tradeType;
    const strategyOk = state.strategy === "all" || campaign.strategy === state.strategy;
    const campaignDate = String(campaign.close_time_bj || campaign.open_time_bj || "").slice(0, 10);
    const dateOk = !state.calendarDateFilter || campaignDate === state.calendarDateFilter;
    const startOk = !window.start || campaignDate >= window.start;
    const endOk = !window.end || campaignDate <= window.end;
    return searchOk && sideOk && typeOk && strategyOk && dateOk && startOk && endOk;
  });
}
function tradesForDate(date) {
  return state.data.trades.filter((trade) => trade.close_time_bj.slice(0, 10) === date);
}

function dateWindowForFilter() {
  if (state.timePreset === "custom") {
    return { start: state.startDate, end: state.endDate };
  }
  if (state.timePreset === "today") {
    const today = dateKeyBeijing(new Date());
    return { start: today, end: today };
  }
  if (state.timePreset === "7d") {
    const end = dateKeyBeijing(new Date());
    return { start: shiftDateKey(end, -6), end };
  }
  if (state.timePreset === "30d") {
    const end = dateKeyBeijing(new Date());
    return { start: shiftDateKey(end, -29), end };
  }
  return { start: "", end: "" };
}

function syncEquityDaysToAnalysisWindow() {
  if (["3", "7", "30"].includes(state.timePreset)) {
    state.equityDays = Number(state.timePreset);
    return;
  }
  if (state.timePreset === "custom" && state.startDate && state.endDate) {
    const start = new Date(`${state.startDate}T00:00:00+08:00`);
    const end = new Date(`${state.endDate}T00:00:00+08:00`);
    const span = Math.round((end - start) / 86400000) + 1;
    state.equityDays = Math.max(1, Math.min(span, 366));
    return;
  }
  state.equityDays = 30;
}

function dateKeyBeijing(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyBeijing(date);
}

function selectedTrade() {
  return campaignSourceTrade(selectedCampaign()) || state.data.trades[0];
}

function selectedCampaign() {
  return state.campaigns.find((campaign) => campaign.id === state.selectedCampaignId) || state.campaigns[0] || null;
}

function campaignSourceTrade(campaign) {
  if (!campaign || !state.data) return null;
  const ids = campaign.source_trade_ids || [];
  return [...ids]
    .reverse()
    .map((id) => state.data.trades.find((trade) => trade.id === id))
    .find(Boolean) || null;
}

function focusFirstMissingStop() {
  window.setTimeout(() => {
    document.querySelector(".position-risk-gap [data-position-stop]")?.focus();
  }, 0);
}

function positionRiskMessage(position) {
  return {
    missing_initial_stop: "缺少入场时设置的初始止损，组合 R 暂不计算。",
    invalid_stop_direction: "止损方向无效：多单需低于所有入场价，空单需高于所有入场价。",
    invalid_initial_stop: "初始止损不是有效价格。",
    position_incomplete: "Position 成交尚未闭合，平仓完成后才能计算 R。",
    volume_mismatch: "开仓与退出手数不一致，当前不计算 R。",
    zero_risk: "初始计划风险为零，当前不计算 R。",
  }[position.risk_missing_reason] || "R 已按该 Position 的初始计划风险计算。";
}

function customFields() {
  return (state.data?.custom_fields || []).filter((field) => field.name !== "\u8d8b\u52bf");
}

function customFieldById(id) {
  return customFields().find((field) => Number(field.id) === Number(id));
}

function fieldTypeLabel(type) {
  return { text: "文本", single: "单选", multi: "多选" }[type] || "文本";
}

function selectedOptionIds(trade, field) {
  const value = trade.custom_fields?.[String(field.id)];
  if (field.field_type === "multi") return Array.isArray(value) ? value.map(String) : [];
  return value ? [String(value)] : [];
}

function optionById(field, optionId) {
  return (field.options || []).find((option) => String(option.id) === String(optionId));
}

function customValueLabel(trade, field) {
  if (field.field_type === "text") return String(trade.custom_fields?.[String(field.id)] || "");
  return selectedOptionIds(trade, field)
    .map((optionId) => optionById(field, optionId)?.label || "")
    .filter(Boolean)
    .join(" ");
}

function renderCustomValueEditor(trade, field, mode) {
  const value = trade.custom_fields?.[String(field.id)];
  if (field.field_type === "text") {
    const textValue = String(value || "");
    return `
      <input
        data-custom-cell
        data-trade-id="${escapeAttr(trade.id)}"
        data-field-id="${field.id}"
        data-original="${escapeAttr(textValue)}"
        value="${escapeAttr(textValue)}"
        placeholder="填写${escapeAttr(field.name)}"
      />
    `;
  }
  const selected = selectedOptionIds(trade, field)
    .map((optionId) => optionById(field, optionId))
    .filter(Boolean);
  const pills = selected
    .map(
      (option) => `
        <span class="choice-value-pill" style="--choice:${escapeAttr(option.color || "#2bd4ff")};">
          ${escapeHtml(option.label)}
        </span>
      `,
    )
    .join("");
  return `
    <button
      class="choice-cell ${mode === "table" ? "table-choice" : "detail-choice"}"
      data-choice-trigger
      data-trade-id="${escapeAttr(trade.id)}"
      data-field-id="${field.id}"
      type="button"
      title="选择${escapeAttr(field.name)}"
    >
      <span class="choice-cell-values">${pills || `<span class="choice-placeholder">点击选择</span>`}</span>
      <span class="cell-caret">v</span>
    </button>
  `;
}

function bindChoiceTriggers() {
  document.querySelectorAll("[data-choice-trigger]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      openChoicePopover(trigger);
    });
  });
}

function openChoicePopover(trigger) {
  const rect = trigger.getBoundingClientRect();
  state.choiceEditor = {
    tradeId: trigger.dataset.tradeId,
    fieldId: Number(trigger.dataset.fieldId),
    query: "",
    rect: {
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
    },
  };
  renderChoicePopover();
}

function choicePopoverNode() {
  let node = document.getElementById("choicePopover");
  if (!node) {
    node = document.createElement("div");
    node.id = "choicePopover";
    node.className = "choice-popover hidden";
    node.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(node);
  }
  return node;
}

function renderChoicePopover() {
  const editor = state.choiceEditor;
  const node = choicePopoverNode();
  if (!editor) {
    node.classList.add("hidden");
    return;
  }
  const field = customFieldById(editor.fieldId);
  const trade = tradeById(editor.tradeId);
  if (!field || !trade) {
    closeChoicePopover();
    return;
  }
  const query = editor.query || "";
  const selected = selectedOptionIds(trade, field);
  const visibleOptions = (field.options || []).filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  const hasExact = (field.options || []).some((option) => option.label.toLowerCase() === query.trim().toLowerCase());
  const createButton = query.trim() && !hasExact
    ? `<button class="choice-create" data-choice-create type="button">创建 ${escapeHtml(query.trim())}</button>`
    : "";
  const clearButton = field.field_type === "single"
    ? `<button class="choice-option muted-choice ${selected.length ? "" : "selected"}" data-choice-option="" type="button">未选</button>`
    : `<button class="choice-option muted-choice" data-choice-option="" type="button">清空</button>`;
  const optionButtons = visibleOptions
    .map((option) => {
      const isSelected = selected.includes(String(option.id));
      return `
        <button
          class="choice-option ${isSelected ? "selected" : ""}"
          style="--choice:${escapeAttr(option.color || "#2bd4ff")};"
          data-choice-option="${option.id}"
          type="button"
        >
          <span class="choice-option-dot"></span>
          <span>${escapeHtml(option.label)}</span>
        </button>
      `;
    })
    .join("");
  node.innerHTML = `
    <div class="choice-popover-title">
      <strong>${escapeHtml(field.name)}</strong>
      <span>${fieldTypeLabel(field.field_type)}</span>
    </div>
    <input class="choice-search" data-choice-search type="search" value="${escapeAttr(query)}" placeholder="查找或创建选项" />
    <div class="choice-options">
      ${clearButton}
      ${optionButtons || `<div class="choice-empty">没有匹配选项</div>`}
      ${createButton}
    </div>
  `;
  positionChoicePopover(node, editor.rect);
  node.classList.remove("hidden");
  node.querySelectorAll("[data-choice-option]").forEach((button) => {
    button.addEventListener("click", () => chooseCustomOption(editor.tradeId, editor.fieldId, button.dataset.choiceOption));
  });
  node.querySelector("[data-choice-create]")?.addEventListener("click", createOptionAndSelect);
  const search = node.querySelector("[data-choice-search]");
  search.addEventListener("input", (event) => {
    state.choiceEditor.query = event.target.value;
    renderChoicePopover();
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createOptionAndSelect();
    }
  });
  window.requestAnimationFrame(() => {
    const input = node.querySelector("[data-choice-search]");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function positionChoicePopover(node, rect) {
  const width = 292;
  const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 360));
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.width = `${width}px`;
}

function closeChoicePopover() {
  state.choiceEditor = null;
  choicePopoverNode().classList.add("hidden");
}

async function chooseCustomOption(tradeId, fieldId, optionId) {
  const field = customFieldById(fieldId);
  const trade = tradeById(tradeId);
  if (!field || !trade) return;
  let value = optionId || "";
  let keepOpen = false;
  if (field.field_type === "multi") {
    const selected = selectedOptionIds(trade, field);
    if (!optionId) {
      value = [];
    } else if (selected.includes(String(optionId))) {
      value = selected.filter((item) => item !== String(optionId));
    } else {
      value = [...selected, String(optionId)];
    }
    keepOpen = true;
  }
  await saveCustomChoiceValue(tradeId, fieldId, value, keepOpen);
}

async function saveCustomChoiceValue(tradeId, fieldId, value, keepOpen) {
  const result = await api(`/api/trades/${encodeURIComponent(tradeId)}/custom-fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
  setTradeCustomValue(tradeId, fieldId, result.value);
  renderTrades();
  renderTradeDetail();
  if (keepOpen && state.choiceEditor) {
    renderChoicePopover();
  } else {
    closeChoicePopover();
  }
  toast("字段内容已保存");
}

async function createOptionAndSelect() {
  const editor = state.choiceEditor;
  if (!editor) return;
  const field = customFieldById(editor.fieldId);
  if (!field || field.field_type === "text") return;
  const label = editor.query.trim();
  if (!label) return;
  const existing = (field.options || []).find((option) => option.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    await chooseCustomOption(editor.tradeId, editor.fieldId, String(existing.id));
    return;
  }
  const options = [...(field.options || []), { label, color: choiceColor((field.options || []).length) }];
  const updated = await api(`/api/custom-fields/${field.id}`, {
    method: "PUT",
    body: JSON.stringify({ name: field.name, field_type: field.field_type, options }),
  });
  updateCustomFieldState(updated);
  const created = [...(updated.options || [])].reverse().find((option) => option.label.toLowerCase() === label.toLowerCase());
  if (!created) return;
  state.choiceEditor.query = "";
  await chooseCustomOption(editor.tradeId, editor.fieldId, String(created.id));
}

function tradeById(tradeId) {
  return state.data.trades.find((trade) => trade.id === tradeId);
}

function setTradeCustomValue(tradeId, fieldId, value) {
  const trade = tradeById(tradeId);
  if (!trade) return;
  trade.custom_fields = trade.custom_fields || {};
  trade.custom_fields[String(fieldId)] = value;
}

function updateCustomFieldState(updatedField) {
  const fields = customFields();
  const index = fields.findIndex((field) => Number(field.id) === Number(updatedField.id));
  if (index >= 0) fields[index] = updatedField;
}

function choiceColor(index) {
  return CHOICE_COLORS[Math.abs(Number(index) || 0) % CHOICE_COLORS.length];
}

function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCurveTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(", ", " ");
}

function formatHour(iso) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatZoneTime(date, zone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

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

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatRValue(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return RMultipleUI.signedR(value);
}

function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 8 });
}

function formatBeijingDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRatio(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(2);
}

function zClassification(value) {
  return {
    alternating: "交替",
    clustered: "成串",
    independent: "独立",
    insufficient_data: "样本不足",
  }[value] || "样本不足";
}

function formatZScore(value) {
  const z = value || {};
  return z.z === null || z.z === undefined
    ? "样本不足"
    : `${Number(z.z).toFixed(2)} · ${zClassification(z.classification)}`;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function profitClass(value) {
  return Number(value) < 0 ? "loss-text" : "profit-text";
}

function heatColor(pnl, maxAbs) {
  if (!pnl || !maxAbs) return "#101413";
  const strength = Math.min(Math.abs(pnl) / maxAbs, 1);
  const alpha = 0.16 + strength * 0.7;
  return pnl > 0 ? `rgba(43, 212, 255, ${alpha})` : `rgba(255, 92, 122, ${alpha})`;
}

function calendarColor(pnl, monthNet) {
  const base = Math.max(Math.abs(monthNet), Math.abs(pnl), 1);
  const alpha = 0.18 + Math.min(Math.abs(pnl) / base, 1) * 0.36;
  return pnl > 0 ? `rgba(26, 92, 112, ${alpha})` : `rgba(112, 28, 44, ${alpha})`;
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("visible"), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}







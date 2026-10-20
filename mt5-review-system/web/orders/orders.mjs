import { RequestGate } from "../shared/js/api.mjs";
import {
  escapeAttr,
  escapeHtml,
  formatHoldingTime,
  formatMoney,
  formatPrice,
  formatRValue,
  formatVolume,
  profitClass,
} from "../shared/js/formatters.mjs";
import { renderRegionState, showToast } from "../shared/js/feedback.mjs";
import { mountShell } from "../shared/js/shell.mjs";
import {
  buildCampaignsQuery,
  normalizeListState,
  readOrdersState,
  writeOrdersState,
} from "./orders-state.mjs";
import { createCustomFieldsModule, fieldTypeLabel } from "./custom-fields.mjs";
import { createOrderDetailModule } from "./order-detail.mjs";

function rMultiple() {
  return globalThis.RMultipleUI;
}

const campaignDayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const campaignDayLabelFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  weekday: "short",
});
const campaignTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const CHECKIN_WEEKDAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];

function parseCalendarDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { date, year, month, day, key: String(value) };
}

export function renderCheckinCalendarMarkup(payload = {}) {
  const days = Array.isArray(payload?.days) ? payload.days : [];
  const dayMap = new Map();
  for (const item of days) {
    const parsed = parseCalendarDate(item?.date);
    if (parsed) dayMap.set(parsed.key, Math.max(0, Number(item?.count || 0)));
  }
  const focus = parseCalendarDate(payload?.today?.date)
    || [...dayMap.keys()].map(parseCalendarDate).filter(Boolean).sort((left, right) => left.date - right.date).at(-1);
  if (!focus) return `<div class="checkin-calendar-empty muted-mini">暂无打卡记录</div>`;

  const firstDay = new Date(Date.UTC(focus.year, focus.month, 1));
  const mondayOffset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(focus.year, focus.month + 1, 0)).getUTCDate();
  const todayKey = String(payload?.today?.date || "");
  const cells = [];
  for (let index = 0; index < mondayOffset; index += 1) {
    cells.push(`<div class="checkin-day is-empty" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${focus.year}-${String(focus.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const count = dayMap.get(key) || 0;
    const classes = ["checkin-day", count ? "has-checkin" : "", key === todayKey ? "is-today" : ""].filter(Boolean).join(" ");
    cells.push(`<div class="${classes}" role="gridcell" data-date="${escapeAttr(key)}" aria-label="${escapeAttr(key)}：${count} 次">
      <strong>${day}</strong><span>${count ? `${count}次` : "·"}</span>
    </div>`);
  }
  return `<div class="checkin-calendar-month">
    <div class="checkin-calendar-month-label">${focus.year}年${focus.month + 1}月</div>
    <div class="checkin-calendar-weekdays" role="row">${CHECKIN_WEEKDAYS.map((label) => `<span role="columnheader">${label}</span>`).join("")}</div>
    <div class="checkin-calendar-grid">${cells.join("")}</div>
  </div>`;
}

function campaignDateInfo(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { key: String(value || "unknown"), label: "日期未知", time: "--:--" };
  }
  const dayParts = Object.fromEntries(
    campaignDayLabelFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    key: campaignDayKeyFormatter.format(date),
    label: `${dayParts.month}月${dayParts.day}日 ${dayParts.weekday}`,
    time: campaignTimeFormatter.format(date),
  };
}

function groupCampaignsByDay(campaigns) {
  const groups = [];
  const byKey = new Map();
  for (const campaign of campaigns || []) {
    const day = campaignDateInfo(campaign.opened_at_utc);
    let group = byKey.get(day.key);
    if (!group) {
      group = { ...day, campaigns: [] };
      byKey.set(day.key, group);
      groups.push(group);
    }
    group.campaigns.push(campaign);
  }
  for (const group of groups) {
    group.campaigns.sort((left, right) => {
      const leftTime = Date.parse(left.opened_at_utc || "");
      const rightTime = Date.parse(right.opened_at_utc || "");
      if (!Number.isFinite(leftTime)) return Number.isFinite(rightTime) ? 1 : 0;
      if (!Number.isFinite(rightTime)) return -1;
      return leftTime - rightTime;
    });
  }
  return groups;
}

function campaignRLabel(campaign) {
  return String(rMultiple()?.formatCampaignR?.(campaign) || "-")
    .replaceAll("R", "")
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateCampaignPageSize({
  availableHeight,
  groupCount = 1,
  rowHeight = 44,
  groupRowHeight = 31,
  min = 1,
  max = 200,
} = {}) {
  const height = Number(availableHeight);
  const rows = Number(rowHeight);
  const groups = Math.max(1, Number(groupCount) || 1);
  if (!Number.isFinite(height) || !Number.isFinite(rows) || rows <= 0) return min;
  const capacity = Math.floor((height - groups * Number(groupRowHeight || 0)) / rows);
  return Math.min(max, Math.max(min, capacity));
}

export function mergePinnedCampaigns(campaigns = [], pinnedCampaign = null, pageSize = null) {
  const source = Array.isArray(campaigns) ? campaigns : [];
  if (!pinnedCampaign?.id) return source;
  const visible = [
    pinnedCampaign,
    ...source.filter((campaign) => campaign?.id !== pinnedCampaign.id),
  ];
  const limit = Number(pageSize);
  return Number.isFinite(limit) && limit > 0 ? visible.slice(0, limit) : visible;
}

export function createOrdersController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  platform = "mt5",
  onRefresh = null,
  confirm = (message) => (globalThis.confirm ? globalThis.confirm(message) : true),
  prompt = (message, initialValue = "") => (globalThis.prompt ? globalThis.prompt(message, initialValue) : initialValue),
} = {}) {
  const gate = new RequestGate();
  let state = readOrdersState(location.search);
  let catalog = { custom_fields: [], classification_options: [], scratch_threshold_r: 0.15 };
  let page = { campaigns: [], total: 0, page: state.page, page_size: state.pageSize };
  let campaignDetail = null;
  let selectedCampaignId = state.campaign || null;
  let selectedPositionId = null;
  let selectedTradeId = null;
  const collapsedDayKeys = new Set();
  const trades = new Map();
  let capacitySyncTimer = null;
  let capacitySyncInFlight = false;

  function toast(message, options) {
    if (typeof view.getElementById !== "function") return;
    if (typeof globalThis.document === "undefined") return;
    showToast(message, options);
  }

  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function setHtml(id, html) {
    const node = getElement(id);
    if (node) node.innerHTML = html;
  }

  function renderRegion(regionId, options) {
    const node = getElement(regionId);
    if (!node || typeof node.replaceChildren !== "function") return;
    renderRegionState(node, options);
  }

  function commitState(partial) {
    state = { ...state, ...partial };
    writeOrdersState(state, { location, history });
  }

  // --- catalog helpers ---

  function customFields() {
    return (catalog.custom_fields || []).filter((field) => field.name !== "\u8d8b\u52bf");
  }

  function classificationOptions(dimension) {
    return (catalog.classification_options || []).filter((option) => option.dimension === dimension);
  }

  function classificationOptionLabel(dimension, optionId) {
    return classificationOptions(dimension).find((option) => option.id === optionId)?.label || "未分类";
  }

  function classificationSelectOptions(dimension, currentId) {
    const available = classificationOptions(dimension).filter((option) => option.active);
    return available
      .map((option) => {
        const selected = option.id === currentId ? "selected" : "";
        return `<option value="${escapeAttr(option.id)}" ${selected}>${escapeHtml(option.label)}</option>`;
      })
      .join("");
  }

  function renderCampaignClassificationSelect(campaign, dimension) {
    const currentId = campaign?.[dimension] || (dimension === "strategy" ? "strategy_unclassified" : "unclassified");
    const option = classificationOptions(dimension).find((item) => item.id === currentId);
    const label = dimension === "trade_type" ? "交易场景" : "交易策略";
    return `<select
      class="campaign-classification-select"
      data-campaign-classification="${escapeAttr(dimension)}"
      data-campaign-id="${escapeAttr(campaign.id)}"
      aria-label="${label}"
      title="修改组合${label}"
      style="--classification-color: ${escapeAttr(option?.color || "#8ca29b")}"
    >${classificationSelectOptions(dimension, currentId)}</select>`;
  }

  function scratchThresholdR() {
    const value = Number(catalog.scratch_threshold_r ?? 0.15);
    return Number.isFinite(value) ? Math.abs(value) : 0.15;
  }

  function isScratchCampaign(campaign = {}) {
    const value = Number(campaign.campaign_r);
    return campaign.risk_status === "complete" && Number.isFinite(value) && Math.abs(value) <= scratchThresholdR();
  }

  // --- campaign / position / trade helpers ---

  function campaignPositionSummaries(campaign) {
    return Array.isArray(campaign?.position_summaries) ? campaign.position_summaries : [];
  }

  function campaignSourceTrade(campaign) {
    if (!campaign) return null;
    const summaries = campaignPositionSummaries(campaign);
    for (let index = summaries.length - 1; index >= 0; index -= 1) {
      if (summaries[index]?.source_trade) return summaries[index].source_trade;
    }
    return null;
  }

  function selectedCampaign() {
    return page.campaigns.find((campaign) => campaign.id === selectedCampaignId) || null;
  }

  function indexTrade(trade) {
    if (trade?.id) trades.set(String(trade.id), trade);
  }

  function indexSourceTrades(sourceTrades) {
    for (const trade of sourceTrades || []) indexTrade(trade);
  }

  function rebuildTrades() {
    trades.clear();
    for (const campaign of page.campaigns) {
      for (const summary of campaignPositionSummaries(campaign)) {
        indexTrade(summary.source_trade);
        indexSourceTrades(summary.source_trades);
      }
    }
    for (const position of campaignDetail?.positions || []) {
      indexTrade(position.source_trade);
      indexSourceTrades(position.source_trades);
    }
  }

  function resolveTrade(id) {
    return trades.get(String(id)) || null;
  }

  function forEachTradeReference(tradeId, callback) {
    const seen = new Set();
    const visit = (trade) => {
      if (!trade?.id || String(trade.id) !== String(tradeId) || seen.has(trade)) return;
      seen.add(trade);
      callback(trade);
    };
    visit(resolveTrade(tradeId));
    for (const campaign of page.campaigns || []) {
      for (const summary of campaignPositionSummaries(campaign)) {
        visit(summary.source_trade);
        for (const trade of summary.source_trades || []) visit(trade);
      }
    }
    for (const position of campaignDetail?.positions || []) {
      visit(position.source_trade);
      for (const trade of position.source_trades || []) visit(trade);
    }
  }

  function setTradeCustomValue(tradeId, fieldId, value) {
    forEachTradeReference(tradeId, (trade) => {
      trade.custom_fields = trade.custom_fields || {};
      trade.custom_fields[String(fieldId)] = value;
    });
    return value;
  }

  function applyFieldUpdate(updatedField) {
    const fields = catalog.custom_fields || [];
    const index = fields.findIndex((field) => Number(field.id) === Number(updatedField.id));
    if (index >= 0) fields[index] = updatedField;
    else fields.push(updatedField);
  }

  function getSelection() {
    const campaign = selectedCampaign();
    const detail = campaignDetail?.id === campaign?.id ? campaignDetail : null;
    const position = selectedPositionId && detail
      ? (detail.positions || []).find((item) => item.id === selectedPositionId)
      : null;
    const trade = position
      ? resolveTrade(selectedTradeId) || position.source_trade || null
      : campaignSourceTrade(campaign);
    return {
      campaign,
      detail,
      position,
      trade,
      customFields: customFields(),
      classificationOptions: classificationOptions,
    };
  }

  // --- rendering ---

  function stopEditorMarkup(position, scope = "table") {
    return `<div class="inline-stop-editor ${position.risk_status === "complete" ? "" : "missing"}">
      <input class="numeric-cell-input" data-position-stop="${escapeAttr(position.id)}" data-position-editor="${scope}" type="number" step="any" inputmode="decimal" value="${escapeAttr(position.initial_stop_price ?? "")}" placeholder="请输入初始止损" aria-label="Position ${escapeAttr(position.display_position_id || position.position_id)} 初始止损" />
    </div>`;
  }

  function classificationField(dimension) {
    const names = { trade_type: "交易场景", strategy: "交易策略" };
    return {
      id: `classification-${dimension}`,
      name: names[dimension] || dimension,
      field_type: "single",
      classification_dimension: dimension,
      options: classificationOptions(dimension).filter((option) => option.active),
    };
  }

  async function saveClassificationValue(tradeId, dimension, value) {
    const trade = resolveTrade(tradeId);
    if (!trade) return;
    const payload = {
      trade_type: dimension === "trade_type" ? value : trade.trade_type,
      strategy: dimension === "strategy" ? value : trade.strategy,
      review_text: trade.review_text || "",
    };
    const updated = await api.requestJson(`/api/trades/${encodeURIComponent(tradeId)}/review`, {
      method: "PATCH",
      body: payload,
    });
    Object.assign(trade, updated || {}, { [dimension]: value });
    await afterMutation();
  }

  async function saveCampaignClassification(campaignId, dimension, value) {
    const campaign = page.campaigns.find((item) => item.id === campaignId);
    if (!campaign || !["trade_type", "strategy"].includes(dimension)) return null;
    const payload = {
      trade_type: dimension === "trade_type" ? value : campaign.trade_type,
      strategy: dimension === "strategy" ? value : campaign.strategy,
      review_text: campaign.review_text || "",
    };
    const updated = await api.requestJson(`/api/campaigns/${encodeURIComponent(campaignId)}/review`, {
      method: "PATCH",
      body: payload,
    });
    Object.assign(campaign, updated || {}, { [dimension]: value });
    if (campaignDetail?.id === campaignId) Object.assign(campaignDetail, updated || {}, { [dimension]: value });
    await afterMutation();
    return updated;
  }

  function setClassificationValue(tradeId, dimension, value) {
    forEachTradeReference(tradeId, (trade) => {
      trade[dimension] = value;
    });
  }

  function formatTablePrice(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed).toLocaleString("zh-CN") : "-";
  }

  function formatTableHoldingTime(seconds) {
    const totalMinutes = Math.max(0, Math.floor(Number(seconds || 0) / 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}小时${minutes}分` : `${minutes}分`;
  }

  function renderCampaignPositionRow(campaign, position, index, fieldCount, scratch) {
    const sourceTrade = position.source_trade || null;
    const editableTrade = sourceTrade ? resolveTrade(sourceTrade.id) || sourceTrade : null;
    const customCells = customFields()
      .map(
        (field) => `
          <td data-label="${escapeAttr(field.name)}" class="custom-value-cell">
            ${editableTrade ? customFieldsModule.renderCustomValueEditor(editableTrade, field, "table") : `<span class="muted-mini">未填写</span>`}
          </td>
        `,
      )
      .join("");
    const shot = sourceTrade?.screenshot_url
      ? `<button class="shot-btn" data-shot="${escapeAttr(sourceTrade.screenshot_url)}" title="查看截图"><img src="${escapeAttr(sourceTrade.screenshot_url)}" alt="MT5截图" /></button>`
      : `<span class="muted-mini">无</span>`;
    const rValue = position.position_r === null || position.position_r === undefined
      ? "R 缺失"
      : formatRValue(position.position_r);
    return `
      <tr class="campaign-detail-row ${scratch ? "scratch" : ""} ${selectedPositionId === position.id ? "active" : ""}" data-campaign-id="${escapeAttr(campaign.id)}" data-position-id="${escapeAttr(position.id)}" data-trade-id="${escapeAttr(sourceTrade?.id || "")}">
        <td data-label="交易组合"><div class="child-order-cell"><span class="child-branch">└</span><span>Position ${escapeHtml(position.display_position_id || position.position_id)}</span></div></td>
        <td data-label="品种 / 方向"><div class="symbol-cell"><span class="side ${campaign.side}">${campaign.side === "long" ? "多" : "空"}</span><span class="child-label">第 ${index + 1} 笔</span></div></td>
        <td data-label="交易数据">
          <div class="trade-metrics-cell">
            <span><b>入</b> ${formatTablePrice(position.weighted_entry_price)} <i>${formatVolume(position.entry_volume)}手</i></span>
            <span><b>出</b> ${formatTablePrice(position.weighted_exit_price)} <i>${formatVolume(position.exit_volume)}手</i></span>
            <span><b>持</b> ${escapeHtml(formatTableHoldingTime(position.holding_seconds))}</span>
          </div>
        </td>
        <td data-label="初始止损">${stopEditorMarkup(position)}</td>
        <td data-label="组合 R" class="campaign-r-cell ${position.risk_status === "complete" ? "risk-complete" : "risk-missing"}">${escapeHtml(rValue)}</td>
        <td data-label="组合盈亏" class="${profitClass(position.position_pnl)}">${formatMoney(position.position_pnl ?? 0)}</td>
        <td data-label="交易场景">${sourceTrade ? customFieldsModule.renderCustomValueEditor(sourceTrade, classificationField("trade_type"), "table") : `<span class="catalog-value">未分类</span>`}</td>
        <td data-label="交易策略">${sourceTrade ? customFieldsModule.renderCustomValueEditor(sourceTrade, classificationField("strategy"), "table") : `<span class="catalog-value">未分类</span>`}</td>
        ${customCells}
        <td data-label="截图">${shot}</td>
      </tr>
    `;
  }

  function renderCampaignRows() {
    setHtml(
      "orderHead",
      `
        <tr><th>开仓时间</th><th>R 值</th><th>净盈亏</th></tr>
      `,
    );
    const rows = groupCampaignsByDay(page.campaigns).map((group) => {
      const groupPnl = group.campaigns.reduce((total, campaign) => total + Number(campaign.net_pnl || 0), 0);
      const expanded = !collapsedDayKeys.has(group.key);
      const summary = `
        <tr class="campaign-day-row" data-day-key="${escapeAttr(group.key)}">
          <td colspan="3">
            <button class="campaign-day-toggle" type="button" data-day-toggle="${escapeAttr(group.key)}" aria-expanded="${expanded}">
              <span class="campaign-day-chevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
              <span class="campaign-day-summary">
              <strong>${escapeHtml(group.label)}</strong>
              <span>${group.campaigns.length}笔</span>
              <strong class="${profitClass(groupPnl)}">${formatMoney(groupPnl)}</strong>
              </span>
            </button>
          </td>
        </tr>
      `;
      const campaignRows = group.campaigns.map((campaign, dayIndex) => {
        const active = campaign.id === selectedCampaignId ? "active" : "";
        const riskClass = campaign.risk_status === "complete" ? "risk-complete" : `risk-${campaign.risk_status || "missing"}`;
        const positions = campaignPositionSummaries(campaign);
        const scratch = isScratchCampaign(campaign);
        const combinedMark = positions.length > 1 || Number(campaign.scale_in_count || 0) > 0
          ? `<span class="campaign-kind-mark" title="合并订单，包含加减仓记录" aria-label="合并订单">组</span>`
          : "";
        const scratchMark = scratch
          ? `<span class="campaign-scratch-mark" title="打平订单" aria-label="打平订单">平</span>`
          : "";
        const missingStop = campaign.risk_status !== "complete"
          ? `<span class="campaign-risk-mark" title="初始止损未完整填写" aria-label="初始止损未完整填写">!</span>`
          : "";
        const timeLabel = campaignDateInfo(campaign.opened_at_utc).time;
        return `
          <tr class="campaign-row ${active} ${scratch ? "scratch" : ""} ${campaign.risk_status === "complete" ? "" : "has-risk-gap"}" data-campaign-id="${escapeAttr(campaign.id)}" data-day-sequence="${dayIndex + 1}">
            <td data-label="开仓时间">
              <div class="campaign-list-time">
                <span class="campaign-list-index" aria-label="当日第 ${dayIndex + 1} 笔">${dayIndex + 1}</span>
                <span class="campaign-row-flags">${scratchMark}${combinedMark}${missingStop}</span>
                <strong>${escapeHtml(timeLabel)}</strong>
              </div>
            </td>
            <td data-label="R 值" class="campaign-r-cell ${riskClass}">${escapeHtml(campaignRLabel(campaign))}</td>
            <td data-label="净盈亏" class="campaign-pnl-cell ${profitClass(campaign.net_pnl)}"><strong class="campaign-list-pnl ${profitClass(campaign.net_pnl)}">${formatMoney(campaign.net_pnl)}</strong></td>
          </tr>
        `;
      }).join("");
      return summary + (expanded ? campaignRows : "");
    }).join("");
    setHtml("orderRows", rows || `<tr><td colspan="3">没有匹配的主订单</td></tr>`);
    applyListPanelHeight();
    bindDayToggles();
    bindRowInteractions();
  }

  function applyListPanelHeight() {
    const panel = view.querySelector?.(".trades-panel");
    const indexColumn = view.querySelector?.(".orders-index-column");
    const detailPanel = view.querySelector?.(".detail-panel");
    if (!panel || !detailPanel || typeof panel.getBoundingClientRect !== "function" || typeof detailPanel.getBoundingClientRect !== "function") return;
    if (typeof globalThis.innerWidth === "number" && globalThis.innerWidth <= 1080) {
      panel.style.maxHeight = "";
      panel.style.height = "";
      if (indexColumn) {
        indexColumn.style.maxHeight = "";
        indexColumn.style.height = "";
      }
      return;
    }
    const detailHeight = detailPanel.getBoundingClientRect().height;
    if (detailHeight > 0) {
      const height = `${Math.ceil(detailHeight)}px`;
      if (indexColumn) {
        indexColumn.style.height = height;
        indexColumn.style.maxHeight = height;
      } else {
        panel.style.height = height;
        panel.style.maxHeight = height;
      }
    }
  }

  function listCapacity() {
    const panel = view.querySelector?.(".trades-panel");
    const indexColumn = view.querySelector?.(".orders-index-column");
    const detailPanel = view.querySelector?.(".detail-panel");
    if (!panel || !detailPanel || typeof detailPanel.getBoundingClientRect !== "function") return null;
    if (typeof globalThis.innerWidth === "number" && globalThis.innerWidth <= 1080) return null;
    const panelHeight = panel.getBoundingClientRect().height;
    const indexHeight = indexColumn?.getBoundingClientRect?.().height || 0;
    if (!panelHeight || !indexHeight) return null;
    const headHeight = panel.querySelector?.(".orders-panel-head")?.getBoundingClientRect?.().height || 0;
    const paginationHeight = panel.querySelector?.(".pagination")?.getBoundingClientRect?.().height || 0;
    const tableHeadHeight = panel.querySelector?.(".orders-table thead")?.getBoundingClientRect?.().height || 44;
    const availableHeight = panelHeight - headHeight - paginationHeight - tableHeadHeight - 2;
    const groupCount = panel.querySelectorAll?.(".campaign-day-row")?.length || 1;
    return calculateCampaignPageSize({ availableHeight, groupCount });
  }

  async function syncListCapacity() {
    if (capacitySyncInFlight) return;
    applyListPanelHeight();
    const capacity = listCapacity();
    if (!capacity || capacity === state.pageSize) return;
    capacitySyncInFlight = true;
    try {
      const selectedIndex = page.campaigns.findIndex((campaign) => campaign.id === selectedCampaignId);
      const pageSize = page.page_size || state.pageSize;
      const absoluteIndex = selectedIndex >= 0
        ? Math.max(0, (page.page - 1) * pageSize + selectedIndex)
        : Math.max(0, (state.page - 1) * state.pageSize);
      commitState({ pageSize: capacity, page: Math.floor(absoluteIndex / capacity) + 1 });
      const pinnedCampaign = campaignDetail?.id === selectedCampaignId ? campaignDetail : null;
      await loadList(undefined, { pinnedCampaign });
    } finally {
      capacitySyncInFlight = false;
    }
  }

  function scheduleListCapacitySync() {
    if (capacitySyncTimer) clearTimeout(capacitySyncTimer);
    capacitySyncTimer = setTimeout(() => {
      capacitySyncTimer = null;
      syncListCapacity().catch((error) => {
        if (error?.name !== "AbortError") toast(error?.message || "订单列表布局更新失败", { tone: "error" });
      });
    }, 0);
  }

  function bindDayToggles() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const button of view.querySelectorAll("[data-day-toggle]")) {
      button.addEventListener("click", () => toggleDay(button.dataset.dayToggle));
    }
  }

  function syncListViewTabs() {
    for (const [id, value] of [["orderViewAll", "all"], ["orderViewFeatured", "featured"]]) {
      const button = getElement(id);
      if (!button) continue;
      const active = state.listView === value;
      button.setAttribute("aria-selected", String(active));
      button.classList?.toggle?.("active", active);
      if (!button.classList?.toggle) {
        if (active) button.classList?.add?.("active");
        else button.classList?.remove?.("active");
      }
    }
  }

  function bindListViewTabs() {
    for (const [id, value] of [["orderViewAll", "all"], ["orderViewFeatured", "featured"]]) {
      const button = getElement(id);
      if (!button) continue;
      button.addEventListener("click", () => {
        selectedCampaignId = null;
        selectedTradeId = null;
        selectedPositionId = null;
        commitState({ listView: value, page: 1, campaign: "", trade: "" });
        syncListViewTabs();
        loadList();
      });
    }
    syncListViewTabs();
  }

  function bindRowInteractions() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const row of view.querySelectorAll("tr[data-campaign-id]")) {
      row.addEventListener("click", async (event) => {
        if (event?.target?.closest?.("button, input, select, textarea, a")) return;
        selectedCampaignId = row.dataset.campaignId;
        selectedPositionId = row.dataset.positionId || null;
        selectedTradeId = row.dataset.tradeId || null;
        commitState({ campaign: selectedCampaignId, trade: selectedTradeId || undefined });
        await selectCampaign(selectedCampaignId);
      });
    }
  }

  function toggleDay(dayKey) {
    if (collapsedDayKeys.has(dayKey)) collapsedDayKeys.delete(dayKey);
    else collapsedDayKeys.add(dayKey);
    renderCampaignRows();
  }

  function toggleExpand(dayKey) {
    toggleDay(dayKey);
  }

  function renderPagination() {
    const total = page.total || 0;
    const current = page.page || state.page || 1;
    const pageSize = page.page_size || state.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    setText("orderTotal", `${total} 个交易组合`);
    setText("orderPage", `第 ${current} / ${totalPages} 页`);
    const prev = getElement("orderPrev");
    const next = getElement("orderNext");
    if (prev) prev.disabled = current <= 1;
    if (next) next.disabled = current >= totalPages;
  }

  function setText(id, text) {
    const node = getElement(id);
    if (node) node.textContent = text;
  }

  function renderCheckinCalendar(payload) {
    const days = Array.isArray(payload?.days) ? payload.days : [];
    const calendar = getElement("checkinCalendar");
    const summary = getElement("checkinCalendarSummary");
    if (summary) summary.textContent = `今日 ${payload?.today?.count || 0} / ${payload?.daily_goal || 0}`;
    if (!calendar) return;
    calendar.innerHTML = renderCheckinCalendarMarkup(payload);
  }

  async function loadCheckinCalendar() {
    try {
      const query = new URLSearchParams({ days: "35", platform: String(platform || "mt5") });
      const result = await api.requestJson(`/api/campaign-checkins?${query}`);
      renderCheckinCalendar(result);
    } catch (error) {
      if (error?.name === "AbortError") return;
      const summary = getElement("checkinCalendarSummary");
      if (summary) summary.textContent = "暂不可用";
    }
  }

  function openImageModal(src) {
    if (!src) return;
    const modal = getElement("imageModal");
    const image = getElement("modalImage");
    if (modal) {
      modal.classList?.add?.("open");
      modal.setAttribute?.("aria-hidden", "false");
    }
    if (image) image.src = src;
  }

  function closeImageModal() {
    const modal = getElement("imageModal");
    const image = getElement("modalImage");
    if (modal) {
      modal.classList?.remove?.("open");
      modal.setAttribute?.("aria-hidden", "true");
    }
    if (image) image.src = "";
  }

  function renderDetail() {
    detailModule.render();
  }

  function rerender() {
    renderCampaignRows();
    renderDetail();
    renderPagination();
  }

  // --- data loading ---

  async function loadCatalog() {
    try {
      const [fields, classifications, settings] = await Promise.all([
        api.requestJson("/api/custom-fields?active_only=1"),
        api.requestJson("/api/classification-options?active_only=1"),
        api.requestJson("/api/analysis-settings"),
      ]);
      catalog = {
        custom_fields: fields?.custom_fields || [],
        classification_options: classifications?.classification_options || [],
        scratch_threshold_r: settings?.scratch_threshold_r ?? 0.15,
      };
      renderClassificationFilters();
    } catch (error) {
      if (error?.name === "AbortError") return;
      // Catalog is non-fatal; the list still renders with fallback labels.
      catalog = { custom_fields: [], classification_options: [], scratch_threshold_r: 0.15 };
    }
  }

  function renderClassificationFilters() {
    const configs = [
      ["tradeTypeFilter", "trade_type", "全部类型", "tradeType"],
      ["strategyFilter", "strategy", "全部策略", "strategy"],
    ];
    for (const [elementId, dimension, allLabel, stateKey] of configs) {
      const select = getElement(elementId);
      if (!select) continue;
      const options = classificationOptions(dimension)
        .map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}</option>`)
        .join("");
      select.innerHTML = `<option value="all">${allLabel}</option>${options}`;
      select.value = state[stateKey] ?? "all";
    }
  }

  async function loadList(partialState, { pinnedCampaign = null } = {}) {
    if (partialState) state = normalizeListState({ ...state, ...partialState });
    const query = buildCampaignsQuery(state);
    renderRegion("orderRegion", { state: "loading", message: "正在读取订单列表" });
    try {
      const result = await gate.run("campaigns", (signal) => api.requestJson(`/api/campaigns?${query}`, { signal }));
      const pageSize = result?.page_size || state.pageSize;
      page = {
        campaigns: mergePinnedCampaigns(result?.campaigns || [], pinnedCampaign, pageSize),
        total: result?.total || 0,
        page: result?.page || state.page,
        page_size: pageSize,
      };
      resolveSelection(page.campaigns);
      rebuildTrades();
      renderCampaignRows();
      renderPagination();
      renderDetail();
      return result;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      renderRegion("orderRegion", {
        state: "error",
        message: error?.message || "读取订单列表失败",
        onRetry: () => loadList(),
      });
      return null;
    }
  }

  function resolveSelection(campaigns) {
    if (selectedCampaignId && campaigns.some((campaign) => campaign.id === selectedCampaignId)) return;
    if (state.trade) {
      const match = campaigns.find((campaign) => (campaign.source_trade_ids || []).includes(state.trade));
      if (match) {
        selectedCampaignId = match.id;
        return;
      }
    }
    if (state.campaign && campaigns.some((campaign) => campaign.id === state.campaign)) {
      selectedCampaignId = state.campaign;
      return;
    }
    selectedCampaignId = campaigns[0]?.id || null;
  }

  async function selectCampaign(campaignId) {
    selectedCampaignId = campaignId;
    if (!campaignId) {
      campaignDetail = null;
      renderDetail();
      return;
    }
    try {
      await loadCampaignDetail(campaignId);
      if (state.trade) {
        const selectedPosition = (campaignDetail?.positions || []).find((item) =>
          [item.source_trade, ...(item.source_trades || [])].some(
            (trade) => String(trade?.id) === String(state.trade),
          ),
        );
        selectedPositionId = selectedPosition?.id || null;
        selectedTradeId = selectedPosition ? state.trade : null;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      toast(error?.message || "交易组合详情加载失败", { tone: "error" });
    }
    renderDetail();
    renderCampaignRows();
    await syncListCapacity();
  }

  async function loadCampaignDetail(campaignId) {
    const deleted = state.deleted === "deleted" ? "?deleted=deleted" : "";
    campaignDetail = await gate.run("detail", (signal) => api.requestJson(`/api/campaigns/${encodeURIComponent(campaignId)}${deleted}`, { signal }));
    rebuildTrades();
    return campaignDetail;
  }

  // --- actions ---

  async function saveInitialStop(positionId, price) {
    const result = await api.requestJson(`/api/positions/${encodeURIComponent(positionId)}/initial-stop`, {
      method: "PATCH",
      body: { initial_stop_price: price },
    });
    const campaignId = result?.campaign?.id || selectedCampaignId;
    if (campaignId) await loadCampaignDetail(campaignId);
    await loadList();
    return result;
  }

  async function saveCampaignInitialStop(campaignId, price) {
    try {
      const updated = await api.requestJson(`/api/campaigns/${encodeURIComponent(campaignId)}/initial-stop`, {
        method: "PATCH",
        body: { initial_stop_price: price },
      });
      await afterMutation();
      return updated;
    } catch (error) {
      const positions = campaignDetail?.id === campaignId ? campaignDetail.positions || [] : [];
      if (error?.status !== 404 || !positions.length) throw error;
      let updated = null;
      for (const position of positions) {
        const result = await api.requestJson(`/api/positions/${encodeURIComponent(position.id)}/initial-stop`, {
          method: "PATCH",
          body: { initial_stop_price: price },
        });
        updated = result?.campaign || updated;
      }
      await afterMutation();
      return updated;
    }
  }

  async function handleStopSave(positionId, input) {
    const raw = input?.value?.trim?.() ?? "";
    const initialStop = raw === "" ? null : Number(raw);
    if (initialStop !== null && !Number.isFinite(initialStop)) {
      toast("初始止损必须是有效数字", { tone: "error" });
      input?.focus?.();
      return;
    }
    if (input) input.disabled = true;
    try {
      await saveInitialStop(positionId, initialStop);
      toast(initialStop === null ? "初始止损已清空" : "初始止损已保存，R 已重新计算");
    } catch (error) {
      if (input) input.disabled = false;
      input?.focus?.();
      toast(error?.message || "初始止损保存失败", { tone: "error" });
    }
  }

  async function deleteSelectedTrade() {
    const selection = getSelection();
    const trade = selection.trade;
    if (!trade) return;
    if (!confirm(`确认删除订单 ${trade.display_order_no || trade.id}？删除后不会被同步文件自动恢复。`)) return;
    const reason = prompt("请输入删除原因（可选）", "") ?? "";
    await api.requestJson(`/api/trades/${encodeURIComponent(trade.id)}`, {
      method: "DELETE",
      body: { reason: String(reason).trim() },
    });
    selectedTradeId = null;
    selectedPositionId = null;
    toast("订单已删除");
    await loadList();
  }

  async function restoreSelectedTrade() {
    const selection = getSelection();
    const trade = selection.trade;
    if (!trade) return;
    if (!confirm(`确认恢复订单 ${trade.display_order_no || trade.id}？恢复后会重新参与当前平台统计。`)) return;
    await api.requestJson(`/api/trades/${encodeURIComponent(trade.id)}/restore`, { method: "POST" });
    selectedTradeId = null;
    selectedPositionId = null;
    commitState({ deleted: "active", page: 1, trade: "" });
    toast("订单已恢复");
    await loadList();
  }

  async function toggleCampaignFeatured(campaign, featured) {
    if (!campaign?.id) return null;
    const updated = await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/featured`, {
      method: "PATCH",
      body: { featured: Boolean(featured) },
    });
    Object.assign(campaign, updated || {}, { is_featured: Boolean(featured) });
    if (campaignDetail?.id === campaign.id) Object.assign(campaignDetail, updated || {}, { is_featured: Boolean(featured) });
    await afterMutation();
    return updated;
  }

  async function checkinCampaign(campaign) {
    if (!campaign?.id) return null;
    const checkedIn = Boolean(campaign.checkin_checked_in_today);
    const result = await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/checkin`, checkedIn
      ? { method: "DELETE" }
      : { method: "POST", body: {} });
    await afterMutation();
    toast(checkedIn ? "已取消今日打卡" : "打卡成功", { tone: "success" });
    return result;
  }

  async function randomFeaturedCampaign() {
    const result = await api.requestJson("/api/campaigns/random-featured");
    const selected = result?.campaign || null;
    if (!selected?.id) {
      toast("暂无精选订单", { tone: "info" });
      return null;
    }
    selectedCampaignId = selected.id;
    selectedTradeId = null;
    selectedPositionId = null;
    commitState({ listView: "featured", page: 1, campaign: selected.id, trade: "" });
    campaignDetail = null;
    await loadList(undefined, { pinnedCampaign: selected });
    // The random record can belong to a later server page. Keep it visible in
    // the current featured page so the list and detail selection share one ID.
    selectedCampaignId = selected.id;
    if (!page.campaigns.some((campaign) => campaign.id === selected.id)) {
      page.campaigns = [selected, ...page.campaigns.filter((campaign) => campaign.id !== selected.id)]
        .slice(0, page.page_size || state.pageSize);
      rebuildTrades();
      renderCampaignRows();
      renderPagination();
    }
    await selectCampaign(selected.id);
    return selected;
  }

  async function afterMutation() {
    if (selectedCampaignId) {
      try {
        await loadCampaignDetail(selectedCampaignId);
      } catch (error) {
        if (error?.name !== "AbortError") toast(error?.message || "详情刷新失败", { tone: "error" });
      }
    }
    await loadList();
    await loadCheckinCalendar();
  }

  // --- sub-modules ---

  const customFieldsModule = createCustomFieldsModule({
    api,
    view,
    toast,
    getFields: customFields,
    resolveTrade,
    setTradeCustomValue,
    getChoiceField: classificationField,
    getChoiceValue: (trade, dimension) => trade?.[dimension] || "",
    setChoiceValue: setClassificationValue,
    saveChoiceValue: saveClassificationValue,
    rerender,
    applyFieldUpdate,
  });

  const detailModule = createOrderDetailModule({
    api,
    view,
    toast,
    confirm,
    getState: getSelection,
    renderCustomValueEditor: customFieldsModule.renderCustomValueEditor,
    bindCustomValueInputs: customFieldsModule.bindCustomValueInputs,
    bindChoiceTriggers: customFieldsModule.bindChoiceTriggers,
    classificationSelectOptions,
    classificationOptions,
    saveCampaignInitialStop,
    toggleFeatured: toggleCampaignFeatured,
    checkinCampaign,
    randomFeatured: randomFeaturedCampaign,
    afterMutation,
    onLayoutChange: scheduleListCapacitySync,
    onDeleteTrade: deleteSelectedTrade,
    onRestoreTrade: restoreSelectedTrade,
  });

  // --- lifecycle ---

  async function load() {
    state = readOrdersState(location.search);
    await loadCatalog();
    await loadList();
    if (selectedCampaignId) {
      await selectCampaign(selectedCampaignId);
    }
  }

  function init() {
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/orders/", title: "订单复盘", onRefresh, share: true })
      : null;

    const searchInput = getElement("searchInput");
    const sideFilter = getElement("sideFilter");
    const tradeTypeFilter = getElement("tradeTypeFilter");
    const strategyFilter = getElement("strategyFilter");
    const startFilter = getElement("startFilter");
    const endFilter = getElement("endFilter");
    const riskMissingOnly = getElement("riskMissingOnly");
    const deletedFilter = getElement("deletedFilter");
    const prevBtn = getElement("orderPrev");
    const nextBtn = getElement("orderNext");
    const imageClose = getElement("imageClose");
    bindListViewTabs();
    loadCheckinCalendar();

    if (searchInput) {
      searchInput.value = state.q || "";
      searchInput.addEventListener("input", (event) => {
        commitState({ q: event.target.value, page: 1 });
        loadList();
      });
    }
    if (sideFilter) {
      sideFilter.value = state.side || "all";
      sideFilter.addEventListener("change", (event) => {
        commitState({ side: event.target.value, page: 1 });
        loadList();
      });
    }
    if (tradeTypeFilter) {
      tradeTypeFilter.addEventListener("change", (event) => {
        commitState({ tradeType: event.target.value, page: 1 });
        loadList();
      });
    }
    if (strategyFilter) {
      strategyFilter.addEventListener("change", (event) => {
        commitState({ strategy: event.target.value, page: 1 });
        loadList();
      });
    }
    if (startFilter) {
      startFilter.value = state.start || "";
      startFilter.addEventListener("change", (event) => {
        commitState({ start: event.target.value, page: 1 });
        loadList();
      });
    }
    if (endFilter) {
      endFilter.value = state.end || "";
      endFilter.addEventListener("change", (event) => {
        commitState({ end: event.target.value, page: 1 });
        loadList();
      });
    }
    if (riskMissingOnly) {
      riskMissingOnly.checked = Boolean(state.rMissing);
      riskMissingOnly.addEventListener("change", (event) => {
        commitState({ rMissing: event.target.checked, page: 1 });
        loadList();
      });
    }
    if (deletedFilter) {
      deletedFilter.value = state.deleted || "active";
      deletedFilter.addEventListener("change", (event) => {
        selectedCampaignId = null;
        selectedTradeId = null;
        selectedPositionId = null;
        commitState({ deleted: event.target.value, page: 1, campaign: "", trade: "" });
        loadList();
      });
    }
    if (prevBtn) prevBtn.addEventListener("click", () => {
      commitState({ page: Math.max(1, state.page - 1) });
      loadList();
    });
    if (nextBtn) nextBtn.addEventListener("click", () => {
      commitState({ page: state.page + 1 });
      loadList();
    });
    if (imageClose) imageClose.addEventListener("click", closeImageModal);
    getElement("imageModal")?.addEventListener?.("click", (event) => {
      if (event.target?.id === "imageModal") closeImageModal();
    });

    if (typeof view.addEventListener === "function") {
      view.addEventListener("click", (event) => {
        if (!event.target?.closest?.(".choice-popover, [data-choice-trigger]")) {
          customFieldsModule.closeChoicePopover();
        }
      });
      view.addEventListener("keydown", (event) => {
        if (event.key === "Escape") customFieldsModule.closeChoicePopover();
      });
    }
    const windowObject = view.defaultView || globalThis;
    windowObject.addEventListener?.("resize", scheduleListCapacitySync);

    return cleanup;
  }

  function dispose() {
    if (capacitySyncTimer) clearTimeout(capacitySyncTimer);
    (view.defaultView || globalThis).removeEventListener?.("resize", scheduleListCapacitySync);
    gate.abortAll();
    customFieldsModule.dispose();
    detailModule.dispose();
  }

  return {
    init,
    load,
    loadList,
    saveInitialStop,
    saveCampaignInitialStop,
    saveCampaignClassification,
    handleStopSave,
    deleteSelectedTrade,
    restoreSelectedTrade,
    toggleDay,
    toggleExpand,
    dispose,
    renderCampaignRows,
    getState: () => state,
    getPage: () => page,
    checkinCampaign,
    randomFeaturedCampaign,
    loadCheckinCalendar,
  };
}

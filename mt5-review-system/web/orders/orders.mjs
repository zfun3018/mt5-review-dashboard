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

export function createOrdersController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  confirm = (message) => (globalThis.confirm ? globalThis.confirm(message) : true),
} = {}) {
  const gate = new RequestGate();
  let state = readOrdersState(location.search);
  let catalog = { custom_fields: [], classification_options: [], scratch_threshold_r: 0.15 };
  let page = { campaigns: [], total: 0, page: state.page, page_size: state.pageSize };
  let campaignDetail = null;
  let selectedCampaignId = state.campaign || null;
  let selectedPositionId = null;
  let selectedTradeId = null;
  const expandedCampaignIds = new Set();
  const trades = new Map();

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

  function setTradeCustomValue(tradeId, fieldId, value) {
    const trade = trades.get(String(tradeId));
    if (trade) {
      trade.custom_fields = trade.custom_fields || {};
      trade.custom_fields[String(fieldId)] = value;
    }
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
    const trade = position ? position.source_trade || null : campaignSourceTrade(campaign);
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
    const saveAttribute = scope === "table" ? "data-position-save-table" : "data-position-save";
    return `<div class="inline-stop-editor ${position.risk_status === "complete" ? "" : "missing"}">
      <input data-position-stop="${escapeAttr(position.id)}" data-position-editor="${scope}" type="number" step="any" inputmode="decimal" value="${escapeAttr(position.initial_stop_price ?? "")}" placeholder="请输入初始止损" aria-label="Position ${escapeAttr(position.display_position_id || position.position_id)} 初始止损" />
      <button class="icon-btn" type="button" ${saveAttribute}="${escapeAttr(position.id)}" title="保存初始止损" aria-label="保存初始止损">✓</button>
    </div>`;
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
            <span><b>入</b> ${formatPrice(position.weighted_entry_price)} <i>${formatVolume(position.entry_volume)}手</i></span>
            <span><b>出</b> ${formatPrice(position.weighted_exit_price)} <i>${formatVolume(position.exit_volume)}手</i></span>
            <span><b>持</b> ${escapeHtml(formatHoldingTime(position.holding_seconds))}</span>
          </div>
        </td>
        <td data-label="初始止损">${stopEditorMarkup(position)}</td>
        <td data-label="组合 R" class="campaign-r-cell ${position.risk_status === "complete" ? "risk-complete" : "risk-missing"}">${escapeHtml(rValue)}</td>
        <td data-label="组合盈亏" class="${profitClass(position.position_pnl)}">${formatMoney(position.position_pnl ?? 0)}</td>
        ${customCells}
        <td data-label="截图">${shot}</td>
      </tr>
    `;
  }

  function renderCampaignRows() {
    const fieldCount = customFields().length;
    setHtml(
      "orderHead",
      `
        <tr>
          <th>交易组合</th>
          <th>品种 / 方向</th>
          <th>交易数据<span>入场价 / 出场价 / 持仓时间</span></th>
          <th>初始止损</th>
          <th class="r-col">组合 R</th>
          <th>组合盈亏</th>
          ${customFields().map((field) => `<th class="custom-col">${escapeHtml(field.name)}<span>${fieldTypeLabel(field.field_type)}</span></th>`).join("")}
          <th>截图</th>
        </tr>
      `,
    );
    const rows = page.campaigns
      .map((campaign) => {
        const trade = campaignSourceTrade(campaign);
        const active = campaign.id === selectedCampaignId ? "active" : "";
        const riskClass = campaign.risk_status === "complete" ? "risk-complete" : `risk-${campaign.risk_status || "missing"}`;
        const scratch = isScratchCampaign(campaign);
        const expanded = expandedCampaignIds.has(campaign.id);
        const positions = campaignPositionSummaries(campaign);
        const shot = trade?.screenshot_url
          ? `<button class="shot-btn" data-shot="${escapeAttr(trade.screenshot_url)}" title="查看截图"><img src="${escapeAttr(trade.screenshot_url)}" alt="M5截图" /></button>`
          : `<span class="muted-mini">无</span>`;
        const customCells = customFields()
          .map(
            (field) => `
              <td data-label="${escapeAttr(field.name)}" class="custom-value-cell">
                ${trade ? customFieldsModule.renderCustomValueEditor(trade, field, "table") : `<span class="muted-mini">-</span>`}
              </td>
            `,
          )
          .join("");
        const primaryPosition = positions.length === 1 ? positions[0] : null;
        const stopCell = primaryPosition
          ? stopEditorMarkup(primaryPosition)
          : positions.length > 1
            ? `<div class="stop-summary"><span>${positions.filter((position) => position.risk_status === "complete").length}/${positions.length} 已填</span><span class="muted-mini">展开后逐笔填写</span></div>`
            : `<div class="stop-summary missing"><span>Position 数据待加载</span></div>`;
        const expandControl = positions.length > 1
          ? `<button class="campaign-expand icon-btn" type="button" data-campaign-expand="${escapeAttr(campaign.id)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "收起" : "展开"} Position">${expanded ? "−" : "+"}</button>`
          : `<span class="campaign-expand-spacer" aria-hidden="true"></span>`;
        const summaryRows = `
          <tr class="campaign-row ${active} ${campaign.risk_status === "complete" ? "" : "has-risk-gap"} ${scratch ? "scratch" : ""}" data-campaign-id="${escapeAttr(campaign.id)}">
            <td data-label="交易组合">
              <div class="order-main campaign-order-cell">
                ${expandControl}
                <div>
                  <strong>${escapeHtml(campaign.display_order_no || campaign.id.slice(0, 8))}</strong>
                  <span>交易组合 · ${escapeHtml(rMultiple()?.campaignActivityLabel?.(campaign) || "")}${scratch ? " · 打平" : ""}</span>
                </div>
              </div>
            </td>
            <td data-label="品种 / 方向">
              <div class="symbol-cell">
                <span class="side ${campaign.side}">${campaign.side === "long" ? "多" : "空"}</span>
                <div class="order-main">
                  <strong>${escapeHtml(campaign.symbol)}</strong>
                  <span>${escapeHtml(classificationOptionLabel("trade_type", campaign.trade_type))}</span>
                </div>
              </div>
            </td>
            <td data-label="交易数据">
              <div class="trade-metrics-cell">
                <span><b>入</b> ${formatPrice(campaign.weighted_entry_price)} <i>${formatVolume(campaign.entry_volume)}手</i></span>
                <span><b>出</b> ${formatPrice(campaign.weighted_exit_price)} <i>${formatVolume(campaign.exit_volume)}手</i></span>
                <span><b>持</b> ${escapeHtml(formatHoldingTime(campaign.holding_seconds))}</span>
              </div>
            </td>
            <td data-label="初始止损">${stopCell}</td>
            <td data-label="组合 R" class="campaign-r-cell ${riskClass}">${escapeHtml(rMultiple()?.formatCampaignR?.(campaign) || "-")}${scratch ? '<span class="scratch-badge">打平</span>' : ""}</td>
            <td data-label="组合盈亏" class="${profitClass(campaign.net_pnl)}">${formatMoney(campaign.net_pnl)}</td>
            ${customCells}
            <td data-label="截图">${shot}</td>
          </tr>
        `;
        if (!expanded || positions.length <= 1) return summaryRows;
        const childRows = positions.map((position, index) => renderCampaignPositionRow(campaign, position, index, fieldCount, scratch)).join("");
        return summaryRows + childRows;
      })
      .join("");
    setHtml("orderRows", rows || `<tr><td colspan="${7 + fieldCount}">没有匹配的交易组合</td></tr>`);
    bindRowInteractions();
  }

  function bindRowInteractions() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const button of view.querySelectorAll("[data-shot]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const src = button.dataset?.shot;
        if (src) openImageModal(src);
      });
    }
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
    for (const button of view.querySelectorAll("[data-campaign-expand]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleExpand(button.dataset.campaignExpand);
      });
    }
    for (const button of view.querySelectorAll("[data-position-save-table]")) {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const input = button.closest?.(".inline-stop-editor")?.querySelector?.("[data-position-stop]");
        handleStopSave(button.dataset.positionSaveTable, input);
      });
    }
    for (const input of view.querySelectorAll("[data-position-stop][data-position-editor='table']")) {
      input.addEventListener("click", (event) => event.stopPropagation());
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleStopSave(input.dataset.positionStop, input);
        }
      });
    }
    customFieldsModule.bindCustomValueInputs();
    customFieldsModule.bindChoiceTriggers();
  }

  function toggleExpand(campaignId) {
    if (expandedCampaignIds.has(campaignId)) expandedCampaignIds.delete(campaignId);
    else expandedCampaignIds.add(campaignId);
    renderCampaignRows();
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
        api.requestJson("/api/custom-fields"),
        api.requestJson("/api/classification-options"),
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
        .map((option) => `<option value="${escapeAttr(option.id)}">${escapeHtml(option.label)}${option.active ? "" : "（已停用）"}</option>`)
        .join("");
      select.innerHTML = `<option value="all">${allLabel}</option>${options}`;
      select.value = state[stateKey] ?? "all";
    }
  }

  async function loadList(partialState) {
    if (partialState) state = normalizeListState({ ...state, ...partialState });
    const query = buildCampaignsQuery(state);
    renderRegion("orderRegion", { state: "loading", message: "正在读取订单列表" });
    try {
      const result = await gate.run("campaigns", (signal) => api.requestJson(`/api/campaigns?${query}`, { signal }));
      page = {
        campaigns: result?.campaigns || [],
        total: result?.total || 0,
        page: result?.page || state.page,
        page_size: result?.page_size || state.pageSize,
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
    } catch (error) {
      if (error?.name === "AbortError") return;
      toast(error?.message || "交易组合详情加载失败", { tone: "error" });
    }
    renderDetail();
    renderCampaignRows();
  }

  async function loadCampaignDetail(campaignId) {
    campaignDetail = await gate.run("detail", (signal) => api.requestJson(`/api/campaigns/${encodeURIComponent(campaignId)}`, { signal }));
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
    await api.requestJson(`/api/trades/${encodeURIComponent(trade.id)}`, { method: "DELETE" });
    selectedTradeId = null;
    selectedPositionId = null;
    toast("订单已删除");
    await loadList();
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
  }

  // --- sub-modules ---

  const customFieldsModule = createCustomFieldsModule({
    api,
    view,
    toast,
    getFields: customFields,
    resolveTrade,
    setTradeCustomValue,
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
    afterMutation,
  });

  // --- lifecycle ---

  async function load() {
    state = readOrdersState(location.search);
    await loadCatalog();
    await loadList();
  }

  function init() {
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/orders/", title: "订单列表" })
      : null;

    const searchInput = getElement("searchInput");
    const sideFilter = getElement("sideFilter");
    const tradeTypeFilter = getElement("tradeTypeFilter");
    const strategyFilter = getElement("strategyFilter");
    const startFilter = getElement("startFilter");
    const endFilter = getElement("endFilter");
    const riskMissingOnly = getElement("riskMissingOnly");
    const prevBtn = getElement("orderPrev");
    const nextBtn = getElement("orderNext");
    const imageClose = getElement("imageClose");

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

    return cleanup;
  }

  function dispose() {
    gate.abortAll();
    customFieldsModule.dispose();
    detailModule.dispose();
  }

  return {
    init,
    load,
    loadList,
    saveInitialStop,
    handleStopSave,
    deleteSelectedTrade,
    toggleExpand,
    dispose,
    renderCampaignRows,
    getState: () => state,
    getPage: () => page,
  };
}

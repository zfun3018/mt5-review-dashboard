import { RequestGate } from "../shared/js/api.mjs";
import { escapeAttr, escapeHtml, formatBytes, formatTime } from "../shared/js/formatters.mjs";
import { showToast } from "../shared/js/feedback.mjs";
import { mountShell } from "../shared/js/shell.mjs";
import { readPlatform } from "../shared/js/platform.mjs";
import { createClassificationsModule } from "./classifications.mjs";
import { createCustomFieldSchemaModule } from "./custom-field-schema.mjs";

const TABS = [
  ["classifications", "分类与字段"],
  ["analysis", "分析设置"],
  ["data", "数据与状态"],
];

function backupFilename(backup) {
  const filePath = String(backup?.file_path || "");
  return filePath.split(/[\\/]/).pop() || `备份 #${backup?.id ?? ""}`;
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return globalThis.btoa(binary);
}

function downloadFuturesTemplate() {
  const content = [
    "trade_date,trade_time,symbol,side,offset,quantity,price,fee,pnl,trade_id,order_id",
    "2026-10-19,09:30:00,IF2611,buy,open,1,4000,5,,T-1001,O-1001",
    "2026-10-19,10:15:00,IF2611,sell,close,1,4010,6,100,T-1002,O-1002",
  ].join("\n");
  const url = globalThis.URL?.createObjectURL?.(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }));
  if (!url || typeof document === "undefined") return null;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "domestic-futures-import-template.csv";
  anchor.click();
  globalThis.URL.revokeObjectURL?.(url);
  return anchor.download;
}

export function createSettingsController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  onRefresh = null,
  confirm = (message) => (globalThis.confirm ? globalThis.confirm(message) : true),
} = {}) {
  const gate = new RequestGate();
  let state = {
    tab: "classifications",
    classifications: [],
    customFields: [],
    analysisSettings: { scratch_threshold_r: 0.15 },
    status: null,
    backups: [],
    importBatches: [],
    importCalendar: {},
    importYear: null,
    importMonth: null,
    unmatchedExecutions: [],
    lastImportSummary: null,
    dataAccounts: [],
    cleanupPreview: null,
    selectedOpenExecutionId: null,
    selectedCloseExecutionId: null,
  };
  let scratchValue = null;

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

  function setText(id, text) {
    const node = getElement(id);
    if (node) node.textContent = text;
  }

  function classificationOptions(dimension) {
    return state.classifications.filter((option) => option.dimension === dimension);
  }

  function findClassification(optionId) {
    return state.classifications.find((option) => option.id === optionId);
  }

  const classificationsModule = createClassificationsModule({
    api,
    view,
    toast,
    confirm,
    getOptions: classificationOptions,
    findOption: findClassification,
    afterMutation: refreshClassifications,
  });

  const customFieldModule = createCustomFieldSchemaModule({
    api,
    view,
    toast,
    confirm,
    getFields: () => state.customFields,
    afterMutation: refreshCustomFields,
  });

  async function load() {
    const platform = readPlatform(location);
    const [classifications, customFields, analysisSettings, status, backups, accounts] = await Promise.all([
      api.requestJson("/api/classification-options"),
      api.requestJson("/api/custom-fields"),
      api.requestJson("/api/analysis-settings"),
      api.requestJson("/api/status"),
      api.requestJson("/api/backups"),
      api.requestJson(`/api/data/accounts?platform=${encodeURIComponent(platform)}`),
    ]);
    state.classifications = classifications?.classification_options || [];
    state.customFields = customFields?.custom_fields || [];
    state.analysisSettings = analysisSettings || { scratch_threshold_r: 0.15 };
    state.status = status;
    state.backups = backups?.backups || [];
    state.dataAccounts = accounts?.accounts || [];
    scratchValue = Number(state.analysisSettings.scratch_threshold_r ?? 0.15);
    renderScratchThreshold();
    renderStatus();
    renderBackups();
    classificationsModule.render();
    customFieldModule.render();
    renderCleanupAccounts();
  }

  async function refreshClassifications() {
    const payload = await api.requestJson("/api/classification-options");
    state.classifications = payload?.classification_options || [];
    classificationsModule.render();
  }

  async function refreshCustomFields() {
    const payload = await api.requestJson("/api/custom-fields");
    state.customFields = payload?.custom_fields || [];
    customFieldModule.render();
  }

  async function refreshStatus() {
    state.status = await api.requestJson("/api/status");
    renderStatus();
  }

  async function refreshDataAccounts() {
    const platform = readPlatform(location);
    const payload = await api.requestJson(`/api/data/accounts?platform=${encodeURIComponent(platform)}`);
    state.dataAccounts = payload?.accounts || [];
    renderCleanupAccounts();
    return state.dataAccounts;
  }

  function cleanupScope() {
    const account = String(getElement("cleanupAccount")?.value || "").trim();
    const startDate = String(getElement("cleanupStartDate")?.value || "").trim();
    const endDate = String(getElement("cleanupEndDate")?.value || "").trim();
    if (!account) throw new Error("请选择账户");
    if (!startDate || !endDate) throw new Error("请选择开始和结束日期");
    if (startDate > endDate) throw new Error("开始日期不能晚于结束日期");
    return {
      platform: readPlatform(location),
      account,
      start_date: startDate,
      end_date: endDate,
    };
  }

  function renderCleanupAccounts() {
    const select = getElement("cleanupAccount");
    if (!select) return;
    const current = String(select.value || "");
    select.innerHTML = state.dataAccounts.length
      ? state.dataAccounts.map((account) => `<option value="${escapeAttr(account)}">${escapeHtml(account)}</option>`).join("")
      : '<option value="">暂无账户</option>';
    select.value = state.dataAccounts.includes(current) ? current : (state.dataAccounts[0] || "");
  }

  function renderCleanupResult(result = null, message = "") {
    const preview = result || state.cleanupPreview;
    if (message) {
      setText("dataCleanupResult", message);
      return;
    }
    if (!preview) {
      setText("dataCleanupResult", "先预览影响范围，再确认清除。");
      return;
    }
    setText(
      "dataCleanupResult",
      `将清除订单 ${Number(preview.trade_count || 0)} 笔、成交事件 ${Number(preview.deal_event_count || 0)} 条、导入成交 ${Number(preview.import_execution_count || 0)} 条，涉及导入批次 ${Number(preview.import_batch_count || 0)} 个。`,
    );
  }

  async function previewDataCleanup() {
    let scope;
    try {
      scope = cleanupScope();
    } catch (error) {
      renderCleanupResult(null, error.message);
      throw error;
    }
    state.cleanupPreview = await api.requestJson("/api/data/cleanup/preview", {
      method: "POST",
      body: scope,
    });
    renderCleanupResult();
    return state.cleanupPreview;
  }

  async function executeDataCleanup() {
    const preview = state.cleanupPreview || await previewDataCleanup();
    const confirmed = confirm(
      `确认永久清除账户 ${preview.account} 在 ${preview.start_date} 至 ${preview.end_date} 的 ${Number(preview.trade_count || 0)} 笔订单吗？该操作不可恢复。`,
    );
    if (!confirmed) return null;
    const scope = cleanupScope();
    const result = await api.requestJson("/api/data/cleanup", {
      method: "POST",
      body: { ...scope, confirm: true },
    });
    state.cleanupPreview = null;
    renderCleanupResult(null, `已清除订单 ${Number(result.deleted_trade_count || 0)} 笔及其关联数据。`);
    await refreshStatus();
    await refreshDataAccounts();
    toast("账户日期范围数据已清除");
    return result;
  }

  async function refreshBackups() {
    const payload = await api.requestJson("/api/backups");
    state.backups = payload?.backups || [];
    renderBackups();
  }

  function renderScratchThreshold() {
    const input = getElement("scratchThresholdR");
    if (input) input.value = Number(scratchValue).toFixed(2);
  }

  function renderStatus() {
    const status = state.status;
    if (!status) {
      setHtml("settingsStatus", `<div class="detail-empty">状态尚未加载</div>`);
      return;
    }
    const counts = status.counts || {};
    const latestTrade = status.latest_trade;
    const latestBackup = status.latest_backup;
    const rows = [
      ["EA 接口", status.bridge_endpoint],
      ["订单", `${counts.trades ?? 0} 笔`],
      ["事件记录", `${counts.raw_events ?? 0} 条`],
      ["资金快照", `${counts.equity_snapshots ?? 0} 条`],
      ["截图", `${status.screenshot_count ?? 0} 张`],
      ["最近交易", latestTrade ? `${latestTrade.symbol} · ${formatTime(latestTrade.close_time_utc)}` : "暂无"],
      ["最近备份", latestBackup ? formatTime(latestBackup.created_at) : "暂无"],
      ["本地占用", formatBytes(status.data_size_bytes)],
    ];
    setHtml(
      "settingsStatus",
      rows
        .map(
          ([label, value]) => `
            <div class="status-item">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `,
        )
        .join(""),
    );
  }

  function renderBackups() {
    const backups = state.backups;
    if (!backups.length) {
      setHtml("settingsBackups", `<div class="detail-empty">还没有备份</div>`);
      return;
    }
    setHtml(
      "settingsBackups",
      backups
        .map(
          (backup) => `
            <div class="backup-item">
              <span class="backup-item__name">${escapeHtml(backupFilename(backup))}</span>
              <span class="backup-item__meta">${escapeHtml(formatTime(backup.created_at))} · ${escapeHtml(formatBytes(backup.size_bytes))}</span>
            </div>
          `,
        )
        .join(""),
    );
  }

  function renderImportCalendar() {
    const year = Number(state.importYear);
    const month = Number(state.importMonth);
    if (!year || !month) return;
    const firstDay = new Date(Date.UTC(year, month - 1, 1));
    const leading = (firstDay.getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = [];
    for (let index = 0; index < leading; index += 1) cells.push('<span class="import-calendar-cell is-empty" aria-hidden="true"></span>');
    for (let day = 1; day <= dayCount; day += 1) {
      const label = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const item = state.importCalendar[label] || {};
      const newRows = Number(item.new_row_count || 0);
      const orderCount = Number(item.order_count || 0);
      const duplicateCount = Number(item.duplicate_count || 0);
      const duplicateOrderCount = Number(item.duplicate_order_count || 0);
      const conflictCount = Number(item.conflict_count || 0);
      const invalidCount = Number(item.invalid_count || 0);
      const unpairedCount = Number(item.unpaired_count || 0);
      const hasData = newRows > 0 || orderCount > 0 || duplicateCount > 0 || duplicateOrderCount > 0 || conflictCount > 0 || invalidCount > 0 || unpairedCount > 0;
      const summary = hasData
        ? `交易日 ${label}：新增成交 ${newRows} 笔，订单 ${orderCount} 笔，重复成交 ${duplicateCount} 行，重复订单 ${duplicateOrderCount} 笔，冲突 ${conflictCount} 行，异常 ${invalidCount} 行，未配对 ${unpairedCount} 行`
        : "暂无导入";
      const issueSummary = duplicateCount || duplicateOrderCount || conflictCount || invalidCount || unpairedCount
        ? `<em>重${duplicateCount} · 单${duplicateOrderCount} · 冲${conflictCount} · 异${invalidCount} · 未${unpairedCount}</em>`
        : "<em>已完成</em>";
      cells.push(`
        <span class="import-calendar-cell ${hasData ? "has-data" : ""}" title="${escapeAttr(summary)}" aria-label="${escapeAttr(summary)}">
          <strong>${day}</strong>
          <small>${hasData ? `${newRows} 笔 / ${orderCount} 单` : "-"}</small>
          ${hasData ? issueSummary : ""}
        </span>
      `);
    }
    setHtml(
      "futuresImportCalendar",
      `<div class="import-calendar-head"><strong>${year}年${month}月</strong><span>成交 / 订单</span></div><div class="import-calendar-week">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div><div class="import-calendar-grid">${cells.join("")}</div>`,
    );
  }

  function renderImportHistory() {
    if (!state.importBatches.length) {
      setHtml("futuresImportHistory", '<div class="detail-empty">还没有数据导入记录</div>');
      return;
    }
    setHtml(
      "futuresImportHistory",
      state.importBatches.map((batch) => {
        const status = batch.status === "committed" ? "已完成" : batch.status === "reverted" ? "已撤销" : batch.status === "legacy" ? "历史兼容" : batch.status === "failed" ? "失败" : "处理中";
        const duplicateOnly = batch.status === "committed"
          && Number(batch.new_row_count || 0) === 0
          && (Number(batch.duplicate_count || 0) > 0 || Number(batch.duplicate_order_count || 0) > 0);
        const hasImportIssues = Number(batch.duplicate_count || 0) > 0
          || Number(batch.duplicate_order_count || 0) > 0
          || Number(batch.conflict_count || 0) > 0
          || Number(batch.invalid_count || 0) > 0
          || Number(batch.unpaired_count || 0) > 0;
        const canRevert = batch.status === "committed" && Number(batch.new_row_count || 0) > 0;
        const duplicateOnlyNote = duplicateOnly ? " · 仅重复记录，原订单来自首次导入" : "";
        return `
          <div class="import-history-item">
            <div class="import-history-main"><strong>${escapeHtml(batch.filename || "未命名文件")}</strong><span>${escapeHtml(status)}</span></div>
            <div class="import-history-meta">${escapeHtml(formatTime(batch.started_at))} · 新增 ${batch.new_row_count || 0} · 重复成交 ${batch.duplicate_count || 0} · 重复订单 ${batch.duplicate_order_count || 0} · 冲突 ${batch.conflict_count || 0} · 异常 ${batch.invalid_count || 0} · 未配对 ${batch.unpaired_count || 0} · 订单 ${batch.order_count || 0}${escapeHtml(duplicateOnlyNote)}</div>
            <div class="import-history-meta">批次 ${escapeHtml(batch.id || "")} · SHA-256 ${escapeHtml(batch.file_sha256 || "未知")}</div>
            ${hasImportIssues ? `<button class="button import-batch-detail" type="button" data-import-batch-detail="${escapeAttr(batch.id)}">查看问题</button>` : ""}
            ${canRevert ? `<button class="button import-batch-revert" type="button" data-revert-import-batch="${escapeAttr(batch.id)}">撤销本批次</button>` : ""}
          </div>
        `;
      }).join(""),
    );
  }

  function renderImportReconciliation(summary = null) {
    if (summary) state.lastImportSummary = summary;
    const currentSummary = summary || state.lastImportSummary || {};
    const executions = state.unmatchedExecutions || [];
    const openQuantity = currentSummary.unmatched_open_quantity ?? executions
      .filter((item) => item.offset === "open")
      .reduce((total, item) => total + Number(item.remaining_quantity || 0), 0);
    const closeQuantity = currentSummary.unmatched_close_quantity ?? executions
      .filter((item) => item.offset === "close")
      .reduce((total, item) => total + Number(item.remaining_quantity || 0), 0);
    setHtml(
      "futuresImportSummary",
      `<div class="import-summary-grid">
        <div><span>已匹配订单</span><strong>${Number(currentSummary.imported || 0)}</strong></div>
        <div><span>重复成交</span><strong>${Number(currentSummary.duplicate_count || 0)}</strong></div>
        <div><span>重复订单</span><strong>${Number(currentSummary.duplicate_order_count || 0)}</strong></div>
        <div class="is-warning"><span>字段冲突</span><strong>${Number(currentSummary.conflict_count || 0)}</strong></div>
        <div><span>异常成交</span><strong>${Number(currentSummary.invalid_count ?? currentSummary.invalid_rows?.length ?? 0)}</strong></div>
        <div class="is-warning"><span>未匹配开仓</span><strong>${openQuantity}</strong></div>
        <div class="is-warning"><span>未匹配平仓</span><strong>${closeQuantity}</strong></div>
      </div>`,
    );
    renderImportIssues(currentSummary.issues || []);
    if (!executions.length) {
      setHtml("futuresUnmatchedExecutions", '<div class="detail-empty">当前没有待处理成交</div>');
      return;
    }
    const selectedOpen = state.selectedOpenExecutionId;
    const selectedClose = state.selectedCloseExecutionId;
    const rows = executions.map((item) => {
      const selected = item.id === selectedOpen || item.id === selectedClose;
      const direction = item.offset === "open" ? "开仓" : "平仓";
      return `<button type="button" class="import-unmatched-row ${selected ? "is-selected" : ""}" data-unmatched-execution="${escapeAttr(item.id)}">
        <span><strong>${escapeHtml(direction)} · ${escapeHtml(item.symbol)}</strong><small>${escapeHtml(item.trade_date)} · ${escapeHtml(formatTime(item.time_utc))}</small></span>
        <span>${escapeHtml(item.side)} · ${Number(item.remaining_quantity || 0)} 手 · ${Number(item.price || 0)} · 第 ${Number(item.source_row_number || 0)} 行</span>
      </button>`;
    }).join("");
    const canMatch = selectedOpen && selectedClose;
    setHtml(
      "futuresUnmatchedExecutions",
      `<div class="import-unmatched-head"><strong>待处理成交</strong><span>选择一条开仓和一条平仓</span></div>
       <div class="import-unmatched-list">${rows}</div>
       <div class="import-match-actions">
         <label>匹配手数 <input id="importMatchQuantity" type="number" min="0.0001" step="0.0001" /></label>
         <button id="matchSelectedExecutions" class="button-primary" type="button" ${canMatch ? "" : "disabled"}>确认匹配</button>
       </div>`,
    );
    getElement("matchSelectedExecutions")?.addEventListener("click", () => {
      const quantity = Number(getElement("importMatchQuantity")?.value || 0);
      matchSelectedExecutions(quantity).catch((error) => toast(error?.message || "手动匹配失败", { tone: "error" }));
    });
  }

  function renderImportIssues(issues) {
    const rows = (Array.isArray(issues) ? issues : []).map((issue) => {
      const code = String(issue?.code || "");
      const category = code === "duplicate_execution" || code === "duplicate_order"
        ? "重复"
        : code === "execution_conflict"
          ? "字段冲突"
          : code === "unpaired_open" || code === "unpaired_close"
            ? "未匹配"
            : "无效";
      const source = issue?.source_filename || issue?.filename || "未提供文件名";
      const row = issue?.row_number ?? issue?.open_row_number ?? "未知";
      let detail = issue?.message || "导入记录存在问题";
      if (code === "duplicate_order") {
        detail += `；首次来源：${issue.existing_source_filename || "未知文件"}`;
        if (issue.existing_source_row_number != null) detail += ` 第 ${issue.existing_source_row_number} 行`;
        if (issue.open_row_number != null || issue.close_row_number != null) {
          detail += `；本次开仓第 ${issue.open_row_number ?? "未知"} 行，平仓第 ${issue.close_row_number ?? "未知"} 行`;
        }
      } else if (code === "duplicate_execution") {
        detail += `；首次来源：${issue.existing_source_filename || "未知文件"}`;
        if (issue.existing_source_row_number != null) detail += ` 第 ${issue.existing_source_row_number} 行`;
        detail += `；匹配依据：${issue.matched_by || issue.duplicate_reason || "成交字段"}`;
      } else if (code === "execution_conflict") {
        const differences = Array.isArray(issue.differences) ? issue.differences : [];
        const comparison = differences.map((item) => `${item.field}: ${item.existing} → ${item.imported}`).join("；");
        if (comparison) detail += `；差异：${comparison}`;
      } else if (code === "invalid_number" || code === "invalid_enum" || code === "invalid_time" || code === "missing_required") {
        detail += `；字段：${issue.field || "未知"}`;
        if (issue.value !== undefined) detail += `；原值：${typeof issue.value === "object" ? JSON.stringify(issue.value) : issue.value}`;
        if (issue.expected) detail += `；期望：${issue.expected}`;
      } else if (code === "unpaired_open" || code === "unpaired_close") {
        detail += `；原因：${issue.reason || "未找到可匹配成交"}`;
        detail += `；已匹配 ${issue.matched_quantity ?? 0} 手，剩余 ${issue.remaining_quantity ?? issue.quantity ?? 0} 手`;
      }
      return `<div class="import-issue-row">
        <div class="import-issue-label"><strong>${escapeHtml(category)}</strong><span>${escapeHtml(code)}</span></div>
        <div class="import-issue-detail">${escapeHtml(detail)}</div>
        <div class="import-issue-source">${escapeHtml(source)} · 第 ${escapeHtml(row)} 行</div>
      </div>`;
    }).join("");
    setHtml(
      "futuresImportIssues",
      rows
        ? `<div class="import-issues-head"><strong>本次导入问题明细</strong><span>${rows.length} 条</span></div><div class="import-issues-list">${rows}</div>`
        : '<div class="detail-empty">本次导入没有需要说明的问题</div>',
    );
  }

  async function loadImportBatchIssues(batchId) {
    const encodedId = encodeURIComponent(String(batchId || ""));
    const payload = await api.requestJson(
      `/api/platforms/import-batches/${encodedId}?platform=domestic_futures`,
    );
    renderImportIssues(payload?.batch?.issues || []);
    return payload?.batch || null;
  }

  function selectUnmatchedExecution(executionId) {
    const item = state.unmatchedExecutions.find((candidate) => candidate.id === executionId);
    if (!item) return;
    if (item.offset === "open") {
      state.selectedOpenExecutionId = state.selectedOpenExecutionId === executionId ? null : executionId;
    } else {
      state.selectedCloseExecutionId = state.selectedCloseExecutionId === executionId ? null : executionId;
    }
    renderImportReconciliation();
  }

  async function refreshImportReconciliation(summary = null) {
    const payload = await api.requestJson("/api/platforms/unmatched-executions");
    state.unmatchedExecutions = payload?.executions || [];
    if (!state.unmatchedExecutions.some((item) => item.id === state.selectedOpenExecutionId)) {
      state.selectedOpenExecutionId = null;
    }
    if (!state.unmatchedExecutions.some((item) => item.id === state.selectedCloseExecutionId)) {
      state.selectedCloseExecutionId = null;
    }
    renderImportReconciliation(summary);
    return state.unmatchedExecutions;
  }

  async function matchSelectedExecutions(quantity) {
    if (!state.selectedOpenExecutionId || !state.selectedCloseExecutionId) {
      throw new Error("请先选择一条开仓和一条平仓成交");
    }
    if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) {
      throw new Error("匹配手数必须大于 0");
    }
    const result = await api.requestJson("/api/platforms/unmatched-executions/match", {
      method: "POST",
      body: {
        platform: "domestic_futures",
        open_execution_id: state.selectedOpenExecutionId,
        close_execution_id: state.selectedCloseExecutionId,
        quantity: Number(quantity),
      },
    });
    state.selectedOpenExecutionId = null;
    state.selectedCloseExecutionId = null;
    await refreshImportReconciliation();
    await refreshStatus();
    return result;
  }

  async function refreshImportHistory(year, month) {
    const now = new Date();
    state.importYear = Number(year) || now.getFullYear();
    state.importMonth = Number(month) || now.getMonth() + 1;
    const suffix = `?year=${state.importYear}&month=${state.importMonth}`;
    const [batches, calendar] = await Promise.all([
      api.requestJson(`/api/platforms/import-batches${suffix}`),
      api.requestJson(`/api/platforms/import-calendar${suffix}`),
    ]);
    state.importBatches = batches?.batches || [];
    state.importCalendar = calendar?.calendar || {};
    renderImportCalendar();
    renderImportHistory();
    await refreshImportReconciliation();
    return { batches: state.importBatches, calendar: state.importCalendar };
  }

  async function revertImportBatch(batchId) {
    const batch = state.importBatches.find((item) => item.id === batchId);
    if (!batch) throw new Error("导入批次不存在");
    if (!confirm(`确认撤销文件“${batch.filename || "未命名文件"}”吗？该批次新增的订单将被隐藏。`)) {
      return null;
    }
    const first = await api.requestJson(`/api/platforms/import-batches/${encodeURIComponent(batchId)}/revert?platform=domestic_futures`, {
      method: "POST",
      body: { confirm: false },
    });
    if (first?.requires_confirmation) {
      const confirmed = confirm(`该批次关联了已有复盘内容，确认撤销并隐藏 ${first.protected_trade_ids?.length || 0} 笔订单吗？`);
      if (!confirmed) return first;
      await api.requestJson(`/api/platforms/import-batches/${encodeURIComponent(batchId)}/revert?platform=domestic_futures`, {
        method: "POST",
        body: { confirm: true },
      });
    }
    await refreshImportHistory();
    await refreshImportReconciliation();
    await refreshStatus();
    toast("导入批次已撤销");
    return first;
  }

  async function saveScratchThreshold(value) {
    const input = getElement("scratchThresholdR");
    const raw = value ?? input?.value;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 5) {
      toast("打平阈值必须在 0R 到 5R 之间", { tone: "error" });
      renderScratchThreshold();
      return false;
    }
    state.analysisSettings = await api.requestJson("/api/analysis-settings", {
      method: "PATCH",
      body: { scratch_threshold_r: parsed },
    });
    scratchValue = Number(state.analysisSettings.scratch_threshold_r);
    renderScratchThreshold();
    toast("打平阈值已更新");
    return true;
  }

  async function createBackup() {
    const backup = await api.requestJson("/api/backups", { method: "POST" });
    state.backups = [backup, ...state.backups.filter((item) => item.id !== backup.id)];
    renderBackups();
    toast(`备份已创建：${backupFilename(backup)}`);
    return backup;
  }

  function importErrorMessage(error) {
    if (Number(error?.status) === 404) return "导入接口未找到，请重启本地服务后再试";
    return error?.message || "数据导入失败";
  }

  async function importFuturesData() {
    const input = getElement("futuresDataFile");
    const resultNode = getElement("futuresImportResult");
    const file = input?.files?.[0];
    if (!file) {
      if (resultNode) resultNode.textContent = "请先选择 CSV 或 XLS 文件";
      return null;
    }
    if (resultNode) resultNode.textContent = "正在导入...";
    let result;
    try {
      result = await api.requestJson("/api/platforms/import-file", {
        method: "POST",
        body: {
          platform: "domestic_futures",
          filename: file.name,
          file_base64: bytesToBase64(await file.arrayBuffer()),
        },
      });
    } catch (error) {
      if (resultNode) resultNode.textContent = importErrorMessage(error);
      throw error;
    }
    if (resultNode) {
      resultNode.textContent = `已导入 ${result.imported ?? 0} 笔；重复成交 ${result.duplicate_count ?? result.deduplicated_row_count ?? 0} 行；重复订单 ${result.duplicate_order_count ?? 0} 笔；冲突 ${result.conflict_count ?? 0} 行；跳过 ${result.skipped ?? 0} 行。${result.warnings?.[0] || ""}`;
    }
    await refreshImportReconciliation(result);
    await refreshStatus();
    try {
      await refreshImportHistory();
    } catch (error) {
      setText("futuresImportHistory", importErrorMessage(error));
    }
    return result;
  }

  function switchTab(tab) {
    if (!TABS.some(([key]) => key === tab)) return;
    state.tab = tab;
    if (typeof view.querySelectorAll !== "function") return;
    view.querySelectorAll("[data-settings-tab]").forEach((button) => {
      const active = button.dataset?.settingsTab === tab;
      button.classList?.toggle?.("is-active", active);
      button.setAttribute?.("aria-selected", String(active));
    });
    view.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset?.settingsPanel !== tab;
    });
    if (tab === "data" && getElement("futuresImportCalendar")) {
      refreshImportHistory().catch((error) => {
        setText("futuresImportHistory", error?.message || "导入记录加载失败");
      });
    }
  }

  function init() {
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/settings/", title: "设置", onRefresh })
      : null;

    if (typeof view.querySelectorAll === "function") {
      view.querySelectorAll("[data-settings-tab]").forEach((button) => {
        button.addEventListener("click", () => switchTab(button.dataset.settingsTab));
      });
    }
    view.addEventListener?.("click", (event) => {
      const target = event.target?.closest?.("[data-unmatched-execution]");
      if (target) selectUnmatchedExecution(target.dataset.unmatchedExecution);
      const revertTarget = event.target?.closest?.("[data-revert-import-batch]");
      if (revertTarget) {
        revertImportBatch(revertTarget.dataset.revertImportBatch).catch((error) => {
          toast(error?.message || "撤销导入批次失败", { tone: "error" });
        });
      }
      const detailTarget = event.target?.closest?.("[data-import-batch-detail]");
      if (detailTarget) {
        loadImportBatchIssues(detailTarget.dataset.importBatchDetail).catch((error) => {
          setText("futuresImportResult", error?.message || "导入问题加载失败");
        });
      }
    });
    getElement("saveScratchThreshold")?.addEventListener("click", () => saveScratchThreshold());
    getElement("refreshStatus")?.addEventListener("click", refreshStatus);
    getElement("previewDataCleanup")?.addEventListener("click", () => previewDataCleanup().catch(() => {}));
    getElement("executeDataCleanup")?.addEventListener("click", () => executeDataCleanup().catch((error) => {
      renderCleanupResult(null, error?.message || "清除数据失败");
    }));
    getElement("createBackup")?.addEventListener("click", createBackup);
    getElement("downloadFuturesTemplate")?.addEventListener("click", downloadFuturesTemplate);
    getElement("importFuturesData")?.addEventListener("click", () => importFuturesData().catch((error) => {
      setText("futuresImportResult", importErrorMessage(error));
    }));
    getElement("addCustomField")?.addEventListener("click", () => customFieldModule.create());

    switchTab(state.tab);
    return cleanup;
  }

  function dispose() {
    gate.abortAll();
  }

  return {
    init,
    load,
    refreshStatus,
    refreshDataAccounts,
    previewDataCleanup,
    executeDataCleanup,
    refreshBackups,
    refreshImportHistory,
    loadImportBatchIssues,
    downloadFuturesTemplate,
    saveScratchThreshold,
    createBackup,
    importFuturesData,
    refreshImportReconciliation,
    revertImportBatch,
    matchSelectedExecutions,
    selectUnmatchedExecution,
    importTonghuashunCsv: importFuturesData,
    createClassificationOption: classificationsModule.create,
    renameClassificationOption: classificationsModule.rename,
    archiveClassificationOption: classificationsModule.archive,
    createCustomField: customFieldModule.create,
    updateCustomField: customFieldModule.update,
    deleteCustomField: customFieldModule.remove,
    restoreCustomField: customFieldModule.restore,
    switchTab,
    dispose,
    getState: () => state,
  };
}

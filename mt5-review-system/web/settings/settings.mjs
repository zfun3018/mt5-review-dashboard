import { RequestGate } from "../shared/js/api.mjs";
import { escapeAttr, escapeHtml, formatBytes, formatTime } from "../shared/js/formatters.mjs";
import { showToast } from "../shared/js/feedback.mjs";
import { mountShell } from "../shared/js/shell.mjs";
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
    const [classifications, customFields, analysisSettings, status, backups] = await Promise.all([
      api.requestJson("/api/classification-options"),
      api.requestJson("/api/custom-fields"),
      api.requestJson("/api/analysis-settings"),
      api.requestJson("/api/status"),
      api.requestJson("/api/backups"),
    ]);
    state.classifications = classifications?.classification_options || [];
    state.customFields = customFields?.custom_fields || [];
    state.analysisSettings = analysisSettings || { scratch_threshold_r: 0.15 };
    state.status = status;
    state.backups = backups?.backups || [];
    scratchValue = Number(state.analysisSettings.scratch_threshold_r ?? 0.15);
    renderScratchThreshold();
    renderStatus();
    renderBackups();
    classificationsModule.render();
    customFieldModule.render();
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
      const invalidCount = Number(item.invalid_count || 0);
      const unpairedCount = Number(item.unpaired_count || 0);
      const hasData = newRows > 0 || orderCount > 0 || duplicateCount > 0 || invalidCount > 0 || unpairedCount > 0;
      const summary = hasData
        ? `交易日 ${label}：新增成交 ${newRows} 笔，订单 ${orderCount} 笔，重复 ${duplicateCount} 行，异常 ${invalidCount} 行，未配对 ${unpairedCount} 行`
        : "暂无导入";
      const issueSummary = duplicateCount || invalidCount || unpairedCount
        ? `<em>重${duplicateCount} · 异${invalidCount} · 未${unpairedCount}</em>`
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
        const status = batch.status === "committed" ? "已完成" : batch.status === "failed" ? "失败" : "处理中";
        return `
          <div class="import-history-item">
            <div class="import-history-main"><strong>${escapeHtml(batch.filename || "未命名文件")}</strong><span>${escapeHtml(status)}</span></div>
            <div class="import-history-meta">${escapeHtml(formatTime(batch.started_at))} · 新增 ${batch.new_row_count || 0} · 重复 ${batch.duplicate_count || 0} · 异常 ${batch.invalid_count || 0} · 未配对 ${batch.unpaired_count || 0} · 订单 ${batch.order_count || 0}</div>
          </div>
        `;
      }).join(""),
    );
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
    return { batches: state.importBatches, calendar: state.importCalendar };
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
      resultNode.textContent = `已导入 ${result.imported ?? 0} 笔；去重 ${result.duplicate_count ?? result.deduplicated_row_count ?? 0} 行；跳过 ${result.skipped ?? 0} 行。${result.warnings?.[0] || ""}`;
    }
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
    getElement("saveScratchThreshold")?.addEventListener("click", () => saveScratchThreshold());
    getElement("refreshStatus")?.addEventListener("click", refreshStatus);
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
    refreshBackups,
    refreshImportHistory,
    downloadFuturesTemplate,
    saveScratchThreshold,
    createBackup,
    importFuturesData,
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

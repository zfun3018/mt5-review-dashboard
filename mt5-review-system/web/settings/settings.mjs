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
    saveScratchThreshold,
    createBackup,
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

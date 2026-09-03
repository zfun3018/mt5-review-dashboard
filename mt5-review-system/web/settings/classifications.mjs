import { escapeAttr, escapeHtml } from "../shared/js/formatters.mjs";

const DIMENSIONS = [
  ["trade_type", "交易类型", "新增类型"],
  ["strategy", "交易策略", "新增策略"],
];

// Classification CRUD. Mutations go through `afterMutation` so the controller
// refreshes only the classification catalog, never the full configuration.
export function createClassificationsModule({
  api,
  view,
  toast,
  confirm,
  getOptions,
  findOption,
  afterMutation,
}) {
  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function readNewLabel(dimension) {
    const node = getElement("classificationManager");
    if (!node || typeof node.querySelectorAll !== "function") return "";
    return node.querySelectorAll(`[data-classification-new="${dimension}"]`)[0]?.value?.trim() || "";
  }

  function readLabel(optionId) {
    const node = getElement("classificationManager");
    if (!node || typeof node.querySelectorAll !== "function") return "";
    return node.querySelectorAll(`[data-classification-label="${optionId}"]`)[0]?.value?.trim() || "";
  }

  function render() {
    const node = getElement("classificationManager");
    if (!node) return;
    node.innerHTML = DIMENSIONS.map(([dimension, title, placeholder]) => {
      const rows = getOptions(dimension)
        .map(
          (option) => `
            <div class="classification-option-row ${option.active ? "" : "archived"}" data-classification-row="${escapeAttr(option.id)}">
              <span class="classification-color" style="--option-color:${escapeAttr(option.color)}"></span>
              <input type="text" value="${escapeAttr(option.label)}" data-classification-label="${escapeAttr(option.id)}" />
              <span class="classification-state">${option.active ? "使用中" : "已停用"}</span>
              <button class="button" type="button" data-classification-save="${escapeAttr(option.id)}">保存</button>
              ${option.active ? `<button class="button-danger" type="button" data-classification-archive="${escapeAttr(option.id)}">停用</button>` : ""}
            </div>
          `,
        )
        .join("");
      return `
        <div class="classification-group">
          <h4>${escapeHtml(title)}</h4>
          <div class="classification-option-list">${rows}</div>
          <div class="classification-add-row">
            <input type="text" data-classification-new="${escapeAttr(dimension)}" placeholder="${escapeAttr(placeholder)}" maxlength="40" />
            <button class="button-primary" type="button" data-classification-add="${escapeAttr(dimension)}">新增</button>
          </div>
        </div>
      `;
    }).join("");
    bind(node);
  }

  function bind(node) {
    if (typeof node.querySelectorAll !== "function") return;
    node.querySelectorAll("[data-classification-add]").forEach((button) => {
      button.addEventListener("click", () => create(button.dataset.classificationAdd));
    });
    node.querySelectorAll("[data-classification-save]").forEach((button) => {
      button.addEventListener("click", () => rename(button.dataset.classificationSave));
    });
    node.querySelectorAll("[data-classification-archive]").forEach((button) => {
      button.addEventListener("click", () => archive(button.dataset.classificationArchive));
    });
    node.querySelectorAll("[data-classification-new]").forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") create(input.dataset.classificationNew);
      });
    });
  }

  async function create(dimension, labelValue) {
    const label = (labelValue ?? readNewLabel(dimension)).trim();
    if (!label) {
      toast("请填写分类名称", { tone: "error" });
      return null;
    }
    const option = await api.requestJson("/api/classification-options", {
      method: "POST",
      body: { dimension, label },
    });
    await afterMutation();
    toast("分类已新增");
    return option;
  }

  async function rename(optionId, labelValue) {
    const label = (labelValue ?? readLabel(optionId)).trim();
    if (!label) {
      toast("分类名称不能为空", { tone: "error" });
      return null;
    }
    const updated = await api.requestJson(`/api/classification-options/${encodeURIComponent(optionId)}`, {
      method: "PUT",
      body: { label },
    });
    await afterMutation();
    toast("分类名称已更新，历史统计保持不变");
    return updated;
  }

  async function archive(optionId) {
    const option = findOption(optionId);
    if (!option) return null;
    if (!confirm(`停用分类“${option.label}”？历史订单和统计仍会保留。`)) return null;
    await api.requestJson(`/api/classification-options/${encodeURIComponent(optionId)}`, {
      method: "DELETE",
    });
    await afterMutation();
    toast("分类已停用，历史数据保持不变");
    return { ok: true };
  }

  return { render, create, rename, archive };
}

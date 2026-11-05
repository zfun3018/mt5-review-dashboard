import { escapeAttr, escapeHtml } from "../shared/js/formatters.mjs";

const CHOICE_COLORS = ["#2bd4ff", "#4ade80", "#ff5c7a", "#f97316", "#facc15", "#a78bfa", "#38bdf8", "#fb7185"];

export function fieldTypeLabel(type) {
  return { text: "文本", single: "单选", multi: "多选" }[type] || "文本";
}

const PLATFORM_OPTIONS = [["mt5", "MT5"], ["domestic_futures", "国内期货"]];

function normalizedPlatforms(value) {
  const source = Array.isArray(value) ? value : [];
  return PLATFORM_OPTIONS.map(([id]) => id).filter((id) => source.includes(id));
}

function renderPlatformCheckboxes(fieldId, selected, attribute = "data-custom-field-platform") {
  const platforms = normalizedPlatforms(selected);
  return PLATFORM_OPTIONS.map(([id, label]) => `
    <label class="field-platform-option"><input type="checkbox" ${attribute}="${id}" data-field-id="${fieldId}" ${platforms.includes(id) ? "checked" : ""} /><span>${label}</span></label>
  `).join("");
}

function choiceColor(index) {
  return CHOICE_COLORS[Math.abs(Number(index) || 0) % CHOICE_COLORS.length];
}

// Custom-field schema CRUD. Mutations refresh only the custom-field catalog.
export function createCustomFieldSchemaModule({
  api,
  view,
  toast,
  confirm,
  getFields,
  afterMutation,
}) {
  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  const platformSaveChains = new Map();

  function readNewName() {
    return getElement("newCustomFieldName")?.value?.trim() || "";
  }

  function readNewType() {
    return "multi";
  }

  function readFieldName(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return "";
    return node.querySelectorAll(`[data-custom-field-name="${fieldId}"]`)[0]?.value?.trim() || "";
  }

  function readFieldType(fieldId) {
    return "multi";
  }

  function readFieldPlatforms(fieldId) {
    const node = getElement("customFieldSchema");
    return Array.from(node?.querySelectorAll?.(`[data-custom-field-platform][data-field-id="${fieldId}"]`) || [])
      .filter((item) => item.checked)
      .map((item) => item.dataset.customFieldPlatform);
  }

  function renderOptionRow(fieldId, option = {}) {
    const active = option.active !== false;
    const purgeButton = !active && option.id
      ? `<button class="button-danger" data-option-purge="${escapeAttr(option.id)}" type="button">永久删除</button>`
      : "";
    return `
      <div class="option-row glass-surface${active ? "" : " is-inactive"}" data-option-row="${fieldId}" data-option-id="${escapeAttr(option.id || "")}" data-option-active="${active}">
        <input type="color" value="${escapeAttr(option.color || choiceColor(0))}" data-option-color title="颜色" />
        <input type="text" value="${escapeAttr(option.label || "")}" data-option-label placeholder="选项名称" />
        ${active
          ? `<span class="option-row-actions"><button class="button-danger" data-option-delete type="button">停用</button></span>`
          : `<span class="option-row-actions"><button class="button" data-option-restore type="button">恢复</button>${purgeButton}</span>`}
      </div>
    `;
  }

  function renderFieldCard(field) {
    const options = (field.options || []).map((option) => renderOptionRow(field.id, option)).join("");
    return `
      <div class="custom-field-card glass-surface" data-custom-field-row="${field.id}">
        <div class="field-row custom-field-main">
          <span>${field.sort_order}</span>
          <input type="text" value="${escapeAttr(field.name)}" data-custom-field-name="${field.id}" />
          <span class="custom-field-type-label">多选</span>
          <button class="button" data-custom-field-save="${field.id}">保存</button>
          ${field.active
            ? `<button class="button" data-custom-field-delete="${field.id}">停用</button>`
            : `<button class="button" data-custom-field-restore="${field.id}">恢复</button><button class="button-danger" data-custom-field-purge="${field.id}">永久删除</button>`}
        </div>
        <div class="field-platforms" data-platform-list="${field.id}">
          <span class="field-platforms-label">启用平台</span>${renderPlatformCheckboxes(field.id, field.platforms)}
        </div>
        <div class="option-editor glass-surface--clear" data-option-editor="${field.id}">
          <div class="option-list" data-option-list="${field.id}">
            ${options || `<div class="detail-empty">暂无选项，可在订单表格里创建，也可以点下面新增</div>`}
          </div>
          <button class="button option-add" data-option-add="${field.id}">新增选项</button>
        </div>
      </div>
    `;
  }

  function render() {
    const node = getElement("customFieldSchema");
    if (!node) return;
    const fields = getFields();
    node.innerHTML = fields.length
      ? fields.map((field) => renderFieldCard(field)).join("")
      : `<div class="detail-empty">还没有自定义字段</div>`;
    bind(node);
  }

  function bind(node) {
    if (typeof node.querySelectorAll !== "function") return;
    node.querySelectorAll("[data-custom-field-save]").forEach((button) => {
      button.addEventListener("click", () => update(Number(button.dataset.customFieldSave), {}));
    });
    node.querySelectorAll("[data-custom-field-delete]").forEach((button) => {
      button.addEventListener("click", () => remove(Number(button.dataset.customFieldDelete)));
    });
    node.querySelectorAll("[data-custom-field-restore]").forEach((button) => {
      button.addEventListener("click", () => restore(Number(button.dataset.customFieldRestore)));
    });
    node.querySelectorAll("[data-custom-field-purge]").forEach((button) => {
      button.addEventListener("click", () => purge(Number(button.dataset.customFieldPurge)));
    });
    node.querySelectorAll("[data-custom-field-platform]").forEach((input) => {
      input.addEventListener("change", () => {
        const fieldId = Number(input.dataset.fieldId);
        const platforms = readFieldPlatforms(fieldId);
        queuePlatformUpdate(fieldId, platforms).catch(async (error) => {
          toast(error?.message || "平台范围保存失败", { tone: "error" });
          try {
            await afterMutation();
          } catch (refreshError) {
            // Keep the original save error visible if the recovery read also fails.
          }
        });
      });
    });
    node.querySelectorAll("[data-option-add]").forEach((button) => {
      button.addEventListener("click", () => addOptionRow(Number(button.dataset.optionAdd)));
    });
    node.querySelectorAll("[data-option-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest?.("[data-option-row]");
        if (!row) return;
        const actions = button.closest?.(".option-row-actions");
        row.dataset.optionActive = "false";
        row.classList.add("is-inactive");
        button.className = "button";
        button.textContent = "恢复";
        button.removeAttribute("data-option-delete");
        button.setAttribute("data-option-restore", "");
        if (row.dataset.optionId && actions && !actions.querySelectorAll?.("[data-option-purge]").length) {
          actions.insertAdjacentHTML(
            "beforeend",
            `<button class="button-danger" data-option-purge="${escapeAttr(row.dataset.optionId)}" type="button">永久删除</button>`,
          );
          const purgeButton = actions.querySelectorAll("[data-option-purge]")[0];
          if (purgeButton) bindOptionPurge(purgeButton);
        }
      });
    });
    node.querySelectorAll("[data-option-restore]").forEach((button) => {
      button.addEventListener("click", () => {
        const row = button.closest?.("[data-option-row]");
        if (!row) return;
        const actions = button.closest?.(".option-row-actions");
        row.dataset.optionActive = "true";
        row.classList.remove("is-inactive");
        button.className = "button-danger";
        button.textContent = "停用";
        button.removeAttribute("data-option-restore");
        button.setAttribute("data-option-delete", "");
        actions?.querySelectorAll?.("[data-option-purge]")[0]?.remove?.();
      });
    });
    node.querySelectorAll("[data-option-purge]").forEach((button) => bindOptionPurge(button));
  }

  function bindOptionPurge(button) {
    button.addEventListener("click", () => {
      const row = button.closest?.("[data-option-row]");
      if (!row) return;
      purgeOption(Number(row.dataset.optionRow), Number(button.dataset.optionPurge));
    });
  }

  function collectOptions(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return [];
    return Array.from(node.querySelectorAll(`[data-option-row="${fieldId}"]`))
      .filter((row) => row.dataset?.optionActive !== "false")
      .map((row) => {
        const label = row.querySelectorAll?.("[data-option-label]")[0]?.value?.trim() || "";
        const color = row.querySelectorAll?.("[data-option-color]")[0]?.value || choiceColor(0);
        const option = { label, color };
        if (row.dataset?.optionId) option.id = Number(row.dataset.optionId);
        return option;
      })
      .filter((option) => option.label);
  }

  function addOptionRow(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return;
    const list = node.querySelectorAll(`[data-option-list="${fieldId}"]`)[0];
    if (!list) return;
    const index = node.querySelectorAll(`[data-option-row="${fieldId}"]`).length;
    const row = renderOptionRow(fieldId, { color: choiceColor(index) });
    if (typeof list.insertAdjacentHTML === "function") {
      list.insertAdjacentHTML("beforeend", row);
    }
  }

  async function create(nameValue, fieldTypeValue) {
    const name = (nameValue ?? readNewName()).trim();
    const fieldType = "multi";
    const platforms = Array.from(getElement("newCustomFieldPlatforms")?.querySelectorAll?.("[data-new-platform]") || [])
      .filter((item) => item.checked)
      .map((item) => item.dataset.newPlatform);
    if (!name) {
      toast("请先填写字段名", { tone: "error" });
      return null;
    }
    const field = await api.requestJson("/api/custom-fields", {
      method: "POST",
      body: { name, field_type: fieldType, platforms },
    });
    const nameInput = getElement("newCustomFieldName");
    const typeSelect = getElement("newCustomFieldType");
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "multi";
    await afterMutation();
    toast("字段已新增");
    return field;
  }

  async function update(fieldId, payload = {}, { toastMessage = "字段已更新" } = {}) {
    const name = (payload.name ?? readFieldName(fieldId)).trim();
    if (!name) {
      toast("字段名不能为空", { tone: "error" });
      return null;
    }
    const fieldType = "multi";
    const options = payload.options ?? collectOptions(fieldId);
    const platforms = payload.platforms ?? readFieldPlatforms(fieldId);
    const updated = await api.requestJson(`/api/custom-fields/${fieldId}`, {
      method: "PUT",
      body: { name, field_type: fieldType, options, platforms },
    });
    await afterMutation();
    if (toastMessage) toast(toastMessage);
    return updated;
  }

  function queuePlatformUpdate(fieldId, platforms) {
    const previous = platformSaveChains.get(fieldId) || Promise.resolve();
    const pending = previous
      .catch(() => {})
      .then(() => update(fieldId, { platforms }, { toastMessage: "平台范围已更新" }));
    platformSaveChains.set(fieldId, pending);
    const cleanup = () => {
      if (platformSaveChains.get(fieldId) === pending) platformSaveChains.delete(fieldId);
    };
    pending.then(cleanup, cleanup);
    return pending;
  }

  async function remove(fieldId) {
    if (!confirm("停用这个自定义字段？历史填写内容会保留，恢复后仍可查看。")) return null;
    await api.requestJson(`/api/custom-fields/${fieldId}`, { method: "DELETE" });
    await afterMutation();
    toast("字段已停用，可在此恢复");
    return { ok: true };
  }

  async function restore(fieldId) {
    try {
      const restored = await api.requestJson(`/api/custom-fields/${fieldId}/restore`, { method: "POST" });
      await afterMutation();
      toast("字段已恢复");
      return restored || fieldId;
    } catch (error) {
      toast(error?.message || "字段恢复失败", { tone: "error" });
      return null;
    }
  }

  async function purge(fieldId) {
    if (!confirm("永久删除这个字段？字段、选项及所有历史订单填写值都会永久删除，无法恢复。")) return null;
    try {
      await api.requestJson(`/api/custom-fields/${fieldId}/purge`, { method: "DELETE" });
      await afterMutation();
      toast("字段已永久删除");
      return { ok: true };
    } catch (error) {
      toast(error?.message || "字段删除失败", { tone: "error" });
      return null;
    }
  }

  async function purgeOption(fieldId, optionId) {
    if (!confirm("永久删除这个选项？历史订单中的该标签会被移除，无法恢复。")) return null;
    try {
      // The inactive state is local until the field is saved. Persist it before purging.
      await update(fieldId, {}, { toastMessage: null });
      await api.requestJson(`/api/custom-fields/${fieldId}/options/${optionId}/purge`, { method: "DELETE" });
      await afterMutation();
      toast("选项已永久删除");
      return { ok: true };
    } catch (error) {
      toast(error?.message || "选项删除失败", { tone: "error" });
      return null;
    }
  }

  return { render, create, update, remove, restore, purge, purgeOption };
}

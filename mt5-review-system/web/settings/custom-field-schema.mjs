import { escapeAttr, escapeHtml } from "../shared/js/formatters.mjs";

const CHOICE_COLORS = ["#2bd4ff", "#4ade80", "#ff5c7a", "#f97316", "#facc15", "#a78bfa", "#38bdf8", "#fb7185"];

export function fieldTypeLabel(type) {
  return { text: "文本", single: "单选", multi: "多选" }[type] || "文本";
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

  function readNewName() {
    return getElement("newCustomFieldName")?.value?.trim() || "";
  }

  function readNewType() {
    return getElement("newCustomFieldType")?.value || "text";
  }

  function readFieldName(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return "";
    return node.querySelectorAll(`[data-custom-field-name="${fieldId}"]`)[0]?.value?.trim() || "";
  }

  function readFieldType(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return "text";
    return node.querySelectorAll(`[data-custom-field-type="${fieldId}"]`)[0]?.value || "text";
  }

  function renderOptionRow(fieldId, option = {}) {
    return `
      <div class="option-row" data-option-row="${fieldId}" data-option-id="${escapeAttr(option.id || "")}">
        <input type="color" value="${escapeAttr(option.color || choiceColor(0))}" data-option-color title="颜色" />
        <input type="text" value="${escapeAttr(option.label || "")}" data-option-label placeholder="选项名称" />
        <button class="button-danger" data-option-delete type="button">删除</button>
      </div>
    `;
  }

  function renderFieldCard(field) {
    const typeOptions = ["text", "single", "multi"]
      .map((type) => `<option value="${type}" ${field.field_type === type ? "selected" : ""}>${fieldTypeLabel(type)}</option>`)
      .join("");
    const options = (field.options || []).map((option) => renderOptionRow(field.id, option)).join("");
    return `
      <div class="custom-field-card" data-custom-field-row="${field.id}">
        <div class="field-row custom-field-main">
          <span>${field.sort_order}</span>
          <input type="text" value="${escapeAttr(field.name)}" data-custom-field-name="${field.id}" />
          <select data-custom-field-type="${field.id}" title="字段类型">${typeOptions}</select>
          <button class="button" data-custom-field-save="${field.id}">保存</button>
          <button class="button-danger" data-custom-field-delete="${field.id}">删除</button>
        </div>
        <div class="option-editor ${field.field_type === "text" ? "hidden" : ""}" data-option-editor="${field.id}">
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
    node.querySelectorAll("[data-option-add]").forEach((button) => {
      button.addEventListener("click", () => addOptionRow(Number(button.dataset.optionAdd)));
    });
    node.querySelectorAll("[data-option-delete]").forEach((button) => {
      button.addEventListener("click", () => button.closest?.("[data-option-row]")?.remove?.());
    });
    node.querySelectorAll("[data-custom-field-type]").forEach((select) => {
      select.addEventListener("change", () => {
        const id = Number(select.dataset.customFieldType);
        const editor = node.querySelectorAll(`[data-option-editor="${id}"]`)[0];
        if (!editor) return;
        editor.classList?.toggle?.("hidden", select.value === "text");
        if (select.value !== "text" && !node.querySelectorAll(`[data-option-editor="${id}"] [data-option-row]`).length) {
          addOptionRow(id);
        }
      });
    });
  }

  function collectOptions(fieldId) {
    const node = getElement("customFieldSchema");
    if (!node || typeof node.querySelectorAll !== "function") return [];
    return Array.from(node.querySelectorAll(`[data-option-row="${fieldId}"]`))
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
    const fieldType = fieldTypeValue ?? readNewType();
    if (!name) {
      toast("请先填写字段名", { tone: "error" });
      return null;
    }
    const field = await api.requestJson("/api/custom-fields", {
      method: "POST",
      body: { name, field_type: fieldType },
    });
    const nameInput = getElement("newCustomFieldName");
    const typeSelect = getElement("newCustomFieldType");
    if (nameInput) nameInput.value = "";
    if (typeSelect) typeSelect.value = "text";
    await afterMutation();
    toast("字段已新增");
    return field;
  }

  async function update(fieldId, payload = {}) {
    const name = (payload.name ?? readFieldName(fieldId)).trim();
    if (!name) {
      toast("字段名不能为空", { tone: "error" });
      return null;
    }
    const fieldType = payload.fieldType ?? readFieldType(fieldId);
    const options = payload.options ?? (fieldType === "text" ? [] : collectOptions(fieldId));
    const updated = await api.requestJson(`/api/custom-fields/${fieldId}`, {
      method: "PUT",
      body: { name, field_type: fieldType, options },
    });
    await afterMutation();
    toast("字段已更新");
    return updated;
  }

  async function remove(fieldId) {
    if (!confirm("删除这个自定义字段？该字段在所有订单里的填写内容也会删除。")) return null;
    await api.requestJson(`/api/custom-fields/${fieldId}`, { method: "DELETE" });
    await afterMutation();
    toast("字段已删除");
    return { ok: true };
  }

  return { render, create, update, remove };
}

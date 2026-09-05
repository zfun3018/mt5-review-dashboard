import { escapeAttr, escapeHtml } from "../shared/js/formatters.mjs";

const CHOICE_COLORS = ["#2bd4ff", "#4ade80", "#ff5c7a", "#f97316", "#facc15", "#a78bfa", "#38bdf8", "#fb7185"];

function choiceColor(index) {
  return CHOICE_COLORS[Math.abs(Number(index) || 0) % CHOICE_COLORS.length];
}

export function fieldTypeLabel(type) {
  return { text: "文本", single: "单选", multi: "多选" }[type] || "文本";
}

export function createCustomFieldsModule({
  api,
  view,
  toast,
  getFields,
  resolveTrade,
  setTradeCustomValue,
  getChoiceField,
  getChoiceValue,
  setChoiceValue,
  saveChoiceValue,
  rerender,
  applyFieldUpdate,
}) {
  let choiceEditor = null;
  const pendingChoiceValues = new Map();
  const choiceSaveChains = new Map();

  function fieldById(id) {
    return getFields().find((field) => Number(field.id) === Number(id));
  }

  function classificationField(dimension) {
    return typeof getChoiceField === "function" ? getChoiceField(dimension) : null;
  }

  function selectedOptionIds(trade, field) {
    const key = `${trade?.id || ""}:${field?.classification_dimension || field?.id || ""}`;
    const value = pendingChoiceValues.has(key)
      ? pendingChoiceValues.get(key)
      : field?.classification_dimension
      ? getChoiceValue?.(trade, field.classification_dimension)
      : trade?.custom_fields?.[String(field.id)];
    if (field.field_type === "multi") return Array.isArray(value) ? value.map(String) : [];
    return value ? [String(value)] : [];
  }

  function optionById(field, optionId) {
    return (field.options || []).find((option) => String(option.id) === String(optionId));
  }

  function renderCustomValueEditor(trade, field, mode) {
    const value = field?.classification_dimension
      ? getChoiceValue?.(trade, field.classification_dimension)
      : trade?.custom_fields?.[String(field.id)];
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
        ${field.classification_dimension ? `data-choice-dimension="${escapeAttr(field.classification_dimension)}"` : `data-field-id="${field.id}"`}
        type="button"
        title="选择${escapeAttr(field.name)}"
      >
        <span class="choice-cell-values">${pills || `<span class="choice-placeholder">点击选择</span>`}</span>
        <span class="cell-caret">v</span>
      </button>
    `;
  }

  async function saveCustomValue(input) {
    const value = input.value;
    if (value === (input.dataset.original || "")) return;
    const tradeId = input.dataset.tradeId;
    const fieldId = Number(input.dataset.fieldId);
    await api.requestJson(`/api/trades/${encodeURIComponent(tradeId)}/custom-fields/${fieldId}`, {
      method: "PATCH",
      body: { value },
    });
    setTradeCustomValue(tradeId, fieldId, value);
    if (typeof view.querySelectorAll === "function") {
      for (const node of view.querySelectorAll(`[data-custom-cell][data-trade-id="${CSS.escape(tradeId)}"][data-field-id="${fieldId}"]`)) {
        if (node !== input) node.value = value;
        node.dataset.original = value;
      }
    }
    input.dataset.original = value;
    toast("字段内容已保存");
  }

  function bindCustomValueInputs() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const input of view.querySelectorAll("[data-custom-cell]")) {
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
    }
  }

  function bindChoiceTriggers() {
    if (typeof view.querySelectorAll !== "function") return;
    for (const trigger of view.querySelectorAll("[data-choice-trigger]")) {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        openChoicePopover(trigger);
      });
    }
  }

  function openChoicePopover(trigger) {
    const rect = typeof trigger.getBoundingClientRect === "function"
      ? trigger.getBoundingClientRect()
      : { top: 0, bottom: 0, left: 0, width: 0 };
    choiceEditor = {
      tradeId: trigger.dataset.tradeId,
      fieldId: trigger.dataset.fieldId ? Number(trigger.dataset.fieldId) : null,
      dimension: trigger.dataset.choiceDimension || null,
      query: "",
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    };
    renderChoicePopover();
  }

  function choicePopoverNode() {
    let node = view.getElementById("choicePopover");
    if (!node && typeof view.createElement === "function") {
      node = view.createElement("div");
      node.id = "choicePopover";
      node.className = "choice-popover hidden";
      node.addEventListener("click", (event) => event.stopPropagation());
      view.body?.appendChild?.(node) || view.appendChild?.(node);
    }
    return node;
  }

  function renderChoiceOptions(node, field, trade) {
    const query = choiceEditor?.query || "";
    const selected = selectedOptionIds(trade, field);
    const options = field.options || [];
    const visibleOptions = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
    const hasExact = options.some((option) => option.label.toLowerCase() === query.trim().toLowerCase());
    const createButton = !choiceEditor.dimension && query.trim() && !hasExact
      ? `<button class="choice-create" data-choice-create type="button">创建 ${escapeHtml(query.trim())}</button>`
      : "";
    const clearButton = field.field_type === "single"
      ? `<button class="choice-option muted-choice ${selected.length ? "" : "selected"}" data-choice-option="" type="button">未选</button>`
      : `<button class="choice-option muted-choice" data-choice-option="" type="button">清空</button>`;
    const optionButtons = visibleOptions.map((option) => `
      <button class="choice-option ${selected.includes(String(option.id)) ? "selected" : ""}"
        style="--choice:${escapeAttr(option.color || "#2bd4ff")};"
        data-choice-option="${option.id}" type="button">
        <span class="choice-option-dot"></span><span>${escapeHtml(option.label)}</span>
      </button>
    `).join("");
    const optionsNode = node.querySelector?.("[data-choice-options]");
    if (!optionsNode) return;
    optionsNode.innerHTML = `${clearButton}${optionButtons || `<div class="choice-empty">没有匹配选项</div>`}${createButton}`;
    for (const button of optionsNode.querySelectorAll("[data-choice-option]")) {
      button.addEventListener("click", () => chooseCustomOption(choiceEditor.tradeId, choiceEditor.fieldId, button.dataset.choiceOption, choiceEditor.dimension));
    }
    optionsNode.querySelector("[data-choice-create]")?.addEventListener("click", createOptionAndSelect);
  }

  function renderChoicePopover() {
    const node = choicePopoverNode();
    if (!node) return;
    if (!choiceEditor) {
      node.classList.add("hidden");
      return;
    }
    const field = choiceEditor.dimension ? classificationField(choiceEditor.dimension) : fieldById(choiceEditor.fieldId);
    const trade = resolveTrade(choiceEditor.tradeId);
    if (!field || !trade) {
      closeChoicePopover();
      return;
    }
    const query = choiceEditor.query || "";
    node.innerHTML = `
      <div class="choice-popover-title">
        <strong>${escapeHtml(field.name)}</strong>
        <span>${fieldTypeLabel(field.field_type)}</span>
      </div>
      <input class="choice-search" data-choice-search type="search" value="${escapeAttr(query)}" placeholder="查找或创建选项" />
      <div class="choice-options" data-choice-options></div>
    `;
    renderChoiceOptions(node, field, trade);
    positionChoicePopover(node, choiceEditor.rect);
    node.classList.remove("hidden");
    const search = node.querySelector("[data-choice-search]");
    search.addEventListener("input", (event) => {
      choiceEditor.query = event.target.value;
      renderChoiceOptions(node, field, trade);
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createOptionAndSelect();
      }
    });
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }

  function positionChoicePopover(node, rect) {
    const width = 292;
    const innerWidth = globalThis.window?.innerWidth ?? globalThis.innerWidth ?? 1024;
    const innerHeight = globalThis.window?.innerHeight ?? globalThis.innerHeight ?? 768;
    const left = Math.min(Math.max(12, rect.left), Math.max(12, innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, Math.max(12, innerHeight - 360));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    node.style.width = `${width}px`;
  }

  function closeChoicePopover() {
    choiceEditor = null;
    const node = view.getElementById?.("choicePopover");
    if (node) node.classList?.add?.("hidden");
  }

  async function chooseCustomOption(tradeId, fieldId, optionId, dimension = null) {
    const field = dimension ? classificationField(dimension) : fieldById(fieldId);
    const trade = resolveTrade(tradeId);
    if (!field || !trade) return;
    const key = `${tradeId}:${dimension || fieldId}`;
    const previousValue = field.field_type === "multi" ? selectedOptionIds(trade, field) : (selectedOptionIds(trade, field)[0] || "");
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
    pendingChoiceValues.set(key, value);
    rerender();
    await saveCustomChoiceValue(tradeId, fieldId, value, keepOpen, dimension, key, previousValue);
  }

  async function saveCustomChoiceValue(tradeId, fieldId, value, keepOpen, dimension = null, key = `${tradeId}:${dimension || fieldId}`, previousValue = "") {
    const save = async () => {
      if (dimension && typeof saveChoiceValue === "function") {
        await saveChoiceValue(tradeId, dimension, value);
      } else {
        await api.requestJson(`/api/trades/${encodeURIComponent(tradeId)}/custom-fields/${fieldId}`, {
          method: "PATCH",
          body: { value },
        });
        setTradeCustomValue(tradeId, fieldId, value);
      }
      if (pendingChoiceValues.get(key) === value) pendingChoiceValues.delete(key);
      rerender();
      if (keepOpen && choiceEditor) renderChoicePopover();
      else closeChoicePopover();
      toast("字段内容已保存");
    };
    const queued = (choiceSaveChains.get(key) || Promise.resolve())
      .catch(() => {})
      .then(save)
      .catch((error) => {
        if (pendingChoiceValues.get(key) === value) {
          pendingChoiceValues.delete(key);
          if (dimension) setChoiceValue?.(tradeId, dimension, previousValue);
          else setTradeCustomValue(tradeId, fieldId, previousValue);
          rerender();
        }
        toast(error?.message || "字段保存失败", { tone: "error" });
      });
    const chain = queued.finally(() => {
      if (choiceSaveChains.get(key) === chain) choiceSaveChains.delete(key);
    });
    choiceSaveChains.set(key, chain);
    return queued;
  }

  async function createOptionAndSelect() {
    const editor = choiceEditor;
    if (!editor) return;
    const field = editor.dimension ? classificationField(editor.dimension) : fieldById(editor.fieldId);
    if (!field || field.field_type === "text") return;
    const label = editor.query.trim();
    if (!label) return;
    const existing = (field.options || []).find((option) => option.label.toLowerCase() === label.toLowerCase());
    if (existing) {
      await chooseCustomOption(editor.tradeId, editor.fieldId, String(existing.id));
      return;
    }
    const options = [...(field.options || []), { label, color: choiceColor((field.options || []).length) }];
    const updated = await api.requestJson(`/api/custom-fields/${field.id}`, {
      method: "PUT",
      body: { name: field.name, field_type: field.field_type, options },
    });
    applyFieldUpdate(updated);
    const created = [...(updated.options || [])].reverse().find((option) => option.label.toLowerCase() === label.toLowerCase());
    if (!created) return;
    choiceEditor.query = "";
    await chooseCustomOption(editor.tradeId, editor.fieldId, String(created.id));
  }

  function dispose() {
    closeChoicePopover();
    choiceEditor = null;
  }

  return {
    renderCustomValueEditor,
    bindCustomValueInputs,
    bindChoiceTriggers,
    closeChoicePopover,
    dispose,
  };
}

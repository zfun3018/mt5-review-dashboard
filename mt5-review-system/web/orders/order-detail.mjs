import {
  escapeAttr,
  escapeHtml,
  formatBeijingDateTime,
  formatMoney,
  formatPrice,
  formatVolume,
  profitClass,
} from "../shared/js/formatters.mjs";

const DEFAULT_MISTAKE_OPTIONS = [
  { id: "过早加仓", label: "过早加仓", color: "#f2bd68" },
  { id: "逆势交易", label: "逆势交易", color: "#f2bd68" },
  { id: "未等确认", label: "未等确认", color: "#f2bd68" },
  { id: "减仓偏晚", label: "减仓偏晚", color: "#f2bd68" },
  { id: "止损执行偏晚", label: "止损执行偏晚", color: "#f2bd68" },
  { id: "无明显错误", label: "无明显错误", color: "#55d69b" },
];

function uniqueTags(value, fallback = []) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map((item) => String(item || "").trim()).filter(Boolean))];
}

const SINGLE_TAG_GROUPS = new Set(["trade_type_tags", "strategy_tags"]);

export function shouldConfirmFeaturedRemoval(campaign) {
  return Boolean(campaign?.is_featured);
}

export function campaignContractDisplay(campaign) {
  const name = String(campaign?.display_symbol || campaign?.contract_name || campaign?.symbol || "-");
  const symbol = String(campaign?.symbol || "");
  return {
    name,
    code: symbol && symbol !== name ? symbol : "",
  };
}

function isSingleTagGroup(group) {
  return SINGLE_TAG_GROUPS.has(group);
}

function tagValues(group, value, fallback = []) {
  const values = uniqueTags(value, fallback);
  return isSingleTagGroup(group) ? values.slice(0, 1) : values;
}

function campaignStop(detail) {
  const positions = detail?.positions || [];
  const stops = positions
    .map((position) => position.initial_stop_price)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number);
  if (!stops.length || stops.length !== positions.length) return "";
  return stops.every((value) => value === stops[0]) ? String(stops[0]) : "";
}

export function renderImportSourcesMarkup(sources = []) {
  const items = Array.isArray(sources) ? sources : [];
  if (!items.length) return '<div class="import-source-empty">来源信息不可用（可能是历史导入数据）</div>';
  return `<section class="import-source-section is-secondary" aria-label="导入来源">
    <div class="section-head"><h3>导入来源</h3><span>${items.length} 个批次</span></div>
    <div class="import-source-list">${items.map((source) => `
      <article class="import-source-item">
        <div class="import-source-item__head"><strong>${escapeHtml(source.filename || "未命名文件")}</strong><span>${escapeHtml(source.batch_id || "")}</span></div>
        <div class="import-source-item__meta">
          <span>导入 ${escapeHtml(source.started_at || "未知时间")}</span>
          <span>工作表 ${escapeHtml(source.source_sheet || "默认")}</span>
          <span>原始行 ${escapeHtml((source.source_rows || []).join(", ") || "未知")}</span>
        </div>
        <div class="import-source-item__meta">
          <span>成交序号 ${escapeHtml((source.trade_ids || []).join(", ") || "未知")}</span>
          <span class="import-source-sha" title="文件 SHA-256">SHA-256 ${escapeHtml(source.file_sha256 || "未知")}</span>
        </div>
      </article>
    `).join("")}</div>
  </section>`;
}

function renderDetailIcons() {
  const lucide = globalThis.window?.lucide || globalThis.lucide;
  lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
}

function dealFees(deal) {
  return Number((Number(deal?.commission || 0) + Number(deal?.swap || 0) + Number(deal?.fee || 0)).toFixed(2));
}

function executionMoney(deal, { realized = false } = {}) {
  const feesValue = dealFees(deal);
  const pnlValue = realized ? Number(deal?.profit || 0) : null;
  const netPnlValue = realized ? Number((pnlValue + feesValue).toFixed(2)) : feesValue || null;
  return {
    feesValue,
    pnlValue,
    netPnlValue,
    fees: realized || feesValue ? formatMoney(feesValue) : "—",
    pnl: realized ? formatMoney(pnlValue) : "—",
    netPnl: netPnlValue === null ? "—" : formatMoney(netPnlValue),
  };
}

export function executionRows(detail) {
  const rows = [];
  let entryIndex = 0;
  for (const position of detail?.positions || []) {
    const side = position.side === "long" ? "多" : "空";
    const entryPrice = Number(position.weighted_entry_price);
    for (const deal of position.entry_deals || []) {
      const money = executionMoney(deal);
      rows.push({
        type: entryIndex === 0 ? "open" : "add",
        typeLabel: entryIndex === 0 ? "开仓" : "加仓",
        side,
        direction: side,
        time: formatBeijingDateTime(deal.time_utc),
        openPrice: formatPrice(deal.price),
        closePrice: "—",
        volume: formatVolume(deal.volume),
        points: "—",
        ...money,
        sort: Number(deal.time_msc || 0),
      });
      entryIndex += 1;
    }
    const exits = position.exit_deals || [];
    exits.forEach((deal, index) => {
      const price = Number(deal.price);
      const signedPoints = Number.isFinite(entryPrice) && Number.isFinite(price)
        ? (position.side === "long" ? price - entryPrice : entryPrice - price)
        : null;
      const money = executionMoney(deal, { realized: true });
      const isClose = index === exits.length - 1
        && ["complete", "legacy_estimated"].includes(position.reconstruction_status);
      rows.push({
        type: isClose ? "close" : "reduce",
        typeLabel: isClose ? "平仓" : "减仓",
        side,
        direction: `平${side}`,
        time: formatBeijingDateTime(deal.time_utc),
        openPrice: Number.isFinite(entryPrice) ? formatPrice(entryPrice) : "—",
        closePrice: formatPrice(deal.price),
        volume: formatVolume(deal.volume),
        points: Number.isFinite(signedPoints) ? `${signedPoints >= 0 ? "+" : ""}${signedPoints.toFixed(2)}` : "—",
        ...money,
        sort: Number(deal.time_msc || 0),
      });
    });
  }
  return rows.sort((left, right) => left.sort - right.sort);
}

export function createOrderDetailModule({
  api,
  view,
  toast,
  confirm,
  getState,
  renderCustomValueEditor,
  bindCustomValueInputs,
  bindChoiceTriggers,
  classificationOptions,
  saveCampaignInitialStop,
  toggleFeatured,
  checkinCampaign,
  randomFeatured,
  afterMutation,
  onLayoutChange,
  onDeleteTrade,
  onRestoreTrade,
}) {
  let reviewTimer = null;
  let campaignSaveChain = Promise.resolve();
  let detachScreenshotEvents = null;
  let detachTagPickerEvents = null;
  let detachDraftEvents = null;
  let lastScreenshotLayout = "";
  const pendingCampaignStates = new Map();
  const pendingCampaignKeepalive = new Set();
  const screenshotUndoStacks = new Map();

  function getElement(id) {
    return typeof view.getElementById === "function" ? view.getElementById(id) : null;
  }

  function mistakeOptions(customFields) {
    const field = (customFields || []).find((item) => item.name === "犯错" && item.field_type === "multi");
    return field?.options?.length
      ? field.options.map((option) => ({ ...option, id: String(option.id) }))
      : DEFAULT_MISTAKE_OPTIONS;
  }

  function renderScreenshotEditor(campaign) {
    const preview = campaign?.screenshot_url
      ? `<button class="shot-btn snapshot compact-snapshot" id="detailShot" data-shot="${escapeAttr(campaign.screenshot_url)}" title="放大截图"><img id="detailScreenshotImage" src="${escapeAttr(campaign.screenshot_url)}" alt="交易组合截图" /></button>`
      : `<div class="screenshot-empty">暂无交易截图</div>`;
    return `
      <div class="screenshot-editor" id="screenshotEditor" tabindex="0" aria-label="交易截图">
        <div class="screenshot-preview">${preview}</div>
        <div class="screenshot-overlay-controls">
          <span class="screenshot-status">${campaign?.screenshot_url ? "已绑定组合截图" : "支持粘贴、拖入或选择"}</span>
          <button id="replaceScreenshot" class="ghost-btn" type="button">替换</button>
          <input id="screenshotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden />
          <button id="deleteScreenshot" class="ghost-btn danger-btn" type="button" ${campaign?.screenshot_url ? "" : "disabled"}>删除</button>
        </div>
      </div>
    `;
  }

  function renderTagPicker(group, label, options, selected) {
    const values = tagValues(group, selected);
    const selectionHint = isSingleTagGroup(group) ? "单选" : "可多选";
    return `
      <div class="campaign-tag-field" data-tag-picker="${escapeAttr(group)}">
        <span class="field-label">${escapeHtml(label)} <small>${selectionHint}</small></span>
        <button class="choice-cell detail-choice" type="button" data-tag-trigger="${escapeAttr(group)}" aria-haspopup="listbox" aria-expanded="false">
          <span class="choice-cell-values">${renderTagPills(options, values) || '<span class="choice-placeholder">点击选择</span>'}</span>
          <span class="cell-caret" aria-hidden="true">v</span>
        </button>
      </div>
    `;
  }

  function renderTagPills(options, selected) {
    return uniqueTags(selected).map((value) => {
      const option = options.find((item) => String(item.id) === value);
      return `<span class="choice-value-pill" style="--choice:${escapeAttr(option?.color || "#64b5ff")};">${escapeHtml(option?.label || value)}</span>`;
    }).join("");
  }

  function updateTagPickerValues(group, options, selected) {
    const picker = Array.from(view.querySelectorAll?.("[data-tag-picker]") || [])
      .find((node) => node.dataset?.tagPicker === group);
    const values = picker?.querySelector?.(".choice-cell-values");
    if (values) values.innerHTML = renderTagPills(options, selected) || '<span class="choice-placeholder">点击选择</span>';
  }

  function choicePopover() {
    let node = getElement("campaignChoicePopover");
    if (!node && typeof view.createElement === "function") {
      node = view.createElement("div");
      node.id = "campaignChoicePopover";
      node.className = "choice-popover hidden";
      node.addEventListener("click", (event) => event.stopPropagation());
      view.body?.appendChild?.(node);
    }
    return node;
  }

  function closeChoicePopover() {
    const node = choicePopover();
    node?.classList.add("hidden");
    view.querySelectorAll?.("[data-tag-trigger]").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  }

  function renderChoicePopover(campaign, group, label, options) {
    const node = choicePopover();
    if (!node) return;
    const single = isSingleTagGroup(group);
    const selected = tagValues(group, campaign[group]);
    node.innerHTML = `
      <div class="choice-popover-title"><strong>${escapeHtml(label)}</strong><span>${single ? "单选" : "可多选"}</span></div>
      <input class="choice-search" data-campaign-choice-search type="search" placeholder="查找选项" />
      <div class="choice-options" data-campaign-choice-options>
        <button class="choice-option muted-choice" type="button" data-campaign-choice-clear>清空</button>
        ${options.map((option) => `
          <button class="choice-option ${selected.includes(String(option.id)) ? "selected" : ""}" type="button" data-campaign-choice-option="${escapeAttr(option.id)}" style="--choice:${escapeAttr(option.color || "#64b5ff")};">
            <span class="choice-option-dot"></span><span>${escapeHtml(option.label)}</span>
          </button>
        `).join("")}
      </div>
    `;
    node.classList.remove("hidden");
    const search = node.querySelector("[data-campaign-choice-search]");
    search?.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      node.querySelectorAll("[data-campaign-choice-option]").forEach((option) => {
        option.hidden = !option.textContent.toLowerCase().includes(query);
      });
    });
    node.querySelector("[data-campaign-choice-clear]")?.addEventListener("click", () => {
      const saving = saveTagSelection(campaign, group, [], { label, options });
      if (single) closeChoicePopover();
      return saving;
    });
    node.querySelectorAll("[data-campaign-choice-option]").forEach((option) => {
      option.addEventListener("click", () => {
        const value = option.dataset.campaignChoiceOption;
        const next = single
          ? [value]
          : selected.includes(value)
            ? selected.filter((item) => item !== value)
            : [...selected, value];
        const saving = saveTagSelection(campaign, group, next, { label, options });
        if (single) closeChoicePopover();
        return saving;
      });
    });
    search?.focus();
  }

  function draftStorage() {
    try {
      return (view.defaultView || globalThis).localStorage || null;
    } catch (error) {
      return null;
    }
  }

  function draftStorageKey(campaign) {
    return `mt5-review-campaign-draft:${String(campaign?.id || "")}`;
  }

  function readStoredCampaignDraft(campaign) {
    const storage = draftStorage();
    if (!storage || !campaign?.id) return null;
    try {
      const raw = storage.getItem(draftStorageKey(campaign));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return {
        review_text: String(parsed.review_text || ""),
        trade_type_tags: tagValues("trade_type_tags", parsed.trade_type_tags),
        strategy_tags: tagValues("strategy_tags", parsed.strategy_tags),
        mistake_tags: tagValues("mistake_tags", parsed.mistake_tags),
      };
    } catch (error) {
      return null;
    }
  }

  function storeCampaignDraft(campaign, draft) {
    const storage = draftStorage();
    if (!storage || !campaign?.id) return;
    try {
      storage.setItem(draftStorageKey(campaign), JSON.stringify(campaignPayload(draft)));
    } catch (error) {
      // Local storage is only a refresh fallback; the API remains authoritative.
    }
  }

  function clearStoredCampaignDraft(campaign) {
    const storage = draftStorage();
    if (!storage || !campaign?.id) return;
    try {
      storage.removeItem(draftStorageKey(campaign));
    } catch (error) {
      // Ignore storage cleanup failures after a successful API save.
    }
  }

  function campaignDraft(campaign) {
    const existing = pendingCampaignStates.get(campaign.id);
    if (existing) return existing;
    const stored = readStoredCampaignDraft(campaign);
    if (stored) return stored;
    return {
      review_text: campaign.review_text || "",
      trade_type_tags: tagValues("trade_type_tags", campaign.trade_type_tags, campaign.trade_type ? [campaign.trade_type] : []),
      strategy_tags: tagValues("strategy_tags", campaign.strategy_tags, campaign.strategy ? [campaign.strategy] : []),
      mistake_tags: tagValues("mistake_tags", campaign.mistake_tags),
    };
  }

  function campaignPayload(draft) {
    return {
      review_text: draft.review_text || "",
      trade_type_tags: tagValues("trade_type_tags", draft.trade_type_tags),
      strategy_tags: tagValues("strategy_tags", draft.strategy_tags),
      mistake_tags: tagValues("mistake_tags", draft.mistake_tags),
    };
  }

  async function sendCampaignDraft(campaign, draft, { keepalive = false } = {}) {
    const updated = await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/review`, {
      method: "PATCH",
      body: campaignPayload(draft),
      keepalive,
    });
    const latest = pendingCampaignStates.get(campaign.id);
    const effective = latest || draft;
    Object.assign(campaign, updated || {}, {
      review_text: effective.review_text,
      trade_type_tags: tagValues("trade_type_tags", effective.trade_type_tags),
      strategy_tags: tagValues("strategy_tags", effective.strategy_tags),
      mistake_tags: tagValues("mistake_tags", effective.mistake_tags),
    });
    if (latest === draft) {
      pendingCampaignStates.delete(campaign.id);
      pendingCampaignKeepalive.delete(campaign.id);
      clearStoredCampaignDraft(campaign);
    }
    const state = getElement("saveState");
    if (state) state.textContent = "已自动保存";
    return updated;
  }

  function stageCampaignDraft(campaign, changes) {
    const draft = { ...campaignDraft(campaign), ...changes };
    draft.trade_type_tags = tagValues("trade_type_tags", draft.trade_type_tags);
    draft.strategy_tags = tagValues("strategy_tags", draft.strategy_tags);
    draft.mistake_tags = tagValues("mistake_tags", draft.mistake_tags);
    pendingCampaignStates.set(campaign.id, draft);
    storeCampaignDraft(campaign, draft);
    Object.assign(campaign, draft);
    return draft;
  }

  function queueCampaignSave(campaign, { keepalive = false } = {}) {
    if (keepalive) pendingCampaignKeepalive.add(campaign.id);
    const operation = campaignSaveChain.catch(() => {}).then(async () => {
      const draft = pendingCampaignStates.get(campaign.id);
      if (!draft) return;
      await sendCampaignDraft(campaign, draft, { keepalive: pendingCampaignKeepalive.has(campaign.id) });
    });
    campaignSaveChain = operation.catch(() => {});
    return operation;
  }

  async function saveTagSelection(campaign, group, values, pickerState) {
    const nextValues = tagValues(group, values);
    stageCampaignDraft(campaign, { [group]: nextValues });
    if (pickerState) {
      updateTagPickerValues(group, pickerState.options, nextValues);
      renderChoicePopover(campaign, group, pickerState.label, pickerState.options);
    }
    try {
      await queueCampaignSave(campaign);
      toast("标签已自动保存");
    } catch (error) {
      toast(error?.message || "标签保存失败", { tone: "error" });
    }
  }

  function bindTagPickers(campaign, optionGroups) {
    detachTagPickerEvents?.();
    view.querySelectorAll?.("[data-tag-trigger]").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const group = trigger.dataset.tagTrigger;
        const picker = trigger.closest("[data-tag-picker]");
        const open = trigger.getAttribute("aria-expanded") === "true";
        closeChoicePopover();
        if (open) return;
        const node = choicePopover();
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(292, (globalThis.innerWidth || 1024) - 24);
        node.style.width = `${width}px`;
        node.style.left = `${Math.min(Math.max(12, rect.left), Math.max(12, (globalThis.innerWidth || 1024) - width - 12))}px`;
        node.style.top = `${Math.min(rect.bottom + 8, Math.max(12, (globalThis.innerHeight || 768) - 380))}px`;
        trigger.setAttribute("aria-expanded", "true");
        renderChoicePopover(campaign, group, picker.querySelector(".field-label")?.textContent || group, optionGroups[group]);
      });
    });
    const handleOutsideClick = (event) => {
      if (event.target?.closest?.(".choice-popover, [data-tag-trigger]")) return;
      closeChoicePopover();
    };
    view.addEventListener?.("click", handleOutsideClick);
    detachTagPickerEvents = () => {
      view.removeEventListener?.("click", handleOutsideClick);
      detachTagPickerEvents = null;
    };
  }

  function screenshotUndoStack(campaign) {
    const key = String(campaign?.id || "");
    if (!key) return [];
    if (!screenshotUndoStacks.has(key)) screenshotUndoStacks.set(key, []);
    return screenshotUndoStacks.get(key);
  }

  function screenshotFilename(url) {
    const value = String(url || "").split(/[?#]/)[0];
    const name = value.split("/").pop();
    return name ? decodeURIComponent(name) : "screenshot.png";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(blob);
    });
  }

  async function captureScreenshotSnapshot(campaign) {
    const url = campaign?.screenshot_url;
    if (!url) return { exists: false };
    if (String(url).startsWith("data:")) {
      return { exists: true, imageData: String(url), filename: screenshotFilename(url) };
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`截图读取失败：${response.status}`);
      return {
        exists: true,
        imageData: await blobToDataUrl(await response.blob()),
        filename: screenshotFilename(url),
      };
    } catch (error) {
      return { exists: true, sourceUrl: String(url), filename: screenshotFilename(url), error };
    }
  }

  async function restoreScreenshotSnapshot(campaign, snapshot) {
    if (!snapshot?.exists) {
      await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/screenshot`, { method: "DELETE" });
      return;
    }
    let imageData = snapshot.imageData;
    if (!imageData && snapshot.sourceUrl) {
      const response = await fetch(snapshot.sourceUrl);
      if (!response.ok) throw snapshot.error || new Error("原截图已无法恢复");
      imageData = await blobToDataUrl(await response.blob());
    }
    if (!imageData) throw snapshot.error || new Error("原截图已无法恢复");
    await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/screenshot`, {
      method: "POST",
      body: { image_data: imageData, filename: snapshot.filename || "screenshot.png" },
    });
  }

  async function replaceScreenshotFile(campaign, file, { recordUndo = true } = {}) {
    if (!campaign) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择图片文件", { tone: "error" });
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("图片不能超过 15MB", { tone: "error" });
      return;
    }
    const previous = recordUndo ? await captureScreenshotSnapshot(campaign) : null;
    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
      await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/screenshot`, { method: "POST", body: { image_data: imageData, filename: file.name } });
      if (previous) screenshotUndoStack(campaign).push(previous);
      toast("截图已替换，旧图片已清理");
      await afterMutation();
    } catch (error) {
      toast(error?.message || "截图替换失败", { tone: "error" });
    }
  }

  async function deleteTradeScreenshot(campaign) {
    if (!campaign?.screenshot_url) return;
    if (!confirm("删除这张交易截图？删除后原文件不可恢复。")) return;
    const previous = await captureScreenshotSnapshot(campaign);
    try {
      await api.requestJson(`/api/campaigns/${encodeURIComponent(campaign.id)}/screenshot`, { method: "DELETE" });
      screenshotUndoStack(campaign).push(previous);
      toast("截图已删除，存储文件已清理");
      await afterMutation();
    } catch (error) {
      toast(error?.message || "截图删除失败", { tone: "error" });
    }
  }

  async function undoScreenshot(campaign) {
    const history = screenshotUndoStack(campaign);
    const previous = history.pop();
    if (!previous) return;
    try {
      await restoreScreenshotSnapshot(campaign, previous);
      toast("已撤销截图操作");
      await afterMutation();
    } catch (error) {
      history.push(previous);
      toast(error?.message || "截图撤销失败", { tone: "error" });
    }
  }

  function clipboardImage(event) {
    const clipboard = event.clipboardData;
    const direct = Array.from(clipboard?.files || []).find((item) => item.type.startsWith("image/"));
    if (direct) return direct;
    return Array.from(clipboard?.items || [])
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile?.())
      .find(Boolean) || null;
  }

  function bindScreenshotEditor(campaign) {
    const editor = getElement("screenshotEditor");
    const fileInput = getElement("screenshotFile");
    if (!editor || !fileInput) return;
    const image = getElement("detailScreenshotImage");
    const syncScreenshotLayout = () => {
      const layout = image
        ? image.naturalWidth > 0
          ? `${image.naturalWidth}x${image.naturalHeight}`
          : "loading"
        : "none";
      if (layout === lastScreenshotLayout) return;
      lastScreenshotLayout = layout;
      onLayoutChange?.();
    };
    image?.addEventListener("load", syncScreenshotLayout, { once: true });
    syncScreenshotLayout();
    detachScreenshotEvents?.();
    getElement("replaceScreenshot")?.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) replaceScreenshotFile(campaign, file);
      fileInput.value = "";
    });
    getElement("deleteScreenshot")?.addEventListener("click", () => deleteTradeScreenshot(campaign));
    const handleScreenshotPaste = (event) => {
      const file = clipboardImage(event);
      if (!file) return;
      event.preventDefault();
      replaceScreenshotFile(campaign, file);
    };
    const handleScreenshotUndo = (event) => {
      const target = event.target;
      if (target !== editor && !editor.contains?.(target) && !target?.closest?.("#screenshotEditor")) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      undoScreenshot(trade);
    };
    view.addEventListener?.("paste", handleScreenshotPaste);
    view.addEventListener?.("keydown", handleScreenshotUndo);
    detachScreenshotEvents = () => {
      view.removeEventListener?.("paste", handleScreenshotPaste);
      view.removeEventListener?.("keydown", handleScreenshotUndo);
      detachScreenshotEvents = null;
    };
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
      replaceScreenshotFile(campaign, file);
    });
  }

  async function saveReview(campaign, reviewText, options = {}) {
    const value = reviewText ?? getElement("detailReview")?.value ?? campaign.review_text ?? "";
    const pending = stageCampaignDraft(campaign, { review_text: value });
    if (options.immediate) {
      return sendCampaignDraft(campaign, pending, { keepalive: Boolean(options.keepalive) });
    }
    await queueCampaignSave(campaign, options);
  }

  function renderCampaignDetail() {
    const node = getElement("orderDetail");
    if (!node) return;
    detachDraftEvents?.();
    const { campaign, detail, trade, customFields } = getState();
    if (!campaign) {
      node.innerHTML = `<div class="detail-empty">选择一个主订单开始复盘</div>`;
      return;
    }
    if (!detail) {
      node.innerHTML = `<div class="detail-empty">正在加载主订单详情</div>`;
      return;
    }
    const storedDraft = readStoredCampaignDraft(campaign);
    if (storedDraft) {
      pendingCampaignStates.set(campaign.id, storedDraft);
      Object.assign(campaign, storedDraft);
      queueCampaignSave(campaign).catch(() => {});
    }
    const sceneOptions = classificationOptions("trade_type");
    const strategyOptions = classificationOptions("strategy");
    const mistakes = mistakeOptions(customFields);
    const customFieldInputs = customFields
      .filter((field) => field.name !== "犯错")
      .map((field) => `<div class="field compact-field"><label>${escapeHtml(field.name)}</label>${trade ? renderCustomValueEditor(trade, field, "detail") : `<span class="muted-mini">暂无来源订单</span>`}</div>`)
      .join("");
    const records = executionRows(detail);
    const stop = campaignStop(detail);
    const checkinCount = Math.max(0, Number(campaign.checkin_count) || 0);
    const contractDisplay = campaignContractDisplay(campaign);
    node.innerHTML = `
      <div class="detail-body order-detail-workspace">
        <header class="detail-title order-detail-title">
          <div>
            <p class="eyebrow">主订单 · ${escapeHtml(formatBeijingDateTime(campaign.opened_at_utc))}</p>
            <h2><span class="detail-contract-name">${escapeHtml(contractDisplay.name)}</span>${contractDisplay.code ? ` <span class="detail-contract-code">${escapeHtml(contractDisplay.code)}</span>` : ""} · ${campaign.side === "long" ? "多单" : "空单"}</h2>
            <span class="detail-time">开仓 ${escapeHtml(formatBeijingDateTime(campaign.opened_at_utc))} · ${formatVolume(campaign.entry_volume)} 手 · ${escapeHtml(rMultipleLabel(campaign))}</span>
          </div>
          <div class="detail-order-actions">
            <span class="detail-action-group" aria-label="订单状态">
              <button id="featureCampaign" class="app-icon-button detail-icon-action featured-action${campaign.is_featured ? " is-active" : ""}" type="button" title="${campaign.is_featured ? "取消精选" : "加入精选"}" aria-label="${campaign.is_featured ? "取消精选" : "加入精选"}" aria-pressed="${Boolean(campaign.is_featured)}"><i data-lucide="star" aria-hidden="true"></i></button>
              ${campaign.is_featured ? '<span class="featured-status-badge"><i data-lucide="star" aria-hidden="true"></i>已精选</span>' : ""}
            </span>
            <span class="detail-action-divider" aria-hidden="true"></span>
            <span class="detail-action-group" aria-label="浏览操作">
              <button id="randomFeatured" class="app-icon-button detail-icon-action" type="button" title="随机一张精选订单" aria-label="随机一张精选订单"><i data-lucide="shuffle" aria-hidden="true"></i></button>
            </span>
            <button id="checkinCampaign" class="app-icon-button detail-icon-action${campaign.checkin_checked_in_today ? " is-active" : ""}" type="button" title="${campaign.checkin_checked_in_today ? "取消今日打卡" : "今日打卡"} · 累计 ${checkinCount} 次" aria-label="${campaign.checkin_checked_in_today ? "取消今日打卡" : "今日打卡"}" aria-pressed="${Boolean(campaign.checkin_checked_in_today)}"><i data-lucide="${campaign.checkin_checked_in_today ? "undo-2" : "check-circle"}" aria-hidden="true"></i><span class="detail-action-count" aria-hidden="true">${checkinCount}</span><span class="sr-only">${campaign.checkin_checked_in_today ? "取消今日打卡" : "今日打卡"}</span></button>
            ${trade ? `<button id="${trade.deleted_at ? "restoreOrder" : "deleteOrder"}" class="app-icon-button detail-icon-action${trade.deleted_at ? "" : "is-danger"}" type="button" title="${trade.deleted_at ? "恢复订单" : "排除订单"}" aria-label="${trade.deleted_at ? "恢复订单" : "排除订单"}"><i data-lucide="${trade.deleted_at ? "archive-restore" : "archive"}" aria-hidden="true"></i></button>` : ""}
          </div>
        </header>
        <div class="detail-hero-grid">
          ${renderScreenshotEditor(campaign)}
          <div class="detail-review-column">
            <section class="order-info-strip" aria-label="主订单信息">
              <div class="order-info-main">
                <div class="order-info-field stop-field ${stop ? "" : "missing"}">
                  <div class="field-label-row"><label for="campaignInitialStop">初始止损</label><span>${stop ? "已填写" : "待填写"}</span></div>
                  <input id="campaignInitialStop" class="numeric-cell-input" type="number" step="any" inputmode="decimal" value="${escapeAttr(stop)}" placeholder="请输入初始止损" />
                </div>
                ${renderTagPicker("trade_type_tags", "交易场景", sceneOptions, campaign.trade_type_tags || (campaign.trade_type ? [campaign.trade_type] : []))}
                ${renderTagPicker("strategy_tags", "交易策略", strategyOptions, campaign.strategy_tags || (campaign.strategy ? [campaign.strategy] : []))}
                ${renderTagPicker("mistake_tags", "犯错标签", mistakes, campaign.mistake_tags)}
                <div class="order-info-save"><span id="saveState" aria-live="polite">自动保存已开启</span></div>
              </div>
              ${customFieldInputs ? `<div class="field-grid detail-custom-fields">${customFieldInputs}</div>` : ""}
            </section>
            <section class="review-editor-panel">
              <div class="section-head"><h3>复盘记录</h3><span id="reviewCount">${String(campaign.review_text || "").length} / 10000</span></div>
              <textarea id="detailReview" class="review-editor" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(campaign.review_text || "")}</textarea>
            </section>
          </div>
        </div>
        <section class="execution-section" aria-label="成交流水">
          <div class="section-head"><h3>成交流水</h3><span>组合订单共 ${records.length} 条执行记录</span></div>
          <div class="execution-table-wrap">
            <table class="execution-table">
              <thead><tr><th>类型 / 方向</th><th>时间 · 北京</th><th>开仓价格</th><th>平仓价格</th><th>手数</th><th>盈利点数</th><th>手续费</th><th>盈亏</th><th>净盈亏</th></tr></thead>
              <tbody>${records.map((record) => `
                <tr>
                  <td><span class="execution-type ${record.type}">${record.typeLabel}</span><span class="execution-side ${["多", "平多"].includes(record.direction) ? "long" : "short"}">${record.direction}</span></td>
                  <td class="mono-cell">${escapeHtml(record.time)}</td>
                  <td class="mono-cell">${escapeHtml(record.openPrice)}</td>
                  <td class="mono-cell">${escapeHtml(record.closePrice)}</td>
                  <td class="mono-cell">${escapeHtml(record.volume)}</td>
                  <td class="mono-cell ${record.points.startsWith("+") ? "profit-text" : record.points.startsWith("-") ? "loss-text" : "muted-mini"}">${escapeHtml(record.points)}</td>
                  <td class="mono-cell ${record.fees.startsWith("-") ? "loss-text" : "muted-mini"}">${escapeHtml(record.fees)}</td>
                  <td class="mono-cell ${record.pnl.startsWith("+") ? "profit-text" : record.pnl.startsWith("-") ? "loss-text" : "muted-mini"}">${escapeHtml(record.pnl)}</td>
                  <td class="mono-cell ${record.netPnl.startsWith("+") ? "profit-text" : record.netPnl.startsWith("-") ? "loss-text" : "muted-mini"}">${escapeHtml(record.netPnl)}</td>
                </tr>
              `).join("") || '<tr><td colspan="9" class="muted-mini">暂无成交流水</td></tr>'}</tbody>
            </table>
          </div>
        </section>
        ${renderImportSourcesMarkup(campaign.import_sources || trade?.import_sources || [])}
      </div>
    `;
    renderDetailIcons();
    bindDetailInteractions(campaign, trade, { trade_type_tags: sceneOptions, strategy_tags: strategyOptions, mistake_tags: mistakes });
    getElement("deleteOrder")?.addEventListener("click", () => onDeleteTrade?.());
    getElement("restoreOrder")?.addEventListener("click", () => onRestoreTrade?.());
    getElement("featureCampaign")?.addEventListener("click", async () => {
      try {
        if (shouldConfirmFeaturedRemoval(campaign) && !confirm("确认取消精选？")) return;
        await toggleFeatured?.(campaign, !campaign.is_featured);
      } catch (error) {
        toast(error?.message || "精选状态保存失败", { tone: "error" });
      }
    });
    getElement("checkinCampaign")?.addEventListener("click", async () => {
      try {
        await checkinCampaign?.(campaign);
      } catch (error) {
        toast(error?.message || "打卡失败", { tone: "error" });
      }
    });
    getElement("randomFeatured")?.addEventListener("click", async () => {
      try {
        await randomFeatured?.();
      } catch (error) {
        toast(error?.message || "随机精选订单失败", { tone: "error" });
      }
    });
  }

  function bindDetailInteractions(campaign, trade, optionGroups) {
    detachDraftEvents?.();
    bindTagPickers(campaign, optionGroups);
    bindCustomValueInputs();
    bindChoiceTriggers();
    bindScreenshotEditor(campaign);
    getElement("detailShot")?.addEventListener("click", (event) => {
      event.preventDefault();
      const modal = getElement("imageModal");
      const image = getElement("modalImage");
      if (modal && image) {
        modal.classList.add("open");
        modal.setAttribute("aria-hidden", "false");
        image.src = event.currentTarget.dataset.shot;
      }
    });
    const stopInput = getElement("campaignInitialStop");
    const saveStop = async () => {
      const raw = stopInput?.value.trim() || "";
      const value = raw === "" ? null : Number(raw);
      if (value !== null && !Number.isFinite(value)) {
        toast("初始止损必须是有效数字", { tone: "error" });
        return;
      }
      if (stopInput) stopInput.disabled = true;
      try {
        await saveCampaignInitialStop(campaign.id, value);
        toast(value === null ? "初始止损已清空" : "初始止损已自动保存，R 已重新计算");
      } catch (error) {
        if (stopInput) stopInput.disabled = false;
        toast(error?.message || "初始止损保存失败", { tone: "error" });
      }
    };
    stopInput?.addEventListener("blur", saveStop);
    stopInput?.addEventListener("change", saveStop);
    stopInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        stopInput.blur();
      }
    });
    const review = getElement("detailReview");
    const count = getElement("reviewCount");
    const saveReviewDebounced = () => {
      const reviewText = review.value;
      stageCampaignDraft(campaign, { review_text: reviewText });
      if (count) count.textContent = `${reviewText.length} / 10000`;
      const state = getElement("saveState");
      if (state) state.textContent = "保存中…";
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(async () => {
        try {
          await saveReview(campaign, reviewText);
        } catch (error) {
          if (state) state.textContent = "保存失败";
          toast(error?.message || "复盘保存失败", { tone: "error" });
        }
      }, 600);
    };
    review?.addEventListener("input", saveReviewDebounced);
    review?.addEventListener("blur", () => {
      clearTimeout(reviewTimer);
      saveReview(campaign, review.value).catch((error) => toast(error?.message || "复盘保存失败", { tone: "error" }));
    });
    const handlePageHide = () => {
      const latestReview = getElement("detailReview")?.value;
      if (latestReview !== undefined) {
        saveReview(campaign, latestReview, { immediate: true, keepalive: true }).catch(() => {});
      }
    };
    const windowObject = view.defaultView || globalThis;
    windowObject.addEventListener?.("pagehide", handlePageHide);
    windowObject.addEventListener?.("beforeunload", handlePageHide);
    detachDraftEvents = () => {
      windowObject.removeEventListener?.("pagehide", handlePageHide);
      windowObject.removeEventListener?.("beforeunload", handlePageHide);
      detachDraftEvents = null;
    };
  }

  function rMultipleLabel(campaign) {
    return globalThis.RMultipleUI?.formatCampaignR?.(campaign) || "R 待补充";
  }

  function renderPositionDetail() {
    renderCampaignDetail();
  }

  function render() {
    renderCampaignDetail();
  }

  function dispose() {
    clearTimeout(reviewTimer);
    detachScreenshotEvents?.();
    detachTagPickerEvents?.();
    detachDraftEvents?.();
    closeChoicePopover();
  }

  return { render, renderCampaignDetail, renderPositionDetail, saveReview, dispose };
}

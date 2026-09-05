import { RequestGate } from "../shared/js/api.mjs";
import { escapeAttr, escapeHtml, formatMoney } from "../shared/js/formatters.mjs";
import { mountShell } from "../shared/js/shell.mjs";
import { buildAlbumQuery, readAlbumState, writeAlbumState } from "./album-state.mjs";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ").slice(0, 16);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "-");
}

function sideLabel(side) {
  return side === "long" ? "多单" : side === "short" ? "空单" : side || "-";
}

function slug(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function createAlbumController({
  api,
  view = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
  onRefresh = null,
} = {}) {
  const gate = new RequestGate();
  let state = readAlbumState(location.search);
  let data = null;
  let loadTimer = null;
  let requestId = 0;

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

  function setHidden(id, hidden) {
    const node = getElement(id);
    if (node) node.hidden = hidden;
  }

  function commitState(partial) {
    state = { ...state, ...partial };
    writeAlbumState(state, { location, history });
  }

  function scheduleLoad() {
    if (typeof globalThis.clearTimeout === "function" && loadTimer !== null) {
      globalThis.clearTimeout(loadTimer);
    }
    loadTimer = typeof globalThis.setTimeout === "function"
      ? globalThis.setTimeout(() => load(), 220)
      : null;
  }

  async function load() {
    const currentRequestId = ++requestId;
    const query = buildAlbumQuery(state);
    setHidden("albumLoading", false);
    try {
      const payload = await gate.run("album", (signal) => (
        api.requestJson(`/api/review-album?${query}`, { signal })
      ));
      if (currentRequestId !== requestId) return;
      data = payload;
      state = { ...state, tags: payload?.filters?.tags || state.tags };
      syncFilterControls();
      commitState(state);
      renderFilters(payload?.available_filters || {});
      renderSummary(payload);
      renderDays(payload);
      showError("");
    } catch (error) {
      if (currentRequestId !== requestId) return;
      if (error && error.name === "AbortError") return;
      showError(error?.message || "画册读取失败");
      if (!data) {
        renderSummary({ total: 0, days: [] });
        renderDays({ days: [] });
      }
    } finally {
      if (currentRequestId === requestId) setHidden("albumLoading", true);
    }
  }

  function renderFilters(filters) {
    const symbolNode = getElement("albumSymbol");
    const currentSymbol = state.symbol;
    if (symbolNode) {
      symbolNode.innerHTML = `<option value="">全部品种</option>${(filters.symbols || [])
        .map((symbol) => `<option value="${escapeAttr(symbol)}">${escapeHtml(symbol)}</option>`)
        .join("")}`;
      symbolNode.value = currentSymbol;
    }

    const groups = new Map();
    (filters.tags || []).forEach((tag) => {
      const groupKey = tag.dimension === "custom_field" ? `field:${tag.field_id}` : tag.dimension;
      const title = String(tag.label || "标签").split(" / ")[0];
      if (!groups.has(groupKey)) groups.set(groupKey, { title, tags: [] });
      groups.get(groupKey).tags.push(tag);
    });

    const node = getElement("albumTagGroups");
    if (!node) return;
    node.innerHTML = [...groups.entries()]
      .map(
        ([groupKey, group]) => `
          <fieldset class="album-tag-group">
            <legend class="album-tag-group-title">${escapeHtml(group.title)}</legend>
            <div class="album-tag-options">
              ${group.tags
                .map((tag, index) => {
                  const inputId = `album-tag-${index}-${slug(groupKey)}`;
                  const checked = state.tags.includes(tag.key) ? "checked" : "";
                  return `
                    <div class="album-tag-option" style="--tag-color:${escapeAttr(tag.color || "#2bd4ff")}">
                      <input id="${inputId}" type="checkbox" value="${escapeAttr(tag.key)}" ${checked} />
                      <label for="${inputId}">${escapeHtml(String(tag.label).split(" / ").slice(1).join(" / "))}</label>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </fieldset>
        `,
      )
      .join("");

    if (typeof node.querySelectorAll !== "function") return;
    node.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        state = {
          ...state,
          tags: [...node.querySelectorAll("input:checked")].map((item) => item.value),
        };
        scheduleLoad();
      });
    });
  }

  function renderSummary(payload) {
    const total = Number(payload.total || 0);
    const trades = payload.trades || [];
    const netPnl = trades.reduce((sum, trade) => sum + Number(trade.net_pnl || 0), 0);
    setText("albumResultCount", `${total} 笔交易`);
    setText("albumDayCount", `${(payload.days || []).length} 个交易日`);
    const pnlNode = getElement("albumNetPnl");
    if (pnlNode) {
      pnlNode.textContent = formatMoney(netPnl);
      pnlNode.className = netPnl > 0 ? "profit" : netPnl < 0 ? "loss" : "";
    }
  }

  function renderDays(payload) {
    const days = payload.days || [];
    const emptyNode = getElement("albumEmpty");
    if (emptyNode) emptyNode.hidden = days.length > 0;
    const node = getElement("albumDays");
    if (!node) return;
    if (!days.length) {
      node.innerHTML = "";
      return;
    }
    const customFields = payload.available_filters?.custom_fields || [];
    node.innerHTML = days.map((day) => renderDay(day, customFields)).join("");
    bindCardInteractions();
  }

  function renderDay(day, customFields) {
    return `
      <section class="album-day">
        <header class="album-day-head">
          <div>
            <p class="eyebrow">BEIJING CLOSE DATE</p>
            <h2>${escapeHtml(day.date)}</h2>
          </div>
          <div class="album-day-meta">
            <span>${day.order_count} 笔</span>
            <strong class="${Number(day.net_pnl) < 0 ? "loss" : ""}">${escapeHtml(formatMoney(day.net_pnl))}</strong>
          </div>
        </header>
        <div class="album-card-list">
          ${(day.trades || []).map((trade) => renderCard(trade, customFields)).join("")}
        </div>
      </section>
    `;
  }

  function renderCard(trade, fields) {
    const pnl = Number(trade.net_pnl || 0);
    const screenshot = trade.screenshot_url
      ? `<button class="album-image-trigger" type="button" data-shot="${escapeAttr(trade.screenshot_url)}" data-caption="${escapeAttr(`${trade.symbol} · ${formatDateTime(trade.close_time_bj)}`)}" title="查看原图">
          <img src="${escapeAttr(trade.screenshot_url)}" loading="lazy" alt="${escapeAttr(`${trade.symbol} 交易截图`)}" />
        </button>`
      : `<div class="album-shot-missing"><strong>截图待补</strong><span>该订单仍在画册中，打开订单详情后可以补充截图。</span></div>`;
    return `
      <article class="album-card" data-trade-id="${escapeAttr(trade.id)}">
        <figure class="album-shot">${screenshot}</figure>
        <div class="album-meta">
          <div class="album-meta-top">
            <div>
              <strong>${escapeHtml(trade.symbol || "未知品种")}</strong>
              <small>${escapeHtml(formatDateTime(trade.close_time_bj))} · ${escapeHtml(trade.display_order_no || trade.id)}</small>
            </div>
            <span class="album-pnl ${pnl > 0 ? "profit" : pnl < 0 ? "loss" : ""}">${escapeHtml(formatMoney(pnl))}</span>
          </div>
          <div class="album-core-grid">
            <div><span>方向</span><strong>${escapeHtml(sideLabel(trade.side))}</strong></div>
            <div><span>手数</span><strong>${escapeHtml(String(trade.lots ?? "-"))}</strong></div>
            <div><span>开仓</span><strong>${escapeHtml(formatDateTime(trade.open_time_bj))}</strong></div>
            <div><span>持仓</span><strong>${escapeHtml(trade.duration_label || "-")}</strong></div>
          </div>
          <div class="album-tag-list">${(trade.album_tags || []).map(renderTag).join("") || '<span class="muted-mini">暂无选项标签</span>'}</div>
          ${renderCustomFields(trade, fields)}
          ${renderReview(trade.review_text)}
          <div class="album-card-actions">
            <a class="ghost-btn" href="/orders/?trade=${encodeURIComponent(trade.id)}">打开订单</a>
            ${trade.screenshot_url ? `<button class="ghost-btn album-image-trigger" type="button" data-shot="${escapeAttr(trade.screenshot_url)}" data-caption="${escapeAttr(`${trade.symbol} · ${formatDateTime(trade.close_time_bj)}`)}">查看大图</button>` : ""}
          </div>
        </div>
      </article>
    `;
  }

  function renderReview(text) {
    if (!text) return '<div class="muted-mini">暂无复盘内容</div>';
    const review = String(text);
    return `<div class="album-review album-review-expanded"><span class="album-review-label">复盘内容</span><p>${escapeHtml(review)}</p></div>`;
  }

  function renderTag(tag) {
    return `<span class="album-tag" style="--tag-color:${escapeAttr(tag.color || "#2bd4ff")}">${escapeHtml(tag.label)}</span>`;
  }

  function renderCustomFields(trade, fields) {
    const items = fields
      .map((field) => {
        const rawValue = trade.custom_fields?.[String(field.id)];
        if (rawValue === undefined || rawValue === null || rawValue === "" || (Array.isArray(rawValue) && !rawValue.length)) return "";
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const optionMap = new Map((field.options || []).map((option) => [String(option.id), option.label]));
        const label = values.map((value) => optionMap.get(String(value)) || String(value)).join("、");
        return `<div class="album-custom-item"><dt>${escapeHtml(field.name)}</dt><dd>${escapeHtml(label)}</dd></div>`;
      })
      .filter(Boolean)
      .join("");
    return items ? `<dl class="album-custom-list">${items}</dl>` : "";
  }

  function bindCardInteractions() {
    if (typeof view.querySelectorAll !== "function") return;
    view.querySelectorAll(".album-image-trigger").forEach((button) => {
      button.addEventListener("click", () => openImageModal(button.dataset.shot, button.dataset.caption));
    });
    view.querySelectorAll(".album-shot img").forEach((image) => {
      image.addEventListener("error", () => {
        const figure = image.closest(".album-shot");
        if (figure) {
          figure.innerHTML = '<div class="album-shot-missing"><strong>截图加载失败</strong><span>可以重试刷新，或打开订单详情替换截图。</span></div>';
        }
      });
    });
  }

  function clearFilters() {
    state = { ...state, symbol: "", start: "", end: "", sort: "desc", tags: [] };
    syncFilterControls();
    load();
  }

  function syncFilterControls() {
    const symbol = getElement("albumSymbol");
    const start = getElement("albumStart");
    const end = getElement("albumEnd");
    const sort = getElement("albumSort");
    if (symbol) symbol.value = state.symbol;
    if (start) start.value = state.start;
    if (end) end.value = state.end;
    if (sort) sort.value = state.sort;
  }

  function showError(message) {
    setText("albumError", message);
    setHidden("albumError", !message);
  }

  function openImageModal(src, caption) {
    const modal = getElement("albumImageModal");
    if (!modal) return;
    const image = getElement("albumModalImage");
    const captionNode = getElement("albumModalCaption");
    if (image) image.src = src;
    if (captionNode) captionNode.textContent = caption || "交易截图";
    if (typeof modal.classList?.add === "function") modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeImageModal() {
    const modal = getElement("albumImageModal");
    if (!modal) return;
    if (typeof modal.classList?.remove === "function") modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    const image = getElement("albumModalImage");
    if (image) image.removeAttribute("src");
  }

  function init() {
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/album/", title: "复盘画册", onRefresh })
      : null;

    getElement("albumRefresh")?.addEventListener("click", () => load());
    getElement("albumClear")?.addEventListener("click", clearFilters);
    getElement("albumEmptyClear")?.addEventListener("click", clearFilters);
    getElement("albumSymbol")?.addEventListener("change", (event) => {
      state = { ...state, symbol: event.target.value };
      scheduleLoad();
    });
    getElement("albumStart")?.addEventListener("change", (event) => {
      state = { ...state, start: event.target.value };
      scheduleLoad();
    });
    getElement("albumEnd")?.addEventListener("change", (event) => {
      state = { ...state, end: event.target.value };
      scheduleLoad();
    });
    getElement("albumSort")?.addEventListener("change", (event) => {
      state = { ...state, sort: event.target.value };
      load();
    });
    getElement("albumImageClose")?.addEventListener("click", closeImageModal);
    getElement("albumImageModal")?.addEventListener("click", (event) => {
      if (event.target && event.target.id === "albumImageModal") closeImageModal();
    });
    if (typeof view.addEventListener === "function") {
      view.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeImageModal();
      });
    }

    const windowRef = globalThis.window || globalThis;
    windowRef.addEventListener?.("popstate", () => {
      state = readAlbumState(location.search);
      syncFilterControls();
      load();
    });

    syncFilterControls();
    return cleanup;
  }

  function dispose() {
    gate.abortAll();
    if (loadTimer !== null && typeof globalThis.clearTimeout === "function") {
      globalThis.clearTimeout(loadTimer);
    }
  }

  return {
    load,
    init,
    clearFilters,
    openImageModal,
    closeImageModal,
    dispose,
    getState: () => state,
  };
}

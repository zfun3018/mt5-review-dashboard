const state = {
  data: null,
  symbol: "",
  start: "",
  end: "",
  sort: "desc",
  tags: [],
  requestId: 0,
};

const money = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

document.addEventListener("DOMContentLoaded", () => {
  readUrlState();
  document.getElementById("albumRefresh").addEventListener("click", () => loadAlbum());
  document.getElementById("albumClear").addEventListener("click", clearFilters);
  document.getElementById("albumEmptyClear").addEventListener("click", clearFilters);
  document.getElementById("albumSymbol").addEventListener("change", (event) => {
    state.symbol = event.target.value;
    scheduleLoad();
  });
  document.getElementById("albumStart").addEventListener("change", (event) => {
    state.start = event.target.value;
    scheduleLoad();
  });
  document.getElementById("albumEnd").addEventListener("change", (event) => {
    state.end = event.target.value;
    scheduleLoad();
  });
  document.getElementById("albumSort").addEventListener("change", (event) => {
    state.sort = event.target.value;
    loadAlbum();
  });
  document.getElementById("albumImageClose").addEventListener("click", closeImageModal);
  document.getElementById("albumImageModal").addEventListener("click", (event) => {
    if (event.target.id === "albumImageModal") closeImageModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageModal();
  });
  window.addEventListener("popstate", () => {
    readUrlState();
    syncFilterControls();
    loadAlbum();
  });
  syncFilterControls();
  loadAlbum();
});

let loadTimer;
function scheduleLoad() {
  window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => loadAlbum(), 220);
}

async function loadAlbum() {
  const requestId = ++state.requestId;
  const params = new URLSearchParams();
  if (state.symbol) params.set("symbol", state.symbol);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.tags.length) params.set("tag", state.tags.join(","));
  params.set("sort", state.sort);
  params.set("page", "1");
  params.set("page_size", "100");
  setLoading(true);
  try {
    const response = await fetch(`/api/review-album?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
    if (requestId !== state.requestId) return;
    state.data = data;
    state.tags = data.filters?.tags || state.tags;
    syncFilterControls();
    updateUrl();
    renderFilters(data.available_filters || {});
    renderSummary(data);
    renderDays(data);
    showError("");
  } catch (error) {
    if (requestId !== state.requestId) return;
    showError(error.message || "画册读取失败");
    if (!state.data) {
      renderSummary({ total: 0, days: [] });
      renderDays({ days: [] });
    }
  } finally {
    if (requestId === state.requestId) setLoading(false);
  }
}

function renderFilters(filters) {
  const symbolNode = document.getElementById("albumSymbol");
  const currentSymbol = state.symbol;
  symbolNode.innerHTML = `<option value="">全部品种</option>${(filters.symbols || [])
    .map((symbol) => `<option value="${escapeAttr(symbol)}">${escapeHtml(symbol)}</option>`)
    .join("")}`;
  symbolNode.value = currentSymbol;

  const groups = new Map();
  (filters.tags || []).forEach((tag) => {
    const groupKey = tag.dimension === "custom_field" ? `field:${tag.field_id}` : tag.dimension;
    const title = String(tag.label || "标签").split(" / ")[0];
    if (!groups.has(groupKey)) groups.set(groupKey, { title, tags: [] });
    groups.get(groupKey).tags.push(tag);
  });
  const node = document.getElementById("albumTagGroups");
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
  node.querySelectorAll("input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", () => {
      state.tags = [...node.querySelectorAll("input:checked")].map((item) => item.value);
      scheduleLoad();
    });
  });
}

function renderSummary(data) {
  const total = Number(data.total || 0);
  const trades = data.trades || [];
  const netPnl = trades.reduce((sum, trade) => sum + Number(trade.net_pnl || 0), 0);
  const countNode = document.getElementById("albumResultCount");
  countNode.textContent = `${total} 笔交易`;
  document.getElementById("albumDayCount").textContent = `${(data.days || []).length} 个交易日`;
  const pnlNode = document.getElementById("albumNetPnl");
  pnlNode.textContent = formatMoney(netPnl);
  pnlNode.className = netPnl > 0 ? "profit" : netPnl < 0 ? "loss" : "";
}

function renderDays(data) {
  const days = data.days || [];
  const node = document.getElementById("albumDays");
  document.getElementById("albumEmpty").hidden = days.length > 0;
  if (!days.length) {
    node.innerHTML = "";
    return;
  }
  node.innerHTML = days
    .map(
      (day) => `
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
            ${(day.trades || []).map((trade) => renderCard(trade, data.available_filters?.custom_fields || [])).join("")}
          </div>
        </section>
      `,
    )
    .join("");
  bindCardInteractions();
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
          <a class="ghost-btn" href="/?trade=${encodeURIComponent(trade.id)}">打开订单</a>
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
  document.querySelectorAll(".album-image-trigger").forEach((button) => {
    button.addEventListener("click", () => openImageModal(button.dataset.shot, button.dataset.caption));
  });
  document.querySelectorAll(".album-shot img").forEach((image) => {
    image.addEventListener("error", () => {
      const figure = image.closest(".album-shot");
      figure.innerHTML = '<div class="album-shot-missing"><strong>截图加载失败</strong><span>可以重试刷新，或打开订单详情替换截图。</span></div>';
    });
  });
}

function clearFilters() {
  state.symbol = "";
  state.start = "";
  state.end = "";
  state.sort = "desc";
  state.tags = [];
  syncFilterControls();
  loadAlbum();
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  state.symbol = params.get("symbol") || "";
  state.start = params.get("start") || "";
  state.end = params.get("end") || "";
  state.sort = params.get("sort") === "asc" ? "asc" : "desc";
  state.tags = (params.get("tag") || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.symbol) params.set("symbol", state.symbol);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.tags.length) params.set("tag", state.tags.join(","));
  if (state.sort !== "desc") params.set("sort", state.sort);
  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", next);
}

function syncFilterControls() {
  document.getElementById("albumSymbol").value = state.symbol;
  document.getElementById("albumStart").value = state.start;
  document.getElementById("albumEnd").value = state.end;
  document.getElementById("albumSort").value = state.sort;
}

function setLoading(isLoading) {
  document.getElementById("albumLoading").hidden = !isLoading;
}

function showError(message) {
  const node = document.getElementById("albumError");
  node.textContent = message;
  node.hidden = !message;
}

function openImageModal(src, caption) {
  const modal = document.getElementById("albumImageModal");
  document.getElementById("albumModalImage").src = src;
  document.getElementById("albumModalCaption").textContent = caption || "交易截图";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeImageModal() {
  const modal = document.getElementById("albumImageModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.getElementById("albumModalImage").removeAttribute("src");
}

function formatMoney(value) {
  return money.format(Number(value || 0));
}

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

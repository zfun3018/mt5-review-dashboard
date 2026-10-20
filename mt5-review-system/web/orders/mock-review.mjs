import { formatBeijingDateTime } from "../shared/js/formatters.mjs";

const orders = [
  {
    id: "order-01",
    opened: "2026-10-16 09:42",
    symbol: "XAUUSD",
    side: "多单",
    pnl: 286.4,
    r: 2.14,
    volume: "1.20 手",
    holding: "1 小时 48 分",
    initialStop: "2656.10",
    scene: ["回调进场"],
    strategy: ["突破回踩"],
    mistakes: ["加仓过早"],
    review: "入场符合计划，第一次减仓有效降低了持仓压力。后续需要把加仓条件写得更明确，避免在波动扩大时追价。",
    records: [
      ["09:42", "open", "开仓 0.60 手", "@ 2661.20 · 初始仓位"],
      ["10:03", "add", "加仓 0.30 手", "@ 2663.10 · 持仓 0.90 手"],
      ["10:19", "add", "加仓 0.30 手", "@ 2664.80 · 持仓 1.20 手"],
      ["10:46", "reduce", "减仓 0.40 手", "@ 2671.30 · 锁定部分利润"],
      ["11:30", "close", "平仓 0.80 手", "@ 2675.50 · 订单完成"],
    ],
  },
  {
    id: "order-02",
    opened: "2026-10-15 14:08",
    symbol: "EURUSD",
    side: "空单",
    pnl: -94.2,
    r: -0.72,
    volume: "0.80 手",
    holding: "36 分钟",
    initialStop: null,
    scene: ["反转试单"],
    strategy: ["区间上沿"],
    mistakes: ["逆势交易", "未等确认"],
    review: "反转信号不够完整，止损执行正常。复盘重点是减少逆势试单，并给高周期方向更高权重。",
    records: [
      ["14:08", "open", "开仓 0.50 手", "@ 1.16842 · 初始仓位"],
      ["14:14", "add", "加仓 0.30 手", "@ 1.16820 · 持仓 0.80 手"],
      ["14:44", "close", "平仓 0.80 手", "@ 1.16912 · 触发止损"],
    ],
  },
  {
    id: "order-03",
    opened: "2026-10-14 10:26",
    symbol: "NAS100",
    side: "多单",
    pnl: 512.8,
    r: 1.67,
    volume: "0.40 手",
    holding: "2 小时 12 分",
    initialStop: "20540.00",
    scene: ["趋势跟随"],
    strategy: ["均线回踩"],
    mistakes: ["无明显错误"],
    review: "仓位节奏稳定，减仓后保留底仓的处理较好。可以继续观察不同波动率下的持仓比例。",
    records: [
      ["10:26", "open", "开仓 0.40 手", "@ 20572.4 · 初始仓位"],
      ["11:48", "reduce", "减仓 0.10 手", "@ 20628.7 · 锁定利润"],
      ["12:38", "close", "平仓 0.30 手", "@ 20684.1 · 订单完成"],
    ],
  },
  {
    id: "order-04",
    opened: "2026-10-13 16:51",
    symbol: "GBPJPY",
    side: "空单",
    pnl: 164.6,
    r: 0.93,
    volume: "0.60 手",
    holding: "52 分钟",
    initialStop: null,
    scene: ["顺势突破"],
    strategy: ["通道破位"],
    mistakes: ["减仓偏晚"],
    review: "突破后的跟随执行较完整，下一次可以在第一目标位提前落袋一部分。",
    records: [
      ["16:51", "open", "开仓 0.60 手", "@ 202.842 · 初始仓位"],
      ["17:21", "reduce", "减仓 0.20 手", "@ 202.610 · 部分止盈"],
      ["17:43", "close", "平仓 0.40 手", "@ 202.420 · 订单完成"],
    ],
  },
  {
    id: "order-05",
    opened: "2026-10-12 08:17",
    symbol: "XAUUSD",
    side: "空单",
    pnl: -38.5,
    r: -0.31,
    volume: "0.50 手",
    holding: "24 分钟",
    initialStop: "2660.00",
    scene: ["震荡区间"],
    strategy: ["区间反弹"],
    mistakes: ["入场位置一般", "区间中部交易"],
    review: "交易结果可控，但入场位置没有优势。下一步只在区间边缘出现确认信号时执行。",
    records: [
      ["08:17", "open", "开仓 0.50 手", "@ 2653.60 · 初始仓位"],
      ["08:41", "close", "平仓 0.50 手", "@ 2655.10 · 手动退出"],
    ],
  },
  {
    id: "order-06",
    opened: "2026-10-11 13:35",
    symbol: "USDJPY",
    side: "多单",
    pnl: 78.1,
    r: 0.54,
    volume: "0.30 手",
    holding: "1 小时 06 分",
    initialStop: "151.10",
    scene: ["消息后跟随"],
    strategy: ["回撤确认"],
    mistakes: ["无明显错误"],
    review: "消息波动后的回撤确认较清晰，仓位偏轻，结果符合预期。",
    records: [
      ["13:35", "open", "开仓 0.30 手", "@ 151.280 · 初始仓位"],
      ["14:41", "close", "平仓 0.30 手", "@ 151.540 · 订单完成"],
    ],
  },
];

orders.forEach((order) => {
  order.screenshotAvailable = true;
  order.screenshotStatus = "原始交易截图 · 模拟数据";
});

const MOCK_DRAFT_STORAGE_KEY = "mt5-review-mock-order-drafts:v1";

function readMockDrafts() {
  try {
    const raw = window.localStorage.getItem(MOCK_DRAFT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeDraftTags(value, single = false) {
  if (!Array.isArray(value)) return [];
  const tags = [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
  return single ? tags.slice(0, 1) : tags;
}

function restoreMockDrafts() {
  const drafts = readMockDrafts();
  orders.forEach((order) => {
    const draft = drafts[order.id];
    if (!draft || typeof draft !== "object") return;
    if (typeof draft.initialStop === "string" || draft.initialStop === null) order.initialStop = draft.initialStop;
    if (Array.isArray(draft.scene)) order.scene = normalizeDraftTags(draft.scene, true);
    if (Array.isArray(draft.strategy)) order.strategy = normalizeDraftTags(draft.strategy, true);
    if (Array.isArray(draft.mistakes)) order.mistakes = normalizeDraftTags(draft.mistakes);
    if (typeof draft.review === "string") order.review = draft.review;
  });
}

function persistMockDraft(order) {
  try {
    const drafts = readMockDrafts();
    drafts[order.id] = {
      initialStop: order.initialStop,
      scene: normalizeDraftTags(order.scene, true),
      strategy: normalizeDraftTags(order.strategy, true),
      mistakes: normalizeDraftTags(order.mistakes),
      review: String(order.review || ""),
    };
    window.localStorage.setItem(MOCK_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Private browsing or blocked storage should not break the mock page.
  }
}

restoreMockDrafts();

const list = document.querySelector("#orderList");
const detail = document.querySelector("#detailPanel");
const search = document.querySelector("#orderSearch");
const clearSearch = document.querySelector("#clearSearch");
const count = document.querySelector("#orderCount");
let selectedId = orders[0].id;
const screenshotHistory = new Map();

function money(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function number(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function compactTime(value) {
  return formatBeijingDateTime(`${value.replace(" ", "T")}:00+08:00`);
}

function hasScaleIn(order) {
  return order.records.some((record) => record[1] === "add");
}

function hasInitialStop(order) {
  return order.initialStop !== null && order.initialStop !== undefined && String(order.initialStop).trim() !== "";
}

function screenshotSnapshot(order) {
  return {
    available: Boolean(order.screenshotAvailable),
    dataUrl: order.screenshotDataUrl || "",
    status: order.screenshotStatus || "",
  };
}

function rememberScreenshot(order) {
  const history = screenshotHistory.get(order.id) || [];
  history.push(screenshotSnapshot(order));
  screenshotHistory.set(order.id, history);
}

function undoScreenshot(order) {
  const history = screenshotHistory.get(order.id) || [];
  const previous = history.pop();
  if (!previous) return false;
  order.screenshotAvailable = previous.available;
  order.screenshotDataUrl = previous.dataUrl;
  order.screenshotStatus = previous.status;
  renderDetail();
  return true;
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

const sceneOptions = ["回调进场", "反转试单", "趋势跟随", "顺势突破", "震荡区间", "消息后跟随"];
const strategyOptions = ["突破回踩", "区间上沿", "均线回踩", "通道破位", "区间反弹", "回撤确认"];
const mistakeOptions = ["加仓过早", "逆势交易", "未等确认", "入场位置一般", "区间中部交易", "减仓偏晚", "仓位过重", "止损执行偏晚", "无明显错误"];
const singleSelectGroups = new Set(["scene", "strategy"]);

function isSingleSelectGroup(group) {
  return singleSelectGroups.has(group);
}

function selectedValues(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function recordRows(order) {
  const orderIndex = orders.indexOf(order);
  const typeLabels = { open: "开仓", add: "加仓", reduce: "减仓", close: "平仓" };
  const direction = order.side === "多单" ? "多" : "空";
  const firstEntryPrice = Number(order.records.find((record) => record[1] === "open")?.[3].match(/@\s*([\d.]+)/)?.[1]);
  return order.records.map(([time, type, title, note], index) => {
    const volume = title.match(/(\d+(?:\.\d+)?)\s*手/)?.[1] || "-";
    const price = note.match(/@\s*([\d.]+)/)?.[1] || "-";
    const isOpening = type === "open" || type === "add";
    const priceNumber = Number(price);
    const points = !isOpening && Number.isFinite(firstEntryPrice) && Number.isFinite(priceNumber)
      ? `${((priceNumber - firstEntryPrice) * (order.side === "多单" ? 1 : -1) >= 0 ? "+" : "")}${((priceNumber - firstEntryPrice) * (order.side === "多单" ? 1 : -1)).toFixed(2)}`
      : "—";
    const netProfit = type === "close"
      ? money(order.pnl)
      : type === "reduce"
        ? money(order.pnl * 0.32)
        : "—";
    return {
      type,
      typeLabel: typeLabels[type] || type,
      direction,
      time: formatBeijingDateTime(`${order.opened.slice(0, 10)}T${time}:00+08:00`),
      openPrice: isOpening ? price : (Number.isFinite(firstEntryPrice) ? firstEntryPrice.toFixed(2) : "—"),
      closePrice: isOpening ? "—" : price,
      volume,
      points,
      netProfit,
      sequence: index + orderIndex * 1000,
    };
  });
}

function closeOpenMultiSelects() {
  detail.querySelectorAll(".multi-select.is-open").forEach((picker) => {
    picker.classList.remove("is-open");
    picker.querySelector(".choice-popover")?.classList.add("hidden");
    picker.querySelector("[data-multi-trigger]")?.setAttribute("aria-expanded", "false");
  });
}

function renderMultiSelect(options, selected, group, placeholder) {
  const selectedValuesForGroup = selectedValues(selected);
  const singleSelect = isSingleSelectGroup(group);
  return `
    <div class="multi-select" data-multi-select="${group}">
      <button id="${group}Input" class="choice-cell detail-choice" type="button" aria-haspopup="listbox" aria-expanded="false" data-multi-trigger="${group}" title="选择${escapeHtml(placeholder)}">
        <span class="choice-cell-values">
          ${selectedValuesForGroup.length ? selectedValuesForGroup.map((value) => `<span class="choice-value-pill">${escapeHtml(value)}</span>`).join("") : '<span class="choice-placeholder">点击选择</span>'}
        </span>
        <span class="cell-caret" aria-hidden="true">v</span>
      </button>
      <div class="choice-popover hidden" role="dialog" aria-label="${escapeHtml(placeholder)}" data-multi-menu="${group}">
        <div class="choice-popover-title"><strong>${escapeHtml(placeholder)}</strong><span>${singleSelect ? "单选" : "可多选"}</span></div>
        <input class="choice-search" type="search" placeholder="查找选项" data-multi-search="${group}" />
        <div class="choice-options">
          <button class="choice-option muted-choice" type="button" data-multi-clear="${group}">清空</button>
        ${options.map((option) => {
          const isSelected = selectedValuesForGroup.includes(option);
          return `<button class="choice-option multi-select-option ${isSelected ? "selected" : ""}" type="button" role="option" aria-selected="${isSelected}" data-multi-option="${group}" data-value="${escapeHtml(option)}"><span class="choice-option-dot"></span><span>${escapeHtml(option)}</span></button>`;
        }).join("")}
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderList() {
  const query = search.value.trim().toLowerCase();
  const visible = orders.filter((order) => order.opened.toLowerCase().includes(query));
  count.textContent = `${visible.length} 笔`;
  list.innerHTML = visible.length
    ? visible.map((order) => `
      <button class="order-row ${order.id === selectedId ? "active" : ""} ${hasInitialStop(order) ? "" : "stop-missing"}" type="button" data-order-id="${order.id}" aria-label="${compactTime(order.opened)} ${number(order.r)} ${money(order.pnl)}">
        <time>${compactTime(order.opened)}</time>
        <span class="row-flags">
          ${hasScaleIn(order) ? '<span class="row-flag scale-in" title="组合订单，包含加仓记录" aria-label="组合订单，包含加仓">组</span>' : ""}
          ${hasInitialStop(order) ? "" : '<span class="row-flag stop-missing" title="初始止损未填写" aria-label="初始止损未填写">!</span>'}
        </span>
        <span class="r-value">${number(order.r)}</span>
        <strong class="pnl ${order.pnl >= 0 ? "positive" : "negative"}">${money(order.pnl)}</strong>
      </button>
    `).join("")
    : `<div class="empty-state">没有匹配的主订单</div>`;
  list.querySelectorAll("[data-order-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedId = button.dataset.orderId;
      renderList();
      renderDetail();
    });
  });
}

function drawChart(order) {
  const canvas = document.querySelector("#tradeCanvas");
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = rect.height;
  const pad = { top: 50, right: 22, bottom: 28, left: 18 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const candles = 46;
  const base = order.side === "多单" ? 0.62 : 0.42;
  const points = Array.from({ length: candles }, (_, index) => {
    const wave = Math.sin(index / 4.1) * 0.13 + Math.sin(index / 1.9) * 0.035;
    const drift = order.pnl >= 0 ? index * 0.004 : -index * 0.003;
    return base + wave + drift;
  });
  const valueY = (value) => pad.top + (1 - value) * chartHeight;

  ctx.fillStyle = "#08121c";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(151,177,201,0.12)";
  ctx.lineWidth = 1;
  for (let row = 0; row < 5; row += 1) {
    const y = pad.top + row * (chartHeight / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
  }
  for (let column = 0; column < 7; column += 1) {
    const x = pad.left + column * (chartWidth / 6);
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, height - pad.bottom); ctx.stroke();
  }

  const candleWidth = chartWidth / candles;
  points.forEach((value, index) => {
    const x = pad.left + index * candleWidth + candleWidth / 2;
    const open = value + Math.sin(index * 2.2) * 0.018;
    const close = value - Math.cos(index * 1.7) * 0.022;
    const high = Math.min(0.94, Math.max(open, close) + 0.035 + (index % 3) * 0.008);
    const low = Math.max(0.08, Math.min(open, close) - 0.035 - (index % 4) * 0.006);
    const rising = close < open;
    ctx.strokeStyle = rising ? "#55d69b" : "#ff7d81";
    ctx.fillStyle = rising ? "rgba(85,214,155,0.72)" : "rgba(255,125,129,0.72)";
    ctx.beginPath(); ctx.moveTo(x, valueY(high)); ctx.lineTo(x, valueY(low)); ctx.stroke();
    const bodyTop = valueY(Math.max(open, close));
    const bodyHeight = Math.max(3, Math.abs(valueY(open) - valueY(close)));
    ctx.fillRect(x - candleWidth * 0.28, bodyTop, candleWidth * 0.56, bodyHeight);
  });

  const markers = order.records.filter((record) => record[1] !== "add");
  markers.forEach((record, index) => {
    const x = pad.left + (8 + index * 8) * candleWidth + candleWidth / 2;
    const y = valueY(points[Math.min(candles - 1, 8 + index * 8)]);
    const color = record[1] === "reduce" ? "#f2bd68" : record[1] === "close" ? "#55d69b" : "#64b5ff";
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, height - 15); ctx.stroke(); ctx.globalAlpha = 1;
  });
}

function renderDetail() {
  const order = orders.find((item) => item.id === selectedId) || orders[0];
  const stopFilled = hasInitialStop(order);
  const openedLabel = compactTime(order.opened);
  detail.innerHTML = `
    <div class="detail-inner">
      <header class="detail-topline">
        <div>
          <p class="eyebrow">主订单 · ${escapeHtml(openedLabel)}</p>
          <h2>${escapeHtml(order.symbol)} · ${escapeHtml(order.side)}</h2>
          <div class="detail-meta"><span>开仓 <strong>${escapeHtml(openedLabel)}</strong></span><span>总仓位 <strong>${escapeHtml(order.volume)}</strong></span><span>持仓 <strong>${escapeHtml(order.holding)}</strong></span></div>
        </div>
        <div class="hero-pnl"><span>主订单盈亏</span><strong class="${order.pnl >= 0 ? "positive" : "negative"}">${money(order.pnl)}</strong></div>
      </header>

      <form id="orderForm" class="order-form order-info-form">
        <div class="order-form-head"><h3>主订单信息</h3><span>编辑后保存</span></div>
        <div class="order-info-fields">
          <div class="form-field stop-field ${stopFilled ? "" : "missing"}">
            <div class="field-label-row"><label for="initialStop">初始止损</label><span>${stopFilled ? "已填写" : "待填写"}</span></div>
            <div class="inline-stop-editor ${stopFilled ? "" : "missing"}">
              <input id="initialStop" name="initialStop" class="numeric-cell-input" type="number" step="0.01" inputmode="decimal" value="${stopFilled ? escapeHtml(order.initialStop) : ""}" placeholder="请输入初始止损" />
            </div>
            <span class="form-hint ${stopFilled ? "" : "warning"}">${stopFilled ? "主订单 R 可正常计算" : "未填写，左侧订单会持续提醒"}</span>
          </div>
          <div class="tag-field">
            <label class="field-label" for="sceneInput">交易场景 <small>可多选</small></label>
            ${renderMultiSelect(sceneOptions, order.scene, "scene", "选择交易场景")}
          </div>
          <div class="tag-field">
            <label class="field-label" for="strategyInput">交易策略 <small>可多选</small></label>
            ${renderMultiSelect(strategyOptions, order.strategy, "strategy", "选择交易策略")}
          </div>
          <div class="tag-field">
            <label class="field-label" for="mistakesInput">犯错标签 <small>可多选</small></label>
            ${renderMultiSelect(mistakeOptions, order.mistakes, "mistakes", "选择犯错标签")}
          </div>
          <div class="form-actions"><span id="saveState" class="save-state" aria-live="polite">自动保存已开启</span></div>
        </div>
      </form>

      <div class="hero-grid">
        <section class="screenshot-stage ${order.screenshotAvailable ? "" : "screenshot-missing"}" aria-label="交易截图模拟">
          ${order.screenshotDataUrl ? `<img id="tradeImage" src="${escapeHtml(order.screenshotDataUrl)}" alt="交易截图" />` : order.screenshotAvailable ? '<canvas id="tradeCanvas"></canvas>' : '<div class="screenshot-empty"><strong>暂无交易截图</strong><span>点击“替换截图”恢复模拟图片</span></div>'}
          <div class="chart-label"><strong>${escapeHtml(order.symbol)}</strong><br />M5 · 交易截图模拟</div>
          <div class="chart-badge">${order.pnl >= 0 ? "订单完成 · 盈利" : "订单完成 · 亏损"}</div>
          <div class="screenshot-toolbar">
            <span class="screenshot-status">${escapeHtml(order.screenshotStatus)}</span>
            <button id="replaceScreenshot" class="ghost-button" type="button">替换</button>
            <input id="screenshotFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
            <button id="deleteScreenshot" class="ghost-button danger-button" type="button" ${order.screenshotAvailable ? "" : "disabled"}>删除</button>
          </div>
        </section>

        <section class="detail-section review-section">
          <div class="section-head"><h3>复盘记录</h3><span id="reviewCount">${order.review.length} / 10000</span></div>
          <textarea id="reviewText" name="review" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(order.review)}</textarea>
        </section>
      </div>

      <section class="summary-strip" aria-label="主订单摘要">
        <div class="summary-item"><span>主订单 R</span><strong class="${order.r >= 0 ? "positive" : "negative"}">${number(order.r)}</strong></div>
        <div class="summary-item"><span>仓位记录</span><strong>${order.records.length} 条</strong></div>
        <div class="summary-item"><span>总仓位</span><strong>${escapeHtml(order.volume)}</strong></div>
        <div class="summary-item"><span>持仓时间</span><strong>${escapeHtml(order.holding)}</strong></div>
      </section>

      <section class="detail-section position-section">
          <div class="section-head"><h3>成交流水</h3><span>仅展示执行过程，不单独复盘</span></div>
          <div class="execution-table-wrap">
            <table class="execution-table">
              <thead><tr><th>类型 / 方向</th><th>时间 · 北京</th><th>开仓价格</th><th>平仓价格</th><th>手数</th><th>盈利点数</th><th>净盈亏</th></tr></thead>
              <tbody>
                ${recordRows(order).map((record) => `
                  <tr>
                    <td><span class="execution-type ${record.type}">${record.typeLabel}</span><span class="execution-side ${record.direction === "多" ? "long" : "short"}">${record.direction}</span></td>
                    <td class="mono-cell">${record.time}</td>
                    <td class="mono-cell">${record.openPrice}</td>
                    <td class="mono-cell">${record.closePrice}</td>
                    <td class="mono-cell">${record.volume}</td>
                    <td class="mono-cell ${record.points.startsWith("+") ? "positive" : record.points.startsWith("-") ? "negative" : "muted"}">${record.points}</td>
                    <td class="mono-cell ${record.netProfit.startsWith("+") ? "positive" : record.netProfit.startsWith("-") ? "negative" : "muted"}">${record.netProfit}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
      </section>
    </div>
  `;
  drawChart(order);
  function setSaveState(message = "已自动保存") {
    const state = detail.querySelector("#saveState");
    if (state) state.textContent = message;
  }

  function updateStopState() {
    const filled = hasInitialStop(order);
    detail.querySelector(".stop-field")?.classList.toggle("missing", !filled);
    detail.querySelector(".inline-stop-editor")?.classList.toggle("missing", !filled);
    const state = detail.querySelector(".stop-field .field-label-row span");
    if (state) state.textContent = filled ? "已填写" : "待填写";
  }

  function syncMainOrderFields() {
    order.initialStop = detail.querySelector("#initialStop")?.value.trim() || null;
    order.scene = Array.from(detail.querySelectorAll('[data-multi-option="scene"].selected')).map((item) => item.dataset.value);
    order.strategy = Array.from(detail.querySelectorAll('[data-multi-option="strategy"].selected')).map((item) => item.dataset.value);
    order.mistakes = Array.from(detail.querySelectorAll('[data-multi-option="mistakes"].selected')).map((item) => item.dataset.value);
    persistMockDraft(order);
    updateStopState();
    renderList();
    setSaveState();
  }

  function updateMultiSelect(group) {
    const picker = detail.querySelector(`[data-multi-select="${group}"]`);
    if (!picker) return;
    const values = Array.from(picker.querySelectorAll(".multi-select-option.selected")).map((item) => item.dataset.value);
    const valuesNode = picker.querySelector(".choice-cell-values");
    if (valuesNode) valuesNode.innerHTML = values.length
      ? values.map((value) => `<span class="choice-value-pill">${escapeHtml(value)}</span>`).join("")
      : '<span class="choice-placeholder">点击选择</span>';
  }

  detail.querySelectorAll("[data-multi-trigger]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const picker = trigger.closest(".multi-select");
      const isOpen = picker.classList.contains("is-open");
      closeOpenMultiSelects();
      if (!isOpen) {
        picker.classList.add("is-open");
        const popover = picker.querySelector(".choice-popover");
        const rect = trigger.getBoundingClientRect();
        const width = 292;
        popover.style.width = `${Math.min(width, window.innerWidth - 24)}px`;
        popover.style.left = `${Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))}px`;
        popover.style.top = `${Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 380))}px`;
        popover.classList.remove("hidden");
        trigger.setAttribute("aria-expanded", "true");
        popover.querySelector(".choice-search")?.focus();
      }
    });
  });
  detail.querySelectorAll(".multi-select-option").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      const group = option.dataset.multiOption;
      if (isSingleSelectGroup(group)) {
        detail.querySelectorAll(`[data-multi-option="${group}"]`).forEach((item) => {
          item.classList.remove("selected");
          item.setAttribute("aria-selected", "false");
        });
        option.classList.add("selected");
      } else {
        option.classList.toggle("selected");
      }
      option.setAttribute("aria-selected", option.classList.contains("selected"));
      updateMultiSelect(group);
      syncMainOrderFields();
    });
  });
  detail.querySelectorAll("[data-multi-clear]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const group = button.dataset.multiClear;
      detail.querySelectorAll(`[data-multi-option="${group}"]`).forEach((option) => {
        option.classList.remove("selected");
        option.setAttribute("aria-selected", "false");
      });
      updateMultiSelect(group);
      syncMainOrderFields();
    });
  });
  detail.querySelectorAll("[data-multi-search]").forEach((searchInput) => {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      const group = searchInput.dataset.multiSearch;
      detail.querySelectorAll(`[data-multi-option="${group}"]`).forEach((option) => {
        option.hidden = !option.dataset.value.toLowerCase().includes(query);
      });
    });
  });
  const reviewEditor = document.querySelector("#reviewText");
  const reviewCount = document.querySelector("#reviewCount");
  let reviewSaveTimer;
  reviewEditor?.addEventListener("input", () => {
    if (reviewCount) reviewCount.textContent = `${reviewEditor.value.length} / 10000`;
    order.review = reviewEditor.value;
    persistMockDraft(order);
    clearTimeout(reviewSaveTimer);
    reviewSaveTimer = setTimeout(() => {
      renderList();
      setSaveState();
    }, 600);
  });
  reviewEditor?.addEventListener("blur", () => {
    clearTimeout(reviewSaveTimer);
    order.review = reviewEditor.value;
    persistMockDraft(order);
    renderList();
    setSaveState();
  });
  const stopInput = document.querySelector("#initialStop");
  const saveStopInput = () => syncMainOrderFields();
  stopInput?.addEventListener("change", saveStopInput);
  stopInput?.addEventListener("blur", saveStopInput);
  stopInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      stopInput.blur();
    }
  });
  const screenshotFile = document.querySelector("#screenshotFile");
  const replaceScreenshot = async (file) => {
    if (!file?.type.startsWith("image/")) return;
    rememberScreenshot(order);
    order.screenshotDataUrl = await readImageFile(file);
    order.screenshotAvailable = true;
    order.screenshotStatus = "截图已替换 · 本地图片";
    renderDetail();
  };
  document.querySelector("#replaceScreenshot")?.addEventListener("click", () => screenshotFile?.click());
  screenshotFile?.addEventListener("change", () => {
    const file = screenshotFile.files?.[0];
    if (file) replaceScreenshot(file);
    screenshotFile.value = "";
  });
  document.querySelector("#deleteScreenshot")?.addEventListener("click", () => {
    rememberScreenshot(order);
    order.screenshotDataUrl = "";
    order.screenshotAvailable = false;
    order.screenshotStatus = "截图已删除 · 待补充";
    renderDetail();
  });
  const screenshotStage = document.querySelector(".screenshot-stage");
  screenshotStage?.addEventListener("paste", (event) => {
    const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
    if (!file) return;
    event.preventDefault();
    replaceScreenshot(file);
  });
  const saveOrderForm = (event) => {
    event.preventDefault();
    syncMainOrderFields();
    order.review = reviewEditor?.value || "";
    setSaveState();
  };
  document.querySelector("#orderForm")?.addEventListener("submit", saveOrderForm);
}

search.addEventListener("input", renderList);
clearSearch.addEventListener("click", () => { search.value = ""; renderList(); search.focus(); });
window.addEventListener("resize", () => drawChart(orders.find((item) => item.id === selectedId) || orders[0]));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".multi-select")) closeOpenMultiSelects();
});
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
  if (event.target.closest?.("textarea, input, select")) return;
  const order = orders.find((item) => item.id === selectedId);
  if (order && undoScreenshot(order)) event.preventDefault();
});
window.addEventListener("pagehide", () => {
  const order = orders.find((item) => item.id === selectedId);
  if (order) persistMockDraft(order);
});
renderList();
renderDetail();

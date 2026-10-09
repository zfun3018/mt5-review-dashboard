import { RequestGate } from "../shared/js/api.mjs";
import { showToast } from "../shared/js/feedback.mjs";
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

function isArchived(value) {
  return value === true || Number(value) === 1;
}

const CHECKIN_WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function monthCalendarOffset(dateValue) {
  const [year, month, day] = String(dateValue).split("-").map(Number);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

function shiftMonth(monthKey, offset) {
  const [year, month] = String(monthKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [year, month] = String(monthKey).split("-").map(Number);
  return `${year}年${month}月`;
}

function compareDates(left, right) {
  return String(left).localeCompare(String(right));
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
  let archivedData = null;
  let randomTrade = null;
  let randomCustomFields = [];
  let checkinData = null;
  let checkinMonth = "";
  let loadTimer = null;
  let requestId = 0;
  let albumView = "all";

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

  function renderIcons() {
    const lucide = globalThis.window?.lucide || globalThis.lucide;
    lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }

  function applyAlbumView() {
    const archived = albumView === "archived";
    setHidden("albumAllPanel", archived);
    setHidden("albumArchivedPanel", !archived);
    if (typeof view.querySelectorAll !== "function") return;
    view.querySelectorAll("[data-album-view]").forEach((button) => {
      const active = button.dataset.albumView === albumView;
      button.setAttribute?.("aria-selected", String(active));
      button.classList?.toggle("is-active", active);
      if (!button.classList) {
        button.className = active ? "album-view-tab is-active" : "album-view-tab";
      }
    });
  }

  function setView(nextView) {
    if (nextView !== "all" && nextView !== "archived") return albumView;
    albumView = nextView;
    applyAlbumView();
    renderSummary(albumView === "archived" ? archivedData : data);
    return albumView;
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
      const archivedQuery = query ? `${query}&archived=true` : "archived=true";
      const [payload, archivedPayload, checkinPayload] = await Promise.all([
        gate.run("album-all", (signal) => (
          api.requestJson(`/api/review-album?${query}`, { signal })
        )),
        gate.run("album-archived", (signal) => (
          api.requestJson(`/api/review-album?${archivedQuery}`, { signal })
        )),
        loadCheckinOverview(),
      ]);
      if (currentRequestId !== requestId) return;
      data = payload;
      archivedData = archivedPayload;
      checkinData = checkinPayload || checkinData;
      if (!checkinMonth) checkinMonth = String(checkinData?.today?.date || "").slice(0, 7);
      state = { ...state, tags: payload?.filters?.tags || state.tags };
      syncFilterControls();
      commitState(state);
      renderFilters(payload?.available_filters || {});
      renderSummary(albumView === "archived" ? archivedPayload : payload);
      renderCheckinHeatmap(checkinData);
      renderDays(payload, archivedPayload);
      showError("");
    } catch (error) {
      if (currentRequestId !== requestId) return;
      if (error && error.name === "AbortError") return;
      showError(error?.message || "画册读取失败");
      if (!data) {
        renderSummary({ total: 0, days: [] });
        renderDays({ days: [] }, { days: [] });
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
    payload = payload || { total: 0, trades: [], days: [] };
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

  function renderCheckinHeatmap(payload) {
    const heatmap = getElement("albumCheckinHeatmap");
    const summary = getElement("albumCheckinSummary");
    const goalInput = getElement("albumCheckinGoal");
    if (!heatmap || !summary) return;
    if (!payload) {
      summary.textContent = "打卡数据暂时不可用";
      summary.className = "album-checkin-summary";
      setText("albumCheckinMonthLabel", "暂无数据");
      setText("albumCheckinMonthSummary", "暂无本月统计");
      ["albumCheckinPrevious", "albumCheckinNext"].forEach((id) => {
        const button = getElement(id);
        if (button) button.disabled = true;
      });
      heatmap.innerHTML = '<div class="album-checkin-empty">打卡数据暂时不可用</div>';
      return;
    }
    const goal = Math.max(1, Number(payload?.daily_goal || 20));
    const today = payload?.today || { count: 0, completed: false };
    if (goalInput) goalInput.value = String(goal);
    summary.textContent = today.completed
      ? `今日已完成 ${today.count} / ${goal} 张，保持这个节奏。`
      : `今日已完成 ${today.count} / ${goal} 张，还差 ${Math.max(0, goal - today.count)} 张。`;
    summary.className = `album-checkin-summary${today.completed ? " is-complete" : ""}`;
    const days = payload?.days || [];
    const records = new Map(days.map((day) => [String(day.date), day]));
    const availableMonths = [...new Set(days.map((day) => String(day.date).slice(0, 7)))].sort();
    const todayDate = String(payload?.today?.date || days.at(-1)?.date || "");
    if (!checkinMonth) checkinMonth = todayDate.slice(0, 7);
    if (availableMonths.length && !availableMonths.includes(checkinMonth)) {
      checkinMonth = availableMonths.at(-1);
    }
    const currentMonth = checkinMonth || todayDate.slice(0, 7);
    const previousMonth = shiftMonth(currentMonth, -1);
    const nextMonth = shiftMonth(currentMonth, 1);
    const previousButton = getElement("albumCheckinPrevious");
    const nextButton = getElement("albumCheckinNext");
    if (previousButton) previousButton.disabled = !availableMonths.includes(previousMonth);
    if (nextButton) nextButton.disabled = !availableMonths.includes(nextMonth);
    setText("albumCheckinMonthLabel", monthLabel(currentMonth));

    const monthStart = `${currentMonth}-01`;
    const [year, month] = currentMonth.split("-").map(Number);
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const rangeStart = String(payload?.range?.start || days[0]?.date || monthStart);
    const rangeEnd = String(payload?.range?.end || todayDate || `${currentMonth}-${String(monthDays).padStart(2, "0")}`);
    const monthRecords = Array.from({ length: monthDays }, (_, index) => {
      const date = `${currentMonth}-${String(index + 1).padStart(2, "0")}`;
      return records.get(date) || { date, count: 0, goal, completed: false };
    });
    const monthTotal = monthRecords.reduce((sum, day) => sum + Number(day.count || 0), 0);
    const completedDays = monthRecords.filter((day) => Boolean(day.completed)).length;
    const monthSummary = getElement("albumCheckinMonthSummary");
    if (monthSummary) {
      monthSummary.textContent = `本月打卡 ${monthTotal} 张 · 达标 ${completedDays} 天 · 每日目标 ${goal} 张`;
      monthSummary.className = `album-checkin-month-summary${completedDays ? " has-progress" : ""}`;
    }

    const offset = monthCalendarOffset(monthStart);
    const blanks = Array.from({ length: offset }, () => '<span class="album-checkin-blank" aria-hidden="true"></span>').join("");
    const cells = monthRecords.map((day) => {
      const count = Number(day.count || 0);
      const complete = Boolean(day.completed);
      const outOfRange = compareDates(day.date, rangeStart) < 0;
      const future = compareDates(day.date, todayDate) > 0;
      const level = complete ? 4 : Math.min(3, Math.ceil((count / goal) * 3));
      const dayNumber = String(day.date).slice(-2).replace(/^0/, "");
      const unavailable = outOfRange || future;
      const statusText = complete ? " · 已达标" : future ? " · 尚未到达" : outOfRange ? " · 暂无历史数据" : "";
      return `<div class="album-checkin-cell level-${level}${complete ? " is-complete" : ""}${future ? " is-future" : ""}${outOfRange ? " is-unavailable" : ""}" role="gridcell" aria-disabled="${String(unavailable)}" title="${escapeAttr(`${day.date} · ${count} 张${statusText}`)}" aria-label="${escapeAttr(`${day.date}，${count} 张${complete ? "，已达标" : ""}`)}">
        <span class="album-checkin-day">${escapeHtml(dayNumber)}</span>
        <span class="album-checkin-count">${unavailable ? "·" : count || "·"}</span>
        ${complete ? '<i data-lucide="badge-check" aria-hidden="true"></i>' : ""}
      </div>`;
    }).join("");
    heatmap.innerHTML = `<section class="album-checkin-month" aria-label="${escapeAttr(monthLabel(currentMonth))}">
      <div class="album-checkin-weekdays" aria-hidden="true">${CHECKIN_WEEKDAYS.map((weekday) => `<span>${weekday}</span>`).join("")}</div>
      <div class="album-checkin-grid">${blanks}${cells}</div>
    </section>`;
    renderIcons();
  }

  function changeCheckinMonth(offset) {
    if (!checkinData) return;
    const target = shiftMonth(checkinMonth, offset);
    const availableMonths = [...new Set((checkinData.days || []).map((day) => String(day.date).slice(0, 7)))];
    if (!availableMonths.includes(target)) return;
    checkinMonth = target;
    renderCheckinHeatmap(checkinData);
  }

  function renderDays(payload, archivedPayload) {
    const days = payload.days || [];
    const archivedDays = archivedPayload?.days || [];
    setText("albumArchivedCount", `${Number(archivedPayload?.total || 0)} 笔`);
    setHidden("albumArchivedEmpty", archivedDays.length > 0);
    const archivedNode = getElement("albumArchivedDays");
    if (archivedNode) {
      const archivedFields = archivedPayload?.available_filters?.custom_fields || [];
      archivedNode.innerHTML = archivedDays
        .map((day) => renderDay(day, archivedFields, "archived"))
        .join("");
    }
    const emptyNode = getElement("albumEmpty");
    if (emptyNode) emptyNode.hidden = days.length > 0;
    const node = getElement("albumDays");
    if (node) {
      if (!days.length) {
        node.innerHTML = "";
      } else {
        const customFields = payload.available_filters?.custom_fields || [];
        node.innerHTML = days.map((day) => renderDay(day, customFields, "all")).join("");
      }
    }
    applyAlbumView();
    bindCardInteractions(getElement("albumAllPanel"));
    bindCardInteractions(getElement("albumArchivedPanel"));
    renderIcons();
  }

  function renderDay(day, customFields, context) {
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
          ${(day.trades || []).map((trade) => renderCard(trade, customFields, context)).join("")}
        </div>
      </section>
    `;
  }

  function renderCard(trade, fields, context = "album") {
    const pnl = Number(trade.net_pnl || 0);
    const archived = isArchived(trade.is_archived);
    const random = context === "random";
    const screenshot = trade.screenshot_url
      ? `<button class="album-image-trigger" type="button" data-shot="${escapeAttr(trade.screenshot_url)}" data-trade-id="${escapeAttr(trade.id)}" data-caption="${escapeAttr(`${trade.symbol} · ${formatDateTime(trade.close_time_bj)}`)}" title="打开阅读器">
          <img src="${escapeAttr(trade.screenshot_url)}" loading="lazy" alt="${escapeAttr(`${trade.symbol} 交易截图`)}" />
        </button>`
      : `<div class="album-shot-missing"><strong>截图待补</strong><span>该订单仍在画册中，打开订单详情后可以补充截图。</span></div>`;
    const coreGrid = `
      <div class="album-core-grid">
        <div><span>方向</span><strong>${escapeHtml(sideLabel(trade.side))}</strong></div>
        <div><span>手数</span><strong>${escapeHtml(String(trade.lots ?? "-"))}</strong></div>
        <div><span>开仓</span><strong>${escapeHtml(formatDateTime(trade.open_time_bj))}</strong></div>
        <div><span>持仓</span><strong>${escapeHtml(trade.duration_label || "-")}</strong></div>
      </div>`;
    const tagList = `<div class="album-tag-list">${(trade.album_tags || []).map(renderTag).join("") || '<span class="muted-mini">暂无选项标签</span>'}</div>`;
    const customFields = renderCustomFields(trade, fields);
    const review = renderReview(trade, context);
    const actions = renderCardActions(trade, archived);
    const checkin = renderCheckinButton(trade);
    const meta = `
      <div class="album-meta">
        <div class="album-meta-top">
          <div>
            <strong>${escapeHtml(trade.symbol || "未知品种")}</strong>
            <small>${escapeHtml(formatDateTime(trade.close_time_bj))} · ${escapeHtml(trade.display_order_no || trade.id)}</small>
          </div>
          <span class="album-pnl ${pnl > 0 ? "profit" : pnl < 0 ? "loss" : ""}">${escapeHtml(formatMoney(pnl))}</span>
        </div>
        ${coreGrid}
        ${tagList}
        ${customFields}
        ${review}
        ${actions}
      </div>`;
    return `
      <article class="album-card${random ? " album-card--random" : ""}" data-trade-id="${escapeAttr(trade.id)}">
        <figure class="album-shot">${screenshot}${checkin}</figure>
        ${meta}
      </article>
    `;
  }

  function renderCheckinButton(trade) {
    const checked = Boolean(trade.reading_checked_in_today);
    const count = Math.max(0, Number(trade.reading_checkin_count || 0));
    return `<div class="album-checkin-wrap">
      <button class="album-checkin-button${checked ? " is-checked" : ""}" type="button" data-checkin="${escapeAttr(trade.id)}" aria-pressed="${String(checked)}" title="${checked ? "取消今天的打卡" : "标记今天已阅读"}">
        <i data-lucide="${checked ? "undo-2" : "check"}" aria-hidden="true"></i><span>${checked ? "取消打卡" : "打卡"}</span>
      </button>
      <span class="album-checkin-count-label">累计 ${count} 次</span>
    </div>`;
  }

  function renderCardActions(trade, archived) {
    return `
      <div class="album-card-actions">
        <button class="ghost-btn album-archive-toggle${archived ? " is-archived" : ""}" type="button" data-archive-toggle="${escapeAttr(trade.id)}" title="${archived ? "恢复到全部画册" : "归档画册"}"><i data-lucide="${archived ? "archive-restore" : "archive"}" aria-hidden="true"></i>${archived ? "恢复" : "归档"}</button>
        <a class="ghost-btn" href="/orders/?trade=${encodeURIComponent(trade.id)}">打开订单</a>
        ${trade.screenshot_url ? `<button class="ghost-btn album-image-trigger" type="button" data-shot="${escapeAttr(trade.screenshot_url)}" data-trade-id="${escapeAttr(trade.id)}" data-caption="${escapeAttr(`${trade.symbol} · ${formatDateTime(trade.close_time_bj)}`)}">打开阅读器</button>` : ""}
      </div>`;
  }

  function renderReview(trade, context) {
    const review = String(trade.review_text || "");
    const editorId = `album-review-${slug(context)}-${slug(trade.id)}`;
    return `
      <div class="album-review album-review-expanded">
        <label class="album-review-label" for="${escapeAttr(editorId)}">复盘</label>
        <textarea id="${escapeAttr(editorId)}" class="album-review-editor" data-review-editor="${escapeAttr(trade.id)}" maxlength="10000" placeholder="记录入场依据、执行过程、风险控制与改进计划">${escapeHtml(review)}</textarea>
        <div class="album-review-actions">
          <button class="primary-btn" type="button" data-review-save="${escapeAttr(trade.id)}">保存订单复盘</button>
        </div>
      </div>
    `;
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

  function bindCardInteractions(root = view) {
    if (typeof root?.querySelectorAll !== "function") return;
    root.querySelectorAll(".album-image-trigger").forEach((button) => {
      button.addEventListener("click", () => openImageModal(button.dataset.shot, button.dataset.caption, button.dataset.tradeId));
    });
    root.querySelectorAll("[data-checkin]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const trade = findTrade(button.dataset.checkin);
          if (trade?.reading_checked_in_today) {
            const cancelled = await cancelCheckin(button.dataset.checkin);
            if (cancelled) toast("已取消今日打卡");
          } else {
            await checkinTrade(button.dataset.checkin);
            toast("今日阅读已打卡");
          }
        } catch (error) {
          button.disabled = false;
          toast(error?.message || "打卡失败", { tone: "error" });
        }
      });
    });
    root.querySelectorAll(".album-shot img").forEach((image) => {
      image.addEventListener("error", () => {
        const figure = image.closest(".album-shot");
        if (figure) {
          figure.innerHTML = '<div class="album-shot-missing"><strong>截图加载失败</strong><span>可以重试刷新，或打开订单详情替换截图。</span></div>';
        }
      });
    });
    root.querySelectorAll("[data-review-save]").forEach((button) => {
      button.addEventListener("click", async () => {
        const card = button.closest?.(".album-card");
        const editor = card?.querySelector?.("[data-review-editor]");
        button.disabled = true;
        try {
          await saveReview(button.dataset.reviewSave, editor?.value || "");
          toast("订单复盘已保存到本地");
        } catch (error) {
          button.disabled = false;
          toast(error?.message || "复盘保存失败", { tone: "error" });
        }
      });
    });
    root.querySelectorAll("[data-archive-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const archived = await toggleArchived(button.dataset.archiveToggle);
          toast(archived ? "已归档" : "已恢复到全部画册");
        } catch (error) {
          button.disabled = false;
          toast(error?.message || "归档状态保存失败", { tone: "error" });
        }
      });
    });
  }

  function findTrade(tradeId) {
    const activeTrades = (data?.days || []).flatMap((day) => day.trades || []);
    const archivedTrades = (archivedData?.days || []).flatMap((day) => day.trades || []);
    return [randomTrade, ...(data?.trades || []), ...activeTrades, ...(archivedData?.trades || []), ...archivedTrades]
      .filter(Boolean)
      .find((trade) => String(trade.id) === String(tradeId)) || null;
  }

  function matchingTrades(tradeId) {
    const candidates = [
      data?.trades || [],
      ...(data?.days || []).map((day) => day.trades || []),
      archivedData?.trades || [],
      ...(archivedData?.days || []).map((day) => day.trades || []),
      randomTrade ? [randomTrade] : [],
    ].flat().filter((item) => String(item.id) === String(tradeId));
    return [...new Set(candidates)];
  }

  async function saveReview(tradeId, reviewText) {
    const trade = findTrade(tradeId);
    if (!trade) throw new Error("订单不存在，无法保存复盘");
    const text = String(reviewText || "");
    const updated = await api.requestJson(`/api/trades/${encodeURIComponent(tradeId)}/review`, {
      method: "PATCH",
      body: {
        trade_type: trade.trade_type,
        strategy: trade.strategy,
        review_text: text,
      },
    });
    const patch = { ...(updated || {}), review_text: text };
    [
      data?.trades || [],
      ...(data?.days || []).map((day) => day.trades || []),
      archivedData?.trades || [],
      ...(archivedData?.days || []).map((day) => day.trades || []),
      randomTrade ? [randomTrade] : [],
    ]
      .flat()
      .filter((item) => String(item.id) === String(tradeId))
      .forEach((item) => Object.assign(item, patch));
    renderDays(data, archivedData);
    renderRandomTrade();
    return updated;
  }

  async function toggleArchived(tradeId) {
    const trade = findTrade(tradeId);
    if (!trade) throw new Error("订单不存在，无法更新归档状态");
    const nextArchived = !isArchived(trade.is_archived);
    await api.requestJson(`/api/trades/${encodeURIComponent(tradeId)}/archived`, {
      method: "PATCH",
      body: { archived: nextArchived },
    });
    if (randomTrade && String(randomTrade.id) === String(tradeId)) {
      randomTrade = null;
      setText("albumRandomStatus", "该画册已归档");
      renderRandomTrade();
    }
    await load();
    return nextArchived;
  }

  function renderRandomTrade() {
    const result = getElement("albumRandomResult");
    const status = getElement("albumRandomStatus");
    if (!result || !status) return;
    if (!randomTrade) {
      result.innerHTML = "";
      result.hidden = true;
      status.hidden = false;
      return;
    }
    status.hidden = true;
    result.hidden = false;
    result.innerHTML = renderCard(randomTrade, randomCustomFields, "random");
    bindCardInteractions(result);
    renderIcons();
  }

  function customFieldsForTrade(trade) {
    if (randomTrade && String(randomTrade.id) === String(trade?.id)) return randomCustomFields;
    if (data?.trades?.some((item) => String(item.id) === String(trade?.id))) {
      return data.available_filters?.custom_fields || [];
    }
    return archivedData?.available_filters?.custom_fields || [];
  }

  function renderReaderReview(trade) {
    const review = String(trade?.review_text || "").trim();
    return `
      <section class="album-reader-review">
        <span class="album-reader-label">复盘</span>
        <p>${review ? escapeHtml(review).replace(/\n/g, "<br />") : "暂无复盘内容"}</p>
      </section>
    `;
  }

  function renderReaderInfo(trade, fields) {
    if (!trade) return "";
    const pnl = Number(trade.net_pnl || 0);
    const coreGrid = `
      <div class="album-core-grid album-reader-core-grid">
        <div><span>方向</span><strong>${escapeHtml(sideLabel(trade.side))}</strong></div>
        <div><span>手数</span><strong>${escapeHtml(String(trade.lots ?? "-"))}</strong></div>
        <div><span>开仓</span><strong>${escapeHtml(formatDateTime(trade.open_time_bj))}</strong></div>
        <div><span>持仓</span><strong>${escapeHtml(trade.duration_label || "-")}</strong></div>
      </div>`;
    const tags = (trade.album_tags || []).map(renderTag).join("") || '<span class="muted-mini">暂无选项标签</span>';
    return `
      <header class="album-reader-order-head">
        <div>
          <strong>${escapeHtml(trade.symbol || "未知品种")}</strong>
          <small>${escapeHtml(formatDateTime(trade.close_time_bj))} · ${escapeHtml(trade.display_order_no || trade.id)}</small>
        </div>
        <span class="album-pnl ${pnl > 0 ? "profit" : pnl < 0 ? "loss" : ""}">${escapeHtml(formatMoney(pnl))}</span>
      </header>
      <div class="album-reader-tags">${tags}</div>
      <div class="album-reader-checkin-count">累计打卡 ${Math.max(0, Number(trade.reading_checkin_count || 0))} 次</div>
      ${coreGrid}
      ${renderCustomFields(trade, fields)}
      ${renderReaderReview(trade)}
      <a class="ghost-btn album-reader-order-link" href="/orders/?trade=${encodeURIComponent(trade.id)}">打开订单详情</a>
    `;
  }

  function renderReader(trade, src, caption) {
    const modal = getElement("albumImageModal");
    const image = getElement("albumModalImage");
    const captionNode = getElement("albumModalCaption");
    const info = getElement("albumReaderInfo");
    if (!modal || !image || !info || !trade) return;
    image.src = src || trade.screenshot_url || "";
    image.alt = `${trade.symbol || "交易"} 交易截图大图`;
    if (captionNode) captionNode.textContent = caption || `${trade.symbol || "交易"} · ${formatDateTime(trade.close_time_bj)}`;
    info.innerHTML = renderReaderInfo(trade, customFieldsForTrade(trade));
    const checkinButton = getElement("albumReaderCheckin");
    if (checkinButton) {
      const checked = Boolean(trade.reading_checked_in_today);
      checkinButton.dataset.checkin = String(trade.id);
      checkinButton.disabled = false;
      checkinButton.classList?.toggle("is-checked", checked);
      checkinButton.setAttribute("aria-pressed", String(checked));
      checkinButton.querySelector?.("span")?.replaceChildren(checked ? "取消打卡" : "打卡");
      checkinButton.querySelector?.("i")?.setAttribute("data-lucide", checked ? "undo-2" : "check");
      checkinButton.title = checked ? "取消今天的打卡" : "标记今天已阅读";
    }
    modal.setAttribute("data-reader-trade-id", String(trade.id));
    renderIcons();
  }

  async function loadRandomTrade() {
    const button = getElement("albumRandomButton");
    const readerButton = getElement("albumReaderNext");
    const label = button?.querySelector?.("span");
    const status = getElement("albumRandomStatus");
    if (button) button.disabled = true;
    if (readerButton) readerButton.disabled = true;
    if (label) label.textContent = "抽取中";
    if (status) {
      status.hidden = false;
      status.textContent = "正在随机抽取...";
    }
    try {
      const payload = await gate.run("album-random", (signal) => (
        api.requestJson("/api/review-album/random", { signal })
      ));
      randomTrade = payload?.trade || null;
      randomCustomFields = payload?.custom_fields || [];
      if (!randomTrade && status) status.textContent = "全部画册中暂无可阅读内容";
      renderRandomTrade();
      if (randomTrade && getElement("albumImageModal")?.classList?.contains("open")) {
        renderReader(randomTrade, randomTrade.screenshot_url, `${randomTrade.symbol || "交易"} · ${formatDateTime(randomTrade.close_time_bj)}`);
      }
      return randomTrade;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      if (status) {
        status.hidden = Boolean(randomTrade);
        status.textContent = "随机画册读取失败";
      }
      toast(error?.message || "随机画册读取失败", { tone: "error" });
      return null;
    } finally {
      if (button) button.disabled = false;
      if (readerButton) readerButton.disabled = false;
      if (label) label.textContent = randomTrade ? "换一个" : "随机一个";
      if (readerButton) readerButton.querySelector("span")?.replaceChildren("换一个");
    }
  }

  async function loadCheckinOverview() {
    try {
      return await gate.run("album-checkins", (signal) => (
        api.requestJson("/api/review-album/checkins?days=90", { signal })
      ));
    } catch (error) {
      if (error?.name !== "AbortError") {
        setText("albumCheckinSummary", "打卡数据暂时不可用");
      }
      return null;
    }
  }

  async function checkinTrade(tradeId) {
    const trade = findTrade(tradeId);
    if (!trade) throw new Error("订单不存在，无法打卡");
    if (trade.reading_checked_in_today) return trade;
    const result = await api.requestJson("/api/review-album/checkin", {
      method: "POST",
      body: { trade_id: tradeId },
    });
    const created = result?.created !== false;
    const matches = matchingTrades(tradeId);
    matches.forEach((item) => {
      item.reading_checked_in_today = true;
      if (created) item.reading_checkin_count = Math.max(0, Number(item.reading_checkin_count || 0)) + 1;
    });
    checkinData = await loadCheckinOverview() || checkinData;
    renderCheckinHeatmap(checkinData);
    renderDays(data, archivedData);
    renderRandomTrade();
    const currentReaderId = getElement("albumImageModal")?.getAttribute?.("data-reader-trade-id");
    if (currentReaderId && String(currentReaderId) === String(tradeId)) renderReader(trade, trade.screenshot_url, "");
    return trade;
  }

  async function cancelCheckin(tradeId, { confirm = globalThis.confirm } = {}) {
    const trade = findTrade(tradeId);
    if (!trade) throw new Error("订单不存在，无法取消打卡");
    if (!trade.reading_checked_in_today) return trade;
    if (typeof confirm === "function" && !confirm("确定取消这张图片今天的打卡吗？")) return null;
    const result = await api.requestJson(`/api/review-album/checkin/${encodeURIComponent(tradeId)}`, {
      method: "DELETE",
    });
    const deleted = result?.deleted !== false;
    const matches = matchingTrades(tradeId);
    matches.forEach((item) => {
      item.reading_checked_in_today = false;
      if (deleted) item.reading_checkin_count = Math.max(0, Number(item.reading_checkin_count || 0) - 1);
    });
    checkinData = await loadCheckinOverview() || checkinData;
    renderCheckinHeatmap(checkinData);
    renderDays(data, archivedData);
    renderRandomTrade();
    const currentReaderId = getElement("albumImageModal")?.getAttribute?.("data-reader-trade-id");
    if (currentReaderId && String(currentReaderId) === String(tradeId)) renderReader(trade, trade.screenshot_url, "");
    return trade;
  }

  async function saveReadingGoal(value) {
    const goal = Number(value);
    if (!Number.isInteger(goal) || goal < 1 || goal > 500) {
      throw new Error("每日目标需要是 1 到 500 之间的整数");
    }
    const updated = await api.requestJson("/api/review-album/goal", {
      method: "PUT",
      body: { daily_goal: goal },
    });
    checkinData = { ...(checkinData || {}), ...(await loadCheckinOverview() || {}), daily_goal: updated?.daily_goal || goal };
    renderCheckinHeatmap(checkinData);
    return checkinData.daily_goal;
  }

  function toast(message, options) {
    if (typeof globalThis.document === "undefined") return;
    showToast(message, options);
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

  function openImageModal(src, caption, tradeId = "") {
    const modal = getElement("albumImageModal");
    if (!modal) return;
    const trade = findTrade(tradeId) || randomTrade;
    if (!trade) return;
    renderReader(trade, src, caption);
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
    const info = getElement("albumReaderInfo");
    if (info) info.replaceChildren();
  }

  function init() {
    const cleanup = typeof mountShell === "function"
      ? mountShell({ activeRoute: "/album/", title: "复盘画册", onRefresh })
      : null;

    getElement("albumRefresh")?.addEventListener("click", () => load());
    getElement("albumRandomButton")?.addEventListener("click", loadRandomTrade);
    getElement("albumCheckinPrevious")?.addEventListener("click", () => changeCheckinMonth(-1));
    getElement("albumCheckinNext")?.addEventListener("click", () => changeCheckinMonth(1));
    getElement("albumReaderCheckin")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      try {
        const trade = findTrade(button.dataset.checkin);
        if (trade?.reading_checked_in_today) {
          const cancelled = await cancelCheckin(button.dataset.checkin);
          if (cancelled) toast("已取消今日打卡");
        } else {
          await checkinTrade(button.dataset.checkin);
          toast("今日阅读已打卡");
        }
      } catch (error) {
        toast(error?.message || "打卡失败", { tone: "error" });
      }
    });
    getElement("albumCheckinGoalSave")?.addEventListener("click", async () => {
      const input = getElement("albumCheckinGoal");
      const button = getElement("albumCheckinGoalSave");
      button.disabled = true;
      try {
        await saveReadingGoal(input?.value);
        toast("每日阅读目标已保存");
      } catch (error) {
        toast(error?.message || "目标保存失败", { tone: "error" });
      } finally {
        button.disabled = false;
      }
    });
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
    getElement("albumReaderNext")?.addEventListener("click", loadRandomTrade);
    getElement("albumImageModal")?.addEventListener("click", (event) => {
      if (event.target && event.target.id === "albumImageModal") closeImageModal();
    });
    if (typeof view.addEventListener === "function") {
      view.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeImageModal();
      });
    }
    if (typeof view.querySelectorAll === "function") {
      view.querySelectorAll("[data-album-view]").forEach((button) => {
        button.addEventListener("click", () => setView(button.dataset.albumView));
      });
    }

    const windowRef = globalThis.window || globalThis;
    windowRef.addEventListener?.("popstate", () => {
      state = readAlbumState(location.search);
      syncFilterControls();
      load();
    });

    syncFilterControls();
    applyAlbumView();
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
    saveReview,
    toggleArchived,
    loadRandomTrade,
    checkinTrade,
    cancelCheckin,
    saveReadingGoal,
    changeCheckinMonth,
    setView,
    dispose,
    getState: () => state,
    getView: () => albumView,
  };
}

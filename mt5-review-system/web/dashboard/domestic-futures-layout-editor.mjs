import {
  cloneDefaultLayout,
  getModuleDefinitions,
  layoutItem,
  loadLayout,
  normalizeLayout,
  saveLayout,
} from "./dashboard-layout.mjs";
import {buildDashboardGridOptions} from "./dashboard-grid.mjs";

const gridElement = document.querySelector("#editorGrid");
const moduleList = document.querySelector("#moduleList");
const emptyInspector = document.querySelector("#emptyInspector");
const moduleInspector = document.querySelector("#moduleInspector");
const titleInput = document.querySelector("#titleInput");
const subtitleInput = document.querySelector("#subtitleInput");
const visibleInput = document.querySelector("#visibleInput");
const importInput = document.querySelector("#importInput");
const layoutStatus = document.querySelector("#layoutStatus");
const toast = document.querySelector("#toast");
const params = new URLSearchParams(window.location.search);
const platform = params.get("platform") === "domestic_futures" ? "domestic_futures" : "mt5";
const MODULE_DEFINITIONS = getModuleDefinitions(platform);
const returnUrl = params.get("return") || (platform === "domestic_futures" ? "mock-domestic-futures.html" : "/dashboard/?platform=mt5");
let layout = loadLayout(localStorage, platform);
let selectedId = null;
let syncing = false;
let toastTimer = null;
let currentColumns = 12;

const previewMarkup = {
  "period-overview": '<div class="preview-value">+¥18,460</div><div class="preview-table"><div><span>交易盈亏</span><b>+¥24,980</b></div><div><span>手续费</span><b>-¥6,520</b></div><div><span>胜率</span><b>56.3%</b></div></div>',
  "net-performance": '<div class="preview-value">+¥18,460</div><div class="preview-line"><span style="width:84%"></span></div><div class="preview-line"><span style="width:62%"></span></div><div class="preview-line"><span style="width:91%"></span></div>',
  "risk-health": '<div class="preview-value">72 / 100</div><div class="preview-table"><div><span>最大单笔亏损</span><b>-¥3,120</b></div><div><span>连续亏损</span><b>3 笔</b></div><div><span>手续费压力</span><b>26.1%</b></div></div>',
  "monthly-pnl": '<div class="preview-bars"><i style="height:34%"></i><i style="height:20%"></i><i style="height:58%"></i><i style="height:42%"></i><i style="height:75%"></i><i style="height:52%"></i><i style="height:88%"></i></div>',
  "daily-calendar": '<div class="preview-calendar">' + "<i></i>".repeat(28) + "</div>",
  "contract-contribution": '<div class="preview-table"><div><span>IF2611</span><b>+¥8,600</b></div><div><span>MA2701</span><b>+¥6,080</b></div><div><span>RB2701</span><b>+¥5,120</b></div></div>',
  "contract-losses": '<div class="preview-table"><div><span>PVC2701</span><b class="loss">-¥1,340</b></div><div><span>FG2701</span><b class="loss">-¥920</b></div><div><span>SC2612</span><b class="loss">-¥760</b></div><div><span>TA2701</span><b class="loss">-¥540</b></div></div>',
  "data-health": '<div class="preview-value">48</div><div class="preview-table"><div><span>已匹配交易</span><b>32</b></div><div><span>重复记录</span><b>2</b></div><div><span>未配对</span><b>1</b></div></div>',
  "review-coverage": '<div class="preview-value">78%</div><div class="preview-line"><span style="width:78%"></span></div><div class="preview-table"><div><span>已完成</span><b>25 / 32 笔</b></div><div><span>缺少截图</span><b>4 笔</b></div></div>',
  "system-evaluation": '<div class="preview-table"><div><span>交易日</span><b>净盈亏 · 手续费 · 胜率</b></div><div><span>10/09</span><b>+¥4,280 · 60.0%</b></div><div><span>10/13</span><b>-¥3,120 · 33.3%</b></div></div>',
  "mode-evaluation": '<div class="preview-table"><div><span>趋势跟随</span><b>+¥12,480</b></div><div><span>突破</span><b>+¥7,620</b></div><div><span>反转</span><b class="loss">-¥1,640</b></div></div>',
  equity: '<div class="preview-value">+¥12,480</div><div class="preview-line"><span style="width:86%"></span></div><div class="preview-line"><span style="width:68%"></span></div><small>区间回报 · 累计净值</small>',
  calendar: '<div class="preview-calendar">' + "<i></i>".repeat(28) + '</div><small>2026 年 10 月 · 月度盈亏</small>',
  "monthly-pnl": '<div class="preview-bars"><i style="height:34%"></i><i style="height:20%"></i><i style="height:58%"></i><i style="height:42%"></i><i style="height:75%"></i><i style="height:52%"></i><i style="height:88%"></i></div><small>按平仓月份汇总净盈亏</small>',
  heatmap: '<div class="preview-calendar">' + "<i></i>".repeat(35) + '</div><small>按星期与北京时间聚合</small>',
  sessions: '<div class="preview-table"><div><span>亚盘</span><b>+¥2,180</b></div><div><span>欧盘</span><b>+¥5,420</b></div><div><span>美盘</span><b>-¥1,260</b></div></div>',
};

const grid = GridStack.init({
  ...buildDashboardGridOptions({editable: true}),
  alwaysShowResizeHandle: true,
  draggable: {handle: ".editor-card-header", cancel: ".editor-card-actions,button,input"},
  resizable: {handles: "e, se, s, sw, w", autoHide: false},
}, gridElement);

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function previewFor(item) {
  return previewMarkup[item.id] || `<div class="preview-value">${item.title}</div>`;
}

function createCard(item) {
  const element = document.createElement("div");
  element.className = "grid-stack-item";
  element.dataset.module = item.id;
  element.id = `editor-module-${item.id}`;
  element.innerHTML = `<div class="grid-stack-item-content"><div class="editor-card"><div class="editor-card-header"><div class="editor-card-title"><strong></strong><small></small></div><div class="editor-card-actions"><button type="button" data-editor-action="select" title="编辑模块" aria-label="编辑模块"><i data-lucide="settings-2"></i></button><button type="button" data-editor-action="hide" title="隐藏模块" aria-label="隐藏模块"><i data-lucide="eye-off"></i></button></div></div><div class="editor-card-body">${previewFor(item)}</div></div></div>`;
  element.querySelector("strong").textContent = item.title;
  element.querySelector("small").textContent = item.subtitle || "可配置模块";
  element.addEventListener("click", (event) => {
    if (event.target.closest("[data-editor-action]")) return;
    selectModule(item.id);
  });
  element.querySelector("[data-editor-action=select]").addEventListener("click", (event) => {
    event.stopPropagation();
    selectModule(item.id);
  });
  element.querySelector("[data-editor-action=hide]").addEventListener("click", (event) => {
    event.stopPropagation();
    setVisibility(item.id, false);
  });
  return element;
}

function updateCardText(item) {
  const card = gridElement.querySelector(`[data-module="${item.id}"]`);
  if (!card) return;
  card.querySelector("strong").textContent = item.title;
  card.querySelector("small").textContent = item.subtitle || "可配置模块";
}

function syncLayoutFromGrid() {
  if (syncing || currentColumns !== 12) return;
  const nodes = new Map(grid.getGridItems().map((element) => [element.dataset.module, element.gridstackNode]));
  layout = normalizeLayout({
    ...layout,
    items: layout.items.map((item) => {
      const node = nodes.get(item.id);
      return node ? {...item, x: node.x, y: node.y, w: node.w, h: node.h} : item;
    }),
  }, platform);
  saveLayout(localStorage, layout, platform);
  layoutStatus.textContent = "已保存";
}

function mountGrid() {
  syncing = true;
  grid.removeAll(true);
  layout.items.filter((item) => item.visible !== false).forEach((item) => {
    const card = createCard(item);
    grid.makeWidget(card, {id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, minW: item.minW, minH: item.minH, maxW: item.maxW, maxH: item.maxH});
  });
  syncing = false;
  updateModuleList();
  if (window.lucide) window.lucide.createIcons();
  if (selectedId && layoutItem(layout, selectedId)) selectModule(selectedId);
}

function applyResponsiveColumns() {
  const nextColumns = window.matchMedia("(max-width: 760px)").matches ? 1 : 12;
  if (nextColumns === currentColumns) return;
  currentColumns = nextColumns;
  grid.column(nextColumns, nextColumns === 1 ? "move" : "moveScale");
  gridElement.dataset.columns = String(nextColumns);
  layoutStatus.textContent = nextColumns === 1 ? "移动端预览" : "已保存";
}

function selectModule(id) {
  const item = layoutItem(layout, id);
  if (!item) return;
  selectedId = id;
  emptyInspector.hidden = true;
  moduleInspector.hidden = false;
  titleInput.value = item.title;
  subtitleInput.value = item.subtitle;
  visibleInput.checked = item.visible !== false;
  moduleList.querySelectorAll("button").forEach((button) => button.classList.toggle("active", button.dataset.module === id));
}

function setVisibility(id, visible) {
  const item = layoutItem(layout, id);
  if (!item) return;
  item.visible = visible;
  mountGrid();
  saveLayout(localStorage, layout, platform);
  selectModule(id);
  showToast(visible ? "模块已显示" : "模块已隐藏");
}

function updateSelectedText() {
  const item = layoutItem(layout, selectedId);
  if (!item) return;
  item.title = titleInput.value.trim() || item.title;
  item.subtitle = subtitleInput.value.trim();
  updateCardText(item);
  updateModuleList();
  saveLayout(localStorage, layout, platform);
  layoutStatus.textContent = "已保存";
}

function updateModuleList() {
  moduleList.textContent = "";
  MODULE_DEFINITIONS.forEach((definition) => {
    const item = layoutItem(layout, definition.id);
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.module = item.id;
    button.innerHTML = "<span></span><small></small>";
    button.querySelector("span").textContent = item.title;
    button.querySelector("small").textContent = item.visible === false ? "已隐藏" : `${item.w} × ${item.h}`;
    button.addEventListener("click", () => selectModule(item.id));
    moduleList.append(button);
  });
}

function resetLayout() {
  layout = cloneDefaultLayout(platform);
  selectedId = null;
  mountGrid();
  saveLayout(localStorage, layout, platform);
  emptyInspector.hidden = false;
  moduleInspector.hidden = true;
  showToast("已恢复默认布局");
}

function exportLayout() {
  syncLayoutFromGrid();
  const blob = new Blob([JSON.stringify(layout, null, 2)], {type: "application/json"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${platform}-dashboard-layout.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("布局已导出");
}

function importLayout(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      layout = normalizeLayout(JSON.parse(String(reader.result)), platform);
      selectedId = null;
      mountGrid();
      saveLayout(localStorage, layout, platform);
      emptyInspector.hidden = false;
      moduleInspector.hidden = true;
      showToast("布局已导入");
    } catch (_) {
      showToast("布局文件无法读取");
    }
  });
  reader.readAsText(file);
}

titleInput.addEventListener("input", updateSelectedText);
subtitleInput.addEventListener("input", updateSelectedText);
visibleInput.addEventListener("change", () => setVisibility(selectedId, visibleInput.checked));
grid.on("change dragstop resizestop", syncLayoutFromGrid);
window.addEventListener("resize", applyResponsiveColumns);
document.querySelector('[data-layout-action="reset"]').addEventListener("click", resetLayout);
document.querySelector('[data-layout-action="export"]').addEventListener("click", exportLayout);
importInput.addEventListener("change", () => { if (importInput.files?.[0]) importLayout(importInput.files[0]); });
document.querySelector("#applyLink").href = returnUrl;
document.querySelector("#editorBackLink").href = returnUrl;
document.querySelector("#applyLink").addEventListener("click", () => { syncLayoutFromGrid(); saveLayout(localStorage, layout, platform); });

document.body.dataset.platform = platform;
document.title = `${platform === "domestic_futures" ? "国内期货" : "MT5"} · 仪表盘布局编辑器`;

mountGrid();
applyResponsiveColumns();
if (window.lucide) window.lucide.createIcons();

import {createModuleRegistry} from "./module-registry.mjs";
import {createWorkspace, loadWorkspace, saveWorkspace} from "./dashboard-core.mjs";
import {createSyntheticDataset} from "./synthetic-data.mjs";
import {equityOption, monthlyOption, strategyOption} from "./chart-options.mjs";

const STORAGE_KEY = "b0-lab.workspace.v1";
const app = document.querySelector("[data-b0-app]");
const gridElement = document.querySelector("#dashboardGrid");
const catalog = document.querySelector("#moduleCatalog");
const catalogList = document.querySelector("[data-catalog-list]");
const emptyWorkspace = document.querySelector("#emptyWorkspace");
const toast = document.querySelector("#toast");
const dataScenario = document.querySelector("#dataScenario");
const editSelection = document.querySelector("[data-edit-selection]");
const editSize = document.querySelector("[data-edit-size]");
const dataset = createSyntheticDataset();
const charts = new Map();
let editing = false;
let syncingGrid = false;
let toastTimer = null;
let currentColumns = 12;
let selectedInstanceId = "equity-main";

const registry = createModuleRegistry([
  {
    type: "equity",
    title: "累计权益与回撤",
    subtitle: "账户权益和峰值回撤的时间序列",
    icon: "chart-no-axes-combined",
    renderer: "equity",
    kicker: "EQUITY / DRAWDOWN",
    metric: "+¥23,930",
    metricDetail: "+23.93%",
    tier: "primary",
    defaultSize: {w: 8, h: 5},
    defaultSettings: {range: "90d"},
  },
  {
    type: "risk-snapshot",
    title: "风险健康度",
    subtitle: "仓位、亏损序列与复盘覆盖",
    icon: "shield-check",
    renderer: "risk",
    kicker: "RISK CONTROL",
    metric: "78",
    metricDetail: "健康度",
    tier: "signal",
    defaultSize: {w: 4, h: 5},
    defaultSettings: {},
  },
  {
    type: "monthly-pnl",
    title: "月度盈亏",
    subtitle: "按平仓月份统计净盈亏",
    icon: "chart-column-big",
    renderer: "monthly",
    kicker: "MONTHLY P/L",
    metric: "+¥25,930",
    metricDetail: "10 个月",
    tier: "supporting",
    defaultSize: {w: 5, h: 4},
    defaultSettings: {currency: "CNY"},
  },
  {
    type: "strategy-contribution",
    title: "策略贡献",
    subtitle: "比较策略的真实收益贡献",
    icon: "git-compare-arrows",
    renderer: "strategy",
    kicker: "EDGE ATTRIBUTION",
    metric: "+¥10,840",
    metricDetail: "趋势跟随",
    tier: "supporting",
    defaultSize: {w: 7, h: 4},
    defaultSettings: {limit: 5},
  },
]);

const defaultWorkspace = {
  version: 1,
  instances: [
    {id: "equity-main", type: "equity", visible: true, x: 0, y: 0, w: 8, h: 5, settings: {range: "90d"}},
    {id: "risk-main", type: "risk-snapshot", visible: true, x: 8, y: 0, w: 4, h: 5, settings: {}},
    {id: "monthly-main", type: "monthly-pnl", visible: true, x: 0, y: 5, w: 5, h: 4, settings: {currency: "CNY"}},
    {id: "strategy-main", type: "strategy-contribution", visible: true, x: 5, y: 5, w: 7, h: 4, settings: {limit: 5}},
  ],
};

const initialState = loadWorkspace(localStorage, STORAGE_KEY, defaultWorkspace, registry.asMap());
const workspace = createWorkspace({definitions: registry.asMap(), initial: initialState});

const grid = GridStack.init({
  column: 12,
  cellHeight: 62,
  margin: 6,
  animate: false,
  float: false,
  staticGrid: true,
  draggable: {handle: ".module-head", cancel: "button"},
  resizable: {handles: "e, se, s, sw, w", autoHide: false},
}, gridElement);

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function persist() {
  try {
    saveWorkspace(localStorage, STORAGE_KEY, workspace.snapshot());
  } catch (_) {
    showToast("浏览器未允许保存布局");
  }
}

function disposeChart(id) {
  const mounted = charts.get(id);
  if (!mounted) return;
  mounted.observer?.disconnect();
  mounted.chart?.dispose();
  charts.delete(id);
}

function disposeAllCharts() {
  [...charts.keys()].forEach(disposeChart);
}

function stateMarkup(scenario) {
  const states = {
    loading: ["loader-circle", "正在计算模块", "协调层正在聚合统一口径数据"],
    empty: ["inbox", "当前范围没有交易", "调整时间范围或切换工作区后重试"],
    insufficient: ["triangle-alert", "样本量不足", "至少需要 10 笔已平仓交易才能计算此指标"],
    error: ["circle-x", "模块暂时不可用", "此模块发生异常，其他模块仍可继续工作"],
  };
  const [icon, title, copy] = states[scenario] || states.error;
  const loading = scenario === "loading" ? '<span class="loading-line" aria-hidden="true"></span>' : "";
  return `<div class="module-state ${scenario === "error" ? "is-error" : ""}"><i data-lucide="${icon}"></i><strong>${title}</strong><span>${copy}</span>${loading}</div>`;
}

function renderRisk(body) {
  const risk = dataset.risk;
  body.innerHTML = `
    <div class="risk-panel">
      <div class="risk-score"><div><strong>${risk.score}</strong><span>RISK SCORE</span></div></div>
      <div class="risk-list">
        <div class="risk-item"><span>单笔风险</span><strong>${risk.riskPerTrade}%</strong><div class="risk-track"><i style="width:${risk.riskPerTrade * 24}%"></i></div></div>
        <div class="risk-item"><span>最大连亏</span><strong>${risk.lossStreak} 笔</strong><div class="risk-track"><i style="width:${risk.lossStreak * 14}%"></i></div></div>
        <div class="risk-item"><span>敞口使用</span><strong>${risk.exposure}%</strong><div class="risk-track"><i style="width:${risk.exposure}%"></i></div></div>
        <div class="risk-item"><span>复盘覆盖</span><strong>${risk.reviewCoverage}%</strong><div class="risk-track"><i style="width:${risk.reviewCoverage}%"></i></div></div>
      </div>
    </div>`;
}

function chartOption(renderer) {
  if (renderer === "equity") return equityOption(dataset);
  if (renderer === "monthly") return monthlyOption(dataset);
  if (renderer === "strategy") return strategyOption(dataset);
  throw new Error(`Unsupported chart renderer: ${renderer}`);
}

function renderChart(body, instance, renderer) {
  const host = document.createElement("div");
  host.className = "chart-host";
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", registry.get(instance.type)?.title || "数据图表");
  body.replaceChildren(host);
  const chart = echarts.init(host, null, {renderer: "canvas"});
  chart.setOption(chartOption(renderer));
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(host);
  charts.set(instance.id, {chart, observer});
}

function renderModuleBody(instance, body) {
  disposeChart(instance.id);
  const definition = registry.get(instance.type);
  const scenario = dataScenario.value;
  try {
    if (!definition || instance.status === "unavailable") {
      body.innerHTML = stateMarkup("error");
    } else if (scenario !== "value" && !(scenario === "error" && definition.renderer !== "strategy")) {
      body.innerHTML = stateMarkup(scenario);
    } else if (definition.renderer === "risk") {
      renderRisk(body);
    } else {
      renderChart(body, instance, definition.renderer);
    }
  } catch (_) {
    body.innerHTML = stateMarkup("error");
  }
}

function createModuleElement(instance) {
  const definition = registry.get(instance.type);
  const title = definition?.title || `不可用模块 · ${instance.type}`;
  const subtitle = definition?.subtitle || "模块定义不存在，布局记录已保留";
  const item = document.createElement("div");
  item.className = "grid-stack-item";
  item.dataset.instanceId = instance.id;
  item.dataset.moduleType = instance.type;
  item.dataset.visualTier = definition?.tier || "supporting";
  item.innerHTML = `
    <div class="grid-stack-item-content">
      <article class="module-card module-card--${definition?.renderer || "unavailable"}">
        <header class="module-head">
          <span class="module-glyph"><i data-lucide="${definition?.icon || "badge-alert"}"></i></span>
          <div class="module-title"><small>${definition?.kicker || "UNAVAILABLE"}</small><strong></strong><span></span></div>
          <div class="module-metric"><strong>${definition?.metric || "--"}</strong><span>${definition?.metricDetail || "模块不可用"}</span></div>
          <span class="module-size" data-module-size>${instance.w} × ${instance.h}</span>
          <div class="module-actions">
            <button type="button" data-instance-action="duplicate" aria-label="复制模块" title="复制模块"><i data-lucide="copy-plus"></i></button>
            <button type="button" data-instance-action="remove" aria-label="删除模块" title="删除模块"><i data-lucide="trash-2"></i></button>
          </div>
        </header>
        <div class="module-body"></div>
        <footer class="module-foot"><span><i></i> Campaign / CLOSE TIME</span><b>Asia/Shanghai · v1</b></footer>
      </article>
    </div>`;
  item.querySelector(".module-title strong").textContent = title;
  item.querySelector(".module-title span").textContent = subtitle;
  return item;
}

function mountWorkspace() {
  syncingGrid = true;
  disposeAllCharts();
  grid.removeAll(true);
  const state = workspace.snapshot();
  state.instances.filter((instance) => instance.visible !== false).forEach((instance) => {
    const item = createModuleElement(instance);
    gridElement.append(item);
    grid.makeWidget(item, {
      id: instance.id,
      x: instance.x,
      y: instance.y,
      w: instance.w,
      h: instance.h,
      minW: 3,
      minH: 3,
    });
    renderModuleBody(instance, item.querySelector(".module-body"));
  });
  syncingGrid = false;
  emptyWorkspace.hidden = state.instances.some((instance) => instance.visible !== false);
  const selected = gridElement.querySelector(`[data-instance-id="${selectedInstanceId}"]`) || gridElement.querySelector("[data-instance-id]");
  if (selected) selectModule(selected);
  lucide?.createIcons();
}

function renderCatalog(filter = "") {
  const normalizedFilter = filter.trim().toLocaleLowerCase("zh-CN");
  catalogList.replaceChildren();
  registry.list()
    .filter((definition) => `${definition.title}${definition.subtitle}`.toLocaleLowerCase("zh-CN").includes(normalizedFilter))
    .forEach((definition) => {
      const item = document.createElement("div");
      item.className = "catalog-item";
      item.innerHTML = `
        <span class="catalog-icon"><i data-lucide="${definition.icon}"></i></span>
        <div class="catalog-copy"><small>${definition.kicker}</small><strong></strong><span></span><b>${definition.defaultSize.w} × ${definition.defaultSize.h}</b></div>
        <button type="button" data-add-type="${definition.type}" aria-label="添加${definition.title}" title="添加模块"><i data-lucide="plus"></i></button>`;
      item.querySelector("strong").textContent = definition.title;
      item.querySelector(".catalog-copy span").textContent = definition.subtitle;
      catalogList.append(item);
    });
  lucide?.createIcons();
}

function openCatalog(open) {
  app.classList.toggle("catalog-open", open);
  catalog.setAttribute("aria-hidden", String(!open));
  if (open) catalog.querySelector("input")?.focus();
}

function setEditing(nextEditing) {
  editing = nextEditing;
  app.dataset.mode = editing ? "edit" : "view";
  if (editing) {
    grid.setStatic(false);
    grid.enableMove(true);
    grid.enableResize(true);
  } else {
    grid.enableMove(false);
    grid.enableResize(false);
    grid.setStatic(true);
  }
  const button = document.querySelector('[data-action="edit"]');
  button.querySelector("span").textContent = editing ? "完成编辑" : "编辑布局";
  button.setAttribute("aria-label", editing ? "完成编辑" : "编辑布局");
  lucide?.createIcons();
  charts.forEach(({chart}) => chart.resize());
}

function updateSizeIndicators(element) {
  if (!element?.gridstackNode) return;
  const {w, h} = element.gridstackNode;
  const size = `${w} × ${h}`;
  const label = element.querySelector("[data-module-size]");
  if (label) label.textContent = size;
  if (element.classList.contains("is-selected")) editSize.textContent = size;
}

function selectModule(element) {
  gridElement.querySelectorAll(".grid-stack-item").forEach((item) => item.classList.toggle("is-selected", item === element));
  const instance = workspace.get(element?.dataset.instanceId);
  const definition = instance && registry.get(instance.type);
  if (!instance || !definition) return;
  selectedInstanceId = instance.id;
  editSelection.textContent = definition.title;
  updateSizeIndicators(element);
}

function syncWorkspaceFromGrid() {
  if (syncingGrid || currentColumns !== 12) return;
  grid.getGridItems().forEach((element) => {
    const node = element.gridstackNode;
    workspace.updateLayout(element.dataset.instanceId, {x: node.x, y: node.y, w: node.w, h: node.h});
  });
  persist();
}

function applyResponsiveColumns() {
  const nextColumns = window.matchMedia("(max-width: 640px)").matches ? 1 : 12;
  if (nextColumns === currentColumns) return;
  currentColumns = nextColumns;
  grid.column(nextColumns, nextColumns === 1 ? "move" : "moveScale");
  charts.forEach(({chart}) => chart.resize());
}

grid.on("change", (_event, nodes = []) => {
  nodes.forEach((node) => updateSizeIndicators(node.el));
  syncWorkspaceFromGrid();
});
grid.on("dragstop resizestop", (_event, element) => {
  updateSizeIndicators(element);
  selectModule(element);
  syncWorkspaceFromGrid();
});
window.addEventListener("resize", applyResponsiveColumns);

document.addEventListener("click", (event) => {
  const moduleElement = event.target.closest("[data-instance-id]");
  if (editing && moduleElement && !event.target.closest("button")) selectModule(moduleElement);
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    if (action === "catalog") openCatalog(true);
    if (action === "close-catalog") openCatalog(false);
    if (action === "edit") setEditing(!editing);
    if (action === "reset") {
      workspace.replace(defaultWorkspace);
      persist();
      mountWorkspace();
      showToast("已恢复默认模块与布局");
    }
    return;
  }

  const addButton = event.target.closest("[data-add-type]");
  if (addButton) {
    workspace.add(addButton.dataset.addType);
    persist();
    mountWorkspace();
    openCatalog(false);
    showToast("模块已添加，可继续添加同类型实例");
    return;
  }

  const instanceButton = event.target.closest("[data-instance-action]");
  if (!instanceButton) return;
  const instanceId = instanceButton.closest("[data-instance-id]")?.dataset.instanceId;
  if (!instanceId) return;
  if (instanceButton.dataset.instanceAction === "duplicate") {
    workspace.duplicate(instanceId);
    persist();
    mountWorkspace();
    showToast("模块实例已复制");
  }
  if (instanceButton.dataset.instanceAction === "remove") {
    workspace.remove(instanceId);
    persist();
    mountWorkspace();
    showToast("模块已从当前布局移除");
  }
});

catalog.querySelector("input").addEventListener("input", (event) => renderCatalog(event.target.value));
dataScenario.addEventListener("change", mountWorkspace);

document.querySelectorAll(".range-control button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-control button").forEach((item) => item.classList.toggle("is-active", item === button));
    showToast(`分析范围已切换为 ${button.textContent}`);
  });
});

renderCatalog();
mountWorkspace();
applyResponsiveColumns();
setEditing(false);
selectModule(gridElement.querySelector('[data-instance-id="equity-main"]') || gridElement.querySelector("[data-instance-id]"));
app.dataset.ready = "true";

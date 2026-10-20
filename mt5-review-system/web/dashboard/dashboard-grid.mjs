function runtimeFor(GridStack) {
  if (GridStack?.init) return GridStack;
  if (GridStack?.GridStack?.init) return GridStack.GridStack;
  return null;
}

export function buildDashboardGridOptions({editable = false} = {}) {
  return {
    column: 12,
    cellHeight: 48,
    margin: 12,
    animate: false,
    float: false,
    staticGrid: !editable,
    disableDrag: !editable,
    disableResize: !editable,
    alwaysShowResizeHandle: editable,
    draggable: {handle: ".grid-stack-item-content", cancel: "button, input, a, select, textarea"},
    resizable: {handles: "e, se, s, sw, w"},
  };
}

function wrapModule(module, document) {
  const parent = module.parentElement;
  if (parent?.classList?.contains("grid-stack-item")) return parent;
  const item = document.createElement("div");
  const content = document.createElement("div");
  item.className = "grid-stack-item";
  content.className = "grid-stack-item-content";
  item.dataset.layoutModule = module.dataset.layoutModule || "";
  item.dataset.module = module.dataset.module || "";
  parent?.replaceChild(item, module);
  item.append(content);
  content.append(module);
  return item;
}

function applyModuleSettings(module, item, selector) {
  module.hidden = item.visible === false;
  const title = module.querySelector?.(selector === "[data-module]" ? "[data-module-title]" : "[data-layout-title]");
  const subtitle = module.querySelector?.(selector === "[data-module]" ? "[data-module-subtitle]" : "[data-layout-subtitle]");
  if (title) title.textContent = item.title;
  if (subtitle) subtitle.textContent = item.subtitle || "";
}

function configureGridItems(root, layout, selector, document) {
  const itemsById = new Map((layout?.items || []).map((item) => [item.id, item]));
  const modules = [...(root.querySelectorAll?.(selector) || [])].filter((module) => module.parentElement === root || module.parentElement?.parentElement === root);
  return modules.map((module) => {
    const id = module.dataset.layoutModule || module.dataset.module;
    const item = itemsById.get(id);
    if (!item) return null;
    const gridItem = wrapModule(module, document);
    gridItem.setAttribute("gs-id", item.id);
    gridItem.setAttribute("gs-x", String(item.x));
    gridItem.setAttribute("gs-y", String(item.y));
    gridItem.setAttribute("gs-w", String(item.w));
    gridItem.setAttribute("gs-h", String(item.h));
    gridItem.setAttribute("gs-min-w", String(item.minW));
    gridItem.setAttribute("gs-min-h", String(item.minH));
    gridItem.setAttribute("gs-max-w", String(item.maxW));
    gridItem.setAttribute("gs-max-h", String(item.maxH));
    gridItem.hidden = item.visible === false;
    applyModuleSettings(module, item, selector);
    return gridItem;
  }).filter(Boolean);
}

export function createDashboardGrid({
  root,
  layout,
  selector = "[data-layout-module]",
  editable = false,
  GridStack = globalThis.GridStack,
  document = globalThis.document,
} = {}) {
  if (!root) return {runtime: "none", grid: null, destroy() {}, refresh() {}};
  root.classList?.add("grid-stack");
  configureGridItems(root, layout, selector, document);
  const runtime = runtimeFor(GridStack);
  if (!runtime) {
    return {runtime: "fallback", grid: null, destroy() {}, refresh() {}};
  }
  const grid = runtime.init(buildDashboardGridOptions({editable}), root);
  return {
    runtime: "gridstack",
    grid,
    destroy() {
      grid?.destroy?.(false);
    },
    refresh() {
      grid?.onResize?.();
    },
  };
}

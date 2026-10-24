import {cloneDefaultLayout, normalizeLayout, saveLayout} from "./dashboard-layout.mjs";

function readItemsFromGrid(layout, grid, platform) {
  const nodes = new Map((grid?.getGridItems?.() || []).map((element) => [
    element.dataset.layoutModule || element.dataset.module,
    element.gridstackNode,
  ]));
  return normalizeLayout({
    ...layout,
    items: layout.items.map((item) => {
      const node = nodes.get(item.id);
      return node ? {...item, x: node.x, y: node.y, w: node.w, h: node.h} : item;
    }),
  }, platform);
}

function locationWithMode(location, editing) {
  const next = new URL(location.href);
  if (editing) next.searchParams.set("layout", "edit");
  else next.searchParams.delete("layout");
  return next.toString();
}

export function mountDashboardLayoutEditorMode({
  root,
  toolbar,
  gridController,
  layout,
  platform = "mt5",
  location = globalThis.location,
  storage = globalThis.localStorage,
  document = globalThis.document,
} = {}) {
  if (!root || !toolbar || new URLSearchParams(location?.search || "").get("layout") !== "edit") {
    return {editing: false, dispose() {}};
  }

  document.body.dataset.layoutEditing = platform;
  toolbar.hidden = false;
  const visibility = toolbar.querySelector("[data-layout-visibility]");
  const status = toolbar.querySelector("[data-layout-status]");
  let currentLayout = normalizeLayout(layout, platform);
  let dirty = false;

  function markDirty(message = "有未保存的布局调整") {
    dirty = true;
    if (status) status.textContent = message;
  }

  function setVisibility(item, visible, button) {
    item.visible = visible;
    const wrapper = root.querySelector(`[gs-id="${item.id}"]`);
    const module = root.querySelector(`[data-layout-module="${item.id}"], [data-module="${item.id}"]`);
    if (wrapper) wrapper.hidden = !visible;
    if (module) module.hidden = !visible;
    button.setAttribute("aria-pressed", String(visible));
    markDirty();
    gridController?.refresh?.();
  }

  if (visibility) {
    visibility.textContent = "";
    currentLayout.items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "layout-editor-toggle";
      button.dataset.layoutToggle = item.id;
      button.setAttribute("aria-pressed", String(item.visible !== false));
      button.textContent = item.title;
      button.addEventListener("click", () => setVisibility(item, item.visible === false, button));
      visibility.append(button);
    });
  }

  const grid = gridController?.grid;
  const syncLayoutFromGrid = () => {
    currentLayout = readItemsFromGrid(currentLayout, grid, platform);
    markDirty();
  };
  grid?.on?.("change dragstop resizestop", syncLayoutFromGrid);

  toolbar.querySelector("[data-layout-save]")?.addEventListener("click", () => {
    currentLayout = readItemsFromGrid(currentLayout, grid, platform);
    saveLayout(storage, currentLayout, platform);
    location?.assign?.(locationWithMode(location, false));
  });

  toolbar.querySelector("[data-layout-reset]")?.addEventListener("click", () => {
    saveLayout(storage, cloneDefaultLayout(platform), platform);
    location?.assign?.(locationWithMode(location, true));
  });

  if (status && !dirty) status.textContent = "拖动真实模块标题或调整边缘；保存后应用到仪表盘";
  return {
    editing: true,
    dispose() {
      grid?.off?.("change dragstop resizestop", syncLayoutFromGrid);
      delete document.body.dataset.layoutEditing;
    },
  };
}

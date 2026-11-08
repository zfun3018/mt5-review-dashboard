import {loadDefaultLayout, normalizeLayout, saveLayout, saveLayoutToServer} from "./dashboard-layout.mjs";

function readItemsFromGrid(layout, grid, platform, root = null) {
  const elements = [...(root?.querySelectorAll?.(":scope > .grid-stack-item") || [])];
  if (!elements.length) {
    const listed = grid?.getGridItems?.();
    if (listed?.length) elements.push(...listed);
  }
  const nodes = new Map(elements.map((element) => [
    element.dataset.layoutModule || element.dataset.module,
    {
      element,
      node: element.gridstackNode,
    },
  ]));
  for (const node of grid?.engine?.nodes || []) {
    const id = node?.el?.dataset?.layoutModule || node?.el?.dataset?.module || node?.el?.getAttribute?.("gs-id");
    if (id) nodes.set(id, {element: node.el, node});
  }
  return normalizeLayout({
    ...layout,
    items: layout.items.map((item) => {
      const entry = nodes.get(item.id);
      if (!entry) return item;
      const node = entry.node || {};
      const read = (name, fallback) => {
        if (Number.isFinite(Number(node[name]))) return node[name];
        const attribute = Number(entry.element?.getAttribute?.(`gs-${name}`));
        return Number.isFinite(attribute) ? attribute : fallback;
      };
      return {
        ...item,
        x: read("x", item.x),
        y: read("y", item.y),
        w: read("w", item.w),
        h: read("h", item.h),
      };
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
  api = null,
  revision = 0,
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
  let currentRevision = Number(revision) || 0;
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
    currentLayout = readItemsFromGrid(currentLayout, grid, platform, root);
    markDirty();
  };
  grid?.on?.("change dragstop resizestop", syncLayoutFromGrid);

  toolbar.querySelector("[data-layout-save]")?.addEventListener("click", async () => {
    currentLayout = readItemsFromGrid(currentLayout, grid, platform, root);
    // Keep the current tab responsive while the authoritative PUT is in
    // flight. A later server read always replaces this cache.
    saveLayout(storage, currentLayout, platform);
    try {
      const saved = await saveLayoutToServer({api, storage, platform, layout: currentLayout, revision: currentRevision});
      currentLayout = saved.layout;
      currentRevision = saved.revision;
      location?.assign?.(locationWithMode(location, false));
    } catch (error) {
      if (status) status.textContent = Number(error?.status) === 409
        ? "布局已被其他窗口更新，请刷新后再保存"
        : (error?.message || "布局保存失败");
    }
  });

  toolbar.querySelector("[data-layout-reset]")?.addEventListener("click", async () => {
    currentLayout = loadDefaultLayout(storage, platform);
    saveLayout(storage, currentLayout, platform);
    try {
      const saved = await saveLayoutToServer({api, storage, platform, layout: currentLayout, revision: currentRevision});
      currentLayout = saved.layout;
      currentRevision = saved.revision;
      location?.assign?.(locationWithMode(location, true));
    } catch (error) {
      if (status) status.textContent = Number(error?.status) === 409
        ? "布局已被其他窗口更新，请刷新后再恢复"
        : (error?.message || "默认布局恢复失败");
    }
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

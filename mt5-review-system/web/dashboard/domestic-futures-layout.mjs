import {
  cloneDefaultLayout as clonePlatformLayout,
  getLayoutConfig,
  getModuleDefinitions,
  layoutItem,
  loadLayout as loadPlatformLayout,
  normalizeLayout as normalizePlatformLayout,
  saveLayout as savePlatformLayout,
} from "./dashboard-layout.mjs";

export const LAYOUT_STORAGE_KEY = getLayoutConfig("domestic_futures").storageKey;
export const MODULE_DEFINITIONS = getModuleDefinitions("domestic_futures");
export const DEFAULT_LAYOUT = clonePlatformLayout("domestic_futures");

export const cloneDefaultLayout = () => clonePlatformLayout("domestic_futures");
export const normalizeLayout = (value) => normalizePlatformLayout(value, "domestic_futures");
export const loadLayout = (storage = globalThis.localStorage) => loadPlatformLayout(storage, "domestic_futures");
export const saveLayout = (storage = globalThis.localStorage, layout = DEFAULT_LAYOUT) => savePlatformLayout(storage, layout, "domestic_futures");
export {layoutItem};

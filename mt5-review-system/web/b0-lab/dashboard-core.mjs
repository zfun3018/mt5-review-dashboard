const MAX_COLUMNS = 12;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function definitionFor(definitions, type) {
  if (definitions?.get) return definitions.get(type) || null;
  return null;
}

function normalizeInstance(instance, definitions) {
  if (!instance?.id || !instance?.type) return null;
  const definition = definitionFor(definitions, instance.type);
  const defaultSize = definition?.defaultSize || {w: 4, h: 3};
  const normalized = {
    id: String(instance.id),
    type: String(instance.type),
    visible: instance.visible !== false,
    x: clampInteger(instance.x, 0, MAX_COLUMNS - 1, 0),
    y: clampInteger(instance.y, 0, 999, 0),
    w: clampInteger(instance.w, 1, MAX_COLUMNS, defaultSize.w),
    h: clampInteger(instance.h, 1, 20, defaultSize.h),
    settings: clone(instance.settings || {}),
  };
  if (!definition) normalized.status = "unavailable";
  return normalized;
}

export function normalizeWorkspace(candidate, definitions) {
  const seen = new Set();
  const instances = [];
  for (const raw of candidate?.instances || []) {
    const instance = normalizeInstance(raw, definitions);
    if (!instance || seen.has(instance.id)) continue;
    seen.add(instance.id);
    instances.push(instance);
  }
  return {version: 1, instances};
}

export function loadWorkspace(storage, key, fallback, definitions) {
  try {
    const raw = storage?.getItem?.(key);
    if (!raw) return clone(fallback);
    return normalizeWorkspace(JSON.parse(raw), definitions);
  } catch (_) {
    return clone(fallback);
  }
}

export function saveWorkspace(storage, key, workspace) {
  storage?.setItem?.(key, JSON.stringify(workspace));
}

function defaultIdFactory() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `module-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createWorkspace({definitions = new Map(), initial, idFactory = defaultIdFactory} = {}) {
  let state = normalizeWorkspace(initial || {version: 1, instances: []}, definitions);

  function get(id) {
    return state.instances.find((instance) => instance.id === id) || null;
  }

  function add(type, options = {}) {
    const definition = definitionFor(definitions, type);
    if (!definition) throw new Error(`Unknown module type: ${type}`);
    const id = options.id || idFactory();
    if (get(id)) throw new Error(`Module instance already exists: ${id}`);
    const instance = normalizeInstance({
      id,
      type,
      visible: options.visible,
      x: options.x ?? 0,
      y: options.y ?? 999,
      w: options.w ?? definition.defaultSize.w,
      h: options.h ?? definition.defaultSize.h,
      settings: {...definition.defaultSettings, ...options.settings},
    }, definitions);
    state.instances.push(instance);
    return clone(instance);
  }

  function duplicate(id) {
    const source = get(id);
    if (!source || source.status === "unavailable") return null;
    return add(source.type, {
      x: Math.min(source.x + 1, MAX_COLUMNS - 1),
      y: source.y + 1,
      w: source.w,
      h: source.h,
      settings: clone(source.settings),
    });
  }

  return Object.freeze({
    add,
    duplicate,
    get(id) {
      return clone(get(id));
    },
    remove(id) {
      const before = state.instances.length;
      state.instances = state.instances.filter((instance) => instance.id !== id);
      return state.instances.length !== before;
    },
    setVisibility(id, visible) {
      const instance = get(id);
      if (!instance) return false;
      instance.visible = Boolean(visible);
      return true;
    },
    updateLayout(id, layout) {
      const instance = get(id);
      if (!instance) return false;
      Object.assign(instance, normalizeInstance({...instance, ...layout}, definitions));
      return true;
    },
    replace(nextState) {
      state = normalizeWorkspace(nextState, definitions);
    },
    snapshot() {
      return clone(state);
    },
  });
}

function stateFromMetricMeta(meta) {
  const status = String(meta?.status || "");
  if (status === "insufficient_data") return "insufficient";
  if (status === "not_applicable") return "empty";
  if (status === "incomplete_data" || status === "estimated") return "warning";
  return "value";
}

export function setDashboardModulesLoading(registry, {findRoot} = {}) {
  for (const module of registry) {
    try {
      findRoot?.(module.rootSelector)?.setAttribute?.("data-module-state", "loading");
    } catch {
      // A missing module host must not prevent other modules from entering loading state.
    }
  }
}

export function setDashboardModulesError(registry, {findRoot} = {}) {
  for (const module of registry) {
    try {
      findRoot?.(module.rootSelector)?.setAttribute?.("data-module-state", "error");
    } catch {
      // Keep the remaining modules recoverable when a host node is unavailable.
    }
  }
}

export function renderDashboardModules(registry, {findRoot, renderers = {}, metricMeta = {}} = {}) {
  const states = {};
  for (const module of registry) {
    let root = null;
    try {
      root = findRoot?.(module.rootSelector);
      const render = renderers[module.id];
      if (typeof render !== "function") throw new Error(`Missing renderer for ${module.id}`);
      const rendererState = render();
      const state = rendererState === "error"
        ? "error"
        : stateFromMetricMeta(module.metricKey ? metricMeta[module.metricKey] : null);
      states[module.id] = state;
      root?.setAttribute?.("data-module-state", state);
    } catch {
      states[module.id] = "error";
      root?.setAttribute?.("data-module-state", "error");
    }
  }
  return states;
}

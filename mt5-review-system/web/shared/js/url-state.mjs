function defaultValue(rule) {
  return typeof rule.default === "function" ? rule.default() : rule.default;
}

function parseValue(params, key, rule) {
  if (rule.type === "array") {
    const values = params.getAll(key).filter(Boolean);
    return values.length ? values : (defaultValue(rule) || []);
  }
  const raw = params.get(key);
  if (raw === null || raw === "") return defaultValue(rule);
  if (typeof rule.parse === "function") {
    const parsed = rule.parse(raw);
    return parsed === undefined ? defaultValue(rule) : parsed;
  }
  if (rule.type === "boolean") {
    const normalized = raw.toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return defaultValue(rule);
  }
  if (rule.type === "integer" || rule.type === "number") {
    if (rule.type === "integer" && !/^[+-]?\d+$/.test(raw.trim())) return defaultValue(rule);
    const parsed = rule.type === "integer" ? Number(raw) : Number(raw);
    if (!Number.isFinite(parsed)) return defaultValue(rule);
    if (rule.min !== undefined && parsed < rule.min) return defaultValue(rule);
    if (rule.max !== undefined && parsed > rule.max) return defaultValue(rule);
    return parsed;
  }
  if (rule.values && !rule.values.includes(raw)) return defaultValue(rule);
  return raw;
}

export function readQuery(schema, search = globalThis.location?.search || "") {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    Object.entries(schema).map(([field, rule]) => [
      field,
      parseValue(params, rule.name || field, rule),
    ]),
  );
}

export function replaceQuery(
  values,
  environment = {location: globalThis.location, history: globalThis.history},
  schema = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      const rule = schema[key];
      if (item === undefined || item === null || item === "" || (item === false && rule?.type !== "boolean")) continue;
      params.append(key, item === true ? "1" : item === false && rule?.type === "boolean" ? "0" : String(item));
    }
  }
  const query = params.toString();
  const url = `${environment.location.pathname}${query ? `?${query}` : ""}${environment.location.hash || ""}`;
  environment.history.replaceState(null, "", url);
  return url;
}

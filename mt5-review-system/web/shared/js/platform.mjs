export const PLATFORM_OPTIONS = Object.freeze([
  Object.freeze({id: "mt5", label: "MT5"}),
  Object.freeze({id: "domestic_futures", label: "国内期货"}),
]);

const STORAGE_KEY = "mt5-review-platform";

export function normalizePlatform(value) {
  const text = String(value || "mt5").trim().toLowerCase();
  if (text === "tonghuashun" || text === "ths" || text === "tonghuashun_futures") return "domestic_futures";
  return PLATFORM_OPTIONS.some(({id}) => id === text) ? text : "mt5";
}

export function readPlatform(location = globalThis.location) {
  const params = new URLSearchParams(String(location?.search || ""));
  if (params.has("platform")) return normalizePlatform(params.get("platform"));
  try {
    return normalizePlatform(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch (_error) {
    return "mt5";
  }
}

export function writePlatform(platform) {
  const normalized = normalizePlatform(platform);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, normalized);
  } catch (_error) {
    // Restricted storage should not block workspace switching.
  }
  return normalized;
}

export function withPlatform(path, platform) {
  const normalized = normalizePlatform(platform);
  const source = String(path || "/dashboard/");
  const hashIndex = source.indexOf("#");
  const hash = hashIndex >= 0 ? source.slice(hashIndex) : "";
  const withoutHash = hashIndex >= 0 ? source.slice(0, hashIndex) : source;
  const queryIndex = withoutHash.indexOf("?");
  const pathname = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : "");
  params.set("platform", normalized);
  return `${pathname || "/"}?${params.toString()}${hash}`;
}

export function platformLabel(platform) {
  const normalized = normalizePlatform(platform);
  return PLATFORM_OPTIONS.find(({id}) => id === normalized)?.label || "MT5";
}

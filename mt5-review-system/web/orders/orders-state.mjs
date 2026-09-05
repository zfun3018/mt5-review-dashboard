import { readQuery, replaceQuery } from "../shared/js/url-state.mjs";

export const PAGE_SIZES = Object.freeze([20, 50, 100]);
export const DEFAULT_PAGE_SIZE = 50;

// URL-backed state for the Orders workspace. Keys stay camelCase in both the
// JavaScript state object and the URL so that read/write round-trips are exact;
// buildCampaignsQuery translates them into the server's snake_case contract.
const SCHEMA = {
  q: { type: "string", default: "" },
  side: { type: "string", default: "all", values: ["all", "long", "short"] },
  tradeType: { type: "string", default: "all" },
  strategy: { type: "string", default: "all" },
  start: { type: "string", default: "" },
  end: { type: "string", default: "" },
  rMissing: { type: "boolean", default: false },
  page: { type: "integer", default: 1, min: 1 },
  pageSize: { type: "integer", default: DEFAULT_PAGE_SIZE, min: 1, max: 200 },
  trade: { type: "string", default: "" },
  campaign: { type: "string", default: "" },
};

export function readOrdersState(search) {
  return readQuery(SCHEMA, search);
}

export function writeOrdersState(state, environment) {
  return replaceQuery(state, environment, SCHEMA);
}

export function normalizeListState(partial) {
  const merged = { ...readOrdersState(""), ...partial };
  merged.page = Math.max(1, Number(merged.page) || 1);
  merged.pageSize = Math.min(200, Math.max(1, Number(merged.pageSize) || DEFAULT_PAGE_SIZE));
  return merged;
}

export function buildCampaignsQuery(state) {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.side && state.side !== "all") params.set("side", state.side);
  if (state.tradeType && state.tradeType !== "all") params.set("trade_type", state.tradeType);
  if (state.strategy && state.strategy !== "all") params.set("strategy", state.strategy);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  if (state.rMissing) params.set("r_missing", "1");
  params.set("page", String(state.page ?? 1));
  params.set("page_size", String(state.pageSize ?? DEFAULT_PAGE_SIZE));
  return params.toString();
}

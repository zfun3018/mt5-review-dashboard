import { readQuery, replaceQuery } from "../shared/js/url-state.mjs";
import { DATE_PRESETS, resolveDateRange } from "../shared/js/date-range.mjs";

export { formatDateKey, shiftDateKey, spanDays, todayBeijing } from "../shared/js/date-range.mjs";

export const PRESETS = DATE_PRESETS;

const SCHEMA = {
  preset: { type: "string", default: "all", values: ["all", "today", "7d", "30d", "custom"] },
  start: { type: "string", default: "" },
  end: { type: "string", default: "" },
  equity_days: { type: "integer", default: null, min: 1, max: 366 },
  year: { type: "integer", default: null },
  month: { type: "integer", default: null, min: 1, max: 12 },
};

export function readDashboardState(search) {
  return readQuery(SCHEMA, search);
}

export function writeDashboardState(state, environment) {
  return replaceQuery(state, environment, SCHEMA);
}

export function resolveAnalysisWindow(state) {
  const range = resolveDateRange(state.preset, state.start, state.end);
  return {
    start: range.start,
    end: range.end,
    equityDays: range.days ?? state.equity_days ?? null,
  };
}

export function buildAnalysisQuery(state, window) {
  const params = new URLSearchParams();
  if (window.start) params.set("start", window.start);
  if (window.end) params.set("end", window.end);
  if (window.equityDays !== null && window.equityDays !== undefined) params.set("equity_days", String(window.equityDays));
  if (state.year) params.set("year", String(state.year));
  if (state.month) params.set("month", String(state.month));
  return params.toString();
}

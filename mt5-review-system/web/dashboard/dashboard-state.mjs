import { readQuery, replaceQuery } from "../shared/js/url-state.mjs";

export const PRESETS = Object.freeze([
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "custom", label: "自定义" },
]);

const SCHEMA = {
  preset: { type: "string", default: "all", values: ["all", "today", "7d", "30d", "custom"] },
  start: { type: "string", default: "" },
  end: { type: "string", default: "" },
  equity_days: { type: "integer", default: 30, min: 1, max: 366 },
  year: { type: "integer", default: null },
  month: { type: "integer", default: null, min: 1, max: 12 },
};

export function formatDateKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayBeijing() {
  return formatDateKey(new Date());
}

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function spanDays(start, end) {
  const startMs = new Date(`${start}T00:00:00+08:00`).getTime();
  const endMs = new Date(`${end}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const days = Math.round((endMs - startMs) / 86400000) + 1;
  return Math.max(1, Math.min(days, 366));
}

export function readDashboardState(search) {
  return readQuery(SCHEMA, search);
}

export function writeDashboardState(state, environment) {
  return replaceQuery(state, environment, SCHEMA);
}

export function resolveAnalysisWindow(state) {
  const today = todayBeijing();
  switch (state.preset) {
    case "today":
      return { start: today, end: today, equityDays: 1 };
    case "7d":
      return { start: shiftDateKey(today, -6), end: today, equityDays: 7 };
    case "30d":
      return { start: shiftDateKey(today, -29), end: today, equityDays: 30 };
    case "custom": {
      const days = spanDays(state.start, state.end) ?? state.equity_days ?? 30;
      return { start: state.start || "", end: state.end || "", equityDays: days };
    }
    default:
      return { start: "", end: "", equityDays: state.equity_days ?? 30 };
  }
}

export function buildAnalysisQuery(state, window) {
  const params = new URLSearchParams();
  if (window.start) params.set("start", window.start);
  if (window.end) params.set("end", window.end);
  params.set("equity_days", String(window.equityDays));
  if (state.year) params.set("year", String(state.year));
  if (state.month) params.set("month", String(state.month));
  return params.toString();
}

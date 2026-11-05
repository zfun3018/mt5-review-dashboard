export const DATE_PRESETS = Object.freeze([
  { value: "all", label: "全部时间" },
  { value: "today", label: "今天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "custom", label: "自定义" },
]);

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

export function resolveDateRange(preset, start = "", end = "") {
  const today = todayBeijing();
  switch (preset) {
    case "today":
      return { start: today, end: today, days: 1 };
    case "7d":
      return { start: shiftDateKey(today, -6), end: today, days: 7 };
    case "30d":
      return { start: shiftDateKey(today, -29), end: today, days: 30 };
    case "custom":
      return { start: start || "", end: end || "", days: spanDays(start, end) };
    default:
      return { start: "", end: "", days: null };
  }
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function isMissing(value) {
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value));
}

export function formatMoney(value) {
  if (isMissing(value)) return "-";
  return moneyFormatter.format(Number(value));
}

export function signedR(value) {
  const parsed = Number(value);
  const prefix = parsed > 0 ? "+" : "";
  return `${prefix}${parsed.toFixed(2)}R`;
}

export function formatR(value) {
  if (isMissing(value)) return "-";
  return signedR(value);
}

// Backwards-compatible alias kept for callers migrating from the monolithic app.
export function formatRValue(value) {
  return formatR(value);
}

export function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

export function formatRatio(value) {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(2);
}

export function formatPrice(value) {
  if (isMissing(value)) return "-";
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 8 });
}

export function formatVolume(value) {
  if (isMissing(value)) return "-";
  return Number(value).toFixed(2);
}

export function formatHoldingTime(seconds) {
  if (isMissing(seconds)) return "-";
  const total = Math.max(0, Math.round(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  if (days) return `${days}天${hours}时`;
  if (hours) return `${hours}时${minutes}分`;
  if (minutes) return `${minutes}分${remainingSeconds}秒`;
  return `${remainingSeconds}秒`;
}

export function formatTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatCurveTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).replace(", ", " ");
}

export function formatHour(iso) {
  return new Date(iso).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatZoneTime(date, zone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatBeijingDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

export function zClassification(value) {
  return {
    alternating: "交替",
    clustered: "成串",
    independent: "独立",
    insufficient_data: "样本不足",
  }[value] || "样本不足";
}

export function formatZScore(value) {
  const z = value || {};
  return z.z === null || z.z === undefined
    ? "样本不足"
    : `${Number(z.z).toFixed(2)} · ${zClassification(z.classification)}`;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

export function profitClass(value) {
  return Number(value) < 0 ? "loss-text" : "profit-text";
}

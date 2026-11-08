const definition = (id, title, subtitle, x, y, w, h, minW, minH, kind, fit, maxW = 12, maxH = 16) => ({
  id,
  title,
  subtitle,
  x,
  y,
  w,
  h,
  minW,
  minH,
  maxW,
  maxH,
  kind,
  fit,
  visible: true,
});

const DOMESTIC_FUTURES_DEFINITIONS = [
  definition("period-overview", "固定周期指标", "独立周期统计，不受上方时间筛选影响", 0, 0, 12, 5, 6, 5, "metrics", "resize", 12, 32),
  definition("net-performance", "累计净盈亏", "已包含手续费，按平仓成交时间归集", 0, 5, 8, 8, 6, 6, "chart", "resize"),
  definition("risk-health", "账户风险状态", "已实现结果压力，不含保证金和未实现盈亏", 8, 5, 4, 8, 3, 5, "metrics", "scroll"),
  definition("monthly-pnl", "月度盈亏", "正柱为品种盈利堆叠，负柱为品种亏损堆叠，折线展示月度净盈亏", 0, 13, 6, 8, 4, 6, "chart", "resize"),
  definition("daily-calendar", "盈亏日历", "", 6, 13, 6, 8, 6, 8, "calendar", "resize"),
  definition("contract-contribution", "合约贡献", "仅显示净盈利合约 · 花瓣长度表示盈利金额", 0, 21, 4, 7, 3, 4, "chart", "resize"),
  definition("contract-losses", "合约亏损榜", "按品种着色 · 面积表示净亏损金额", 4, 21, 4, 8, 3, 4, "chart", "resize"),
  definition("data-health", "数据与导入", "数据批次与质量", 8, 21, 4, 5, 3, 4, "metrics", "resize"),
  definition("review-coverage", "复盘完成度", "填写初始止损即视为完成", 8, 26, 4, 3, 3, 3, "metrics", "resize"),
  definition("system-evaluation", "交易系统评估", "按交易日查看净盈亏、手续费、胜率、盈亏比和期望值", 0, 29, 12, 8, 8, 6, "table", "scroll"),
  definition("mode-evaluation", "交易模式评估", "比较交易类型和策略的真实贡献", 0, 37, 12, 8, 6, 5, "table", "scroll"),
];

const MT5_DEFINITIONS = [
  definition("r-metrics", "R 指标概览", "按交易组合评估风险回报", 0, 0, 12, 4, 6, 2, "metrics", "resize", 12, 6),
  definition("equity", "收益累计曲线", "按交易组合累计收益", 0, 4, 12, 8, 6, 6, "chart", "resize"),
  definition("calendar", "盈亏日历", "按北京时间展示每日净盈亏", 6, 12, 6, 8, 5, 4, "calendar", "resize", 12, 16),
  definition("monthly-pnl", "月度盈亏", "按平仓月份汇总成本后的净盈亏", 0, 12, 6, 10, 4, 6, "chart", "resize"),
  definition("heatmap", "周期共振热力图", "按北京时间查看交易集中区间", 6, 20, 6, 7, 6, 6, "chart", "resize"),
  definition("sessions", "盘面胜率", "按交易时段比较净盈亏和胜率", 0, 22, 6, 5, 3, 4, "metrics", "resize"),
  definition("period-overview", "交易系统评估", "四个周期各一张卡，展示六项核心指标", 0, 27, 12, 7, 8, 6, "metrics", "resize"),
  definition("daily-evaluation", "每日订单汇总", "按北京时间平仓日汇总交易结果", 0, 34, 12, 10, 8, 7, "table", "resize"),
  definition("mode-evaluation", "交易模式评估", "比较交易场景和策略的真实贡献", 0, 44, 12, 16, 6, 7, "table", "resize"),
];

const CONFIGS = Object.freeze({
  mt5: Object.freeze({storageKey: "mt5-dashboard-layout-v1", definitions: MT5_DEFINITIONS}),
  domestic_futures: Object.freeze({storageKey: "domestic-futures-dashboard-layout-v3", definitions: DOMESTIC_FUTURES_DEFINITIONS}),
});

function platformKey(platform) {
  return platform === "domestic_futures" ? "domestic_futures" : "mt5";
}

const clamp = (value, min, max) => Math.min(
  max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min),
);

function configFor(platform) {
  return CONFIGS[platformKey(platform)];
}

function normalizeItem(definitionItem, raw = {}) {
  const previousDefaultCalendarFootprint = definitionItem.id === "daily-calendar"
    && Number(raw.w) === 4
    && Number(raw.h) === 7;
  const previousCompactCalendarFootprint = definitionItem.id === "daily-calendar"
    && Number(raw.w) === 4
    && Number(raw.h) === 5;
  const previousMonthlyCalendarFootprint = definitionItem.id === "monthly-pnl"
    && Number(raw.x) === 0
    && Number(raw.y) === 13
    && Number(raw.w) === 8
    && Number(raw.h) === 8;
  // Older layouts could not shrink this module below 8×10 GridStack cells.
  const legacyCalendarMinimum = definitionItem.id === "calendar" && Number(raw.w) === 8 && Number(raw.h) === 10;
  const requestedWidth = legacyCalendarMinimum ? definitionItem.minW : previousCompactCalendarFootprint || previousMonthlyCalendarFootprint ? definitionItem.w : raw.w ?? definitionItem.w;
  const requestedHeight = legacyCalendarMinimum
    ? definitionItem.minH
    : previousDefaultCalendarFootprint || previousCompactCalendarFootprint ? definitionItem.h : raw.h ?? definitionItem.h;
  const requestedX = legacyCalendarMinimum ? Number(raw.x ?? definitionItem.x) + 1 : previousCompactCalendarFootprint ? definitionItem.x : raw.x ?? definitionItem.x;
  const w = clamp(requestedWidth, definitionItem.minW, Math.min(definitionItem.maxW, 12));
  const legacyEvaluationTitle = definitionItem.id === "period-overview" && raw.title === "周期交易概览";
  const legacyEvaluationSubtitle = definitionItem.id === "period-overview"
    && new Set([
      "同时比较四个周期的六项核心指标",
      "六项指标分别比较四个周期，保留各自刻度和实际数值",
      "六项核心指标，快速对比四个周期",
    ]).has(raw.subtitle);
  const legacyMonthlyPnlSubtitles = new Set([
    "按平仓月份汇总成本后的净盈亏",
    "按平仓月份展示各品种净盈亏构成",
  ]);
  const legacyMonthlyPnlSubtitle = definitionItem.id === "monthly-pnl" && legacyMonthlyPnlSubtitles.has(raw.subtitle);
  return {
    id: definitionItem.id,
    x: clamp(requestedX, 0, 12 - w),
    y: clamp(raw.y ?? definitionItem.y, 0, 999),
    w,
    h: clamp(requestedHeight, definitionItem.minH, definitionItem.maxH),
    minW: definitionItem.minW,
    minH: definitionItem.minH,
    maxW: definitionItem.maxW,
    maxH: definitionItem.maxH,
    kind: definitionItem.kind,
    fit: definitionItem.fit,
    visible: raw.visible !== false,
    title: legacyEvaluationTitle
      ? definitionItem.title
      : typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : definitionItem.title,
    subtitle: legacyEvaluationSubtitle
      ? definitionItem.subtitle
      : legacyMonthlyPnlSubtitle
        ? definitionItem.subtitle
      : typeof raw.subtitle === "string" ? raw.subtitle.trim() : definitionItem.subtitle,
  };
}

export function getLayoutConfig(platform = "mt5") {
  const config = configFor(platform);
  return {storageKey: config.storageKey, definitions: config.definitions.map((item) => ({...item}))};
}

export function getModuleDefinitions(platform = "mt5") {
  return getLayoutConfig(platform).definitions;
}

export function cloneDefaultLayout(platform = "mt5") {
  const config = configFor(platform);
  return {version: 1, columns: 12, items: config.definitions.map((item) => ({...item}))};
}

export function normalizeLayout(value, platform = "mt5") {
  const config = configFor(platform);
  const sourceItems = Array.isArray(value?.items) ? value.items : [];
  const definitionsById = new Map(config.definitions.map((item) => [item.id, item]));
  const sourceById = new Map(sourceItems.filter((item) => definitionsById.has(item?.id)).map((item) => [item.id, item]));
  return {
    version: 1,
    columns: 12,
    items: config.definitions.map((item) => {
      const source = sourceById.get(item.id);
      return normalizeItem(item, source);
    }),
  };
}

export function loadLayout(storage = globalThis.localStorage, platform = "mt5") {
  const storageKey = configFor(platform).storageKey;
  try {
    const saved = storage?.getItem(storageKey);
    const layout = saved ? normalizeLayout(JSON.parse(saved), platform) : cloneDefaultLayout(platform);
    if (!storage?.getItem?.(defaultStorageKey(platform))) {
      saveLayoutAsDefault(storage, layout, platform);
    }
    return layout;
  } catch (_) {
    return cloneDefaultLayout(platform);
  }
}

function defaultStorageKey(platform) {
  return `${configFor(platform).storageKey}-default`;
}

function layoutEndpoint(platform) {
  return `/api/dashboard-layout?platform=${encodeURIComponent(platformKey(platform))}`;
}

export async function loadLayoutFromServer({
  api,
  storage = globalThis.localStorage,
  platform = "mt5",
} = {}) {
  const localLayout = loadLayout(storage, platform);
  if (!api?.requestJson) return {layout: localLayout, revision: 0, source: "local"};
  const record = await api.requestJson(layoutEndpoint(platform));
  if (!record || !Object.prototype.hasOwnProperty.call(record, "revision")) {
    return {layout: localLayout, revision: 0, source: "local"};
  }
  const cacheServerLayout = (serverRecord, source = "server") => {
    const layout = normalizeLayout(serverRecord.layout, platform);
    saveLayout(storage, layout, platform);
    saveLayoutAsDefault(storage, layout, platform);
    return {layout, revision: Number(serverRecord.revision) || 0, source};
  };
  if (record?.layout && Array.isArray(record.layout.items)) {
    return cacheServerLayout(record);
  }
  try {
    // Empty or legacy server JSON cannot represent a module layout. Seed the
    // deterministic project default rather than reviving browser-specific
    // cached geometry.
    const seeded = await api.requestJson(layoutEndpoint(platform), {
      method: "PUT",
      body: {revision: Number(record.revision) || 0, layout: cloneDefaultLayout(platform)},
    });
    return cacheServerLayout(seeded, "migration");
  } catch (error) {
    if (Number(error?.status) !== 409) throw error;
    const current = await api.requestJson(layoutEndpoint(platform));
    if (!Array.isArray(current?.layout?.items)) throw error;
    return cacheServerLayout(current);
  }
}

export async function saveLayoutToServer({
  api,
  storage = globalThis.localStorage,
  platform = "mt5",
  layout,
  revision = 0,
} = {}) {
  const normalized = normalizeLayout(layout, platform);
  if (!api?.requestJson) {
    saveLayout(storage, normalized, platform);
    return {layout: normalized, revision: Number(revision) || 0, source: "local"};
  }
  let record;
  try {
    record = await api.requestJson(layoutEndpoint(platform), {
      method: "PUT",
      body: {revision: Number(revision) || 0, layout: normalized},
    });
  } catch (error) {
    // Layout preferences use last-save-wins semantics. If another open
    // editor saved first, retry this explicit user save once against the
    // current server revision so the editor can finish and all viewers can
    // converge on the same layout.
    if (Number(error?.status) !== 409) throw error;
    const current = await api.requestJson(layoutEndpoint(platform));
    record = await api.requestJson(layoutEndpoint(platform), {
      method: "PUT",
      body: {revision: Number(current?.revision) || 0, layout: normalized},
    });
  }
  const nextLayout = normalizeLayout(record.layout, platform);
  saveLayout(storage, nextLayout, platform);
  return {layout: nextLayout, revision: Number(record.revision) || 0, source: "server"};
}

export function watchDashboardLayout({
  api,
  platform = "mt5",
  revision = 0,
  location = globalThis.location,
  intervalMs = 4000,
} = {}) {
  if (!api?.requestJson || typeof location?.reload !== "function") return () => {};
  const knownRevision = Number(revision) || 0;
  let checking = false;
  let changed = false;
  const check = async () => {
    if (checking || changed || globalThis.document?.hidden) return;
    checking = true;
    try {
      const current = await api.requestJson(`${layoutEndpoint(platform)}&check=${Date.now()}`);
      if (Number(current?.revision) !== knownRevision) {
        changed = true;
        location.reload();
      }
    } catch (_) {
      // A transient network error must not interrupt dashboard use.
    } finally {
      checking = false;
    }
  };
  const timer = globalThis.setInterval(check, intervalMs);
  return () => globalThis.clearInterval(timer);
}

export function loadDefaultLayout(storage = globalThis.localStorage, platform = "mt5") {
  try {
    const saved = storage?.getItem(defaultStorageKey(platform));
    return saved ? normalizeLayout(JSON.parse(saved), platform) : cloneDefaultLayout(platform);
  } catch (_) {
    return cloneDefaultLayout(platform);
  }
}

export function saveLayoutAsDefault(storage = globalThis.localStorage, layout = null, platform = "mt5") {
  try {
    storage?.setItem(defaultStorageKey(platform), JSON.stringify(normalizeLayout(layout, platform)));
    return true;
  } catch (_) {
    return false;
  }
}

export function saveLayout(storage = globalThis.localStorage, layout = null, platform = "mt5") {
  try {
    storage?.setItem(configFor(platform).storageKey, JSON.stringify(normalizeLayout(layout, platform)));
    return true;
  } catch (_) {
    return false;
  }
}

export function layoutItem(layout, id) {
  return layout.items.find((item) => item.id === id) || null;
}

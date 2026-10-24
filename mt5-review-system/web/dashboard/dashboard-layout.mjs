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
  definition("period-overview", "固定周期指标", "独立周期统计，不受上方时间筛选影响", 0, 0, 12, 5, 6, 3, "metrics", "flow", 12, 8),
  definition("net-performance", "累计净盈亏", "已包含手续费，按平仓成交时间归集", 0, 5, 8, 8, 6, 6, "chart", "resize"),
  definition("risk-health", "账户风险状态", "已实现结果压力，不含保证金和未实现盈亏", 8, 5, 4, 8, 3, 5, "metrics", "scroll"),
  definition("monthly-pnl", "月度盈亏", "正柱为品种盈利堆叠，负柱为品种亏损堆叠，折线展示月度净盈亏", 0, 13, 8, 8, 4, 6, "chart", "resize"),
  definition("daily-calendar", "盈亏日历", "", 8, 13, 4, 5, 4, 5, "calendar", "resize"),
  definition("contract-contribution", "合约贡献", "仅显示净盈利合约 · 花瓣长度表示盈利金额", 0, 21, 4, 7, 3, 4, "chart", "resize"),
  definition("contract-losses", "合约亏损榜", "按品种着色 · 面积表示净亏损金额", 4, 21, 4, 8, 3, 4, "chart", "resize"),
  definition("data-health", "数据与导入", "数据批次与质量", 8, 21, 4, 7, 3, 4, "metrics", "scroll"),
  definition("review-coverage", "复盘完成度", "填写初始止损即视为完成", 0, 29, 4, 6, 3, 4, "metrics", "scroll"),
  definition("system-evaluation", "交易系统评估", "按交易日查看净盈亏、手续费、胜率、盈亏比和期望值", 4, 29, 8, 8, 8, 6, "table", "scroll"),
  definition("mode-evaluation", "交易模式评估", "比较交易类型和策略的真实贡献", 0, 37, 12, 8, 6, 5, "table", "scroll"),
];

const MT5_DEFINITIONS = [
  definition("r-metrics", "R 指标概览", "按交易组合评估风险回报", 0, 0, 12, 4, 6, 4, "metrics", "flow", 12, 6),
  definition("equity", "收益累计曲线", "按交易组合累计收益", 0, 5, 12, 8, 6, 6, "chart", "resize"),
  definition("calendar", "盈亏日历", "按北京时间展示每日净盈亏", 2, 13, 8, 8, 6, 8, "calendar", "resize", 12, 16),
  definition("monthly-pnl", "月度盈亏", "按平仓月份汇总成本后的净盈亏", 0, 21, 6, 7, 5, 6, "chart", "resize"),
  definition("heatmap", "周期共振热力图", "按北京时间查看交易集中区间", 6, 21, 6, 7, 5, 6, "chart", "resize"),
  definition("sessions", "盘面胜率", "按交易时段比较净盈亏和胜率", 0, 28, 4, 7, 3, 4, "metrics", "scroll"),
  definition("period-overview", "交易系统评估", "六项指标分别比较四个周期，保留各自刻度和实际数值", 4, 28, 8, 9, 8, 8, "chart", "resize"),
  definition("daily-evaluation", "每日订单汇总", "按北京时间平仓日汇总交易结果", 0, 36, 12, 10, 8, 7, "table", "scroll"),
  definition("mode-evaluation", "交易模式评估", "比较交易场景和策略的真实贡献", 0, 46, 12, 9, 6, 5, "table", "scroll"),
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
  // Older layouts could not shrink this module below 8×10 GridStack cells.
  const legacyCalendarMinimum = definitionItem.id === "calendar" && Number(raw.w) === 8 && Number(raw.h) === 10;
  const requestedWidth = legacyCalendarMinimum ? definitionItem.minW : raw.w ?? definitionItem.w;
  const requestedHeight = legacyCalendarMinimum
    ? definitionItem.minH
    : previousDefaultCalendarFootprint ? definitionItem.h : raw.h ?? definitionItem.h;
  const requestedX = legacyCalendarMinimum ? Number(raw.x ?? definitionItem.x) + 1 : raw.x ?? definitionItem.x;
  const w = clamp(requestedWidth, definitionItem.minW, Math.min(definitionItem.maxW, 12));
  const legacyEvaluationTitle = definitionItem.id === "period-overview" && raw.title === "周期交易概览";
  const legacyEvaluationSubtitle = definitionItem.id === "period-overview" && raw.subtitle === "同时比较四个周期的六项核心指标";
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
  return {version: 1, columns: 12, items: config.definitions.map((item) => normalizeItem(item, sourceById.get(item.id)))};
}

export function loadLayout(storage = globalThis.localStorage, platform = "mt5") {
  const storageKey = configFor(platform).storageKey;
  try {
    const saved = storage?.getItem(storageKey);
    return saved ? normalizeLayout(JSON.parse(saved), platform) : cloneDefaultLayout(platform);
  } catch (_) {
    return cloneDefaultLayout(platform);
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

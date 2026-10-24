import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("domestic futures layout schema exposes stable modules and defaults", async () => {
  const {DEFAULT_LAYOUT, MODULE_DEFINITIONS, cloneDefaultLayout} = await import(moduleUrl("dashboard/domestic-futures-layout.mjs"));

  assert.equal(DEFAULT_LAYOUT.version, 1);
  assert.equal(MODULE_DEFINITIONS.length, 11);
  assert.deepEqual(cloneDefaultLayout(), DEFAULT_LAYOUT);
  assert.equal(DEFAULT_LAYOUT.items.find((item) => item.id === "net-performance").w, 8);
  assert.equal(DEFAULT_LAYOUT.items.find((item) => item.id === "period-overview").visible, true);
  assert.equal(DEFAULT_LAYOUT.items.some((item) => item.id === "r-metrics"), false);
  assert.equal(DEFAULT_LAYOUT.items.find((item) => item.id === "net-performance").kind, "chart");
  assert.equal(DEFAULT_LAYOUT.items.find((item) => item.id === "net-performance").fit, "resize");
});

test("layout schema keeps MT5 modules and storage isolated from domestic futures", async () => {
  const {
    getLayoutConfig,
    getModuleDefinitions,
    loadLayout,
    saveLayout,
  } = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  assert.deepEqual(getModuleDefinitions("mt5").map((item) => item.id), [
    "r-metrics", "equity", "calendar", "monthly-pnl", "heatmap", "sessions", "period-overview", "daily-evaluation", "mode-evaluation",
  ]);
  assert.notEqual(getLayoutConfig("mt5").storageKey, getLayoutConfig("domestic_futures").storageKey);
  const resetLayout = (await import(moduleUrl("dashboard/dashboard-layout.mjs"))).cloneDefaultLayout("mt5");
  resetLayout.items[0].title = "自定义标题";
  assert.equal(resetLayout.items[0].title, "自定义标题");
  assert.equal(saveLayout(adapter, loadLayout(adapter, "mt5"), "mt5"), true);
  assert.equal(saveLayout(adapter, loadLayout(adapter, "domestic_futures"), "domestic_futures"), true);
  assert.match(storage.get("mt5-dashboard-layout-v1"), /"r-metrics"/);
  assert.match(storage.get("domestic-futures-dashboard-layout-v3"), /"period-overview"/);
  assert.match(storage.get("mt5-dashboard-layout-v1"), /"daily-evaluation"/);
});

test("chart and dense-table modules declare minimum sizes that protect their live content", async () => {
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const definitions = Object.fromEntries(getModuleDefinitions("domestic_futures").map((item) => [item.id, item]));
  assert.ok(definitions["net-performance"].minW >= 6);
  assert.ok(definitions["net-performance"].minH >= 6);
  assert.ok(definitions["daily-calendar"].minW >= 4);
  assert.equal(definitions["daily-calendar"].minH, 5);
  assert.equal(definitions["daily-calendar"].h, 5);
  assert.ok(definitions["system-evaluation"].minW >= 8);
  assert.ok(definitions["system-evaluation"].minH >= 6);
  const mt5 = Object.fromEntries(getModuleDefinitions("mt5").map((item) => [item.id, item]));
  assert.ok(mt5.equity.minW >= 6 && mt5.equity.minH >= 6);
  assert.ok(mt5.calendar.minW >= 6 && mt5.calendar.minH >= 8);
  assert.ok(mt5.heatmap.minW >= 5 && mt5.heatmap.minH >= 6);
  assert.ok(mt5["period-overview"].minW >= 6 && mt5["period-overview"].minH >= 6);
  assert.ok(mt5["daily-evaluation"].minW >= 8 && mt5["daily-evaluation"].minH >= 7);
  for (const item of [...Object.values(definitions), ...Object.values(mt5)]) {
    assert.ok(["chart", "calendar", "metrics", "table"].includes(item.kind));
    assert.ok(["resize", "scroll", "flow"].includes(item.fit));
  }
});

test("layout normalization preserves display settings and drops unknown modules", async () => {
  const {normalizeLayout} = await import(moduleUrl("dashboard/domestic-futures-layout.mjs"));

  const layout = normalizeLayout({
    version: 1,
    items: [
      {id: "net-performance", x: -2, y: 5, w: 99, h: 1, title: "净收益走势", subtitle: "只看净值"},
      {id: "unknown", x: 0, y: 0, w: 1, h: 1},
    ],
  });

  assert.equal(layout.items.length, 11);
  assert.deepEqual(layout.items.find((item) => item.id === "net-performance"), {
    id: "net-performance",
    x: 0,
    y: 5,
    w: 12,
    h: 6,
    minW: 6,
    minH: 6,
    maxW: 12,
    maxH: 16,
    kind: "chart",
    fit: "resize",
    visible: true,
    title: "净收益走势",
    subtitle: "只看净值",
  });
});

test("layout normalization migrates the old default calendar size and preserves custom height", async () => {
  const {normalizeLayout} = await import(moduleUrl("dashboard/domestic-futures-layout.mjs"));
  const previousDefault = normalizeLayout({items: [{id: "daily-calendar", x: 8, y: 13, w: 4, h: 7}]});
  const customHeight = normalizeLayout({items: [{id: "daily-calendar", x: 8, y: 13, w: 4, h: 8}]});

  assert.equal(previousDefault.items.find((item) => item.id === "daily-calendar").h, 5);
  assert.equal(customHeight.items.find((item) => item.id === "daily-calendar").h, 8);
});

test("layout normalization refreshes prior default monthly pnl descriptions and keeps custom text", async () => {
  const {normalizeLayout} = await import(moduleUrl("dashboard/domestic-futures-layout.mjs"));
  const legacyMigrated = normalizeLayout({items: [{id: "monthly-pnl", subtitle: "按平仓月份汇总成本后的净盈亏"}]});
  const previousMigrated = normalizeLayout({items: [{id: "monthly-pnl", subtitle: "按平仓月份展示各品种净盈亏构成"}]});
  const custom = normalizeLayout({items: [{id: "monthly-pnl", subtitle: "自定义说明"}]});

  assert.equal(legacyMigrated.items.find((item) => item.id === "monthly-pnl").subtitle, "正柱为品种盈利堆叠，负柱为品种亏损堆叠，折线展示月度净盈亏");
  assert.equal(previousMigrated.items.find((item) => item.id === "monthly-pnl").subtitle, "正柱为品种盈利堆叠，负柱为品种亏损堆叠，折线展示月度净盈亏");
  assert.equal(custom.items.find((item) => item.id === "monthly-pnl").subtitle, "自定义说明");
});

test("layout persistence falls back to defaults for malformed data", async () => {
  const {loadLayout, saveLayout} = await import(moduleUrl("dashboard/domestic-futures-layout.mjs"));
  const storage = new Map();
  const adapter = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  adapter.setItem("domestic-futures-dashboard-layout-v3", "{bad json");
  assert.equal(loadLayout(adapter).items.length, 11);
  const saved = saveLayout(adapter, loadLayout(adapter));
  assert.equal(saved, true);
  assert.match(storage.get("domestic-futures-dashboard-layout-v3"), /"version":1/);
});

test("legacy synthetic layout prototype remains isolated from the live dashboard", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/mock-domestic-futures.html"), "utf8");
  const editor = fs.readFileSync(path.join(webRoot, "dashboard/mock-domestic-futures-layout.html"), "utf8");
  const editorScript = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-layout-editor.mjs"), "utf8");

  assert.match(html, /mock-domestic-futures-layout\.html/);
  assert.match(html, /domestic-futures-layout-view\.mjs/);
  assert.doesNotMatch(html, /<script[^>]+src="\.\.\/vendor\/gridstack-all\.js"/);
  assert.doesNotMatch(html, /<script[^>]+src="\.\.\/vendor\/gridstack\.min\.css"/);
  assert.match(editor, /vendor\/gridstack-all\.js/);
  assert.match(editor, /data-layout-action="export"/);
  assert.match(editor, /data-layout-action="import"/);
  assert.match(editor, /data-layout-action="reset"/);
  assert.match(editor, /titleInput/);
  assert.match(editor, /subtitleInput/);
  assert.match(editorScript, /params\.get\("platform"\)/);
  assert.match(editorScript, /getModuleDefinitions\(platform\)/);
  assert.match(editorScript, /\$\{platform\}-dashboard-layout\.json/);
});

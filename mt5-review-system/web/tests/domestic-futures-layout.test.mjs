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
    "r-metrics", "equity", "calendar", "monthly-pnl", "heatmap", "sessions", "system-evaluation", "mode-evaluation",
  ]);
  assert.notEqual(getLayoutConfig("mt5").storageKey, getLayoutConfig("domestic_futures").storageKey);
  const resetLayout = (await import(moduleUrl("dashboard/dashboard-layout.mjs"))).cloneDefaultLayout("mt5");
  resetLayout.items[0].title = "自定义标题";
  assert.equal(resetLayout.items[0].title, "自定义标题");
  assert.equal(saveLayout(adapter, loadLayout(adapter, "mt5"), "mt5"), true);
  assert.equal(saveLayout(adapter, loadLayout(adapter, "domestic_futures"), "domestic_futures"), true);
  assert.match(storage.get("mt5-dashboard-layout-v1"), /"r-metrics"/);
  assert.match(storage.get("domestic-futures-dashboard-layout-v3"), /"period-overview"/);
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
    h: 4,
    minW: 4,
    minH: 4,
    maxW: 12,
    maxH: 16,
    visible: true,
    title: "净收益走势",
    subtitle: "只看净值",
  });
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

test("dashboard view delegates layout editing to the standalone editor", () => {
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

import assert from "node:assert/strict";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;
const editorSource = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-layout-editor.mjs"), "utf8");

test("dashboard grid runtime configures GridStack for the saved layout in static mode", async () => {
  const {createDashboardGrid} = await import(moduleUrl("dashboard/dashboard-grid.mjs"));
  const root = {
    classList: {add() {}},
    querySelectorAll() { return []; },
  };
  const calls = [];
  const GridStack = {
    init(options, element) {
      calls.push({options, element});
      return {on() {}, destroy() {}};
    },
  };

  const controller = createDashboardGrid({
    root,
    GridStack,
    layout: {columns: 12, items: []},
    editable: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.column, 12);
  assert.equal(calls[0].options.staticGrid, true);
  assert.equal(controller.runtime, "gridstack");
  controller.destroy();
});

test("dashboard grid runtime enables movement and resize only for the editor", async () => {
  const {buildDashboardGridOptions} = await import(moduleUrl("dashboard/dashboard-grid.mjs"));
  const options = buildDashboardGridOptions({editable: true});
  assert.equal(options.staticGrid, false);
  assert.equal(options.disableDrag, false);
  assert.equal(options.disableResize, false);
  assert.match(options.draggable.handle, /\.panel-head/);
  assert.match(options.draggable.handle, /\.domestic-panel-head/);
  assert.match(options.draggable.handle, /\[data-layout-drag-handle\]/);
  assert.match(options.resizable.handles, /se/);
});

test("layout editor reuses the dashboard grid dimensions", async () => {
  const {buildDashboardGridOptions} = await import(moduleUrl("dashboard/dashboard-grid.mjs"));
  const options = buildDashboardGridOptions({editable: true});

  assert.equal(options.cellHeight, 48);
  assert.equal(options.margin, 12);
  assert.match(editorSource, /buildDashboardGridOptions/);
  assert.doesNotMatch(editorSource, /cellHeight:\s*70/);
});

test("MT5 calendar uses the project preview footprint", async () => {
  const {getModuleDefinitions, normalizeLayout} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const calendar = getModuleDefinitions("mt5").find((item) => item.id === "calendar");

  assert.deepEqual({x: calendar.x, w: calendar.w, h: calendar.h, minW: calendar.minW, minH: calendar.minH}, {
    x: 6, w: 6, h: 8, minW: 5, minH: 4,
  });

  const previousMinimum = normalizeLayout({items: [{id: "calendar", x: 4, y: 13, w: 8, h: 10}]}).items.find((item) => item.id === "calendar");
  assert.deepEqual({x: previousMinimum.x, w: previousMinimum.w, h: previousMinimum.h}, {x: 5, w: 5, h: 4});
});

test("MT5 evaluation cards stay separate from the scrollable daily table", async () => {
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const definitions = getModuleDefinitions("mt5");
  const period = definitions.find((item) => item.id === "period-overview");
  const daily = definitions.find((item) => item.id === "daily-evaluation");

  assert.ok(period);
  assert.ok(daily);
  assert.equal(period.kind, "metrics");
  assert.equal(period.fit, "resize");
  assert.equal(daily.fit, "resize");
  assert.ok(daily.minH >= 6);
  assert.deepEqual({w: period.w, h: period.h, minW: period.minW, minH: period.minH}, {w: 12, h: 7, minW: 8, minH: 6});

  const migrated = (await import(moduleUrl("dashboard/dashboard-layout.mjs"))).normalizeLayout({items: [
    {id: "period-overview", title: "周期交易概览", subtitle: "同时比较四个周期的六项核心指标"},
    {id: "daily-evaluation", title: "我的每日汇总"},
  ]});
  assert.equal(migrated.items.find((item) => item.id === "period-overview").title, "交易系统评估");
  assert.equal(migrated.items.find((item) => item.id === "period-overview").subtitle, "四个周期各一张卡，展示六项核心指标");
  assert.equal(migrated.items.find((item) => item.id === "period-overview").kind, "metrics");
  assert.equal(migrated.items.find((item) => item.id === "daily-evaluation").title, "我的每日汇总");
});

test("MT5 R metrics use the project preview surface", async () => {
  const {getModuleDefinitions, normalizeLayout} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const metric = getModuleDefinitions("mt5").find((item) => item.id === "r-metrics");
  assert.ok(metric);
  assert.equal(metric.fit, "resize");
  assert.deepEqual({x: metric.x, y: metric.y, w: metric.w, h: metric.h, minH: metric.minH}, {x: 0, y: 0, w: 12, h: 4, minH: 2});
  const equity = getModuleDefinitions("mt5").find((item) => item.id === "equity");
  assert.equal(equity.y, 4);

  const migrated = normalizeLayout({items: Object.entries({
    "r-metrics": [0, 0, 12, 4], equity: [0, 5, 12, 8], calendar: [2, 13, 8, 8],
    "monthly-pnl": [0, 21, 6, 7], heatmap: [6, 21, 6, 7], sessions: [0, 28, 4, 7],
    "period-overview": [4, 28, 8, 9], "daily-evaluation": [0, 36, 12, 10], "mode-evaluation": [0, 46, 12, 9],
  }).map(([id, [x, y, w, h]]) => ({id, x, y, w, h}))});
  assert.equal(migrated.items.find((item) => item.id === "r-metrics").h, 4);
});

test("MT5 session module uses the preview height for three glass cards", async () => {
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const sessions = getModuleDefinitions("mt5").find((item) => item.id === "sessions");
  assert.ok(sessions);
  assert.equal(sessions.fit, "resize");
  assert.deepEqual({h: sessions.h, minH: sessions.minH}, {h: 5, minH: 4});
});

test("MT5 mode evaluation keeps the project preview table contract", async () => {
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const mode = getModuleDefinitions("mt5").find((item) => item.id === "mode-evaluation");
  assert.ok(mode);
  assert.equal(mode.fit, "resize");
  assert.equal(mode.minH, 7);
});

test("MT5 R metrics expand to two rows on narrow GridStack layouts", async () => {
  const {adaptDashboardLayout} = await import(moduleUrl("dashboard/dashboard-grid.mjs"));
  const layout = {items: [{id: "r-metrics", h: 4, minH: 4}, {id: "sessions", h: 7, minH: 4}, {id: "equity", h: 8}]};
  assert.equal(adaptDashboardLayout(layout, 1440).items[0].h, 4);
  assert.equal(adaptDashboardLayout(layout, 390).items[0].h, 4);
  assert.equal(adaptDashboardLayout(layout, 390).items[1].h, 7);
  assert.equal(adaptDashboardLayout(layout, 390).items[2].h, 8);
});

test("MT5 calendar preserves the project preview footprint", async () => {
  const {getModuleDefinitions, normalizeLayout} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const calendar = getModuleDefinitions("mt5").find((item) => item.id === "calendar");
  assert.deepEqual({w: calendar.w, h: calendar.h, minW: calendar.minW, minH: calendar.minH}, {w: 6, h: 8, minW: 5, minH: 4});
  const migrated = normalizeLayout({items: [
    {id: "r-metrics", x: 0, y: 0, w: 12, h: 4}, {id: "equity", x: 0, y: 5, w: 12, h: 8},
    {id: "calendar", x: 2, y: 13, w: 8, h: 8}, {id: "monthly-pnl", x: 0, y: 21, w: 6, h: 7},
    {id: "heatmap", x: 6, y: 21, w: 6, h: 7}, {id: "sessions", x: 0, y: 28, w: 4, h: 7},
    {id: "period-overview", x: 4, y: 28, w: 8, h: 9}, {id: "daily-evaluation", x: 0, y: 36, w: 12, h: 10},
    {id: "mode-evaluation", x: 0, y: 46, w: 12, h: 9},
  ]});
  assert.equal(migrated.items.find((item) => item.id === "calendar").h, 8);
  assert.equal(migrated.items.find((item) => item.id === "monthly-pnl").y, 21);
});

test("MT5 preserves the current saved layout and records it as the default", async () => {
  const {loadDefaultLayout, loadLayout, saveLayoutAsDefault} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const storage = {
    values: new Map([["mt5-dashboard-layout-v1", JSON.stringify({
      version: 1,
      columns: 12,
      items: [{id: "mode-evaluation", x: 2, y: 2, w: 6, h: 5}],
    })]]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
  const loaded = loadLayout(storage, "mt5");
  assert.deepEqual(
    loaded.items.find((item) => item.id === "mode-evaluation"),
    {...loaded.items.find((item) => item.id === "mode-evaluation"), x: 2, y: 2, w: 6, h: 7},
  );
  assert.deepEqual(
    loadDefaultLayout(storage, "mt5").items.find((item) => item.id === "mode-evaluation"),
    loaded.items.find((item) => item.id === "mode-evaluation"),
  );

  const changed = {...loaded, items: loaded.items.map((item) => item.id === "mode-evaluation" ? {...item, x: 1, y: 5} : item)};
  assert.equal(saveLayoutAsDefault(storage, changed, "mt5"), true);
  assert.deepEqual(
    loadDefaultLayout(storage, "mt5").items.find((item) => item.id === "mode-evaluation"),
    {...loaded.items.find((item) => item.id === "mode-evaluation"), x: 1, y: 5},
  );
});

test("MT5 preserves browser layouts until the server migration owns them", async () => {
  const {loadLayout} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const stale = {
    version: 1,
    columns: 12,
    items: [
      {id: "r-metrics", x: 0, y: 0, w: 12, h: 2},
      {id: "equity", x: 0, y: 2, w: 12, h: 8},
      {id: "monthly-pnl", x: 0, y: 10, w: 6, h: 7},
      {id: "calendar", x: 6, y: 10, w: 6, h: 8},
    ],
  };
  const storage = {
    values: new Map([
      ["mt5-dashboard-layout-v1", JSON.stringify(stale)],
      ["mt5-dashboard-layout-v1-default", JSON.stringify(stale)],
    ]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };

  const preservedDefault = loadLayout(storage, "mt5");
  assert.equal(preservedDefault.items.find((item) => item.id === "calendar").x, 6);

  const noSnapshotStorage = {
    values: new Map([["mt5-dashboard-layout-v1", JSON.stringify(stale)]]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
  const preservedWithoutSnapshot = loadLayout(noSnapshotStorage, "mt5");
  assert.equal(preservedWithoutSnapshot.items.find((item) => item.id === "calendar").x, 6);

  const custom = {...stale, items: stale.items.map((item) => item.id === "calendar" ? {...item, x: 2, y: 15} : item)};
  storage.values.set("mt5-dashboard-layout-v1", JSON.stringify(custom));
  const preserved = loadLayout(storage, "mt5");
  assert.equal(preserved.items.find((item) => item.id === "calendar").x, 2);
});

test("server dashboard layout is authoritative and empty server uses the project default", async () => {
  const {loadLayoutFromServer} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const storage = {
    values: new Map([["mt5-dashboard-layout-v1", JSON.stringify({items: [{id: "calendar", x: 6, y: 10, w: 6, h: 8}]})]]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
  const serverLayout = {version: 1, columns: 12, items: [{id: "calendar", x: 2, y: 10, w: 8, h: 5}]};
  const calls = [];
  const authoritative = await loadLayoutFromServer({
    api: {requestJson: async (url, options) => {
      calls.push([url, options]);
      return {platform: "mt5", revision: 4, layout: serverLayout};
    }},
    storage,
    platform: "mt5",
  });
  assert.equal(authoritative.revision, 4);
  assert.equal(authoritative.layout.items.find((item) => item.id === "calendar").x, 2);
  assert.equal(calls.length, 1);

  storage.values.set("mt5-dashboard-layout-v1", JSON.stringify({items: [{id: "calendar", x: 6, y: 10, w: 6, h: 8}]}));
  calls.length = 0;
  const seeded = await loadLayoutFromServer({
    api: {requestJson: async (url, options) => {
      calls.push([url, options]);
      if (options?.method === "PUT") return {platform: "mt5", revision: 1, layout: options.body.layout};
      return {platform: "mt5", revision: 0, layout: null};
    }},
    storage,
    platform: "mt5",
  });
  assert.equal(seeded.revision, 1);
  assert.equal(seeded.layout.items.find((item) => item.id === "calendar").x, 6);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].method, "PUT");
});

test("two isolated browser clients converge on one project layout and retry stale saves", async () => {
  const {cloneDefaultLayout, loadLayoutFromServer, saveLayoutToServer} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const shared = {revision: 0, layout: null};
  const api = {
    async requestJson(_url, options) {
      if (!options?.method) return {platform: "mt5", revision: shared.revision, layout: shared.layout};
      if (Number(options.body.revision) !== shared.revision) {
        const error = new Error("stale");
        error.status = 409;
        throw error;
      }
      shared.revision += 1;
      shared.layout = options.body.layout;
      return {platform: "mt5", revision: shared.revision, layout: shared.layout};
    },
  };
  const storageFor = (layout) => ({
    values: new Map([["mt5-dashboard-layout-v1", JSON.stringify(layout)]]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  });
  const clientA = await loadLayoutFromServer({api, storage: storageFor({items: [{id: "calendar", x: 8, y: 1, w: 4, h: 8}]}), platform: "mt5"});
  const clientB = await loadLayoutFromServer({api, storage: storageFor({items: [{id: "calendar", x: 1, y: 8, w: 6, h: 8}]}), platform: "mt5"});
  assert.equal(clientA.revision, 1);
  assert.equal(clientB.revision, 1);
  assert.deepEqual(clientB.layout, clientA.layout);
  assert.deepEqual(clientA.layout, cloneDefaultLayout("mt5"));

  const changed = {...clientB.layout, items: clientB.layout.items.map((item) => item.id === "calendar" ? {...item, x: 1} : item)};
  const saved = await saveLayoutToServer({api, storage: storageFor(clientB.layout), platform: "mt5", layout: changed, revision: clientB.revision});
  assert.equal(saved.revision, 2);
  const staleEditorSave = await saveLayoutToServer({
    api,
    storage: storageFor(clientA.layout),
    platform: "mt5",
    layout: clientA.layout,
    revision: clientA.revision,
  });
  assert.equal(staleEditorSave.revision, 3);
  assert.equal(shared.revision, 3);
  assert.deepEqual(shared.layout, clientA.layout);
});

test("server layout with an invalid empty object is repaired with the shared default", async () => {
  const {cloneDefaultLayout, loadLayoutFromServer} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const calls = [];
  const storage = {
    values: new Map([["mt5-dashboard-layout-v1", JSON.stringify({items: [{id: "calendar", x: 6, y: 10, w: 6, h: 8}]})]]),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
  const result = await loadLayoutFromServer({
    api: {requestJson: async (_url, options) => {
      calls.push(options);
      if (options?.method === "PUT") {
        assert.equal(options.body.revision, 8);
        return {platform: "mt5", revision: 9, layout: options.body.layout};
      }
      return {platform: "mt5", revision: 8, layout: {}};
    }},
    storage,
    platform: "mt5",
  });

  assert.equal(result.source, "migration");
  assert.equal(result.revision, 9);
  assert.deepEqual(result.layout, cloneDefaultLayout("mt5"));
  assert.equal(calls.length, 2);
});

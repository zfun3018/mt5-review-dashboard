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

test("MT5 calendar defaults to a compact footprint with a smaller editable minimum", async () => {
  const {getModuleDefinitions, normalizeLayout} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const calendar = getModuleDefinitions("mt5").find((item) => item.id === "calendar");

  assert.deepEqual({x: calendar.x, w: calendar.w, h: calendar.h, minW: calendar.minW, minH: calendar.minH}, {
    x: 2, w: 8, h: 8, minW: 6, minH: 8,
  });

  const previousMinimum = normalizeLayout({items: [{id: "calendar", x: 4, y: 13, w: 8, h: 10}]}).items.find((item) => item.id === "calendar");
  assert.deepEqual({x: previousMinimum.x, w: previousMinimum.w, h: previousMinimum.h}, {x: 5, w: 6, h: 8});
});

test("MT5 evaluation modules separate period chart from a scrollable daily table", async () => {
  const {getModuleDefinitions} = await import(moduleUrl("dashboard/dashboard-layout.mjs"));
  const definitions = getModuleDefinitions("mt5");
  const period = definitions.find((item) => item.id === "period-overview");
  const daily = definitions.find((item) => item.id === "daily-evaluation");

  assert.ok(period);
  assert.ok(daily);
  assert.equal(period.kind, "chart");
  assert.equal(daily.fit, "scroll");
  assert.ok(daily.minH >= 6);
  assert.deepEqual({w: period.w, h: period.h, minW: period.minW, minH: period.minH}, {w: 8, h: 9, minW: 8, minH: 8});

  const migrated = (await import(moduleUrl("dashboard/dashboard-layout.mjs"))).normalizeLayout({items: [
    {id: "period-overview", title: "周期交易概览", subtitle: "同时比较四个周期的六项核心指标"},
    {id: "daily-evaluation", title: "我的每日汇总"},
  ]});
  assert.equal(migrated.items.find((item) => item.id === "period-overview").title, "交易系统评估");
  assert.equal(migrated.items.find((item) => item.id === "period-overview").subtitle, "六项指标分别比较四个周期，保留各自刻度和实际数值");
  assert.equal(migrated.items.find((item) => item.id === "daily-evaluation").title, "我的每日汇总");
});

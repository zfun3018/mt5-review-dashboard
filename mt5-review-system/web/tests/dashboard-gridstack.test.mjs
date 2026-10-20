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
  assert.match(options.draggable.handle, /grid-stack-item-content/);
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

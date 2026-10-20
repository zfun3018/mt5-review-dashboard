import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (relativePath) => pathToFileURL(path.join(webRoot, relativePath)).href;

test("dashboard exposes separate MT5 and domestic-futures workspace configuration", async () => {
  const {getDashboardWorkspaceConfig} = await import(moduleUrl("dashboard/dashboard.mjs"));

  assert.deepEqual(getDashboardWorkspaceConfig("mt5"), {
    showMarketClock: true,
    showSessions: true,
    actionLabel: "刷新数据",
    actionIcon: "refresh-cw",
  });
  assert.deepEqual(getDashboardWorkspaceConfig("domestic_futures"), {
    showMarketClock: false,
    showSessions: false,
    actionLabel: "导入数据",
    actionIcon: "upload",
  });
});

test("domestic futures dashboard has a latest import status region and no global sessions copy", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const shell = fs.readFileSync(path.join(webRoot, "shared/js/shell.mjs"), "utf8");

  assert.match(html, /id="latestImportSummary"/);
  assert.match(html, /最近导入订单/);
  assert.match(html, /settings\/\?tab=data/);
  assert.match(shell, /activePlatform === "domestic_futures" \? "导入数据"/);
  assert.match(shell, /activePlatform === "domestic_futures" \? "upload"/);
});

test("shared shell gives domestic futures its own workspace brand", () => {
  const shell = fs.readFileSync(path.join(webRoot, "shared/js/shell.mjs"), "utf8");

  assert.match(shell, /const workspaceBrand = isDomesticFutures \? "国内期货" : "MT5 复盘"/);
  assert.match(shell, /const workspaceMark = isDomesticFutures \? "期" : "MT"/);
});

test("domestic futures dashboard keeps one page title and uses compact adaptive modules", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/index.html"), "utf8");
  const dashboard = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-dashboard.mjs"), "utf8");
  const styles = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-dashboard.css"), "utf8");
  const layout = fs.readFileSync(path.join(webRoot, "dashboard/dashboard-layout.mjs"), "utf8");

  assert.doesNotMatch(html, /<h2>账户整体收益与风险<\/h2>/);
  assert.doesNotMatch(dashboard, /title: "国内期货仪表盘"/);
  assert.doesNotMatch(dashboard, /<h3>复盘完成度<\/h3>/);
  assert.match(layout, /definition\("daily-calendar", "盈亏日历"/);
  assert.match(styles, /\.domestic-dashboard-stage\.grid-stack/);
  assert.match(dashboard, /createDashboardGrid/);
  assert.match(layout, /definition\("net-performance", "累计净盈亏"/);
  assert.doesNotMatch(styles, /min-height:\s*280px/);
});

test("domestic futures dashboard mock delegates layout editing to the standalone editor", () => {
  const html = fs.readFileSync(path.join(webRoot, "dashboard/mock-domestic-futures.html"), "utf8");
  const editor = fs.readFileSync(path.join(webRoot, "dashboard/mock-domestic-futures-layout.html"), "utf8");
  const editorScript = fs.readFileSync(path.join(webRoot, "dashboard/domestic-futures-layout-editor.mjs"), "utf8");

  assert.match(html, /mock-domestic-futures-layout\.html/);
  assert.match(html, /domestic-futures-layout-view\.mjs/);
  assert.doesNotMatch(html, /vendor\/gridstack(?:-all)?\.js/);
  assert.doesNotMatch(html, /GridStack\.init/);
  assert.match(editor, /vendor\/gridstack-all\.js/);
  assert.match(editorScript, /grid\.on\("change dragstop resizestop"/);
  assert.match(editorScript, /resizable: \{handles: "e, se, s, sw, w"/);
  assert.match(editorScript, /alwaysShowResizeHandle: true/);
  assert.match(editorScript, /data-editor-action="hide"/);
  assert.match(editor, /titleInput/);
  assert.match(editor, /subtitleInput/);
});

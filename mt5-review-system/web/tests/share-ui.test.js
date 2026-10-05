const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const webRoot = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(webRoot, ...segments), "utf8");

test("share module renders the complete page to PNG and handles download plus clipboard", () => {
  const source = read("shared", "js", "share.mjs");
  assert.match(source, /html2canvas/);
  assert.doesNotMatch(source, /foreignObject/);
  assert.match(source, /canvas\.toBlob/);
  assert.match(source, /link\.download = filename/);
  assert.match(source, /navigatorRef\.clipboard\.write/);
  assert.match(source, /new ClipboardItemConstructor\(\{\"image\/png\": blob\}\)/);
  assert.match(source, /data-share-exclude/);
  assert.match(read("vendor", "html2canvas.min.js"), /html2canvas 1\.4\.1/);
});

test("only dashboard and orders enable sharing; album and settings stay excluded", () => {
  const dashboard = read("dashboard", "dashboard.mjs");
  const orders = read("orders", "orders.mjs");
  const album = read("album", "album.mjs");
  const settings = read("settings", "settings.mjs");
  const dashboardHtml = read("dashboard", "index.html");
  const ordersHtml = read("orders", "index.html");
  assert.match(dashboard, /mountShell\(\{[^}]*share:\s*true/);
  assert.match(orders, /mountShell\(\{[^}]*share:\s*true/);
  assert.match(dashboardHtml, /vendor\/html2canvas\.min\.js/);
  assert.match(ordersHtml, /vendor\/html2canvas\.min\.js/);
  assert.doesNotMatch(album, /share:\s*true/);
  assert.doesNotMatch(settings, /share:\s*true/);
});

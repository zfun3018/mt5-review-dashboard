import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const read = (...segments) => readFileSync(join(webRoot, ...segments), "utf8");

const WORKSPACES = [
  { name: "dashboard", route: "/dashboard/", controller: "dashboard.mjs" },
  { name: "orders", route: "/orders/", controller: "orders.mjs" },
  { name: "album", route: "/album/", controller: "album.mjs" },
  { name: "settings", route: "/settings/", controller: "settings.mjs" },
];

test("every workspace entry drops the coupled app.js and styles.css assets", () => {
  for (const workspace of WORKSPACES) {
    const html = read(workspace.name, "index.html");
    assert.doesNotMatch(html, /\/app\.js|\/styles\.css/, `${workspace.name} must not reference app.js or styles.css`);
  }
});

test("every workspace entry mounts the shared shell and tokens", () => {
  for (const workspace of WORKSPACES) {
    const html = read(workspace.name, "index.html");
    const controller = read(workspace.name, workspace.controller);
    assert.match(html, /shared\/css\/tokens\.css/, `${workspace.name} loads shared tokens`);
    assert.match(html, /shared\/css\/shell\.css/, `${workspace.name} loads shared shell styles`);
    assert.match(controller, /shared\/js\/shell\.mjs/, `${workspace.name} controller imports the shared shell`);
  }
});

test("dashboard only calls the analysis endpoint", () => {
  const source = read("dashboard", "dashboard.mjs");
  assert.match(source, /\/api\/analysis/);
  assert.doesNotMatch(source, /\/api\/campaigns|\/api\/trades|\/api\/positions|\/api\/review-album/);
  assert.doesNotMatch(source, /\/api\/status|\/api\/backups|\/api\/classification-options|\/api\/custom-fields/);
});

test("album only reads the review album and never mutates", () => {
  const source = read("album", "album.mjs");
  assert.match(source, /\/api\/review-album/);
  assert.doesNotMatch(source, /\/api\/analysis(?!-)/);
  assert.doesNotMatch(source, /\/api\/campaigns|\/api\/trades|\/api\/status/);
  assert.doesNotMatch(source, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
});

test("settings owns configuration, status, and backup without analysis", () => {
  const source = read("settings", "settings.mjs");
  assert.match(source, /\/api\/classification-options/);
  assert.match(source, /\/api\/custom-fields/);
  assert.match(source, /\/api\/status/);
  assert.match(source, /\/api\/backups/);
  assert.match(source, /\/api\/analysis-settings/);
  assert.doesNotMatch(source, /\/api\/analysis(?!-)/);
  assert.doesNotMatch(source, /\/api\/campaigns|\/api\/review-album|\/api\/trades|\/api\/positions/);
});

test("orders never calls dashboard analysis or system status", () => {
  const orders = read("orders", "orders.mjs");
  const detail = read("orders", "order-detail.mjs");
  const fields = read("orders", "custom-fields.mjs");
  const combined = `${orders}\n${detail}\n${fields}`;
  assert.match(combined, /\/api\/campaigns/);
  assert.match(combined, /\/api\/trades/);
  assert.doesNotMatch(combined, /\/api\/analysis(?!-)/);
  assert.doesNotMatch(combined, /\/api\/status|\/api\/review-album|\/api\/backups/);
});

test("root index.html stays a compatibility redirect without coupled assets", () => {
  const html = read("index.html");
  assert.match(html, /location\.replace/);
  assert.match(html, /\/dashboard\//);
  assert.match(html, /\/orders\//);
  assert.doesNotMatch(html, /\/app\.js|\/styles\.css/);
});

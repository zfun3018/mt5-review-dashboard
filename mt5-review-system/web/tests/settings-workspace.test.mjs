import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSettingsController } from "../settings/settings.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const settingsHtml = fs.readFileSync(path.join(__dirname, "..", "settings", "index.html"), "utf8");
const settingsSource = fs.readFileSync(path.join(__dirname, "..", "settings", "settings.mjs"), "utf8");
const classificationsSource = fs.readFileSync(path.join(__dirname, "..", "settings", "classifications.mjs"), "utf8");
const schemaSource = fs.readFileSync(path.join(__dirname, "..", "settings", "custom-field-schema.mjs"), "utf8");

class FakeElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.style = {};
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  addEventListener(type, listener) {
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener(event);
  }

  classList = { add() {}, remove() {}, toggle() {} };
  focus() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, bottom: 0, width: 0, height: 0 };
  }
}

class FakeView {
  constructor() {
    this.elements = new Map();
    this.allElements = [];
  }

  getElementById(id) {
    if (!this.elements.has(id)) {
      const element = new FakeElement();
      element.id = id;
      this.elements.set(id, element);
      this.allElements.push(element);
    }
    return this.elements.get(id);
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }

  addEventListener() {}
}

const DEFAULT_ROUTES = {
  "/api/classification-options": {
    classification_options: [
      { id: "trade_type_follow", dimension: "trade_type", label: "跟随", color: "#2bd4ff", sort_order: 1, active: true },
      { id: "strategy_breakout", dimension: "strategy", label: "突破", color: "#4ade80", sort_order: 1, active: true },
    ],
  },
  "/api/custom-fields": {
    custom_fields: [
      { id: 1, name: "复盘结论", field_type: "single", sort_order: 1, options: [{ id: 11, field_id: 1, label: "盈利", color: "#2bd4ff", sort_order: 1 }] },
    ],
  },
  "/api/analysis-settings": { scratch_threshold_r: 0.2 },
  "/api/status": {
    bridge_endpoint: "http://127.0.0.1:8787/api/mt5/events",
    database_path: "C:\\secret\\journal.sqlite",
    data_dir: "C:\\secret\\data",
    data_size_bytes: 1048576,
    screenshot_count: 7,
    counts: { trades: 42, raw_events: 900, equity_snapshots: 300 },
    latest_trade: { id: "T-1", symbol: "XAUUSD", close_time_utc: "2026-09-03T02:00:00Z", pnl: 120 },
    latest_backup: { file_path: "C:\\secret\\backups\\mt5-review-backup-20260903.zip", created_at: "2026-09-03T01:00:00Z", size_bytes: 512000 },
    latest_raw_event_file: "C:\\secret\\raw.jsonl",
  },
  "/api/backups": {
    backups: [
      { id: 1, file_path: "C:\\secret\\backups\\mt5-review-backup-20260903.zip", created_at: "2026-09-03T01:00:00Z", size_bytes: 512000 },
    ],
  },
};

function recordingApi(routes = {}) {
  const paths = [];
  const methods = [];
  const bodies = [];
  const merged = { ...DEFAULT_ROUTES, ...routes };
  return {
    paths,
    methods,
    bodies,
    async requestJson(requestPath, options = {}) {
      const method = options.method || "GET";
      paths.push(requestPath);
      methods.push(method);
      bodies.push(options.body);
      if (requestPath === "/api/backups" && method === "POST") {
        return { id: 2, file_path: "C:\\secret\\backups\\mt5-review-backup-new.zip", created_at: "2026-09-03T03:00:00Z", size_bytes: 1024 };
      }
      if (requestPath === "/api/classification-options" && method === "POST") {
        return { id: "trade_type_new", dimension: "trade_type", label: "新类型", color: "#2bd4ff", sort_order: 99, active: true };
      }
      if (requestPath === "/api/custom-fields" && method === "POST") {
        return { id: 2, name: "新字段", field_type: "text", sort_order: 2, options: [] };
      }
      if (Object.prototype.hasOwnProperty.call(merged, requestPath)) return merged[requestPath];
      if (requestPath.startsWith("/api/classification-options/")) return { ok: true };
      if (requestPath.startsWith("/api/custom-fields/")) return { ok: true };
      throw new Error(`unexpected path ${requestPath}`);
    },
  };
}

function controllerWith(routes = {}) {
  const api = recordingApi(routes);
  const view = new FakeView();
  const controller = createSettingsController({
    api,
    view,
    location: { search: "", pathname: "/settings/", hash: "" },
    history: { replaceState() {} },
  });
  return { api, controller, view };
}

test("settings mounts the shared shell and activates the settings route", () => {
  assert.match(settingsHtml, /data-app-shell/);
  assert.match(settingsHtml, /shared\/css\/tokens\.css/);
  assert.match(settingsSource, /shell\.mjs/);
  assert.match(settingsSource, /activeRoute:\s*"\/settings\/"/);
  assert.match(settingsHtml, /设置/);
  assert.match(settingsHtml, /futuresImportCalendar/);
  assert.match(settingsHtml, /futuresImportHistory/);
  assert.match(settingsHtml, /downloadFuturesTemplate/);
});

test("data import view renders a trading-date calendar and batch history", async () => {
  const { controller, view } = controllerWith({
    "/api/platforms/import-batches?year=2026&month=10": {
      batches: [{
        id: "IMP-1",
        filename: "trades.xls",
        started_at: "2026-10-19T08:00:00Z",
        status: "committed",
        new_row_count: 4,
        duplicate_count: 1,
        invalid_count: 0,
        unpaired_count: 0,
        order_count: 2,
      }],
    },
    "/api/platforms/import-calendar?year=2026&month=10": {
      calendar: {
        "2026-10-19": { new_row_count: 4, duplicate_count: 1, invalid_count: 0, unpaired_count: 0, order_count: 2 },
      },
    },
  });

  await controller.refreshImportHistory(2026, 10);

  assert.match(view.getElementById("futuresImportCalendar").innerHTML, /2026年10月/);
  assert.match(view.getElementById("futuresImportCalendar").innerHTML, /4/);
  assert.match(view.getElementById("futuresImportCalendar").innerHTML, /重1/);
  assert.match(view.getElementById("futuresImportCalendar").innerHTML, /aria-label="交易日 2026-10-19/);
  assert.match(view.getElementById("futuresImportHistory").innerHTML, /trades\.xls/);
  assert.match(view.getElementById("futuresImportHistory").innerHTML, /已完成/);
});

test("domestic futures data importer accepts xls files and sends binary content", async () => {
  const { api, view, controller } = controllerWith({
    "/api/platforms/import-file": { imported: 1, skipped: 0, source_format: "xls" },
  });
  await controller.load();
  view.getElementById("futuresDataFile").files = [{
    name: "trades.xls",
    arrayBuffer: async () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]).buffer,
  }];

  const result = await controller.importFuturesData();

  assert.equal(result.source_format, "xls");
  const index = api.paths.indexOf("/api/platforms/import-file");
  assert.ok(index >= 0);
  assert.equal(api.bodies[index].filename, "trades.xls");
  assert.equal(api.bodies[index].file_base64, "0M8R4A==");
  assert.match(view.getElementById("futuresImportResult").textContent, /已导入 1 笔/);
});

test("data importer explains that the local service must be restarted after a route 404", async () => {
  const { api, view, controller } = controllerWith();
  await controller.load();
  view.getElementById("futuresDataFile").files = [{
    name: "trades.xls",
    arrayBuffer: async () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]).buffer,
  }];
  api.requestJson = async (requestPath) => {
    if (requestPath === "/api/platforms/import-file") {
      const error = new Error("Not found");
      error.status = 404;
      throw error;
    }
    return DEFAULT_ROUTES[requestPath];
  };

  await assert.rejects(() => controller.importFuturesData(), /Not found/);
  assert.match(view.getElementById("futuresImportResult").textContent, /重启本地服务/);
});

test("settings loads configuration without analysis or campaigns", async () => {
  const { api, controller } = controllerWith();
  await controller.load();
  assert.deepEqual(new Set(api.paths), new Set([
    "/api/classification-options",
    "/api/custom-fields",
    "/api/analysis-settings",
    "/api/status",
    "/api/backups",
  ]));
});

test("classification options are data driven and user manageable", async () => {
  const { api, controller } = controllerWith();
  await controller.load();
  await controller.createClassificationOption("trade_type", "新类型", "#f97316");
  await controller.renameClassificationOption("trade_type_follow", "跟随改", "#a78bfa");
  await controller.archiveClassificationOption("trade_type_follow");

  assert.ok(api.paths.includes("/api/classification-options"));
  assert.ok(api.paths.includes("/api/classification-options/trade_type_follow"));

  const postIndex = api.paths.findIndex((p, i) => p === "/api/classification-options" && api.methods[i] === "POST");
  const putIndex = api.paths.findIndex((p, i) => p === "/api/classification-options/trade_type_follow" && api.methods[i] === "PUT");
  assert.ok(postIndex >= 0);
  assert.ok(putIndex >= 0);
  assert.deepEqual(api.bodies[postIndex], { dimension: "trade_type", label: "新类型", color: "#f97316" });
  assert.deepEqual(api.bodies[putIndex], { label: "跟随改", color: "#a78bfa" });
  assert.ok(api.methods.includes("DELETE"));
});

test("custom field type and options are sent when saved", async () => {
  const { api, controller } = controllerWith();
  await controller.load();
  await controller.updateCustomField(1, {
    name: "复盘结论",
    fieldType: "multi",
    options: [
      { id: 11, label: "盈利", color: "#2bd4ff" },
      { label: "亏损", color: "#ff5c7a" },
    ],
  });

  assert.ok(api.paths.includes("/api/custom-fields/1"));
  const index = api.paths.indexOf("/api/custom-fields/1");
  assert.equal(api.methods[index], "PUT");
  const body = api.bodies[index];
  assert.equal(body.field_type, "multi");
  assert.equal(body.options.length, 2);
  assert.deepEqual(body.options[0], { id: 11, label: "盈利", color: "#2bd4ff" });
  assert.deepEqual(body.options[1], { label: "亏损", color: "#ff5c7a" });
});

test("scratch threshold validates range before saving", async () => {
  const { api, controller } = controllerWith();
  await controller.load();

  const rejected = await controller.saveScratchThreshold(9);
  assert.equal(rejected, false);
  assert.ok(!api.methods.includes("PATCH"));

  const accepted = await controller.saveScratchThreshold(0.35);
  assert.equal(accepted, true);
  const patchIndex = api.methods.indexOf("PATCH");
  assert.ok(patchIndex >= 0);
  assert.equal(api.paths[patchIndex], "/api/analysis-settings");
  assert.deepEqual(api.bodies[patchIndex], { scratch_threshold_r: 0.35 });
});

test("status retries on demand without reloading configuration", async () => {
  const { api, controller } = controllerWith();
  await controller.load();
  const before = api.paths.length;

  await controller.refreshStatus();

  assert.equal(api.paths.length, before + 1);
  assert.equal(api.paths[api.paths.length - 1], "/api/status");
});

test("backup success shows filename and size without exposing the absolute path", async () => {
  const { api, view, controller } = controllerWith();
  await controller.load();
  await controller.createBackup();

  assert.ok(api.paths.includes("/api/backups"));
  const postIndex = api.methods.indexOf("POST");
  assert.ok(postIndex >= 0);

  const html = view.getElementById("settingsBackups").innerHTML;
  assert.match(html, /mt5-review-backup-new\.zip/);
  assert.match(html, /1\.0 KB/);
  assert.doesNotMatch(html, /C:\\secret\\backups/);
});

test("status view omits absolute local paths", async () => {
  const { view, controller } = controllerWith();
  await controller.load();
  const html = view.getElementById("settingsStatus").innerHTML;
  assert.match(html, /127\.0\.0\.1:8787/);
  assert.match(html, /42/);
  assert.match(html, /XAUUSD/);
  assert.doesNotMatch(html, /C:\\secret/);
});

test("status view only renders configured state, counts, size, and last activity", () => {
  assert.doesNotMatch(settingsSource, /database_path/);
  assert.doesNotMatch(settingsSource, /data_dir/);
  assert.doesNotMatch(settingsSource, /latest_raw_event_file/);
  assert.match(settingsSource, /bridge_endpoint/);
  assert.match(settingsSource, /screenshot_count/);
  assert.match(settingsSource, /data_size_bytes/);
});

test("settings is listed as a shared shell destination", async () => {
  const { NAV_ITEMS } = await import("../shared/js/shell.mjs");
  assert.ok(NAV_ITEMS.some((item) => item.href === "/settings/"));
});

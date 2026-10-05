import assert from "node:assert/strict";
import test from "node:test";

import { createOrdersController } from "../orders/orders.mjs";
import {
  buildCampaignsQuery,
  normalizeListState,
  readOrdersState,
} from "../orders/orders-state.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ordersSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "orders.mjs"), "utf8");
const ordersStyle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "orders.css"), "utf8");

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

  classList = { add() {}, remove() {} };
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
    return this.allElements;
  }

  querySelector() {
    return null;
  }

  addEventListener() {}
}

function recordingApi(routes, { campaigns = [], detail = null } = {}) {
  const paths = [];
  const methods = [];
  const bodies = [];
  return {
    paths,
    methods,
    bodies,
    async requestJson(requestPath, options = {}) {
      paths.push(requestPath);
      methods.push(options.method || "GET");
      bodies.push(options.body);
      if (Object.prototype.hasOwnProperty.call(routes, requestPath)) return routes[requestPath];
      if (requestPath.startsWith("/api/campaigns?")) {
        return { campaigns, total: campaigns.length, page: 1, page_size: 50 };
      }
      if (requestPath.startsWith("/api/campaigns/")) {
        return detail || { id: requestPath.split("/")[3], positions: [] };
      }
      if (requestPath.startsWith("/api/positions/")) return { campaign: { id: "C-1" } };
      if (requestPath.startsWith("/api/trades/")) return { deleted: true };
      throw new Error(`unexpected path ${requestPath}`);
    },
  };
}

function campaign(id, extra = {}) {
  return {
    id,
    display_order_no: id,
    side: "long",
    symbol: "XAUUSD",
    trade_type: "follow",
    strategy: "breakout",
    weighted_entry_price: 1800,
    weighted_exit_price: 1810,
    entry_volume: 0.1,
    exit_volume: 0.1,
    holding_seconds: 3600,
    net_pnl: 120,
    campaign_r: 1.2,
    risk_status: "complete",
    position_count: 1,
    source_trade_ids: [],
    position_summaries: [],
    ...extra,
  };
}

function position(id, extra = {}) {
  return {
    id,
    display_position_id: id,
    position_id: id,
    weighted_entry_price: 1800,
    weighted_exit_price: 1810,
    entry_volume: 0.1,
    exit_volume: 0.1,
    holding_seconds: 3600,
    position_pnl: 120,
    position_r: 1.2,
    risk_status: "complete",
    initial_stop_price: 1790,
    source_trade: { id: `T-${id}`, display_order_no: id, screenshot_url: null, custom_fields: {} },
    source_trades: [],
    ...extra,
  };
}

function controllerWith(location = { search: "" }, routes = {}, options = {}) {
  const api = recordingApi(routes, options);
  const view = new FakeView();
  const controller = createOrdersController({
    api,
    view,
    location,
    history: { replaceState() {} },
  });
  return { api, controller, view };
}

test("order filters are sent to the server", async () => {
  const { api, controller } = controllerWith();
  await controller.loadList({ q: "XAU", side: "long", page: 2, pageSize: 50, rMissing: true });
  assert.equal(api.paths[0], "/api/campaigns?q=XAU&side=long&r_missing=1&page=2&page_size=50");
});

test("saving a stop refreshes one campaign and the current page", async () => {
  const { api, controller } = controllerWith();
  await controller.saveInitialStop("P-1", 98);
  assert.deepEqual(api.methods, ["PATCH", "GET", "GET"]);
  assert.match(api.paths[1], /\/api\/campaigns\//);
  assert.match(api.paths[2], /\/api\/campaigns\?/);
});

test("?trade= resolves the owning campaign", async () => {
  const { view, controller } = controllerWith(
    { search: "?trade=T-9" },
    {},
    { campaigns: [campaign("C-1", { source_trade_ids: ["T-9"] }), campaign("C-2")] },
  );
  await controller.loadList();

  const html = view.getElementById("orderRows").innerHTML;
  const activeRow = html.match(/<tr class="([^"]*)" data-campaign-id="C-1"/);
  const inactiveRow = html.match(/<tr class="([^"]*)" data-campaign-id="C-2"/);
  assert.match(activeRow[1], /active/);
  assert.doesNotMatch(inactiveRow[1], /active/);
});

test("?trade= opens the matching order detail instead of the campaign review", async () => {
  const sourceTrade = { id: "T-9", display_order_no: "T-9", review_text: "订单级复盘", custom_fields: {} };
  const representativeTrade = { id: "T-10", display_order_no: "T-10", review_text: "代表订单复盘", custom_fields: {} };
  const selectedPosition = position("1", {
    source_trade: representativeTrade,
    source_trades: [sourceTrade, representativeTrade],
  });
  const selectedCampaign = campaign("C-1", {
    source_trade_ids: ["T-9"],
    position_summaries: [selectedPosition],
    review_text: "来源 T-9\n订单级复盘",
  });
  const { view, controller } = controllerWith(
    { search: "?trade=T-9" },
    {},
    { campaigns: [selectedCampaign], detail: { ...selectedCampaign, positions: [selectedPosition] } },
  );

  await controller.load();

  assert.match(view.getElementById("orderDetail").innerHTML, /保存订单复盘/);
  assert.match(view.getElementById("orderDetail").innerHTML, /订单级复盘/);
  assert.doesNotMatch(view.getElementById("orderDetail").innerHTML, /代表订单复盘/);
  assert.doesNotMatch(view.getElementById("orderDetail").innerHTML, /来源 T-9/);
});

test("?campaign= keeps the requested campaign selected", async () => {
  const { view, controller } = controllerWith(
    { search: "?campaign=C-2" },
    {},
    { campaigns: [campaign("C-1"), campaign("C-2")] },
  );
  await controller.loadList();

  assert.equal(controller.getState().campaign, "C-2");
  const html = view.getElementById("orderRows").innerHTML;
  assert.match(html.match(/<tr class="([^"]*)" data-campaign-id="C-2"/)[1], /active/);
});

test("multi-Position campaigns render child rows only when expanded", async () => {
  const { view, controller } = controllerWith(
    { search: "" },
    {},
    {
      campaigns: [
        campaign("C-1", {
          position_count: 2,
          source_trade_ids: ["T-1", "T-2"],
          position_summaries: [position("1"), position("2")],
        }),
      ],
    },
  );
  await controller.loadList();

  const childRows = () => (view.getElementById("orderRows").innerHTML.match(/campaign-detail-row/g) || []).length;

  // Collapsed: only the summary row renders.
  assert.equal(childRows(), 0);

  // Expanded: one child row per Position.
  controller.toggleExpand("C-1");
  assert.equal(childRows(), 2);

  // Collapse again removes them.
  controller.toggleExpand("C-1");
  assert.equal(childRows(), 0);
});

test("soft delete removes the selected trade", async () => {
  const { api, controller } = controllerWith(
    { search: "" },
    {},
    {
      campaigns: [
        campaign("C-1", {
          source_trade_ids: ["T-1"],
          position_summaries: [position("1", { source_trade: { id: "T-1", display_order_no: "T-1" } })],
        }),
      ],
    },
  );
  await controller.loadList();
  await controller.deleteSelectedTrade();
  assert.ok(api.methods.includes("DELETE"));
  assert.ok(api.paths.includes("/api/trades/T-1"));
});

test("campaign list uses server-side pagination state", async () => {
  const { api, controller } = controllerWith({ search: "?page=3" }, {}, { campaigns: [campaign("C-1")] });
  await controller.loadList();
  assert.equal(api.paths[0], "/api/campaigns?page=3&page_size=50");
});

test("normalizeListState clamps page and page size", () => {
  const state = normalizeListState({ page: -4, pageSize: 999 });
  assert.equal(state.page, 1);
  assert.equal(state.pageSize, 200);
});

test("buildCampaignsQuery maps camelCase state to the snake_case contract", () => {
  const query = buildCampaignsQuery({
    q: "XAU",
    side: "long",
    tradeType: "follow",
    strategy: "breakout",
    start: "2026-08-01",
    end: "2026-08-31",
    rMissing: true,
    page: 2,
    pageSize: 50,
  });
  assert.equal(
    query,
    "q=XAU&side=long&trade_type=follow&strategy=breakout&start=2026-08-01&end=2026-08-31&r_missing=1&page=2&page_size=50",
  );
});

test("combined campaign summary renders and saves campaign classification", async () => {
  const combined = campaign("C-1", {
    position_count: 2,
    trade_type: "follow",
    strategy: "breakout",
    source_trade_ids: ["T-1", "T-2"],
    position_summaries: [
      position("1", { source_trade: { id: "T-1", trade_type: "reversal", strategy: "range", custom_fields: {} } }),
      position("2", { source_trade: { id: "T-2", trade_type: "reversal", strategy: "range", custom_fields: {} } }),
    ],
  });
  const { api, view, controller } = controllerWith(
    { search: "" },
    {},
    { campaigns: [combined], detail: { ...combined, positions: combined.position_summaries } },
  );
  await controller.loadList();

  const summary = view.getElementById("orderRows").innerHTML.split("campaign-detail-row")[0];
  assert.match(summary, /data-campaign-classification="trade_type"[^>]*data-campaign-id="C-1"/);
  assert.match(summary, /data-campaign-classification="strategy"[^>]*data-campaign-id="C-1"/);
  assert.doesNotMatch(summary, /data-trade-id="T-2"/);

  await controller.saveCampaignClassification("C-1", "strategy", "range");
  const patchIndex = api.methods.indexOf("PATCH");
  assert.equal(api.paths[patchIndex], "/api/campaigns/C-1/review");
  assert.deepEqual(api.bodies[patchIndex], {
    trade_type: "follow",
    strategy: "range",
    review_text: "",
  });
});

test("order table places trade scene and strategy after campaign PnL", () => {
  const renderSource = ordersSource.slice(ordersSource.indexOf("function renderCampaignPositionRow"), ordersSource.indexOf("function bindRowInteractions"));
  assert.match(renderSource, /组合盈亏[\s\S]*交易场景[\s\S]*交易策略/);
  assert.match(renderSource, /<th>组合盈亏<\/th>\s*<th>交易场景<\/th>\s*<th>交易策略<\/th>/);
});

test("selected order rows use a stronger background than scratch rows", () => {
  assert.match(ordersStyle, /\.orders-table tbody tr\.active\s*\{[\s\S]*background:\s*rgba\(61, 130, 246, 0\.28\) !important;[\s\S]*box-shadow:/);
  assert.match(ordersStyle, /\.campaign-row\.scratch\s*\{[\s\S]*background:\s*rgba\(130, 148, 168, 0\.12\) !important;/);
  assert.match(ordersStyle, /\.campaign-row\.scratch\.active\s*\{[\s\S]*background:\s*rgba\(61, 130, 246, 0\.22\) !important;[\s\S]*#f2b84b/);
});

test("readOrdersState parses filters, pagination, and selection", () => {
  const state = readOrdersState(
    "?q=XAU&side=short&tradeType=follow&rMissing=1&page=2&pageSize=20&trade=T-9&campaign=C-1",
  );
  assert.equal(state.q, "XAU");
  assert.equal(state.side, "short");
  assert.equal(state.tradeType, "follow");
  assert.equal(state.rMissing, true);
  assert.equal(state.page, 2);
  assert.equal(state.pageSize, 20);
  assert.equal(state.trade, "T-9");
  assert.equal(state.campaign, "C-1");
});

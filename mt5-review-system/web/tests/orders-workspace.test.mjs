import assert from "node:assert/strict";
import test from "node:test";

import { createOrdersController } from "../orders/orders.mjs";
import {
  buildCampaignsQuery,
  normalizeListState,
  readOrdersState,
} from "../orders/orders-state.mjs";

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
  return {
    paths,
    methods,
    async requestJson(requestPath, options = {}) {
      paths.push(requestPath);
      methods.push(options.method || "GET");
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

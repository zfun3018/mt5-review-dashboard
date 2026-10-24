import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCampaignPageSize,
  createOrdersController,
  groupCampaignsByDay,
  mergePinnedCampaigns,
  renderCheckinCalendarMarkup,
} from "../orders/orders.mjs";
import {
  buildCampaignsQuery,
  normalizeListState,
  readOrdersState,
} from "../orders/orders-state.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  campaignContractDisplay,
  executionRows,
  renderImportSourcesMarkup,
  shouldConfirmFeaturedRemoval,
} from "../orders/order-detail.mjs";
import { formatBeijingDateTime } from "../shared/js/formatters.mjs";

const ordersSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "orders.mjs"), "utf8");
const ordersStyle = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "orders.css"), "utf8");
const ordersHtml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "index.html"), "utf8");
const orderDetailSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "orders", "order-detail.mjs"), "utf8");

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
      if (Object.prototype.hasOwnProperty.call(routes, requestPath)) {
        const route = routes[requestPath];
        return typeof route === "function" ? await route(requestPath, options) : route;
      }
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
    platform: options.platform || "mt5",
  });
  return { api, controller, view };
}

test("order filters are sent to the server", async () => {
  const { api, controller } = controllerWith();
  await controller.loadList({ q: "XAU", side: "long", page: 2, pageSize: 50, rMissing: true });
  assert.equal(api.paths[0], "/api/campaigns?q=XAU&side=long&r_missing=1&page=2&page_size=50");
});

test("featured is a view of the same campaign order list", async () => {
  const { api, controller } = controllerWith();
  await controller.loadList({ listView: "featured" });
  assert.equal(api.paths[0], "/api/campaigns?featured=1&page=1&page_size=12");
});

test("order list appends the next batch without splitting the visible workflow into pages", async () => {
  const first = campaign("C-1", { opened_at_utc: "2026-10-20T01:00:00Z" });
  const second = campaign("C-2", { opened_at_utc: "2026-10-20T02:00:00Z" });
  const { api, controller } = controllerWith(
    { search: "" },
    {
      "/api/campaigns?page=1&page_size=50": {
        campaigns: [first],
        total: 52,
        page: 1,
        page_size: 50,
      },
      "/api/campaigns?page=2&page_size=50": {
        campaigns: [second],
        total: 52,
        page: 2,
        page_size: 50,
      },
    },
  );

  await controller.loadList({ page: 1, pageSize: 50 });
  await controller.loadMore();

  assert.deepEqual(controller.getPage().campaigns.map((item) => item.id), ["C-1", "C-2"]);
  assert.equal(api.paths[1], "/api/campaigns?page=2&page_size=50");
});

test("a stale list response cannot overwrite the latest list selection", async () => {
  let releaseOld;
  const oldResponse = new Promise((resolve) => {
    releaseOld = resolve;
  });
  const newest = campaign("C-NEW", { display_symbol: "最新订单" });
  const { controller } = controllerWith(
    { search: "" },
    {
      "/api/campaigns?q=old&page=1&page_size=12": () => oldResponse,
      "/api/campaigns?q=new&page=1&page_size=12": {
        campaigns: [newest],
        total: 1,
        page: 1,
        page_size: 12,
      },
    },
  );

  const oldRequest = controller.loadList({ q: "old" });
  const newRequest = controller.loadList({ q: "new" });
  await newRequest;
  releaseOld({ campaigns: [campaign("C-OLD", { display_symbol: "旧订单" })], total: 1, page: 1, page_size: 12 });
  await oldRequest;

  assert.deepEqual(controller.getPage().campaigns.map((item) => item.id), ["C-NEW"]);
});

test("orders workspace uses a scroll status instead of page navigation controls", () => {
  assert.match(ordersHtml, /orderLoadStatus/);
  assert.doesNotMatch(ordersHtml, /orderPrev|orderNext|orderPage/);
  assert.match(ordersStyle, /\.trades-panel \.table-wrap[\s\S]*overflow-y:\s*auto/);
});

test("sticky order table headers use an opaque surface while rows scroll underneath", () => {
  assert.match(ordersStyle, /html\[data-platform\] \.orders-table thead th\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*5[^}]*background:\s*#151a22/s);
});

test("featured campaigns are visibly marked in the main order list", async () => {
  const { controller, view } = controllerWith(
    { search: "" },
    {},
    { campaigns: [campaign("C-FEATURED", { is_featured: 1 })] },
  );

  await controller.loadList();

  assert.match(view.getElementById("orderRows").innerHTML, /campaign-featured-mark/);
  assert.match(view.getElementById("orderRows").innerHTML, /已精选/);
});

test("main order list renders the canonical contract display name", async () => {
  const { controller, view } = controllerWith(
    { search: "" },
    {},
    { campaigns: [campaign("C-CONTRACT", { display_symbol: "黄金期货" })] },
  );

  await controller.loadList();

  assert.match(view.getElementById("orderHead").innerHTML, /订单信息/);
  assert.match(view.getElementById("orderRows").innerHTML, /黄金期货/);
});

test("contract title shows the common name and raw code only when they differ", () => {
  assert.deepEqual(
    campaignContractDisplay({ symbol: "V2701", display_symbol: "PVC2701" }),
    { name: "PVC2701", code: "V2701" },
  );
  assert.deepEqual(
    campaignContractDisplay({ symbol: "XAUUSD", display_symbol: "XAUUSD" }),
    { name: "XAUUSD", code: "" },
  );
});

test("order details expose import batch provenance without absolute paths", () => {
  const markup = renderImportSourcesMarkup([
    {
      batch_id: "IMP-1",
      filename: "trades.xls",
      started_at: "2026-10-21T01:00:00Z",
      source_sheet: "成交明细",
      source_rows: [11, 12],
      trade_ids: ["1001", "1002"],
      file_sha256: "abc123",
    },
  ]);

  assert.match(markup, /trades\.xls/);
  assert.match(markup, /成交明细/);
  assert.match(markup, /11, 12/);
  assert.match(markup, /1001, 1002/);
  assert.match(markup, /abc123/);
  assert.doesNotMatch(markup, /[A-Z]:\\/);
  assert.match(markup, /import-source-section is-secondary/);
  assert.ok(orderDetailSource.indexOf('class="execution-section"') < orderDetailSource.lastIndexOf("renderImportSourcesMarkup"));
});

test("MT5 and domestic futures use the same compact order-list structure", async () => {
  for (const platform of ["mt5", "domestic_futures"]) {
    const item = campaign("C-COMPACT", {
      platform,
      symbol: platform === "domestic_futures" ? "V2701" : "XAUUSD",
      display_symbol: platform === "domestic_futures" ? "PVC2701" : "XAUUSD",
      opened_at_utc: "2026-10-20T03:00:00Z",
      net_pnl: -72.02,
    });
    const { view, controller } = controllerWith(
      { search: platform === "domestic_futures" ? "?platform=domestic_futures" : "" },
      {},
      { platform, campaigns: [item] },
    );

    await controller.loadList();

    const html = view.getElementById("orderRows").innerHTML;
    assert.match(view.getElementById("orderHead").innerHTML, /<th>订单信息<\/th><th>R 值<\/th><th>净盈亏<\/th>/);
    assert.match(html, /campaign-list-order/);
    assert.match(html, /campaign-list-contract/);
    assert.match(html, /<span class="campaign-list-opened">11:00<\/span>/);
    assert.match(html, />-72\.02<\/strong>/);
    assert.doesNotMatch(html, /\$-?72\.02/);
  }
});

test("domestic futures order groups use the exchange trade date for night orders", () => {
  const groups = groupCampaignsByDay([
    campaign("C-NIGHT", {
      platform: "domestic_futures",
      trade_date: "2026-10-20",
      opened_at_utc: "2026-10-19T13:00:00Z",
    }),
  ], "domestic_futures");

  assert.equal(groups[0].key, "2026-10-20");
  assert.match(groups[0].label, /10月20日/);
});

test("removing a featured campaign requires confirmation", () => {
  assert.equal(shouldConfirmFeaturedRemoval({ is_featured: true }), true);
  assert.equal(shouldConfirmFeaturedRemoval({ is_featured: false }), false);
});

test("featured action is separated and rendered as a solid orange star", () => {
  assert.match(orderDetailSource, /featured-action/);
  assert.match(orderDetailSource, /detail-action-divider/);
  assert.match(orderDetailSource, /确认取消精选/);
  assert.match(ordersStyle, /\.detail-icon-action\.featured-action\.is-active/);
  assert.match(ordersStyle, /\.campaign-featured-mark svg[\s\S]*fill: currentColor/);
});

test("check-in calendar renders a month grid with weekday headers and counts", () => {
  const markup = renderCheckinCalendarMarkup({
    days: [
      { date: "2026-10-01", count: 2 },
      { date: "2026-10-08", count: 1 },
    ],
  });
  assert.match(markup, /2026年10月/);
  assert.match(markup, /星期一/);
  assert.match(markup, /星期日/);
  assert.match(markup, /2次/);
  assert.match(markup, /role="gridcell"/);
  assert.match(markup, /is-empty/);
});

test("campaign check-in toggles between create and cancel and refreshes the calendar", async () => {
  const selected = campaign("C-1", { checkin_checked_in_today: false, checkin_count: 2 });
  const { api, controller } = controllerWith(
    { search: "" },
    {
      "/api/campaigns/C-1/checkin": { campaign_id: "C-1", checked_in: true },
      "/api/campaigns/C-1/checkin?cancel=1": { campaign_id: "C-1", checked_in: false },
      "/api/campaign-checkins?days=35&platform=mt5": { days: [] },
    },
    { campaigns: [selected], detail: { ...selected, positions: [] } },
  );

  await controller.checkinCampaign(selected);
  assert.equal(api.methods[0], "POST");
  assert.ok(api.paths.includes("/api/campaign-checkins?days=35&platform=mt5"));

  selected.checkin_checked_in_today = true;
  await controller.checkinCampaign(selected);
  assert.ok(api.methods.includes("DELETE"));
  assert.ok(api.paths.some((path) => path === "/api/campaigns/C-1/checkin"));
});

test("random featured campaign remains visible while its detail is loading", async () => {
  const selected = campaign("C-RANDOM", { display_order_no: "C-RANDOM" });
  const { api, controller } = controllerWith(
    { search: "" },
    { "/api/campaigns/random-featured?platform=mt5": { campaign: selected } },
    { campaigns: [campaign("C-FIRST")], detail: { ...selected, positions: [] } },
  );

  await controller.loadList();
  await controller.randomFeaturedCampaign();

  assert.equal(controller.getState().campaign, "C-RANDOM");
  assert.ok(controller.getPage().campaigns.some((item) => item.id === "C-RANDOM"));
  assert.equal(
    api.paths[api.paths.indexOf("/api/campaigns/random-featured?platform=mt5")],
    "/api/campaigns/random-featured?platform=mt5",
  );
});

test("domestic futures random featured request keeps the platform scope", async () => {
  const selected = campaign("C-FUT-RANDOM", {
    platform: "domestic_futures",
  });
  const { api, controller } = controllerWith(
    { search: "?platform=domestic_futures" },
    {
      "/api/campaigns/random-featured?platform=domestic_futures": { campaign: selected },
      "/api/campaigns?featured=1&page=1&page_size=12&platform=domestic_futures": {
        campaigns: [selected],
        total: 1,
        page: 1,
        page_size: 12,
      },
      "/api/campaigns/C-FUT-RANDOM?platform=domestic_futures": {
        ...selected,
        screenshot_url: "/media/screenshots/manual-futures.png",
        positions: [],
      },
    },
    { platform: "domestic_futures" },
  );

  await controller.randomFeaturedCampaign();

  assert.ok(api.paths.includes("/api/campaigns/random-featured?platform=domestic_futures"));
  assert.ok(api.paths.includes("/api/campaigns/C-FUT-RANDOM?platform=domestic_futures"));
  assert.equal(
    controller.getPage().campaigns[0].screenshot_url,
    "/media/screenshots/manual-futures.png",
  );
});

test("random campaign stays selected when a capacity refresh returns another page", () => {
  const selected = campaign("C-RANDOM");
  const refreshedPage = [campaign("C-FIRST"), campaign("C-SECOND"), campaign("C-THIRD")];

  const visible = mergePinnedCampaigns(refreshedPage, selected, 3);

  assert.equal(visible[0].id, "C-RANDOM");
  assert.deepEqual(visible.map((item) => item.id), ["C-RANDOM", "C-FIRST", "C-SECOND"]);
});

test("saving a stop refreshes one campaign and the current page", async () => {
  const { api, controller } = controllerWith();
  await controller.saveInitialStop("P-1", 98);
  assert.deepEqual(api.methods, ["PATCH", "GET", "GET"]);
  assert.match(api.paths[1], /\/api\/campaigns\//);
  assert.match(api.paths[2], /\/api\/campaigns\?/);
});

test("campaign stop save falls back to each position when the campaign endpoint is unavailable", async () => {
  const selected = campaign("C-1", {
    position_count: 2,
    position_summaries: [position("1"), position("2")],
  });
  const detail = { ...selected, positions: selected.position_summaries };
  const { api, controller } = controllerWith(
    { search: "" },
    {
      "/api/campaigns/C-1/initial-stop": async () => {
        const error = new Error("Campaign not found");
        error.status = 404;
        throw error;
      },
    },
    { campaigns: [selected], detail },
  );

  await controller.load();
  await controller.saveCampaignInitialStop("C-1", 1790);

  assert.ok(api.paths.includes("/api/positions/1/initial-stop"));
  assert.ok(api.paths.includes("/api/positions/2/initial-stop"));
  assert.equal(api.bodies[api.paths.indexOf("/api/positions/1/initial-stop")].initial_stop_price, 1790);
});

test("campaign page size is calculated from the available list height", () => {
  assert.equal(calculateCampaignPageSize({ availableHeight: 430, groupCount: 2 }), 8);
  assert.equal(calculateCampaignPageSize({ availableHeight: 160, groupCount: 1 }), 2);
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
    review_text: "主订单级复盘",
  });
  const { view, controller } = controllerWith(
    { search: "?trade=T-9" },
    {},
    { campaigns: [selectedCampaign], detail: { ...selectedCampaign, positions: [selectedPosition] } },
  );

  await controller.load();

  assert.match(view.getElementById("orderDetail").innerHTML, /id="detailReview"/);
  assert.match(view.getElementById("orderDetail").innerHTML, /主订单级复盘/);
  assert.doesNotMatch(view.getElementById("orderDetail").innerHTML, /代表订单复盘/);
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

test("refreshing the list onto another campaign also loads that campaign detail", async () => {
  const first = campaign("C-1", { display_symbol: "第一笔" });
  const second = campaign("C-2", { display_symbol: "第二笔" });
  let listCalls = 0;
  const { view, controller } = controllerWith(
    { search: "" },
    {
      "/api/campaigns?page=1&page_size=50": async () => {
        listCalls += 1;
        return {
          campaigns: listCalls === 1 ? [first, second] : [second],
          total: listCalls === 1 ? 2 : 1,
          page: 1,
          page_size: 50,
        };
      },
      "/api/campaigns/C-1?platform=mt5": { ...first, positions: [] },
      "/api/campaigns/C-2?platform=mt5": { ...second, positions: [] },
    },
  );

  await controller.load();
  await controller.loadList();

  assert.match(view.getElementById("orderRows").innerHTML, /class="campaign-row active[^"]*" data-campaign-id="C-2"/);
  assert.match(view.getElementById("orderDetail").innerHTML, /第二笔/);
  assert.doesNotMatch(view.getElementById("orderDetail").innerHTML, /正在加载主订单详情/);
});

test("multi-Position campaigns are expanded as one main-order row per campaign", async () => {
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

  assert.match(view.getElementById("orderRows").innerHTML, /data-campaign-id="C-1"/);
  assert.equal(childRows(), 0);
  assert.doesNotMatch(view.getElementById("orderRows").innerHTML, /data-campaign-expand/);
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

test("deleted order filter is included in the campaigns query", () => {
  assert.equal(
    buildCampaignsQuery({ deleted: "deleted", page: 1, pageSize: 12 }),
    "deleted=deleted&page=1&page_size=12",
  );
  assert.match(ordersHtml, /id="deletedFilter"/);
  assert.match(ordersSource, /restoreSelectedTrade/);
});

test("campaign list uses server-side pagination state", async () => {
  const { api, controller } = controllerWith({ search: "?page=3" }, {}, { campaigns: [campaign("C-1")] });
  await controller.loadList();
  assert.equal(api.paths[0], "/api/campaigns?page=3&page_size=12");
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

  const summary = view.getElementById("orderRows").innerHTML;
  assert.match(summary, /data-campaign-id="C-1"/);
  assert.match(summary, /campaign-kind-mark/);
  assert.doesNotMatch(summary, /data-campaign-classification=/);
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

test("order table keeps scene and strategy out of the main-order index", () => {
  const renderSource = ordersSource.slice(ordersSource.indexOf("function renderCampaignPositionRow"), ordersSource.indexOf("function bindRowInteractions"));
  assert.match(renderSource, /<tr><th>订单信息<\/th><th>R 值<\/th><th>净盈亏<\/th><\/tr>/);
  assert.doesNotMatch(renderSource, /<th>交易场景<\/th>|<th>交易策略<\/th>/);
});

test("main-order rows group by Beijing date and restart their sequence per day", async () => {
  const previousRMultiple = globalThis.RMultipleUI;
  globalThis.RMultipleUI = { formatCampaignR: (value) => `${Number(value.campaign_r) > 0 ? "+" : ""}${Number(value.campaign_r).toFixed(2)}R` };
  const { view, controller } = controllerWith(
    { search: "" },
    {},
    {
      campaigns: [
        campaign("C-DAY-1", { opened_at_utc: "2026-10-08T01:00:00Z", campaign_r: 1.2, net_pnl: 10 }),
        campaign("C-DAY-2", { opened_at_utc: "2026-10-08T02:00:00Z", campaign_r: -0.4, net_pnl: -4 }),
        campaign("C-DAY-3", { opened_at_utc: "2026-10-07T03:00:00Z", campaign_r: 0.8, net_pnl: 8 }),
      ],
    },
  );
  await controller.loadList();
  globalThis.RMultipleUI = previousRMultiple;

  let html = view.getElementById("orderRows").innerHTML;
  assert.equal((html.match(/campaign-day-row/g) || []).length, 2);
  assert.match(html, /10月8日 周四/);
  assert.match(html, /10月7日 周三/);
  assert.match(html, /aria-expanded="true"/);

  assert.match(html, /data-day-sequence="1"/);
  assert.match(html, /data-day-sequence="2"/);
  assert.equal((html.match(/data-day-sequence="1"/g) || []).length, 2);
  assert.match(html, /\+1\.20<\/td>/);
  assert.doesNotMatch(html, /\+1\.20R/);
  assert.match(html, /2笔/);
});

test("campaign rows are numbered from the earliest Beijing opening time", async () => {
  const { view, controller } = controllerWith(
    { search: "" },
    {},
    {
      campaigns: [
        campaign("C-LATE", { opened_at_utc: "2026-10-08T03:00:00Z" }),
        campaign("C-EARLY", { opened_at_utc: "2026-10-08T01:00:00Z" }),
      ],
    },
  );
  await controller.loadList();

  const html = view.getElementById("orderRows").innerHTML;
  assert.ok(html.indexOf('data-campaign-id="C-EARLY"') < html.indexOf('data-campaign-id="C-LATE"'));
  assert.match(html, /data-campaign-id="C-EARLY"[^>]*data-day-sequence="1"/);
  assert.match(html, /data-campaign-id="C-LATE"[^>]*data-day-sequence="2"/);
});

test("selected order rows use a stronger background than scratch rows", () => {
  assert.match(ordersStyle, /html\[data-platform="mt5"\] \.orders-table tbody tr\.active,\s*html\[data-platform="mt5"\] \.campaign-detail-row\.active\s*\{[\s\S]*background:\s*#dff5f1 !important;[\s\S]*#069d91/);
  assert.match(ordersStyle, /\.campaign-row\.scratch\s*\{[\s\S]*background:\s*rgba\(130, 148, 168, 0\.12\) !important;/);
  assert.match(ordersStyle, /html\[data-platform="mt5"\] \.campaign-row\.scratch\.active\s*\{[\s\S]*background:\s*#fff0d9 !important;[\s\S]*#f49b22/);
});

test("order actions use accessible Lucide icon buttons", () => {
  assert.match(orderDetailSource, /data-lucide="star"/);
  assert.match(orderDetailSource, /data-lucide="shuffle"/);
  assert.match(orderDetailSource, /check-circle/);
  assert.match(orderDetailSource, /archive/);
  assert.match(orderDetailSource, /aria-label=/);
  assert.match(orderDetailSource, /lucide\?\.createIcons/);
});

test("primary review fields sit before the featured action and the tag area only contains mistakes", () => {
  const detailHeaderStart = orderDetailSource.indexOf('<header class="detail-title order-detail-title">');
  const detailHeaderEnd = orderDetailSource.indexOf("</header>", detailHeaderStart);
  const detailHeader = orderDetailSource.slice(detailHeaderStart, detailHeaderEnd);
  const reviewFieldsStart = orderDetailSource.indexOf('<div class="detail-primary-review-fields"', detailHeaderStart);
  const headingStart = orderDetailSource.indexOf('<div class="order-detail-heading">', detailHeaderStart);
  const actionBarStart = orderDetailSource.indexOf('<div class="detail-order-actions"', detailHeaderStart);
  const featuredAction = orderDetailSource.indexOf('<span class="detail-action-group" aria-label="订单状态">');
  const mistakeAreaStart = orderDetailSource.indexOf('<section class="order-info-strip"');
  const reviewEditorStart = orderDetailSource.indexOf('<section class="review-editor-panel">', mistakeAreaStart);
  const mistakeArea = orderDetailSource.slice(mistakeAreaStart, reviewEditorStart);

  assert.ok(headingStart < reviewFieldsStart && reviewFieldsStart < actionBarStart);
  assert.match(detailHeader, /<div class="order-detail-heading">[\s\S]*?<div class="detail-primary-review-fields"[\s\S]*?<div class="detail-order-actions"/);
  assert.match(ordersStyle, /html\[data-platform\] \.order-detail-title\s*\{[^}]*display:\s*grid[^}]*align-items:\s*center/s);
  assert.ok(reviewFieldsStart < featuredAction);
  assert.match(orderDetailSource.slice(reviewFieldsStart, featuredAction), /campaignInitialStop/);
  assert.match(orderDetailSource.slice(reviewFieldsStart, featuredAction), /renderTagPicker\("trade_type_tags"/);
  assert.match(orderDetailSource.slice(reviewFieldsStart, featuredAction), /renderTagPicker\("strategy_tags"/);
  assert.match(mistakeArea, /renderTagPicker\("mistake_tags"/);
  assert.match(orderDetailSource.slice(reviewFieldsStart, featuredAction), /id="saveState"/);
  assert.doesNotMatch(mistakeArea, /campaignInitialStop|trade_type_tags|strategy_tags/);
});

test("mistake tags size to their content and wrap without stretching or clipping", () => {
  assert.match(ordersStyle, /html\[data-platform\] \.detail-primary-review-fields\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
  assert.match(ordersStyle, /html\[data-platform\] \.detail-review-column \.order-info-strip\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*100%/s);
  assert.match(ordersStyle, /html\[data-platform\] \.order-info-strip \.campaign-tag-field\[data-tag-picker="mistake_tags"\]\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*100%/s);
  assert.match(ordersStyle, /html\[data-platform\] \.order-info-strip \.campaign-tag-field\[data-tag-picker="mistake_tags"\] \.choice-cell-values\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
  assert.match(ordersStyle, /html\[data-platform\] \.order-info-strip \.campaign-tag-field\[data-tag-picker="mistake_tags"\] \.choice-cell\.detail-choice\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
});

test("check-in action is a labeled pill while preserving its accessible pressed state", () => {
  assert.match(orderDetailSource, /id="checkinCampaign" class="app-icon-button detail-icon-action detail-checkin-pill/);
  assert.match(orderDetailSource, /<span class="detail-checkin-label">\$\{campaign\.checkin_checked_in_today \? "已打卡" : "今日打卡"\}<\/span>/);
  assert.match(ordersStyle, /html\[data-platform\] \.detail-icon-action\.detail-checkin-pill\s*\{[^}]*width:\s*auto[^}]*border-radius:\s*var\(--radius-pill\)/s);
});

test("daily order summaries use semantic profit and loss pills", () => {
  assert.match(ordersSource, /class="\$\{profitClass\(groupPnl\)\} campaign-day-pnl-pill"/);
  assert.match(ordersStyle, /html\[data-platform\] \.campaign-day-summary \.campaign-day-pnl-pill\s*\{[^}]*padding:[^}]*border-radius:\s*var\(--radius-pill\)/s);
});

test("orders workspace keeps shared light contrast and a full-width calendar grid", () => {
  assert.match(ordersStyle, /html\[data-platform="mt5"\][\s\S]*\.choice-value-pill/);
  assert.match(ordersStyle, /html\[data-platform="domestic_futures"\][\s\S]*\.choice-value-pill/);
  assert.match(ordersStyle, /html\[data-platform="mt5"\][\s\S]*\.campaign-day-row td/);
  assert.match(ordersStyle, /html\[data-platform="domestic_futures"\][\s\S]*\.campaign-day-row td/);
  assert.match(ordersStyle, /\.checkin-calendar\s*\{[^}]*display:\s*block/);
  assert.match(ordersStyle, /\.checkin-calendar-weekdays span\s*\{[^}]*white-space:\s*nowrap/);
});

test("order list aligns amounts and keeps the three columns balanced", () => {
  assert.match(ordersStyle, /\.orders-table th:nth-child\(2\),\s*\.orders-table td:nth-child\(2\)\s*\{[\s\S]*?width:\s*4\.3rem[\s\S]*?text-align:\s*center/s);
  assert.match(ordersStyle, /\.orders-table th:nth-child\(3\),\s*\.orders-table td:nth-child\(3\)\s*\{[\s\S]*?width:\s*6rem[\s\S]*?text-align:\s*right/s);
  assert.match(ordersStyle, /\.campaign-list-pnl,\s*\.campaign-day-summary strong:last-child\s*\{[\s\S]*?font-size:\s*12px[\s\S]*?font-variant-numeric:\s*tabular-nums/s);
  assert.match(ordersStyle, /\.campaign-day-summary strong:last-child\s*\{[\s\S]*?background:\s*color-mix\(/s);
});

test("scratch campaigns carry the legacy state styling and a compact PnL emphasis", async () => {
  const { view, controller } = controllerWith(
    { search: "" },
    {},
    { campaigns: [campaign("C-SCRATCH", { campaign_r: 0.05, risk_status: "complete", net_pnl: 3.2 })] },
  );
  await controller.loadList();
  const html = view.getElementById("orderRows").innerHTML;
  assert.match(html, /class="campaign-row[^\"]*scratch/);
  assert.match(html, /campaign-scratch-mark/);
  assert.match(html, /campaign-list-pnl[^\"]*profit-text/);
  assert.doesNotMatch(ordersHtml, /class="table-legend"/);
});

test("the main-order list keeps the aligned panel height and scrolls continuously", () => {
  assert.match(ordersStyle, /\.trades-panel \.table-wrap[\s\S]*overflow-y:\s*auto/);
  assert.doesNotMatch(ordersHtml, /orderPrev|orderNext|orderPage/);
  assert.match(ordersSource, /applyListPanelHeight/);
  assert.match(ordersSource, /loadMore/);
  assert.doesNotMatch(ordersSource, /syncListCapacity|scheduleListCapacitySync/);
});

test("execution ledger separates entry and exit direction and closes the final complete exit", () => {
  const records = executionRows({
    positions: [{
      side: "long",
      weighted_entry_price: 100,
      reconstruction_status: "complete",
      entry_deals: [
        { time_utc: "2026-10-16T01:00:00Z", time_msc: 1, price: 100, volume: 1 },
        { time_utc: "2026-10-16T01:05:00Z", time_msc: 2, price: 101, volume: 1 },
      ],
      exit_deals: [
        {
          time_utc: "2026-10-16T01:10:00Z",
          time_msc: 3,
          price: 102,
          volume: 0.5,
          profit: 1,
          commission: -0.2,
          swap: -0.1,
          fee: -0.05,
        },
        {
          time_utc: "2026-10-16T01:15:00Z",
          time_msc: 4,
          price: 103,
          volume: 1.5,
          profit: 2,
          commission: -0.3,
          swap: -0.2,
          fee: -0.1,
        },
      ],
    }],
  });
  assert.deepEqual(records.map((record) => [record.typeLabel, record.direction]), [
    ["开仓", "多"],
    ["加仓", "多"],
    ["减仓", "平多"],
    ["平仓", "平多"],
  ]);
  assert.match(records[0].time, /周五/);
  assert.doesNotMatch(records[0].time, /UTC/);
  assert.equal(records[2].pnlValue, 1);
  assert.equal(records[2].feesValue, -0.35);
  assert.equal(records[2].netPnlValue, 0.65);
  assert.equal(records[3].pnlValue, 2);
  assert.equal(records[3].feesValue, -0.6);
  assert.equal(records[3].netPnlValue, 1.4);
  assert.equal(records[3].pnl, "$2.00");
  assert.equal(records[3].fees, "-$0.60");
  assert.equal(records[3].netPnl, "$1.40");
  assert.match(orderDetailSource, /<th>手续费<\/th><th>盈亏<\/th><th>净盈亏<\/th>/);
});

test("order action icons have a wide hit-area gap", () => {
  assert.match(ordersStyle, /\.detail-order-actions\s*\{[\s\S]*gap:\s*14px/);
});

test("screenshot layout preserves the image's natural aspect ratio", () => {
  const compactStyle = ordersStyle.slice(ordersStyle.lastIndexOf(".snapshot.compact-snapshot"));
  assert.match(compactStyle, /aspect-ratio:\s*auto/);
  assert.match(compactStyle, /width:\s*100%;[\s\S]*height:\s*auto;/);
  assert.doesNotMatch(compactStyle, /min-height:\s*280px/);
  assert.match(ordersStyle, /\.screenshot-preview\s*\{[\s\S]*display:\s*flex/);
  assert.match(ordersStyle, /\.detail-hero-grid\s*\{[\s\S]*grid-template-columns:\s*fit-content\(70%\)\s+minmax\(0, 1fr\)/);
  assert.match(ordersStyle, /\.detail-hero-grid\s*\{[\s\S]*overflow:\s*visible/);
  assert.match(ordersStyle, /\.screenshot-editor\s*\{[\s\S]*width:\s*fit-content/);
  assert.match(ordersStyle, /\.screenshot-editor\s*\{[\s\S]*position:\s*relative/);
  assert.match(ordersStyle, /\.screenshot-overlay-controls\s*\{[\s\S]*left:\s*14px/);
  assert.match(ordersStyle, /\.screenshot-preview\s*\{[\s\S]*width:\s*fit-content[\s\S]*overflow:\s*visible/);
  assert.match(compactStyle, /max-height:\s*none/);
  assert.match(orderDetailSource, /detailScreenshotImage/);
  assert.match(orderDetailSource, /onLayoutChange/);
});

test("campaign tag menus stay open for multiple selections and close outside", () => {
  assert.doesNotMatch(
    orderDetailSource.slice(orderDetailSource.indexOf("async function saveTagSelection"), orderDetailSource.indexOf("function bindTagPickers")),
    /closeChoicePopover\(\)/,
  );
  assert.match(orderDetailSource, /data-tag-trigger/);
  assert.match(orderDetailSource, /choice-popover/);
  assert.match(orderDetailSource, /event\.target\?\.closest\?\.\("\.choice-popover, \[data-tag-trigger\]"\)/);
});

test("screenshot layout sync is guarded against repeated renders", () => {
  assert.match(orderDetailSource, /lastScreenshotLayout/);
  assert.match(orderDetailSource, /naturalWidth.*naturalHeight/);
  assert.doesNotMatch(orderDetailSource, /bindDetailInteractions\(campaign, trade, \{[^}]+\}\);\s*onLayoutChange\?\.\(\);/s);
});

test("order timestamps use Beijing time and include the weekday", () => {
  const value = formatBeijingDateTime("2026-10-16T01:42:00Z");
  assert.match(value, /周五/);
  assert.match(value, /09:42/);
  assert.match(orderDetailSource, /<th>时间 · 北京<\/th>/);
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

test("order detail prefers the human-readable contract display name", () => {
  assert.match(orderDetailSource, /campaignContractDisplay\(campaign\)/);
  assert.match(orderDetailSource, /detail-contract-code/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { createDashboardController } from "../dashboard/dashboard.mjs";
import {
  readDashboardState,
  writeDashboardState,
} from "../dashboard/dashboard-state.mjs";

class FakeElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.hidden = false;
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

function recordingApi(routes) {
  const paths = [];
  const methods = [];
  return {
    paths,
    methods,
    async requestJson(requestPath, options = {}) {
      paths.push(requestPath);
      methods.push(options.method || "GET");
      if (routes[requestPath]) return routes[requestPath];
      throw new Error(`unexpected path ${requestPath}`);
    },
  };
}

const ANALYSIS = {
  start_date: "",
  end_date: "",
  metrics: { order_count: 12, net_pnl: 340.5, win_rate: 0.5 },
  r_metrics: { sample_count: 12, complete_count: 10, sqn_status: "available", sqn: 1.4 },
  periods: {
    today: { net_pnl: 10, order_count: 1, win_rate: 1, profit_factor: null, payoff_ratio: null },
    week: { net_pnl: 120, order_count: 4, win_rate: 0.5, profit_factor: 1.2, payoff_ratio: 1.1 },
    month: { net_pnl: 340.5, order_count: 12, win_rate: 0.5, profit_factor: 1.4, payoff_ratio: 1.3 },
    year: { net_pnl: 900, order_count: 30, win_rate: 0.5, profit_factor: 1.6, payoff_ratio: 1.4 },
  },
  equity: [
    { time_bj: "2026-08-01T10:00:00+08:00", equity: 10000, cumulative_return: 0, return_rate: 0 },
    { time_bj: "2026-08-02T10:00:00+08:00", equity: 10050, cumulative_return: 50, return_rate: 0.5 },
  ],
  calendar: {
    year: 2026,
    month: 8,
    month_net_pnl: 340.5,
    month_order_count: 12,
    month_win_rate: 0.5,
    days: { "2026-08-02": { label: "2026-08-02", net_pnl: 50, order_count: 2, win_rate: 0.5 } },
  },
  heatmap: { days: [], max_abs_pnl: 0 },
  sessions: {
    asia: { key: "asia", label: "Asia", window: "08:00-15:00", net_pnl: 100, order_count: 4, win_rate: 0.5, avg_pnl: 25 },
    europe: { key: "europe", label: "Europe", window: "15:00-20:00", net_pnl: 150, order_count: 5, win_rate: 0.6, avg_pnl: 30 },
    us: { key: "us", label: "US", window: "20:00-02:00", net_pnl: 90.5, order_count: 3, win_rate: 0.33, avg_pnl: 30.17 },
  },
  system_evaluation: [{ date: "2026-08-02", net_pnl: 50, order_count: 2, win_rate: 0.5 }],
  mode_evaluation: { trade_type: [], strategy: [] },
};

test("dashboard loads analysis without campaigns or bootstrap", async () => {
  const api = recordingApi({ "/api/analysis?equity_days=30": ANALYSIS });
  const controller = createDashboardController({
    api,
    view: new FakeView(),
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();

  assert.deepEqual(api.paths, ["/api/analysis?equity_days=30"]);
  assert.equal(
    api.paths.some((requestPath) => requestPath.includes("campaigns") || requestPath.includes("bootstrap")),
    false,
  );
});

test("dashboard resolves a preset into a dated analysis window", async () => {
  const api = recordingApi({});
  api.requestJson = async (requestPath) => {
    api.paths.push(requestPath);
    return ANALYSIS;
  };
  const controller = createDashboardController({
    api,
    view: new FakeView(),
    location: { search: "?preset=7d" },
    history: { replaceState() {} },
  });

  await controller.load();

  assert.equal(api.paths.length, 1);
  assert.equal(api.paths[0].startsWith("/api/analysis?"), true);
  assert.equal(api.paths[0].includes("equity_days=7"), true);
  assert.equal(api.paths[0].includes("start="), true);
  assert.equal(api.paths[0].includes("end="), true);
});

test("dashboard URL state round-trips preset, start, end, equity days, year, and month", () => {
  const state = readDashboardState(
    "?preset=custom&start=2026-08-01&end=2026-08-31&equity_days=31&year=2026&month=8",
  );
  assert.deepEqual(state, {
    preset: "custom",
    start: "2026-08-01",
    end: "2026-08-31",
    equity_days: 31,
    year: 2026,
    month: 8,
  });

  const calls = [];
  const location = { pathname: "/dashboard/", search: "?preset=all", hash: "" };
  const history = { replaceState: (...args) => calls.push(args) };
  writeDashboardState(state, { location, history });

  assert.deepEqual(calls, [
    [null, "", "/dashboard/?preset=custom&start=2026-08-01&end=2026-08-31&equity_days=31&year=2026&month=8"],
  ]);

  const defaults = readDashboardState("");
  assert.equal(defaults.preset, "all");
  assert.equal(defaults.equity_days, 30);
  assert.equal(defaults.year, null);
  assert.equal(defaults.month, null);
});

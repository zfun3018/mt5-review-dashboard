const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const albumHtml = fs.readFileSync(path.join(__dirname, "..", "album", "index.html"), "utf8");
const albumSource = fs.readFileSync(path.join(__dirname, "..", "album", "album.mjs"), "utf8");
const albumStyle = fs.readFileSync(path.join(__dirname, "..", "album", "album.css"), "utf8");

class FakeElement {
  constructor() {
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.className = "";
    this.hidden = false;
    this.dataset = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const set = this.listeners.get(type) || new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
}

class FakeView {
  constructor() {
    this.elements = new Map();
  }

  getElementById(id) {
    if (!this.elements.has(id)) {
      const element = new FakeElement();
      element.id = id;
      this.elements.set(id, element);
    }
    return this.elements.get(id);
  }

  querySelectorAll() {
    return [];
  }

  addEventListener() {}
}

const EMPTY_ALBUM = {
  filters: { start: "", end: "", symbols: [], tags: [], sort: "desc" },
  trades: [],
  days: [],
  total: 0,
  page: 1,
  page_size: 100,
  available_filters: { symbols: [], tags: [], custom_fields: [] },
};

test("album mounts the shared shell and keeps review writes scoped to trades", () => {
  assert.match(albumHtml, /data-app-shell/);
  assert.match(albumHtml, /shared\/css\/tokens\.css/);
  assert.match(albumSource, /shell\.mjs/);
  assert.match(albumHtml, /复盘画册/);
  assert.match(albumSource, /\/api\/review-album/);
  assert.match(albumSource, /\/api\/trades/);
  assert.doesNotMatch(albumSource, /\/api\/campaigns|\/api\/analysis|\/api\/positions/);
  assert.match(albumSource, /custom_fields/);
  assert.doesNotMatch(albumSource, /sideFilter/);
  assert.doesNotMatch(albumSource, /q=/);
});

test("album renders date groups, labels, review text, and order links into the orders workspace", () => {
  assert.match(albumSource, /album-day/);
  assert.match(albumSource, /album_tags/);
  assert.match(albumSource, /review_text/);
  assert.match(albumSource, /href="\/orders\/\?trade=/);
  assert.match(albumSource, /BEIJING CLOSE DATE/);
  assert.match(albumHtml, /随机阅读/);
  assert.match(albumSource, /\/api\/review-album\/random/);
  assert.match(albumSource, /data-archive-toggle/);
  assert.match(albumSource, /\/archived/);
  assert.match(albumHtml, /role="tablist"/);
  assert.match(albumHtml, /data-album-view="all"/);
  assert.match(albumHtml, /data-album-view="archived"/);
});

test("album renders archived trades in a separate section", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const activeTrade = {
    id: "T-1",
    symbol: "EURUSD",
    close_time_bj: "2026-08-20T16:30:00+08:00",
    open_time_bj: "2026-08-20T16:00:00+08:00",
    is_archived: 0,
    net_pnl: 10,
    lots: 0.01,
    side: "long",
    duration_label: "30m",
    album_tags: [],
    review_text: "当前复盘",
  };
  const archivedTrade = { ...activeTrade, id: "T-2", is_archived: 1, review_text: "归档复盘" };
  const view = new FakeView();
  const controller = createAlbumController({
    api: {
      async requestJson(requestPath) {
        if (requestPath.includes("archived=true")) {
          return {
            ...EMPTY_ALBUM,
            trades: [archivedTrade],
            days: [{ date: "2026-08-20", order_count: 1, net_pnl: 10, trades: [archivedTrade] }],
            total: 1,
          };
        }
        return {
          ...EMPTY_ALBUM,
          trades: [activeTrade],
          days: [{ date: "2026-08-20", order_count: 1, net_pnl: 10, trades: [activeTrade] }],
          total: 1,
        };
      },
    },
    view,
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();

  assert.match(view.getElementById("albumArchivedDays").innerHTML, /归档复盘/);
  assert.doesNotMatch(view.getElementById("albumArchivedDays").innerHTML, /当前复盘/);
  assert.match(view.getElementById("albumDays").innerHTML, /当前复盘/);
  controller.dispose();
});

test("album toggles a trade archived state through the trade endpoint", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const calls = [];
  const trade = { id: "T-1", is_archived: 0, trade_type: "follow", strategy: "breakout" };
  const controller = createAlbumController({
    api: {
      async requestJson(requestPath, options = {}) {
        calls.push({ requestPath, options });
        return requestPath.startsWith("/api/review-album")
          ? { ...EMPTY_ALBUM, trades: [trade], days: [{ date: "2026-08-20", trades: [trade] }] }
          : { ...trade, is_archived: 1 };
      },
    },
    view: new FakeView(),
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();
  await controller.toggleArchived("T-1");

  assert.equal(calls[2].requestPath, "/api/trades/T-1/archived");
  assert.equal(calls[2].options.method, "PATCH");
  assert.deepEqual(calls[2].options.body, { archived: true });
  controller.dispose();
});

test("album defaults to all trades and switches between one visible panel", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const view = new FakeView();
  const controller = createAlbumController({
    api: { async requestJson() { return EMPTY_ALBUM; } },
    view,
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();
  assert.equal(controller.getView(), "all");
  assert.equal(view.getElementById("albumAllPanel").hidden, false);
  assert.equal(view.getElementById("albumArchivedPanel").hidden, true);

  await controller.setView("archived");
  assert.equal(controller.getView(), "archived");
  assert.equal(view.getElementById("albumAllPanel").hidden, true);
  assert.equal(view.getElementById("albumArchivedPanel").hidden, false);
  controller.dispose();
});

test("album activates its navigation destination through the shared shell", () => {
  assert.match(albumSource, /mountShell\(\{[^}]*activeRoute:\s*"\/album\/"/);
});

test("selected album tags round-trip through URL state", async () => {
  const { readAlbumState, buildAlbumQuery } = await import("../album/album-state.mjs");
  const state = readAlbumState("?symbol=XAUUSD&sort=asc&tags=trade_type%3A7&tags=field%3A3%3A12");
  assert.equal(state.symbol, "XAUUSD");
  assert.equal(state.sort, "asc");
  assert.deepEqual(state.tags, ["trade_type:7", "field:3:12"]);

  const query = buildAlbumQuery(state);
  assert.match(query, /tag=trade_type%3A7%2Cfield%3A3%3A12/);
});

test("album URL state writes and reads back the same filters", async () => {
  const { readAlbumState, writeAlbumState } = await import("../album/album-state.mjs");
  let url = "";
  const history = { replaceState(_state, _title, next) { url = next; } };
  writeAlbumState(
    { symbol: "XAUUSD", start: "2026-08-01", end: "2026-08-31", sort: "asc", tags: ["trade_type:7", "field:3:12"] },
    { location: { pathname: "/album/", hash: "" }, history },
  );
  const parsed = readAlbumState(url.split("?")[1] || "");
  assert.equal(parsed.symbol, "XAUUSD");
  assert.equal(parsed.start, "2026-08-01");
  assert.equal(parsed.end, "2026-08-31");
  assert.equal(parsed.sort, "asc");
  assert.deepEqual(parsed.tags, ["trade_type:7", "field:3:12"]);
});

test("album controller requests only the review-album endpoint", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const paths = [];
  const api = {
    async requestJson(requestPath) {
      paths.push(requestPath);
      return EMPTY_ALBUM;
    },
  };
  const controller = createAlbumController({
    api,
    view: new FakeView(),
    location: { search: "" },
    history: { replaceState() {} },
  });
  await controller.load();
  assert.equal(paths.length, 2);
  assert.match(paths[0], /^\/api\/review-album\?/);
  assert.match(paths[1], /archived=true/);
  controller.dispose();
});

test("album saves an order review through the existing trade review endpoint", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const calls = [];
  const controllerView = new FakeView();
  const reviewTrade = { id: "T-1", trade_type: "follow", strategy: "breakout", review_text: "旧复盘" };
  const api = {
    async requestJson(requestPath, options = {}) {
      calls.push({ requestPath, options });
      return requestPath.startsWith("/api/review-album")
        ? {
          ...EMPTY_ALBUM,
          trades: [{ ...reviewTrade }],
          days: [{ date: "2026-08-01", order_count: 1, net_pnl: 1, trades: [{ ...reviewTrade }] }],
        }
        : { id: "T-1", review_text: options.body.review_text };
    },
  };
  const controller = createAlbumController({
    api,
    view: controllerView,
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();
  await controller.saveReview("T-1", "新的复盘内容");

  assert.equal(calls[2].requestPath, "/api/trades/T-1/review");
  assert.equal(calls[2].options.method, "PATCH");
  assert.deepEqual(calls[2].options.body, {
    trade_type: "follow",
    strategy: "breakout",
    review_text: "新的复盘内容",
  });
  assert.match(controllerView.getElementById("albumDays").innerHTML, /新的复盘内容/);
  assert.doesNotMatch(controllerView.getElementById("albumDays").innerHTML, /旧复盘/);
  controller.dispose();
});

test("album saves a review when the order is present only in a date group", async () => {
  const { createAlbumController } = await import("../album/album.mjs");
  const calls = [];
  const view = new FakeView();
  const reviewTrade = { id: "T-2", trade_type: "follow", strategy: "breakout", review_text: "旧复盘" };
  const api = {
    async requestJson(requestPath, options = {}) {
      calls.push({ requestPath, options });
      return requestPath.startsWith("/api/review-album")
        ? {
          ...EMPTY_ALBUM,
          trades: [],
          days: [{ date: "2026-08-01", order_count: 1, net_pnl: 1, trades: [{ ...reviewTrade }] }],
        }
        : { id: "T-2", review_text: options.body.review_text };
    },
  };
  const controller = createAlbumController({
    api,
    view,
    location: { search: "" },
    history: { replaceState() {} },
  });

  await controller.load();
  await controller.saveReview("T-2", "日期分组中的新复盘");

  assert.equal(calls[2].requestPath, "/api/trades/T-2/review");
  assert.match(view.getElementById("albumDays").innerHTML, /日期分组中的新复盘/);
  controller.dispose();
});

test("album renders the same bounded review editor contract as the orders workspace", () => {
  assert.match(albumSource, /textarea/);
  assert.match(albumSource, /maxlength="10000"/);
  assert.match(albumSource, /保存/);
  assert.match(albumSource, /api.*trades.*encodeURIComponent.*tradeId.*review/);
});

test("random reading keeps the original image-and-order layout", () => {
  assert.match(albumSource, /album-card--random/);
  assert.doesNotMatch(albumSource, /<details class="album-meta"/);
  assert.match(albumSource, /<div class="album-meta">/);
  assert.match(albumStyle, /\.album-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.65fr\) minmax\(360px, 0\.85fr\)/);
  assert.doesNotMatch(albumStyle, /\.album-random-result \.album-card--random\s*\{[\s\S]*display:\s*block/);
});

test("image reader keeps the order context and random navigation beside the image", () => {
  assert.match(albumHtml, /albumImageModal[\s\S]*albumReaderNext/);
  assert.match(albumHtml, /albumReaderInfo/);
  assert.match(albumSource, /data-trade-id/);
  assert.match(albumSource, /function renderReader\(/);
  assert.match(albumSource, /getElement\("albumReaderNext"\)\?\.addEventListener/);
  assert.match(albumStyle, /\.album-reader-shell\s*\{[\s\S]*grid-template-columns/);
  assert.match(albumStyle, /\.album-reader-media img\s*\{[\s\S]*max-height:\s*calc\(100dvh/);
  assert.match(albumStyle, /\.album-reader-aside\s*\{[\s\S]*border-left/);
});

test("random reading uses the image-led landscape layout", () => {
  assert.match(albumStyle, /\.album-reader-shell\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, 360px\)/);
  assert.match(albumStyle, /\.album-reader-media img\s*\{[\s\S]*max-height:\s*calc\(100dvh/);
  assert.match(albumStyle, /\.album-reader-aside\s*\{[\s\S]*border-left/);
  assert.match(albumStyle, /@media \(max-width: 900px\) and \(orientation: landscape\) and \(max-height: 600px\)/);
});

test("album keeps screenshot proportions and stacks metadata below the image on mobile", () => {
  assert.match(albumStyle, /\.album-shot img\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto/s);
  assert.doesNotMatch(albumStyle, /object-fit:\s*cover/);
  assert.match(albumStyle, /@media \(max-width: 720px\)[\s\S]*\.album-card\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("album review editor stays usable for long text", () => {
  assert.match(albumSource, /function renderReview\(trade, context\)/);
  assert.match(albumSource, /album-review-expanded/);
  assert.match(albumSource, /maxlength="10000"/);
  assert.match(albumStyle, /\.album-review-editor\s*\{[\s\S]*overflow-y:\s*scroll/);
});

test("album desktop cards allocate the screenshot's spare height to review content", () => {
  assert.match(albumStyle, /\.album-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.65fr\) minmax\(360px, 0\.85fr\)/);
  assert.match(albumStyle, /\.album-meta\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
  assert.match(albumStyle, /\.album-review\s*\{[\s\S]*flex:\s*1 1 180px[\s\S]*min-height:\s*0/);
});

test("album review content keeps a bounded vertical scrollbar instead of clipping behind actions", () => {
  assert.match(albumStyle, /\.album-card\s*\{[\s\S]*min-height:\s*0/);
  assert.match(albumStyle, /\.album-meta\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow:\s*hidden/);
  assert.match(albumStyle, /\.album-review-editor\s*\{[\s\S]*overflow-y:\s*scroll/);
  assert.match(albumStyle, /\.album-review-editor::-webkit-scrollbar\s*\{[\s\S]*width:\s*10px/);
});

test("album is listed as a shared shell destination", async () => {
  const { NAV_ITEMS } = await import("../shared/js/shell.mjs");
  assert.ok(NAV_ITEMS.some((item) => item.href === "/album/"));
});

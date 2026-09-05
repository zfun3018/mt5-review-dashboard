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

test("album mounts the shared shell and reads only the review-album API", () => {
  assert.match(albumHtml, /data-app-shell/);
  assert.match(albumHtml, /shared\/css\/tokens\.css/);
  assert.match(albumSource, /shell\.mjs/);
  assert.match(albumHtml, /复盘画册/);
  assert.match(albumSource, /\/api\/review-album/);
  assert.doesNotMatch(albumSource, /\/api\/campaigns|\/api\/trades|\/api\/analysis|\/api\/positions/);
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
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/api\/review-album\?/);
  controller.dispose();
});

test("album keeps screenshot proportions and stacks metadata below the image on mobile", () => {
  assert.match(albumStyle, /\.album-shot img\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto/s);
  assert.doesNotMatch(albumStyle, /object-fit:\s*cover/);
  assert.match(albumStyle, /@media \(max-width: 720px\)[\s\S]*\.album-card\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("album review text stays visible in one scrollable block regardless of length", () => {
  assert.match(albumSource, /function renderReview\(text\)/);
  assert.match(albumSource, /album-review-expanded/);
  assert.doesNotMatch(albumSource, /details open class="album-review"/);
  assert.match(albumStyle, /\.album-review p\s*\{[\s\S]*max-height:\s*none/);
});

test("album desktop cards allocate the screenshot's spare height to review content", () => {
  assert.match(albumStyle, /\.album-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.65fr\) minmax\(360px, 0\.85fr\)/);
  assert.match(albumStyle, /\.album-meta\s*\{[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/);
  assert.match(albumStyle, /\.album-review\s*\{[\s\S]*flex:\s*1 1 180px[\s\S]*min-height:\s*0/);
});

test("album review content keeps a bounded vertical scrollbar instead of clipping behind actions", () => {
  assert.match(albumStyle, /\.album-card\s*\{[\s\S]*min-height:\s*0/);
  assert.match(albumStyle, /\.album-meta\s*\{[\s\S]*min-height:\s*0[\s\S]*overflow:\s*hidden/);
  assert.match(albumStyle, /\.album-review p\s*\{[\s\S]*overflow-y:\s*scroll/);
  assert.match(albumStyle, /\.album-review p::-webkit-scrollbar\s*\{[\s\S]*width:\s*10px/);
});

test("album is listed as a shared shell destination", async () => {
  const { NAV_ITEMS } = await import("../shared/js/shell.mjs");
  assert.ok(NAV_ITEMS.some((item) => item.href === "/album/"));
});

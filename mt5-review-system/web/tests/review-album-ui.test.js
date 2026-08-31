const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const albumSource = fs.readFileSync(path.join(__dirname, "..", "album.js"), "utf8");
const albumStyle = fs.readFileSync(path.join(__dirname, "..", "album.css"), "utf8");
const albumHtml = fs.readFileSync(path.join(__dirname, "..", "album.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("album uses the existing read-only review album API and excludes side/text search controls", () => {
  assert.match(albumSource, /\/api\/review-album/);
  assert.match(albumSource, /custom_fields/);
  assert.doesNotMatch(albumSource, /sideFilter/);
  assert.doesNotMatch(albumSource, /q=/);
  assert.match(albumHtml, /复盘画册/);
});

test("album renders date groups, labels, review text, and order links", () => {
  assert.match(albumSource, /album-day/);
  assert.match(albumSource, /album_tags/);
  assert.match(albumSource, /review_text/);
  assert.match(albumSource, /href="\/\?trade=/);
  assert.match(albumSource, /BEIJING CLOSE DATE/);
});

test("album keeps screenshot proportions and moves metadata below the image on mobile", () => {
  assert.match(albumStyle, /\.album-shot img\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto/s);
  assert.doesNotMatch(albumStyle, /object-fit:\s*cover/);
  assert.match(albumStyle, /@media \(max-width: 720px\)[\s\S]*\.album-card\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("dashboard exposes the album entry point", () => {
  assert.match(indexHtml, /href="\/album\.html"/);
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

test("dashboard and album share a top navigation with active page state", () => {
  assert.match(indexHtml, /class="site-nav"/);
  assert.match(albumHtml, /class="site-nav"/);
  assert.match(indexHtml, /site-nav-link active[^>]*href="\/"/);
  assert.match(albumHtml, /site-nav-link active[^>]*href="\/album\.html"/);
  assert.match(albumStyle, /\.album-basic-filters select,[\s\S]*color-scheme:\s*dark/);
});

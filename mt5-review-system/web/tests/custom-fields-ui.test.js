const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Dashboard workspace modules (Task 3): the chart layout assertions below read
// the migrated dashboard sources instead of the removed app.js/styles.css.
const dashboardJs = fs.readFileSync(path.join(__dirname, "..", "dashboard", "dashboard.mjs"), "utf8");
const dashboardCss = fs.readFileSync(path.join(__dirname, "..", "dashboard", "dashboard.css"), "utf8");

// Orders workspace modules (Task 4).
const ordersSource = fs.readFileSync(path.join(__dirname, "..", "orders", "orders.mjs"), "utf8");
const orderDetailSource = fs.readFileSync(path.join(__dirname, "..", "orders", "order-detail.mjs"), "utf8");
const customFieldsSource = fs.readFileSync(path.join(__dirname, "..", "orders", "custom-fields.mjs"), "utf8");
const ordersCss = fs.readFileSync(path.join(__dirname, "..", "orders", "orders.css"), "utf8");
const ordersHtml = fs.readFileSync(path.join(__dirname, "..", "orders", "index.html"), "utf8");

// Settings workspace modules (Task 6).
const settingsHtml = fs.readFileSync(path.join(__dirname, "..", "settings", "index.html"), "utf8");
const settingsSource = fs.readFileSync(path.join(__dirname, "..", "settings", "settings.mjs"), "utf8");
const schemaSource = fs.readFileSync(path.join(__dirname, "..", "settings", "custom-field-schema.mjs"), "utf8");
const classificationsSource = fs.readFileSync(path.join(__dirname, "..", "settings", "classifications.mjs"), "utf8");

test("custom select fields use the choice popover in table and detail views", () => {
  assert.match(ordersSource, /renderCustomValueEditor\(trade, field, "table"\)/);
  assert.match(orderDetailSource, /renderCustomValueEditor\(trade, field, "detail"\)/);
  assert.match(customFieldsSource, /data-choice-trigger/);
  assert.match(customFieldsSource, /choice-popover/);
  assert.match(customFieldsSource, /\u67e5\u627e\u6216\u521b\u5efa\u9009\u9879/);
});

test("cumulative return chart has an independent grid row and readable axis reserves", () => {
  assert.match(dashboardCss, /\.equity-panel\s*\{[^}]*grid-row:\s*span 2/s);
  assert.match(dashboardJs, /const padding = \{ top: 30, right: 84, bottom: 44, left: 106 \}/);
  assert.match(dashboardJs, /Math\.min\(1200, chartNode\.clientWidth/);
  assert.match(dashboardCss, /\.axis-label\s*\{[^}]*fill:\s*var\(--color-muted\)/s);
  assert.match(dashboardCss, /\.time-label\s*\{[^}]*fill:\s*var\(--color-muted\)/s);
});

test("custom field type and options are sent when fields are added or saved", () => {
  assert.match(settingsHtml, /newCustomFieldType/);
  assert.match(schemaSource, /field_type:\s*fieldType/);
  assert.match(schemaSource, /collectOptions/);
});

test("classification manager supports data-driven create, rename, and archive", () => {
  assert.match(settingsSource, /classification_options/);
  assert.match(classificationsSource, /data-classification-add/);
  assert.match(classificationsSource, /data-classification-save/);
  assert.match(classificationsSource, /data-classification-archive/);
  assert.match(classificationsSource, /\/api\/classification-options/);
  assert.doesNotMatch(classificationsSource, /\{ follow: "跟随", reversal: "反转", unclassified: "未分类" \}/);
});

test("trend field is not rendered in the order flow or trade detail", () => {
  assert.doesNotMatch(ordersSource, /<th>\u8d8b\u52bf<\/th>/);
  assert.doesNotMatch(ordersSource, /\$\{trendChip\(trade\)\}/);
  assert.doesNotMatch(ordersSource, /id="detailTrend"/);
  assert.doesNotMatch(ordersSource, /class="trend-editor"/);
});

test("trade detail no longer renders the dense information card grid", () => {
  assert.doesNotMatch(ordersSource, /const detailItems/);
  assert.doesNotMatch(ordersSource, /detail-info-grid/);
});

test("custom table columns reserve eight Chinese characters", () => {
  assert.match(ordersCss, /--custom-column-width:\s*8rem/);
  assert.match(ordersCss, /table-layout:\s*fixed/);
  assert.match(ordersCss, /\.orders-table th\.custom-col,\s*\.orders-table td\.custom-value-cell\s*\{[^}]*width:\s*var\(--custom-column-width\)/s);
});

test("order filters and detail use data-driven classification options", () => {
  assert.match(ordersSource, /classification_options/);
  assert.match(ordersSource, /renderClassificationFilters/);
  assert.doesNotMatch(ordersSource, /\{ follow: "跟随", reversal: "反转", unclassified: "未分类" \}/);
  assert.doesNotMatch(ordersHtml, /<option value="follow">跟随<\/option>/);
});

test("review editor is large and remark field is removed", () => {
  assert.match(orderDetailSource, /id="detailReview" class="review-editor" maxlength="10000"/);
  assert.match(ordersCss, /\.review-editor\s*\{[^}]*min-height:\s*320px/s);
  assert.doesNotMatch(orderDetailSource, /detailRemark/);
  assert.doesNotMatch(orderDetailSource, /<label>备注<\/label>/);
  assert.doesNotMatch(orderDetailSource, /remark:\s*document/);
});

test("order screenshot supports preview, replace, paste/upload, and delete", () => {
  assert.match(orderDetailSource, /id="screenshotFile"/);
  assert.match(orderDetailSource, /replaceScreenshotFile/);
  assert.match(orderDetailSource, /clipboardData/);
  assert.match(orderDetailSource, /\/screenshot/);
  assert.match(orderDetailSource, /deleteTradeScreenshot/);
  assert.match(orderDetailSource, /id="replaceScreenshot"/);
  assert.match(orderDetailSource, /id="deleteScreenshot"/);
  assert.match(ordersCss, /\.screenshot-editor/);
});

test("analysis workspace exposes cumulative return, shared filters, and evaluation summaries", () => {
  const dashboardHtml = fs.readFileSync(path.join(__dirname, "..", "dashboard", "index.html"), "utf8");

  assert.match(dashboardHtml, /收益累计曲线/);
  assert.match(dashboardHtml, /id="timePreset"/);
  assert.doesNotMatch(dashboardHtml, /id="equityPreset"/);
  assert.match(dashboardHtml, /id="systemEvaluationSummary"/);
  assert.doesNotMatch(dashboardHtml, /交易结果连续性说明（Z 分数）/);
  assert.match(dashboardJs, /cumulative_return/);
  assert.match(dashboardJs, /return_rate/);
  assert.match(dashboardJs, /sampleCurvePoints\(sourcePoints, 140\)/);
  assert.match(dashboardJs, /chartNode\.clientWidth/);
  assert.match(dashboardJs, /z_score/);
  assert.match(dashboardJs, /renderSystemEvaluationSummary/);
  assert.match(dashboardCss, /\.r-metric-grid\s*\{[^}]*repeat\(5,/s);
  assert.match(dashboardCss, /\.evaluation-table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(dashboardCss, /\.evaluation-table\s*\{[^}]*min-width:\s*860px/s);
  assert.match(dashboardCss, /\.equity-panel\s*\{[^}]*grid-row:\s*span 2/s);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("custom select fields use the choice popover in table and detail views", () => {
  assert.match(appSource, /renderCustomValueEditor\(trade, field, "table"\)/);
  assert.match(appSource, /renderCustomValueEditor\(trade, field, "detail"\)/);
  assert.match(appSource, /data-choice-trigger/);
  assert.match(appSource, /choice-popover/);
  assert.match(appSource, /\u67e5\u627e\u6216\u521b\u5efa\u9009\u9879/);
});

test("cumulative return chart has an independent grid row and readable axis reserves", () => {
  assert.match(styleSource, /\.equity-panel\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(styleSource, /\.calendar-panel\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
  assert.match(appSource, /const padding = \{ top: 30, right: 84, bottom: 44, left: 106 \}/);
  assert.match(appSource, /Math\.min\(1200, chartNode\.clientWidth/);
  assert.match(styleSource, /\.axis-label\s*\{[^}]*fill:\s*#b9cbc4/s);
  assert.match(styleSource, /\.time-label\s*\{[^}]*fill:\s*#8ca29b/s);
});

test("custom field type and options are sent when fields are added or saved", () => {
  assert.match(appSource, /newCustomFieldType/);
  assert.match(appSource, /field_type:\s*type/);
  assert.match(appSource, /collectCustomFieldOptions/);
});

test("trend field is not rendered in the order flow or trade detail", () => {
  assert.doesNotMatch(appSource, /<th>\u8d8b\u52bf<\/th>/);
  assert.doesNotMatch(appSource, /\$\{trendChip\(trade\)\}/);
  assert.doesNotMatch(appSource, /id="detailTrend"/);
  assert.doesNotMatch(appSource, /class="trend-editor"/);
});

test("trade detail no longer renders the dense information card grid", () => {
  assert.doesNotMatch(appSource, /const detailItems/);
  assert.doesNotMatch(appSource, /detail-info-grid/);
});

test("custom table columns reserve eight Chinese characters", () => {
  assert.match(styleSource, /--custom-column-width:\s*8rem/);
  assert.match(styleSource, /table-layout:\s*fixed/);
  assert.match(styleSource, /\.custom-col,\s*\.custom-value-cell\s*{[^}]*width:\s*var\(--custom-column-width\)/s);
});

test("trade classifications are data driven and user manageable", () => {
  assert.match(indexSource, /id="classificationManager"/);
  assert.match(appSource, /classification_options/);
  assert.match(appSource, /renderClassificationManager/);
  assert.match(appSource, /createClassificationOption/);
  assert.match(appSource, /updateClassificationOption/);
  assert.match(appSource, /archiveClassificationOption/);
  assert.doesNotMatch(appSource, /\{ follow: "跟随", reversal: "反转", unclassified: "未分类" \}/);
  assert.doesNotMatch(indexSource, /<option value="follow">跟随<\/option>/);
});

test("review editor is large and remark field is removed", () => {
  assert.match(appSource, /id="detailReview" class="review-editor" maxlength="10000"/);
  assert.match(styleSource, /\.detail-panel\s+\.review-editor\s*{[^}]*min-height:\s*320px/s);
  assert.doesNotMatch(appSource, /detailRemark/);
  assert.doesNotMatch(appSource, /<label>备注<\/label>/);
  assert.doesNotMatch(appSource, /remark:\s*document/);
});

test("order screenshot supports preview, replace, paste/upload, and delete", () => {
  assert.match(appSource, /id="screenshotFile"/);
  assert.match(appSource, /replaceScreenshotFile/);
  assert.match(appSource, /clipboardData/);
  assert.match(appSource, /\/screenshot/);
  assert.match(appSource, /deleteTradeScreenshot/);
  assert.match(appSource, /id="replaceScreenshot"/);
  assert.match(appSource, /id="deleteScreenshot"/);
  assert.match(styleSource, /\.screenshot-editor/);
});

test("analysis workspace exposes cumulative return, shared filters, and evaluation summaries", () => {
  assert.match(indexSource, /收益累计曲线/);
  assert.match(indexSource, /id="timePreset"/);
  assert.doesNotMatch(indexSource, /id="equityPreset"/);
  assert.match(indexSource, /id="systemEvaluationSummary"/);
  assert.match(indexSource, /Z 分数说明/);
  assert.match(appSource, /cumulative_return/);
  assert.match(appSource, /return_rate/);
  assert.match(appSource, /sampleCurvePoints\(sourcePoints, 140\)/);
  assert.match(appSource, /chartNode\.clientWidth/);
  assert.match(appSource, /z_score/);
  assert.match(appSource, /renderSystemEvaluationSummary/);
  assert.match(styleSource, /\.metric-grid\s*{[^}]*repeat\(4,/s);
  assert.match(styleSource, /\.evaluation-table\s*{[^}]*min-width:\s*0/s);
  assert.match(styleSource, /\.equity-panel\s*{[^}]*align-self:\s*start/s);
});

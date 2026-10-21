const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const RMultipleUI = require(path.join(root, "r-multiple.js"));

const ordersSource = fs.readFileSync(path.join(root, "orders", "orders.mjs"), "utf8");
const orderDetailSource = fs.readFileSync(path.join(root, "orders", "order-detail.mjs"), "utf8");
const ordersCss = fs.readFileSync(path.join(root, "orders", "orders.css"), "utf8");

test("campaign R formatter distinguishes complete, missing, partial, and invalid states", () => {
  assert.equal(RMultipleUI.formatCampaignR({ campaign_r: 0.1234 }), "+0.12R");
  assert.equal(
    RMultipleUI.formatCampaignR({ risk_status: "missing", risk_positions_complete: 0, risk_positions_total: 2 }),
    "R 缺失",
  );
  assert.equal(
    RMultipleUI.formatCampaignR({ risk_status: "missing", risk_positions_complete: 1, risk_positions_total: 2 }),
    "R 不完整 1/2",
  );
  assert.equal(
    RMultipleUI.formatCampaignR({ risk_status: "invalid", risk_positions_complete: 1, risk_positions_total: 2 }),
    "止损方向无效",
  );
});

test("campaign activity label reports scale-ins and partial exits", () => {
  assert.equal(
    RMultipleUI.campaignActivityLabel({ scale_in_count: 2, partial_exit_count: 3 }),
    "加仓 x2 · 分批平仓 x3",
  );
  assert.equal(RMultipleUI.campaignActivityLabel({ scale_in_count: 0, partial_exit_count: 0 }), "单次开平仓");
});

test("R missing filter keeps every non-complete campaign", () => {
  const campaigns = [
    { id: "complete", risk_status: "complete" },
    { id: "missing", risk_status: "missing" },
    { id: "invalid", risk_status: "invalid" },
  ];

  assert.deepEqual(RMultipleUI.filterRiskMissing(campaigns, true).map((item) => item.id), ["missing", "invalid"]);
  assert.equal(RMultipleUI.filterRiskMissing(campaigns, false).length, 3);
});

test("metric explanations include formula, dynamic threshold, sample, missing reason, and limitation", () => {
  const context = {
    scratchThresholdR: 0.15,
    sampleCount: 24,
    completeCount: 18,
    missingCount: 6,
    missingPositionCount: 2,
  };

  const campaignR = RMultipleUI.metricExplanation("campaign_r", context);
  const scratch = RMultipleUI.metricExplanation("scratch", context);
  const sqn = RMultipleUI.metricExplanation("sqn", context);
  const payoff = RMultipleUI.metricExplanation("payoff_ratio", context);
  const zScore = RMultipleUI.metricExplanation("z_score", context);
  const coverage = RMultipleUI.metricExplanation("coverage", context);

  assert.match(campaignR.formula, /组合结果.*初始计划风险/);
  assert.match(campaignR.limitation, /不代表实际最大浮亏/);
  assert.match(campaignR.missing, /2 个 Position/);
  assert.match(scratch.threshold, /-0\.15R 至 \+0\.15R/);
  assert.match(scratch.sample, /18/);
  assert.match(sqn.threshold, /N < 30/);
  assert.match(coverage.formula, /R 完整 Campaign 数.*已完成 Campaign 总数/);
  assert.match(coverage.missing, /6/);
  assert.match(RMultipleUI.metricExplanation("decisive_win_rate").title, /剔除打平/);
  assert.equal(RMultipleUI.metricExplanation("all_sample_win_rate").title, "有效胜率");
  assert.match(RMultipleUI.metricExplanation("expectancy_r").threshold, /正期望/);
  assert.match(RMultipleUI.metricExplanation("sqn").title, /收益稳定度/);
  assert.match(RMultipleUI.metricExplanation("campaign_count").formula, /独立交易组合数量/);
  assert.match(RMultipleUI.metricExplanation("cash_profit_factor").formula, /总盈利金额/);
  assert.match(RMultipleUI.metricExplanation("cash_win_rate").formula, /盈利交易笔数/);
  assert.match(payoff.formula, /平均盈利金额.*平均亏损金额/);
  assert.match(zScore.threshold, /交替.*成串/);
});

test("metric quality renders server-owned insufficient-data states", () => {
  const dashboard = fs.readFileSync(path.join(root, "dashboard", "dashboard.mjs"), "utf8");
  assert.match(dashboard, /insufficient_data/);
  assert.match(dashboard, /metric_meta/);
  assert.doesNotMatch(dashboard, /numeric < 30/);
});

test("dashboard exposes accessible shared metric explanation", () => {
  const html = fs.readFileSync(path.join(root, "dashboard", "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "dashboard", "dashboard.mjs"), "utf8");
  const css = fs.readFileSync(path.join(root, "dashboard", "dashboard.css"), "utf8");

  assert.match(html, /id="metricExplanationPopover"[^>]*role="dialog"/);
  assert.match(app, /aria-label="解释/);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeMetricExplanation/);
  assert.match(app, /closest\?\.\("\.metric-explanation-popover, \[data-metric-info\]"\)/);
  assert.match(css, /width:\s*420px/);
  assert.match(css, /max-width:\s*calc\(100vw - 24px\)/);
  assert.doesNotMatch(app, /R 数据覆盖率/);
  assert.doesNotMatch(html, /R 覆盖率/);
  assert.match(app, /净胜率（剔除打平）/);
  assert.match(app, /有效胜率/);
  assert.match(app, /交易笔数/);
  assert.match(app, /\["本年", periods\.year\]/);
  assert.match(app, /净盈亏比/);
  assert.match(app, /\["z_score", "Z 分数"/);
  assert.match(html, /净盈亏比/);
  assert.match(html, /总胜率.*净胜率.*打平占比/);
  assert.doesNotMatch(html, /class="z-score-guide"/);
  assert.match(app, /metricQualityBadge\(/);
  assert.doesNotMatch(html, /id="summary"/);
  assert.match(html, /id="rMetricSummary"/);
  assert.match(css, /\.evaluation-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("order flow renders a compact merged-campaign index", () => {
  assert.match(ordersSource, /<tr><th>订单信息<\/th><th>R 值<\/th><th>净盈亏<\/th><\/tr>/);
  assert.match(ordersSource, /class="campaign-kind-mark"/);
  assert.match(ordersSource, />组<\/span>/);
  assert.match(ordersSource, /初始止损未完整填写/);
  assert.match(ordersSource, /class="campaign-risk-mark"/);
  assert.match(ordersCss, /\.orders-table th,[\s\r\n]+\.orders-table td\s*\{[\s\S]*font-size:\s*11px/);
  assert.match(ordersCss, /grid-template-columns:\s*minmax\(260px, 320px\)/);
  assert.match(ordersCss, /\.app-page\s*\{[\s\S]*height:\s*calc\(100dvh - 60px\)/);
});

test("order flow keeps source positions out of the main order index", () => {
  assert.doesNotMatch(ordersSource, /<th>仓位记录<\/th>/);
  assert.doesNotMatch(ordersSource, /<th>交易场景<\/th>/);
  assert.doesNotMatch(ordersSource, /<th>交易策略<\/th>/);
  assert.doesNotMatch(ordersSource, /展开逐笔填写/);
  assert.match(orderDetailSource, /成交流水/);
  assert.match(orderDetailSource, /<th>类型 \/ 方向<\/th>/);
  assert.match(orderDetailSource, /<th>开仓价格<\/th>/);
  assert.match(orderDetailSource, /<th>平仓价格<\/th>/);
  assert.match(orderDetailSource, /<th>盈利点数<\/th>/);
  assert.match(orderDetailSource, /<th>净盈亏<\/th>/);
});

test("order detail puts editable review fields above the ledger", () => {
  assert.match(orderDetailSource, /id="campaignInitialStop"/);
  assert.match(orderDetailSource, /renderTagPicker\("trade_type_tags"/);
  assert.match(orderDetailSource, /renderTagPicker\("strategy_tags"/);
  assert.match(orderDetailSource, /renderTagPicker\("mistake_tags"/);
  assert.match(orderDetailSource, /id="detailReview" class="review-editor" maxlength="10000"/);
  assert.match(orderDetailSource, /renderScreenshotEditor\(campaign\)/);
  assert.match(orderDetailSource, /function saveTagSelection\(/);
  assert.match(orderDetailSource, /campaignSaveChain/);
  assert.match(orderDetailSource, /pendingCampaignStates/);
  assert.match(orderDetailSource, /初始止损已自动保存/);
});

test("order flow does not force a horizontally scrolling wide table", () => {
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*980px/);
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*1040px/);
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*1080px/);
  assert.match(ordersCss, /\.orders-table\s*\{[^}]*width:\s*100%/);
  assert.match(ordersCss, /\.orders-table\s*\{[^}]*max-width:\s*100%/);
  assert.match(ordersCss, /\.orders-table th,[\s\S]*?\.orders-table td\s*\{[\s\S]*?overflow-wrap/);
});

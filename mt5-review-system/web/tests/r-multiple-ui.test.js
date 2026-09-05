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

test("metric quality treats missing values as insufficient samples", () => {
  const dashboard = fs.readFileSync(path.join(root, "dashboard", "dashboard.mjs"), "utf8");
  assert.match(dashboard, /if \(!hasValue\) return \{ label: "样本不足"/);
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

test("order flow exposes Scratch state and inline initial-stop editing", () => {
  assert.match(ordersSource, /function isScratchCampaign\(/);
  assert.match(ordersSource, /class="campaign-row[\s\S]*scratch/);
  assert.match(ordersSource, /data-position-stop/);
  assert.match(ordersSource, /campaign-expand/);
  assert.match(ordersSource, /初始止损/);
  assert.match(ordersSource, /入场价/);
  assert.match(ordersSource, /出场价/);
  assert.match(ordersSource, /持仓时间/);
  assert.match(ordersSource, /placeholder="请输入初始止损"/);
  assert.doesNotMatch(ordersSource, /placeholder="初始止损"/);
  assert.match(ordersCss, /\.campaign-row\.scratch/);
  assert.match(ordersCss, /\.campaign-detail-row/);
  assert.match(ordersCss, /\.inline-stop-editor\s*\{[\s\S]*display:\s*block/);
  assert.match(ordersCss, /\.orders-table td:nth-child\(5\)\s*\{[^}]*min-width:\s*165px/);
  assert.match(ordersSource, /<th>交易场景<\/th>/);
  assert.match(ordersSource, /<th>交易策略<\/th>/);
  assert.match(ordersSource, /data-label="交易场景"/);
  assert.match(ordersSource, /data-label="交易策略"/);
  assert.match(ordersSource, /position\.source_trade/);
  assert.match(ordersSource, /trade-metrics-cell/);
  assert.doesNotMatch(ordersSource, /<th>复盘<\/th>/);
  assert.match(ordersSource, /data-position-id/);
  assert.match(orderDetailSource, /function renderPositionDetail\(/);
  assert.match(orderDetailSource, /\/api\/trades\/\$\{encodeURIComponent\(selection\.trade\.id\)\}/);
});

test("order flow only renders expand controls for merged campaigns", () => {
  assert.match(ordersSource, /positions\.length > 1/);
  assert.match(ordersSource, /if \(!expanded \|\| positions\.length <= 1\) return summaryRows/);
  assert.match(ordersSource, /renderCampaignPositionRow\(campaign, position/);
  assert.match(ordersSource, /position\.position_pnl/);
  assert.match(ordersSource, /formatMoney\(position\.position_pnl/);
  assert.doesNotMatch(ordersSource, /展开逐笔填写/);
});

test("order flow shows a placeholder for campaigns missing Position summaries", () => {
  assert.match(ordersSource, /Position 数据待加载/);
  assert.doesNotMatch(ordersSource, /0\/0 已填/);
  assert.doesNotMatch(ordersSource, /hydrateCampaignPositionSummaries/);
});

test("order flow does not force a horizontally scrolling wide table", () => {
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*980px/);
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*1040px/);
  assert.doesNotMatch(ordersCss, /\.orders-table\s*\{[^}]*min-width:\s*1080px/);
  assert.match(ordersCss, /\.orders-table\s*\{[^}]*width:\s*100%/);
  assert.match(ordersCss, /\.orders-table\s*\{[^}]*max-width:\s*100%/);
  assert.match(ordersCss, /\.orders-table th,[\s\S]*?\.orders-table td\s*\{[\s\S]*?overflow-wrap/);
});

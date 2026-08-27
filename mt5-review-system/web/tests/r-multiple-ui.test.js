const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const RMultipleUI = require(path.join(root, "r-multiple.js"));

test("campaign R formatter distinguishes complete, missing, partial, and invalid states", () => {
  assert.equal(RMultipleUI.formatCampaignR({ campaign_r: 0.1234 }), "+0.12R");
  assert.equal(
    RMultipleUI.formatCampaignR({ risk_status: "missing", risk_positions_complete: 0, risk_positions_total: 2 }),
    "待补初始止损",
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
  const coverage = RMultipleUI.metricExplanation("coverage", context);

  assert.match(campaignR.formula, /组合结果.*初始计划风险/);
  assert.match(campaignR.limitation, /不代表实际最大浮亏/);
  assert.match(campaignR.missing, /2 个 Position/);
  assert.match(scratch.threshold, /-0\.15R 至 \+0\.15R/);
  assert.match(scratch.sample, /18/);
  assert.match(sqn.threshold, /N < 30/);
  assert.match(coverage.formula, /R 完整 Campaign 数.*已完成 Campaign 总数/);
  assert.match(coverage.missing, /6/);
});

test("dashboard exposes accessible shared metric explanation and R controls", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  assert.match(html, /id="riskMissingOnly"/);
  assert.match(html, /id="scratchThresholdR"/);
  assert.match(html, /id="metricExplanationPopover"[^>]*role="dialog"/);
  assert.match(app, /aria-label="解释/);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeMetricExplanation/);
  assert.match(app, /closest\("\.metric-explanation-popover, \[data-metric-info\]"\)/);
  assert.match(css, /max-width:\s*min\(420px, calc\(100vw - 24px\)\)/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*\.campaign-position/);
});

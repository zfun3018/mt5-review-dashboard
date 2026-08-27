(function initRMultipleUI(globalScope) {
  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function signedR(value) {
    const parsed = number(value);
    const prefix = parsed > 0 ? "+" : "";
    return `${prefix}${parsed.toFixed(2)}R`;
  }

  function formatCampaignR(campaign = {}) {
    if (campaign.campaign_r !== null && campaign.campaign_r !== undefined) {
      return signedR(campaign.campaign_r);
    }
    const complete = number(campaign.risk_positions_complete);
    const total = number(campaign.risk_positions_total);
    if (campaign.risk_status === "invalid") return "止损方向无效";
    if (campaign.risk_status === "incomplete") return "成交数据不完整";
    if (complete > 0 && total > complete) return `R 不完整 ${complete}/${total}`;
    return "待补初始止损";
  }

  function campaignActivityLabel(campaign = {}) {
    const labels = [];
    const scaleIns = number(campaign.scale_in_count);
    const partialExits = number(campaign.partial_exit_count);
    if (scaleIns > 0) labels.push(`加仓 x${scaleIns}`);
    if (partialExits > 0) labels.push(`分批平仓 x${partialExits}`);
    return labels.join(" · ") || "单次开平仓";
  }

  function filterRiskMissing(campaigns, enabled) {
    const values = Array.isArray(campaigns) ? campaigns : [];
    return enabled ? values.filter((campaign) => campaign.risk_status !== "complete") : values;
  }

  function metricExplanation(metricKey, context = {}) {
    const threshold = Math.abs(number(context.scratchThresholdR, 0.15));
    const complete = number(context.completeCount);
    const sample = number(context.sampleCount);
    const missing = number(context.missingCount);
    const missingPositions = number(context.missingPositionCount);
    const shared = {
      sample: `当前样本：${complete} 个 R 完整 Campaign / ${sample} 个已完成 Campaign。`,
      missing: missing
        ? `当前有 ${missing} 个 Campaign 缺少完整 R 数据。`
        : "当前已完成 Campaign 的 R 数据完整。",
    };
    const definitions = {
      campaign_r: {
        title: "组合 R 倍数",
        formula: "组合 R = 组合结果 / 组合内各 Position 初始计划风险之和。",
        threshold: "R 的分母不受 Scratch 阈值调整影响。",
        sample: shared.sample,
        missing: missingPositions
          ? `缺少初始止损或止损无效：${missingPositions} 个 Position；不会用部分数据估算 R。`
          : shared.missing,
        limitation: "初始计划风险来自入场时记录的止损，不代表实际最大浮亏；当前不计手续费、利息和其他费用。",
      },
      scratch: {
        title: "Scratch 交易",
        formula: "Scratch = |组合 R| 小于或等于当前阈值。",
        threshold: `当前区间：-${threshold.toFixed(2)}R 至 +${threshold.toFixed(2)}R。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "R 不完整的 Campaign 不参与 Scratch 占比，阈值只改变分类，不改变单笔 R。",
      },
      decisive_win_rate: {
        title: "净胜率",
        formula: "净胜率 = 盈利 Campaign 数 /（盈利 Campaign 数 + 亏损 Campaign 数）。",
        threshold: `-${threshold.toFixed(2)}R 至 +${threshold.toFixed(2)}R 的 Scratch 不进入分母。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "用于观察有明确结果的交易，不等同于现金胜率。",
      },
      all_sample_win_rate: {
        title: "全样本胜率",
        formula: "全样本胜率 = 盈利 Campaign 数 / R 完整 Campaign 总数。",
        threshold: `Scratch 按当前 ±${threshold.toFixed(2)}R 阈值识别，并保留在分母中。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "R 不完整 Campaign 不进入样本；现金胜率仍按真实盈亏记录单独展示。",
      },
      expectancy_r: {
        title: "R 期望（E_R）",
        formula: "E_R = 所有完整组合 R 之和 / R 完整 Campaign 数。",
        threshold: "Scratch Campaign 同时保留在分子和分母中。",
        sample: shared.sample,
        missing: shared.missing,
        limitation: "它描述每次交易决策的平均计划风险回报，不等同于金额收益。",
      },
      sqn: {
        title: "系统质量数（SQN）",
        formula: "SQN = 平均 R / R 的样本标准差 × √N。",
        threshold: "N < 30 时只报告样本不足，不提供质量等级；标准差为零时不输出 SQN。",
        sample: shared.sample,
        missing: shared.missing,
        limitation: "SQN 对样本选择和极端 R 敏感，只能作为辅助观察，不能单独判定系统优劣。",
      },
      coverage: {
        title: "R 数据覆盖率",
        formula: "R 数据覆盖率 = R 完整 Campaign 数 / 已完成 Campaign 总数。",
        threshold: "覆盖率不受 Scratch 阈值影响。",
        sample: shared.sample,
        missing: `当前缺失 ${missing} 个 Campaign；优先补齐所有子 Position 的初始止损。`,
        limitation: "覆盖率只说明数据完整程度，不说明交易系统表现。",
      },
    };
    return definitions[metricKey] || definitions.campaign_r;
  }

  const api = {
    campaignActivityLabel,
    filterRiskMissing,
    formatCampaignR,
    metricExplanation,
    signedR,
  };
  globalScope.RMultipleUI = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

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
    return "R 缺失";
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
      sample: `当前样本：${complete} 个 R 完整交易组合 / ${sample} 个已完成交易组合。`,
      missing: missing
        ? `当前有 ${missing} 个交易组合缺少完整 R 数据。`
        : "当前已完成交易组合的 R 数据完整。",
    };
    const definitions = {
      campaign_count: {
        title: "交易笔数",
        formula: "交易笔数 = 统计范围内的独立交易组合数量。同品种、同方向且持仓重叠的加仓会合并为一笔统计交易。",
        threshold: "少于 30 笔时样本不足；30 至 100 笔可作初步参考；100 笔以上更有代表性。",
        sample: `当前共有 ${sample} 个交易组合，其中 ${complete} 个具备完整 R 数据。`,
        missing: missing ? `其中 ${missing} 个交易组合暂时缺少完整 R 数据。` : "当前交易组合的 R 数据完整。",
        limitation: "交易组合数不是下单次数；一个组合可能包含多次加仓或分批平仓。",
      },
      cash_profit_factor: {
        title: "总盈亏比",
        formula: "总盈亏比 = 总盈利金额 / 总亏损金额的绝对值。",
        threshold: "总盈亏比 ≥ 1.5 通常较好；1 至 1.5 为一般；小于 1 表示亏损大于盈利。",
        sample: "按实际盈亏金额统计，包含统计范围内的全部交易。",
        missing: "总盈亏比不依赖初始止损；没有交易时无法判断。",
        limitation: "总盈亏比不考虑交易顺序和资金占用，也不等同于平均数学期望。",
      },
      cash_win_rate: {
        title: "总胜率",
        formula: "总胜率 = 盈利交易笔数 / 总交易笔数。",
        threshold: "盈利金额大于 0 才算胜利；打平和亏损都不算胜利。通常 50% 以上较好，40% 至 50% 为一般，低于 40% 较差。",
        sample: "按实际盈亏统计，包含统计范围内的全部交易。",
        missing: "总胜率不依赖初始止损；没有交易时无法判断。",
        limitation: "总胜率包含打平交易，不能直接替代剔除打平后的净胜率。",
      },
      payoff_ratio: {
        title: "净盈亏比",
        formula: "净盈亏比 = 平均盈利金额 / 平均亏损金额的绝对值；打平交易不参与平均值计算。",
        threshold: "净盈亏比 ≥ 1.5 通常较好；1 至 1.5 为一般；小于 1 表示平均盈利小于平均亏损。",
        sample: "按实际盈亏金额计算，只比较盈利交易和亏损交易。",
        missing: "没有同时出现盈利和亏损交易时无法计算。",
        limitation: "净盈亏比看的是单笔平均盈亏大小；总盈亏比看的是盈利总额与亏损总额，两者可能不同。",
      },
      campaign_r: {
        title: "组合 R 倍数",
        formula: "组合 R = 组合结果 / 组合内各 Position 初始计划风险之和。",
        threshold: "R 的分母不受打平判定阈值调整影响。",
        sample: shared.sample,
        missing: missingPositions
          ? `缺少初始止损或止损无效：${missingPositions} 个 Position；不会用部分数据估算 R。`
          : shared.missing,
        limitation: "初始计划风险来自入场时记录的止损，不代表实际最大浮亏；当前不计手续费、利息和其他费用。",
      },
      scratch: {
        title: "打平占比",
        formula: "打平交易 = 结果接近 0R 的交易组合；打平占比 = 打平交易数 / R 完整交易组合数。",
        threshold: `当前区间：-${threshold.toFixed(2)}R 至 +${threshold.toFixed(2)}R。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "R 不完整的交易组合不参与打平占比；通常低于 15% 较好，15% 至 30% 为一般，高于 30% 较差；阈值只改变分类，不改变单笔 R。",
      },
      decisive_win_rate: {
        title: "净胜率（剔除打平）",
        formula: "净胜率 = 剔除打平数据后，盈利交易组合数 /（盈利交易组合数 + 亏损交易组合数）。",
        threshold: `-${threshold.toFixed(2)}R 至 +${threshold.toFixed(2)}R 的打平交易不进入分母。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "它只看明确盈利或亏损的交易，不等同于总胜率。",
      },
      all_sample_win_rate: {
        title: "有效胜率",
        formula: "有效胜率 = 有效盈利交易组合数 / R 完整交易组合总数。",
        threshold: `无效盈利（-${threshold.toFixed(2)}R 至 +${threshold.toFixed(2)}R 的打平交易）不算胜利，但保留在分母中。`,
        sample: shared.sample,
        missing: shared.missing,
        limitation: "R 不完整交易组合不进入样本；总胜率仍按实际盈亏单独统计。",
      },
      expectancy_r: {
        title: "平均数学期望（ER）",
        formula: "ER = 所有 R 完整交易组合的 R 总和 / R 完整交易组合数，也就是每笔交易平均赚或亏多少个 R。",
        threshold: "ER > 0 表示正期望；ER < 0 表示负期望；ER = 0 表示没有优势。",
        sample: shared.sample,
        missing: shared.missing,
        limitation: "它描述平均计划风险回报，不等同于金额收益。",
      },
      sqn: {
        title: "收益稳定度（SQN）",
        formula: "SQN = 平均 R / R 的波动程度 × √交易组合数。数值越高，收益越稳定。",
        threshold: "SQN > 2 通常可视为优秀；N < 30（交易组合少于 30 笔）时只提示样本不足。",
        sample: shared.sample,
        missing: shared.missing,
        limitation: "SQN 会受样本数量和极端结果影响，只能作为稳定性参考。",
      },
      z_score: {
        title: "交易结果连续性（Z 分数）",
        formula: "Z 分数按交易结果的连胜、连败和交替次数，判断结果是否呈现连续性。",
        threshold: "Z > +1.96 表示更容易交替；Z < -1.96 表示更容易成串；-1.96 至 +1.96 未发现显著连续性。",
        sample: shared.sample,
        missing: shared.missing,
        limitation: "打平交易和 R 不完整交易不进入序列；样本过少或只有单一结果时无法判断。",
      },
      coverage: {
        title: "R 数据覆盖率",
        formula: "R 数据覆盖率 = R 完整 Campaign 数 / 已完成 Campaign 总数。",
        threshold: "覆盖率不受打平判定阈值影响。",
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
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      campaignActivityLabel,
      filterRiskMissing,
      formatCampaignR,
      metricExplanation,
      signedR,
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

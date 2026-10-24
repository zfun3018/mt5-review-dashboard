const module = (id, rootSelector, dataRequirements, metricKey = null) => Object.freeze({
  id,
  rootSelector,
  dataRequirements: Object.freeze(dataRequirements),
  metricKey,
});

export const MT5_DASHBOARD_MODULES = Object.freeze([
  module("r-metrics", '[data-layout-module="r-metrics"]', ["metrics", "r_metrics", "metric_meta"], "r_metrics"),
  module("equity", '[data-layout-module="equity"]', ["equity", "max_drawdown", "metric_meta"], "equity_curve"),
  module("calendar", '[data-layout-module="calendar"]', ["calendar", "metric_meta"], "calendar"),
  module("monthly-pnl", '[data-layout-module="monthly-pnl"]', ["monthly_pnl", "metric_meta"], "monthly_pnl"),
  module("heatmap", '[data-layout-module="heatmap"]', ["heatmap", "metric_meta"], "hour_heatmap"),
  module("sessions", '[data-layout-module="sessions"]', ["sessions", "metric_meta"], "sessions"),
  module("period-overview", '[data-layout-module="period-overview"]', ["periods", "metric_meta"], "periods"),
  module("daily-evaluation", '[data-layout-module="daily-evaluation"]', ["system_evaluation", "metric_meta"], "system_evaluation"),
  module("mode-evaluation", '[data-layout-module="mode-evaluation"]', ["mode_evaluation", "metric_meta"], "mode_evaluation"),
]);

export const DOMESTIC_FUTURES_DASHBOARD_MODULES = Object.freeze([
  module("period-overview", '[data-module="period-overview"]', ["fixed_periods", "metric_meta"], "fixed_periods"),
  module("net-performance", '[data-module="net-performance"]', ["equity", "metric_meta"], "equity_curve"),
  module("risk-health", '[data-module="risk-health"]', ["risk_summary", "metric_meta"], "risk_summary"),
  module("monthly-pnl", '[data-module="monthly-pnl"]', ["monthly_pnl", "metric_meta"], "monthly_pnl"),
  module("daily-calendar", '[data-module="daily-calendar"]', ["calendar", "metric_meta"], "calendar"),
  module("contract-contribution", '[data-module="contract-contribution"]', ["contract_rankings", "metric_meta"], "contract_rankings"),
  module("contract-losses", '[data-module="contract-losses"]', ["contract_rankings", "metric_meta"], "contract_rankings"),
  module("data-health", '[data-module="data-health"]', ["data_health", "import_summary"]),
  module("review-coverage", '[data-module="review-coverage"]', ["review_coverage", "metric_meta"], "review_coverage"),
  module("system-evaluation", '[data-module="system-evaluation"]', ["domestic_system_evaluation", "metric_meta"], "domestic_system_evaluation"),
  module("mode-evaluation", '[data-module="mode-evaluation"]', ["mode_evaluation", "metric_meta"], "mode_evaluation"),
]);

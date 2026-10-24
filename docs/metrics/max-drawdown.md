# 最大已实现回撤

## Contract

- **Entity owner:** `Campaign` owns the realized net P/L fact. This metric is a request-time analysis projection and does not own or persist business fields.
- **Data source:** active, closed Campaign rows for the explicitly selected platform. The amount is `net_pnl`, which includes known commission, swap, and fee.
- **Statistical unit:** one Campaign, ordered by `closed_at_utc`.
- **Fact time and timezone:** `closed_at_utc`, displayed and date-filtered in `Asia/Shanghai`.
- **Definition version:** `1`.
- **Formula:** start cumulative realized net P/L at `0`; after each Campaign, update the running cumulative total and its high-water mark. `amount` is the largest `high_water_mark - cumulative_total`. The output also includes the high-water mark (`peak`) and subsequent low (`trough`) that produce that amount.
- **Interpretation:** absolute currency drawdown on the selected Campaign history. It is not a percentage of account equity, does not include open-position floating P/L, and does not use account snapshots as P/L points.
- **Quality:** no Campaigns returns `insufficient_data` with a null value; otherwise the metric is `available`, including an amount of zero when no peak-to-trough decline occurred. The sample count is the number of selected closed Campaigns.
- **Platform scope:** the explicit AnalysisContext platform. The metric uses common Campaign net P/L semantics and does not branch on platform name.
- **Rebuild rule:** recomputed from active Campaigns for each analysis request; deletion, restoration, or Campaign correction is reflected on the next request. No stored result or invalidation job exists.
- **Cross-view test path:** deterministic Campaign fixture -> domain metric test -> `/api/analysis?platform=mt5` response -> Campaign list reconciliation. A synthetic win of `12.50` followed by a loss of `-4.00` must produce peak `12.50`, trough `8.50`, and drawdown `4.00`.
- **Drill-down:** retain the same platform and selected `start`/`end` close-date range when navigating from the equity module to the Campaign list.

## Synthetic verification

For the four-Campaign sequence `+12.50, -4.00, +3.00, -20.00`, cumulative realized net P/L is `12.50, 8.50, 11.50, -8.50`. The highest prior peak is `12.50`, so the maximum decline to `-8.50` is `21.00`. The same arithmetic is asserted by `server/tests/test_metrics.py`; the two-Campaign API case verifies the response contract.

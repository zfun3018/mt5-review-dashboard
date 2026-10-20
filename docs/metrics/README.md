# 仪表盘指标目录

本目录记录仪表盘当前使用的指标主题和统计口径。指标的计算实现位于 `mt5-review-system/server/app/domain/`，指标不能直接读取数据库或前端状态。

所有指标的默认统计单位都是合并后的 `Campaign`。Deal 和 Position 只用于订单详情、成交重建和执行明细，不能直接增加仪表盘订单数。

## 当前指标清单

| key | owner | unit | statistical_unit | time_field | timezone | definition_version | test_path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| summary | `app.domain.analytics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| r_metrics | `app.domain.r_metrics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| periods | `app.domain.dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| equity_curve | `app.domain.analytics` | currency | Campaign and snapshot | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| calendar | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| hour_heatmap | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| sessions | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| system_evaluation | `app.domain.analytics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| mode_evaluation | `app.domain.dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| domestic_fixed_periods | `app.domain.domestic_futures_dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| contract_rankings | `app.domain.domestic_futures_dashboard` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| review_coverage | `app.domain.domestic_futures_dashboard` | ratio and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| risk_summary | `app.domain.domestic_futures_dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |

## 阅读规则

- `owner` 是指标计算模块的所有者，不是页面组件。
- `time_field` 是指标分组和日期筛选使用的事实时间字段；页面显示时间可以转换，但不能改变统计边界。
- `definition_version` 发生变化时，必须更新指标说明、测试和变更记录。
- 多选标签可以产生标签出现次数，不应被误认为互斥分组订单数。
- 指标样本不足、字段缺失或平台不适用时，必须返回明确状态，不能用零代替未知。


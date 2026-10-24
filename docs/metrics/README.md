# 仪表盘指标目录

本目录记录仪表盘当前使用的指标主题和统计口径。指标的计算实现位于 `mt5-review-system/server/app/domain/`，指标不能直接读取数据库或前端状态。

所有指标的默认统计单位都是合并后的 `Campaign`。Deal 和 Position 只用于订单详情、成交重建和执行明细，不能直接增加仪表盘订单数。

## 当前指标清单

| key | owner | unit | statistical_unit | time_field | timezone | definition_version | test_path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| summary | `app.domain.analytics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| r_metrics | `app.domain.r_metrics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| periods | `app.domain.dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 2 | `server/tests/test_metrics.py`, `server/tests/test_application_services.py` |
| equity_curve | `app.domain.analytics` | currency | Campaign and snapshot | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| max_drawdown | `app.domain.metrics.equity` | currency | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| calendar | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| monthly_pnl | `app.domain.metrics.calendar` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 2 | `server/tests/test_domestic_futures_dashboard.py`, `server/tests/test_application_services.py` |
| hour_heatmap | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| sessions | `app.domain.analytics` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| system_evaluation | `app.domain.analytics` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_analytics.py` |
| mode_evaluation | `app.domain.dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_metrics.py` |
| fixed_periods | `app.domain.metrics.domestic_futures` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| contract_rankings | `app.domain.domestic_futures_dashboard` | currency and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| domestic_system_evaluation | `app.domain.metrics.domestic_futures` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| review_coverage | `app.domain.domestic_futures_dashboard` | ratio and count | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |
| risk_summary | `app.domain.domestic_futures_dashboard` | mixed | Campaign | `close_time_utc` | `Asia/Shanghai` | 1 | `server/tests/test_domestic_futures_dashboard.py` |

## 阅读规则

- `owner` 是指标计算模块的所有者，不是页面组件。
- `time_field` 是指标分组和日期筛选使用的事实时间字段；页面显示时间可以转换，但不能改变统计边界。
- `definition_version` 发生变化时，必须更新指标说明、测试和变更记录。
- 多选标签可以产生标签出现次数，不应被误认为互斥分组订单数。
- 指标样本不足、字段缺失或平台不适用时，必须返回明确状态，不能用零代替未知。

## A 计划模块映射

A 计划的原生 ES Module 仪表盘按以下映射消费同一份 `/api/analysis` 响应。模块注册表中的 `dataRequirements` 与 `metricKey` 必须和本表一致；图表不重新计算指标。指标统计单位、事实时间、时区、定义版本和测试入口以本目录上方的指标清单为准，质量状态读取同一响应的 `metric_meta`。

| 平台 | 模块 ID | 响应字段 | `metric_meta` key |
| --- | --- | --- | --- |
| MT5 | `r-metrics` | `metrics`, `r_metrics` | `summary`, `r_metrics` |
| MT5 | `equity` | `equity`, `max_drawdown` | `equity_curve` |
| MT5 | `calendar` | `calendar` | `calendar` |
| MT5 | `monthly-pnl` | `monthly_pnl` | `monthly_pnl` |
| MT5 | `heatmap` | `heatmap` | `hour_heatmap` |
| MT5 | `sessions` | `sessions` | `sessions` |
| MT5 | `period-overview` | `periods` | `periods` |
| MT5 | `daily-evaluation` | `system_evaluation` | `system_evaluation` |
| MT5 | `mode-evaluation` | `mode_evaluation` | `mode_evaluation` |
| 国内期货 | `period-overview` | `fixed_periods` | `fixed_periods` |
| 国内期货 | `net-performance` | `equity` | `equity_curve` |
| 国内期货 | `risk-health` | `risk_summary` | `risk_summary` |
| 国内期货 | `monthly-pnl` | `monthly_pnl` | `monthly_pnl` |
| 国内期货 | `daily-calendar` | `calendar` | `calendar` |
| 国内期货 | `contract-contribution` / `contract-losses` | `contract_rankings` | `contract_rankings` |
| 国内期货 | `data-health` | `import_summary` 与 `data_health` | 不适用；显示导入与数据质量事实 |
| 国内期货 | `review-coverage` | `review_coverage` | `review_coverage` |
| 国内期货 | `system-evaluation` | `domestic_system_evaluation` | `domestic_system_evaluation` |
| 国内期货 | `mode-evaluation` | `mode_evaluation` | `mode_evaluation` |

模块下钻继续使用服务端已有筛选定义和 Campaign 关系，不在浏览器生成订单事实或指标公式。热力图、时段、R 指标等 MT5 页面内联展示区域由既有 MT5 模块承担；国内期货不支持的市场时段能力不会额外注册。

`monthly_pnl.product_pnl` 是月度盈亏的国内期货图表构成：实体所有者为 `Campaign`；来源是每条 Campaign 的 `symbol`、`close_time_utc` 和成本后 `net_pnl`，先按北京时间平仓月、再按合约映射出的品种归并；不持久化，每次 `/api/analysis?platform=domestic_futures` 重算；仅国内期货响应包含该字段，MT5 月度单序列保持不变。可手算数据：FG701 于 UTC 9 月 30 日 16:00 盈利 10、手续费 -1；FG801 于 UTC 10 月 2 日 01:00 亏损 4、手续费 -1；IF2611 于 UTC 10 月 2 日 02:00 盈利 7、手续费 -2。三笔均属于北京时间 10 月，玻璃合计 +4、沪深300股指合计 +5，堆叠合计 +9。服务器合成测试覆盖该边界、同品种多合约合并及手续费；应用服务测试验证国内期货 API 序列化且 MT5 不带该派生字段。跨视图路径为该 API 月度合计对照相同平台和日期范围的 Campaign 订单列表净盈亏。

布局只保存模块 ID、位置、尺寸和可见状态；它不是业务记录或指标投影。若以后增加新的指标公式，必须按本目录的“新指标验收”先补手算合成数据、领域测试、API 测试与 Campaign 对账。

`period_ranges` 是分析响应的周期导航元数据，不是独立业务事实：实体所有者仍为 Campaign 平仓时间；从当前平台最新已平仓 Campaign 取北京时间锚点，每次分析请求重算；用相同日期范围请求 Campaign 列表验证。`periods` 的滚动窗口包含锚点日：昨日是锚点日前一个北京时间自然日；近 7/30/365 天分别包含锚点日及此前 6/29/364 日。数据来源是平台内 Campaign；不持久化派生结果，每次 `/api/analysis` 重算；跨页面核对路径为周期图表与订单列表/订单详情共享同一 Campaign 平台范围。Campaign 列表的 `close_hour` 和 `session` 是查询参数，分别按 `closed_at_utc` 转换后的北京时间小时及 `Asia 08:00-15:00 / Europe 15:00-20:00 / US 20:00-02:00` 分组，边界左闭右开。

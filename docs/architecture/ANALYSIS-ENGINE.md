# 分析引擎边界

## 目标

分析引擎负责把 Campaign 事实转换为可解释、可验证、可重建的统计报告。它不拥有交易事实，也不改变订单复盘页面的布局和业务含义。

## 单一事实源

`Campaign` 是全系统唯一业务订单，也是仪表盘的默认统计单位。数据流为：

```text
Deal / 成交导入
        ↓
Position / 成交重建
        ↓
Campaign / 合并后的业务订单
        ↓
订单复盘、仪表盘、精选、打卡和其他报告
```

仪表盘不直接以 Deal 或 Position 作为订单统计来源。成交流水可以在订单详情中展开，但不能让同一个 Campaign 在仪表盘中被重复计数。

## 运行时边界

```text
CampaignRepository
        ↓ 规范化 Campaign 行
AnalysisContext
        ↓ 统一时间窗口、时区、平台能力和数据质量
Metric modules
        ↓ MetricResult
AnalysisReport
        ↓ 兼容 API 响应
/api/analysis
        ↓
dashboard.mjs / charts
```

### 数据层

`CampaignRepository` 负责从 SQLite 读取有效的 Campaign、快照、分类目录和必要的关联数据。它不能生成页面专用别名，也不能把仪表盘结果写回交易事实表。

### 领域层

领域模块只接收内存中的规范化数据和配置，负责公式、分组、日期转换和数据质量判断。它不能导入 SQLite、HTTP、文件系统或 DOM。

### 应用层

`DashboardService` 负责加载一次分析上下文、选择指标模块、组装报告和保持旧 API 兼容。它不应该重新实现任何指标公式。

### 前端层

前端只负责卡片、表格、图表、状态和下钻链接。前端不能根据原始 Campaign、Position 或 Deal 重新计算净盈亏、订单数或胜率。

## 当前基线

当前仪表盘已有模块和口径记录在 `docs/metrics/README.md`。迁移到指标注册表前，现有领域函数的数值视为兼容基线；重构不应无说明地改变历史统计结果。

## 非目标

- 不把仪表盘改造成图片浏览器；
- 不把指标结果作为新的业务数据持久化；
- 不为每个平台复制一套通用统计公式；
- 不为假设中的大数据量提前引入缓存、数据仓库或分布式服务；
- 不在指标引擎中加入 AI 判断或交易建议。


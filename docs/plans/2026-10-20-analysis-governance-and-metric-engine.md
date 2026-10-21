# 分析治理与指标引擎实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Campaign 单一事实源、Codex 开发约束和可验证的仪表盘指标体系固化到项目结构、文档和自动化测试中，使以后新增平台、指标和页面时不会继续扩大数据口径和维护风险。

**Architecture:** 保留当前订单复盘页面和 `/api/analysis` 的用户可见结构。新增一个纯领域的分析上下文与指标契约层：`CampaignRepository` 提供规范化 Campaign 行，指标模块只读取 `AnalysisContext` 并返回带状态、样本数、公式版本和警告的 `MetricResult`，仪表盘服务负责组装报告，前端只负责渲染。平台差异通过能力声明进入分析上下文，不再让每个指标散落平台名称分支。

**Tech Stack:** Python 标准库 `dataclasses`、现有 SQLite 仓储、Python `unittest`、原生 HTML/CSS/JavaScript、现有 ECharts/GridStack、现有 Node 测试。

---

## 范围与不变项

- `Campaign` 继续是全系统唯一业务订单。
- 订单复盘页面的当前布局和交互不重做。
- Deal、Position、Campaign 的关系和成交流水展示保持不变。
- 不把仪表盘指标结果持久化为第二份事实数据。
- 不引入 Next.js、Drizzle、前端构建工具或第三方指标引擎。
- `/api/analysis` 现有字段保持兼容；新增指标元数据采用向后兼容字段。
- 每个阶段都必须保留 MT5 与国内期货的平台隔离。

## 目标结构

```text
CampaignRepository
        |
        v
AnalysisContext
        |
        v
Metric Registry -> MetricResult[]
        |
        v
AnalysisReport
        |
        v
/api/analysis -> dashboard.mjs -> cards/charts/tables
```

指标模块不能直接查询 SQLite、读取 HTTP 请求或依赖 DOM。订单复盘和仪表盘都必须使用同一套 Campaign 字段和时间口径；只有展示和交互状态可以由页面自己维护。

## 执行约定

- 每个任务先写失败测试或失败的架构检查，再写最小实现。
- 每个任务完成后运行该任务的窄测试，再提交一个聚焦 commit。
- 不在同一任务中同时重命名共享字段、迁移数据库和重做前端布局。
- 任何指标公式变化都必须修改指标说明书、`definition_version` 和对应测试。
- 任何平台差异都必须写明能力、缺失状态和不适用原因。

### Task 1: 建立当前基线与分析口径清单

**Files:**
- Create: `docs/metrics/README.md`
- Create: `docs/metrics/metric-contract.md`
- Create: `docs/architecture/ANALYSIS-ENGINE.md`
- Test: `mt5-review-system/server/tests/test_metric_contracts.py`

**Step 1: Write the failing test**

增加文档契约测试，验证指标目录存在，并且每个已登记指标至少声明 `key`、`owner`、`unit`、`statistical_unit`、`time_field`、`timezone`、`definition_version` 和测试路径。

同时在测试中列出当前仪表盘已有模块，作为迁移清单：

- summary metrics；
- R metrics；
- periods；
- equity curve；
- calendar；
- hour heatmap；
- sessions；
- system evaluation；
- mode evaluation；
- domestic futures fixed periods；
- contract rankings；
- review coverage；
- risk summary。

**Step 2: Run test to verify it fails**

Run:

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_metric_contracts -v
```

Expected: FAIL because the metric contract and registry documents do not exist.

**Step 3: Write minimal implementation**

在文档中定义每个指标必须包含：公式、输入字段、统计对象、时间字段、时区、手续费口径、打平处理、缺失数据、最小样本量、舍入规则、平台范围、下钻订单筛选和测试位置。

先为现有指标建立目录，不改变任何运行时代码和指标数值。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_metric_contracts -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add docs/metrics docs/architecture mt5-review-system/server/tests/test_metric_contracts.py
git commit -m "docs: define analysis metric contracts"
```

### Task 2: 固化 Codex 的分层开发约束

**Files:**
- Modify: `AGENTS.md`
- Create: `mt5-review-system/server/AGENTS.md`
- Create: `mt5-review-system/server/app/domain/AGENTS.md`
- Create: `mt5-review-system/web/AGENTS.md`
- Modify: `mt5-review-system/server/tests/test_architecture_contract.py`

**Step 1: Write the failing test**

扩展架构契约测试，检查：

- `app/domain` 不导入数据库、HTTP、文件系统或前端模块；
- 指标目录中的模块只能依赖领域模块和 Python 标准库；
- `app/data` 不导入 `application` 或 `presentation`；
- 新的分析指标必须进入注册表；
- 指标结果必须携带状态、样本数和定义版本。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_architecture_contract -v
```

Expected: FAIL on the missing local instructions and metric registry contract.

**Step 3: Write minimal implementation**

在各级 `AGENTS.md` 中写明：

- 新功能必须先说明实体所有者、数据来源、重建规则、平台范围和跨页面测试；
- 新指标必须先有指标说明书和人工可核对的合成数据；
- 前端不得重新计算交易事实；
- 仓储不得输出页面专用字段别名；
- 计算模块不得读数据库；
- 页面布局保持当前订单复盘设计，除非用户明确要求改变。

把这些规则加入架构契约测试能让 Codex 后续改动更容易被自动检查，而不是依赖记忆。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_architecture_contract -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add AGENTS.md mt5-review-system/server/AGENTS.md mt5-review-system/server/app/domain/AGENTS.md mt5-review-system/web/AGENTS.md mt5-review-system/server/tests/test_architecture_contract.py
git commit -m "chore: enforce domain and metric boundaries"
```

### Task 3: 新增 AnalysisContext 与 MetricResult 契约

**Files:**
- Create: `mt5-review-system/server/app/domain/analysis_context.py`
- Create: `mt5-review-system/server/app/domain/metric_contracts.py`
- Create: `mt5-review-system/server/app/domain/metric_registry.py`
- Test: `mt5-review-system/server/tests/test_metric_contracts.py`

**Step 1: Write the failing test**

测试以下行为：

- `AnalysisContext` 只能携带规范化 Campaign 行、快照、时间窗口、平台、时区、设置和数据质量信息；
- `MetricResult` 可以表达 `available`、`insufficient_data`、`incomplete_data`、`estimated` 和 `not_applicable`；
- 缺少样本时不能把结果伪装成零；
- 每个结果都有 `key`、`value`、`unit`、`sample_count`、`definition_version`、`coverage` 和 `warnings`；
- 注册表拒绝重复 key 和未声明版本的指标。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_metric_contracts -v
```

Expected: FAIL because the contracts do not exist.

**Step 3: Write minimal implementation**

使用 `dataclasses` 定义不可变或受控变更的上下文对象和指标结果对象。注册表只负责登记和执行，不包含数据库逻辑。

建议的结果状态：

```text
available          有足够且完整的数据
insufficient_data  样本量不足
incomplete_data    必要字段缺失
estimated          结果是估算值
not_applicable     当前平台不适用
```

保留旧接口字段的组装责任给 `DashboardService`，不要让 `MetricResult` 直接破坏现有 API。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_metric_contracts -v
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add mt5-review-system/server/app/domain/analysis_context.py mt5-review-system/server/app/domain/metric_contracts.py mt5-review-system/server/app/domain/metric_registry.py mt5-review-system/server/tests/test_metric_contracts.py
git commit -m "feat: add analysis context and metric contracts"
```

### Task 4: 将 DashboardService 改为分析上下文编排器

**Files:**
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`
- Modify: `mt5-review-system/server/app/application/dashboard_assembly.py`
- Modify: `mt5-review-system/server/app/data/campaign_repository.py`
- Test: `mt5-review-system/server/tests/test_application_services.py`
- Test: `mt5-review-system/server/tests/test_server_payload.py`

**Step 1: Write the failing test**

增加服务测试，验证：

- 所有通用分析模块接收同一个 `AnalysisContext`；
- Campaign 查询只执行一次筛选范围查询和一次全量查询；
- 同一平台、同一时间窗口的所有模块使用同一 anchor、timezone 和 threshold；
- 现有 `/api/analysis` 字段仍然存在；
- 新增 `metric_meta` 或等价元数据字段不影响旧前端。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_application_services tests.test_server_payload -v
```

Expected: FAIL because `DashboardService` currently直接组装多个独立函数结果，尚未创建统一分析上下文。

**Step 3: Write minimal implementation**

将 `DashboardService.get_analysis()` 拆成三个步骤：

1. `_load_analysis_context()`：读取 Campaign、快照、分类、设置和平台信息；
2. `_build_analysis_report(context)`：执行注册的指标模块；
3. `_serialize_legacy_payload(report)`：生成当前 API 兼容结构。

不要在此任务中修改指标公式。旧的 `build_*` 函数先作为兼容计算器被包装起来，确保重构前后数值一致。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_application_services tests.test_server_payload -v
```

Expected: PASS，且旧响应字段保持不变。

**Step 5: Commit**

```powershell
git add mt5-review-system/server/app/application/dashboard_service.py mt5-review-system/server/app/application/dashboard_assembly.py mt5-review-system/server/app/data/campaign_repository.py mt5-review-system/server/tests/test_application_services.py mt5-review-system/server/tests/test_server_payload.py
git commit -m "refactor: assemble dashboard from analysis context"
```

### Task 5: 迁移通用指标到注册表

**Files:**
- Create: `mt5-review-system/server/app/domain/metrics/__init__.py`
- Create: `mt5-review-system/server/app/domain/metrics/summary.py`
- Create: `mt5-review-system/server/app/domain/metrics/equity.py`
- Create: `mt5-review-system/server/app/domain/metrics/calendar.py`
- Create: `mt5-review-system/server/app/domain/metrics/time_patterns.py`
- Create: `mt5-review-system/server/app/domain/metrics/modes.py`
- Modify: `mt5-review-system/server/app/domain/analytics.py`
- Modify: `mt5-review-system/server/app/domain/dashboard.py`
- Modify: `mt5-review-system/server/app/domain/r_metrics.py`
- Test: `mt5-review-system/server/tests/test_analytics.py`
- Test: `mt5-review-system/server/tests/test_metrics.py`

**Step 1: Write the failing test**

为每个模块增加注册表级测试，验证：

- summary 使用 Campaign 作为统计单位；
- equity curve 按时间排序且不使用快照覆盖已实现交易盈亏；
- calendar 使用北京时间平仓日；
- sessions 正确处理跨午夜时段；
- mode evaluation 的标签口径与指标说明一致；
- R metrics 对缺少止损和样本不足有明确状态；
- 每个结果都包含 `sample_count` 和 `definition_version`。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_analytics tests.test_metrics -v
```

Expected: FAIL on the new result metadata and registry integration.

**Step 3: Write minimal implementation**

把现有纯函数包装为指标模块，不立即重写公式。每个模块只负责一个分析主题：

- `summary`：净盈亏、胜率、Profit Factor、Payoff Ratio、样本数；
- `equity`：累计收益曲线和基准；
- `calendar`：月度与日历统计；
- `time_patterns`：时段、小时、星期；
- `modes`：交易场景、策略和标签分组；
- `r_metrics`：R 倍数和风险质量。

先保持现有 API 数值，再将 `MetricResult` 元数据加入新的 `metric_meta` 区域。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_analytics tests.test_metrics -v
```

Expected: PASS，且旧指标数值不发生无依据变化。

**Step 5: Commit**

```powershell
git add mt5-review-system/server/app/domain/metrics mt5-review-system/server/app/domain/analytics.py mt5-review-system/server/app/domain/dashboard.py mt5-review-system/server/app/domain/r_metrics.py mt5-review-system/server/tests/test_analytics.py mt5-review-system/server/tests/test_metrics.py
git commit -m "refactor: register common dashboard metrics"
```

### Task 6: 隔离平台能力并迁移国内期货指标

**Files:**
- Modify: `mt5-review-system/server/app/platform_adapters/contracts.py`
- Modify: `mt5-review-system/server/app/platform_adapters/registry.py`
- Modify: `mt5-review-system/server/app/platform_modules/mt5_service.py`
- Modify: `mt5-review-system/server/app/platform_modules/domestic_futures_service.py`
- Create: `mt5-review-system/server/app/domain/metrics/domestic_futures.py`
- Modify: `mt5-review-system/server/app/domain/domestic_futures_dashboard.py`
- Test: `mt5-review-system/server/tests/test_platform_contracts.py`
- Test: `mt5-review-system/server/tests/test_platform_module_contracts.py`
- Test: `mt5-review-system/server/tests/test_domestic_futures_dashboard.py`

**Step 1: Write the failing test**

增加平台能力测试，验证：

- MT5 和国内期货都声明平台标识和通用能力；
- 国内期货专属模块在 MT5 上返回 `not_applicable` 或不进入响应；
- 通用模块不依赖 `if platform == ...` 才能计算；
- 合约排名、固定周期、风险摘要仍按 Campaign 统计；
- 不支持的会话或市场时钟不会伪造空统计。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_platform_contracts tests.test_platform_module_contracts tests.test_domestic_futures_dashboard -v
```

Expected: FAIL because the dashboard currently uses platform-specific branches instead of an explicit capability contract.

**Step 3: Write minimal implementation**

在平台契约中增加能力声明，例如：

```text
show_market_clock
show_sessions
show_contract_rankings
show_fixed_periods
supports_r_metrics
supports_market_replay
```

将国内期货的固定周期、合约排名、复盘覆盖和风险摘要包装为平台指标模块。通用指标保持相同的 `MetricResult` 格式。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_platform_contracts tests.test_platform_module_contracts tests.test_domestic_futures_dashboard -v
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add mt5-review-system/server/app/platform_adapters mt5-review-system/server/app/platform_modules mt5-review-system/server/app/domain/metrics/domestic_futures.py mt5-review-system/server/app/domain/domestic_futures_dashboard.py mt5-review-system/server/tests/test_platform_contracts.py mt5-review-system/server/tests/test_platform_module_contracts.py mt5-review-system/server/tests/test_domestic_futures_dashboard.py
git commit -m "refactor: isolate platform dashboard capabilities"
```

### Task 7: 建立仪表盘跨视图对账测试

**Files:**
- Create: `mt5-review-system/server/tests/test_analysis_reconciliation.py`
- Modify: `mt5-review-system/server/tests/support.py`
- Modify: `mt5-review-system/server/tests/test_campaign_api.py`
- Modify: `mt5-review-system/server/tests/test_http_routes.py`
- Modify: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`

**Step 1: Write the failing test**

使用小型合成数据库，至少包含：

- 两笔盈利 Campaign；
- 两笔亏损 Campaign；
- 一笔打平 Campaign；
- 一个 Campaign 包含多个 Position；
- 跨北京时间日期；
- 跨午夜交易时段；
- 手续费、swap 和 fee；
- 缺少初始止损；
- 一个 Campaign 有多个错误标签。

验证以下恒等关系：

```text
orders total Campaign count = analysis order_count
orders net_pnl sum = analysis net_pnl
daily net_pnl sum = analysis net_pnl
calendar month total = same month Campaign sum
fixed period total = same Campaign filter sum
```

对互斥分类验证分组和等于总数；对多选错误标签只验证标签出现次数，不错误地要求分组和等于总数。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_analysis_reconciliation -v
```

Expected: FAIL until all analysis sections use the same Campaign rows和时间窗口。

**Step 3: Write minimal implementation**

只修正数据来源、时间边界、统计单位或字段口径，不为了通过测试而改动预期值。将对账规则写入测试名称和指标文档。

前端测试只验证新元数据能被安全忽略或显示，不把前端测试当作统计正确性测试。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_analysis_reconciliation -v
Set-Location ..
node --test web/tests/dashboard-workspace.test.mjs
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add mt5-review-system/server/tests/test_analysis_reconciliation.py mt5-review-system/server/tests/support.py mt5-review-system/server/tests/test_campaign_api.py mt5-review-system/server/tests/test_http_routes.py mt5-review-system/web/tests/dashboard-workspace.test.mjs
git commit -m "test: reconcile dashboard metrics with campaigns"
```

### Task 8: 增加指标元数据与可解释状态的前端兼容支持

**Files:**
- Modify: `mt5-review-system/web/dashboard/index.html`
- Modify: `mt5-review-system/web/dashboard/dashboard.mjs`
- Modify: `mt5-review-system/web/dashboard/mt5-dashboard-charts.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-charts.mjs`
- Modify: `mt5-review-system/web/tests/custom-fields-ui.test.js`
- Modify: `mt5-review-system/web/tests/dashboard-workspace.test.mjs`
- Modify: `mt5-review-system/web/tests/mt5-dashboard-charts.test.mjs`

**Step 1: Write the failing test**

验证：

- `insufficient_data` 不显示为 0；
- `not_applicable` 显示为不适用，而不是空白或 0；
- 指标信息按钮可以读取公式版本、样本数、覆盖范围和警告；
- 旧 `/api/analysis` payload 没有 `metric_meta` 时页面仍正常显示；
- 图表数据缺失时不会生成误导性的零点。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system
node --test web/tests/custom-fields-ui.test.js web/tests/dashboard-workspace.test.mjs web/tests/mt5-dashboard-charts.test.mjs
```

Expected: FAIL on the new status and metadata expectations.

**Step 3: Write minimal implementation**

在现有指标解释弹层基础上增加可选元数据渲染。保持当前仪表盘布局和图表类型不变，不增加新的视觉模块。

前端只显示服务端的状态和说明，不在浏览器重新判断样本是否足够。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system
node --test web/tests/custom-fields-ui.test.js web/tests/dashboard-workspace.test.mjs web/tests/mt5-dashboard-charts.test.mjs
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add mt5-review-system/web/dashboard/index.html mt5-review-system/web/dashboard/dashboard.mjs mt5-review-system/web/dashboard/mt5-dashboard-charts.mjs mt5-review-system/web/dashboard/domestic-futures-charts.mjs mt5-review-system/web/tests/custom-fields-ui.test.js mt5-review-system/web/tests/dashboard-workspace.test.mjs mt5-review-system/web/tests/mt5-dashboard-charts.test.mjs
git commit -m "feat: expose dashboard metric quality metadata"
```

### Task 9: 增加导入、重建和派生数据的长期维护规则

**Files:**
- Modify: `docs/architecture/ANALYSIS-ENGINE.md`
- Create: `docs/architecture/DATA-REBUILD-RULES.md`
- Modify: `docs/VERSION-ROUTE.md`
- Modify: `CHANGELOG.md` only when the implementation is released
- Test: `mt5-review-system/server/tests/test_data_compatibility.py`
- Test: `mt5-review-system/server/tests/test_import_batches.py`

**Step 1: Write the failing test**

增加兼容性测试，验证：

- 重建 Campaign 不覆盖用户拥有的复盘字段；
- 导入重复数据不会重复计算 Campaign；
- 派生指标可以从 Campaign 和成交事实重新计算；
- 原始成交、Campaign 复盘字段和指标结果的备份责任不同；
- 旧 API 字段在迁移后仍有兼容映射。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_data_compatibility tests.test_import_batches -v
```

Expected: FAIL on any undocumented rebuild or annotation-preservation behavior.

**Step 3: Write minimal implementation**

文档明确：

- 原始成交是导入事实；
- Campaign 是业务聚合和复盘字段所有者；
- 仪表盘是可重建的统计投影；
- 估算市场数据不能覆盖真实成交结果；
- 公式改变时增加指标版本；
- 导入失败必须回滚；
- 任何跨表重建都必须有迁移测试。

如果测试发现现有行为不符合规则，先补兼容实现和迁移，再更新文档，不要直接删除旧数据。

**Step 4: Run test to verify it passes**

```powershell
Set-Location mt5-review-system/server
python -m unittest tests.test_data_compatibility tests.test_import_batches -v
```

Expected: PASS。

**Step 5: Commit**

```powershell
git add docs/architecture/ANALYSIS-ENGINE.md docs/architecture/DATA-REBUILD-RULES.md mt5-review-system/server/tests/test_data_compatibility.py mt5-review-system/server/tests/test_import_batches.py
git commit -m "docs: define rebuild and derived-data rules"
```

### Task 10: 全量验证、性能基线和交付检查

**Files:**
- Modify: `mt5-review-system/tools/benchmark_synthetic.py` only if the new report path changes benchmark inputs
- Modify: `mt5-review-system/tools/check_release.py` only if architecture/metric checks need release gating
- Modify: `README.md` only if the public architecture description changes
- Modify: `docs/VERSION-ROUTE.md` only when the implemented changes are released

**Step 1: Write the failing test**

增加发布检查，要求分析引擎、指标目录、架构契约和跨视图对账测试全部通过；检查 `/api/analysis` 的旧字段仍存在。

**Step 2: Run test to verify it fails**

```powershell
Set-Location mt5-review-system
python tools/check_release.py
```

Expected: FAIL until the new documentation and test gates are registered.

**Step 3: Write minimal implementation**

将新的架构检查加入发布门禁。记录分析接口在合成数据上的响应时间和行数基线，只有发现真实性能问题时才增加缓存或 SQL 优化。

**Step 4: Run complete verification**

```powershell
Set-Location mt5-review-system/server
python -m unittest discover -s tests -p "test_*.py"
Set-Location ..
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js web/tests/orders-workspace.test.mjs web/tests/dashboard-workspace.test.mjs web/tests/mt5-dashboard-charts.test.mjs
node --check web/shared/js/shell.mjs
node --check web/dashboard/dashboard.mjs
node --check web/orders/orders.mjs
node --check web/album/album.mjs
python tools/check_release.py
```

Expected: all commands PASS.

**Step 5: Commit**

```powershell
git add mt5-review-system/tools/benchmark_synthetic.py mt5-review-system/tools/check_release.py README.md docs/VERSION-ROUTE.md
git commit -m "chore: gate analysis architecture and metric verification"
```

## 验收标准

完成后，Codex 新增一个仪表盘指标时必须能够按照以下路径完成：

```text
指标说明书
→ AnalysisContext 输入声明
→ 纯指标函数
→ Metric Registry 注册
→ 合成数据单元测试
→ 订单与仪表盘对账测试
→ 状态和元数据展示
→ 全量测试与发布检查
```

最终验收必须确认：

- 同一 Campaign 在订单、仪表盘、精选、打卡和相关 API 中 ID 一致；
- 仪表盘所有订单统计均按 Campaign 计数；
- 指标样本不足、字段缺失和平台不适用不会显示为虚假的 0；
- MT5 与国内期货的通用指标口径一致，专属指标通过能力声明隔离；
- 指标公式和版本可以脱离页面单独复核；
- 新增指标不需要修改订单复盘页面；
- 当前订单复盘页面布局和主要交互保持不变；
- 全量 Python、Node、语法、发布和跨视图测试通过。

## 推荐执行顺序

先执行 Task 1-4，建立文档、Codex 约束、指标契约和分析上下文；确认旧 API 兼容后再执行 Task 5-8，逐步迁移指标和前端状态；最后执行 Task 9-10，补齐重建规则、发布门禁和性能基线。

不要在第一阶段增加新指标。先让现有指标通过新的契约和对账测试，再扩展能力。

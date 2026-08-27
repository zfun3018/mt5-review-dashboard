# R 倍数与交易组合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏既有复盘数据和现金统计的前提下，把订单流水与系统质量评估升级为以交易组合为单位，并用每个独立持仓的初始计划止损计算可解释、可筛选的 R 指标。

**Architecture:** 保留 `trades` 作为旧平仓记录与兼容数据源，新增规范化 `deal_events`、`positions`、`trade_campaigns` 和成员关系表。`server/app/campaigns.py` 负责纯领域重建和 R 指标，`storage.py` 负责幂等迁移、持久化、接口聚合；现金日历继续读实际退出成交，系统质量统计改读最终平仓的 Campaign。

**Tech Stack:** Python 3.11+ 标准库、SQLite、`unittest`、原生 HTML/CSS/JavaScript、Node.js 内置测试运行器、MQL5。

**Spec:** `docs/superpowers/specs/2026-08-27-r-multiple-trade-campaign-design.md`

## Global Constraints

- 不读取、上传、暂存或提交 `mt5-review-system/data/`、`backups/`、`config.local.json`、截图、原始 MT5 JSONL 或生成二进制。
- 不引入第三方 Python、数据库或前端框架；本地 HTTP 服务不得暴露到公网。
- R 计算忽略佣金、隔夜利息和费用；现金统计保持既有口径。
- 同账户、同品种、同方向且生命周期重叠的 Position 自动合并，传递重叠也属于同一 Campaign。
- 每个 Position 独立填写初始止损，任一缺失、无效或成交量不闭合时整个 Campaign R 为空。
- Scratch 阈值默认 `0.15R` 且可持久化调整；SQN 在 `N < 30` 时只显示样本不足。
- 新增指标的说明必须覆盖中文名、公式、阈值、样本数、缺失原因和限制，并支持键盘、移动端、Escape 与点击外部关闭。
- 用户可见发布更新到 `v0.5.0`，但不覆盖工作区中已有的无关版本文档改动。

---

### Task 1: Deal 规范化与 Position/Campaign 纯领域重建

**Files:**
- Create: `mt5-review-system/server/app/campaigns.py`
- Create: `mt5-review-system/server/tests/test_campaigns.py`

**Interfaces:**
- Consumes: Deal 字典字段 `deal_ticket`, `account`, `position_id`, `entry_kind`, `deal_type`, `symbol`, `volume`, `price`, `time_utc`, `time_msc`, `profit`。
- Produces: `reconstruct_positions(deals: list[dict]) -> list[dict]`；`group_campaigns(positions: list[dict]) -> list[dict]`；输出包含稳定排序、重建状态、部分平仓次数和成员 Position ID。

- [ ] **Step 1: 写失败测试，覆盖单次开平仓、部分平仓、同方向重叠、传递重叠、归零后重开、反方向隔离和同毫秒票号排序。**

```python
def test_groups_transitively_overlapping_positions_once():
    positions = [
        {"id": "A", "account": "ACC", "symbol": "XAUUSD", "side": "long", "opened_at_utc": "2026-08-01T00:00:00+00:00", "closed_at_utc": "2026-08-01T00:10:00+00:00"},
        {"id": "B", "account": "ACC", "symbol": "XAUUSD", "side": "long", "opened_at_utc": "2026-08-01T00:05:00+00:00", "closed_at_utc": "2026-08-01T00:20:00+00:00"},
        {"id": "C", "account": "ACC", "symbol": "XAUUSD", "side": "long", "opened_at_utc": "2026-08-01T00:15:00+00:00", "closed_at_utc": "2026-08-01T00:30:00+00:00"},
    ]
    groups = group_campaigns(positions)
    self.assertEqual([group["position_ids"] for group in groups], [["A", "B", "C"]])
```

- [ ] **Step 2: 运行 `python -m unittest tests.test_campaigns -v`，确认因 `app.campaigns` 不存在而失败。**
- [ ] **Step 3: 实现按 `(account, position_id)` 的 Deal 重建和按 `(account, symbol, side)` 的区间扫描。** `DEAL_ENTRY_IN` 增仓、`OUT/OUT_BY` 减仓、`INOUT` 拆为旧方向退出与新方向进入；数量用 `1e-9` 容差归零；事件排序键固定为 `(time_msc, deal_ticket)`。
- [ ] **Step 4: 重跑 `python -m unittest tests.test_campaigns -v`，预期所有领域测试通过。**
- [ ] **Step 5: 提交 `feat: reconstruct MT5 trade campaigns`。**

### Task 2: R 风险、Scratch 与 Campaign 分析指标

**Files:**
- Modify: `mt5-review-system/server/app/campaigns.py`
- Modify: `mt5-review-system/server/app/analytics.py`
- Modify: `mt5-review-system/server/tests/test_campaigns.py`
- Modify: `mt5-review-system/server/tests/test_metrics.py`

**Interfaces:**
- Consumes: 完全重建 Position、`initial_stop_price: float | None`、`scratch_threshold_r: float`。
- Produces: `calculate_position_risk(position: dict) -> dict`；`calculate_campaign_r(campaign: dict, positions: list[dict]) -> dict`；`build_r_metrics(campaigns: list[dict], scratch_threshold_r: float = 0.15) -> dict`；`calculate_campaign_runs_z(campaigns, threshold) -> dict`。

- [ ] **Step 1: 写失败测试，使用手算字面量覆盖多单、空单、多次入场、部分退出、多个 Position 风险累加、缺失止损、错误方向、零风险、数量不闭合。**

```python
def test_campaign_r_sums_each_positions_planned_risk():
    positions = [
        {"side": "long", "entry_deals": [{"volume": 1.0, "price": 100.0}], "exit_deals": [{"volume": 1.0, "price": 104.0}], "initial_stop_price": 98.0, "reconstruction_status": "complete"},
        {"side": "long", "entry_deals": [{"volume": 0.5, "price": 102.0}], "exit_deals": [{"volume": 0.5, "price": 106.0}], "initial_stop_price": 99.0, "reconstruction_status": "complete"},
    ]
    result = calculate_campaign_r({"status": "closed"}, positions)
    self.assertEqual(result["total_risk"], 3.5)
    self.assertAlmostEqual(result["campaign_r"], 6.0 / 3.5)
```

- [ ] **Step 2: 运行领域与指标测试，确认新增函数缺失导致失败。**
- [ ] **Step 3: 实现风险和结果计算。** 多单止损低于全部开仓价，空单止损高于全部开仓价；`position_risk = Σ(volume × |entry - stop|)`；结果按实际退出量和加权入场价计算，不包含费用。
- [ ] **Step 4: 写失败测试覆盖 `abs(R) <= threshold` 的边界、净胜率、全样本胜率、覆盖率、`E_R`、样本标准差 SQN、`N < 30`、零标准差和按最终平仓时间排序且排除 Scratch 的 Z 序列。**
- [ ] **Step 5: 实现 `build_r_metrics` 和 Campaign Z，返回 `sample_count`, `complete_count`, `missing_count`, `coverage_rate`, `scratch_threshold_r`, `scratch_count`, `scratch_rate`, `decisive_win_rate`, `all_sample_win_rate`, `expectancy_r`, `sqn`, `sqn_status`, `z_score`。**
- [ ] **Step 6: 运行 `python -m unittest tests.test_campaigns tests.test_metrics -v`，预期通过。**
- [ ] **Step 7: 提交 `feat: calculate campaign R metrics`。**

### Task 3: SQLite v4 模型、幂等迁移与旧数据重建

**Files:**
- Modify: `mt5-review-system/server/app/storage.py`
- Create: `mt5-review-system/server/tests/test_campaign_storage.py`

**Interfaces:**
- Consumes: Task 1/2 的领域函数，既有 `trades` 与 `raw_events`。
- Produces: schema v4 表 `deal_events`, `positions`, `trade_campaigns`, `campaign_positions`, `campaign_source_trades`, `analysis_settings`；`rebuild_campaign_models(conn)`；`list_campaigns(...)`；`get_campaign(campaign_id)`。

- [ ] **Step 1: 写失败迁移测试。** 在临时 SQLite 写入同一 `position_id` 的两条旧平仓记录和重叠的另一 Position，调用 `init_db(seed=False)` 后断言旧 `review_text`、分类、自定义字段、截图引用与删除状态仍在，且只生成一个 Campaign；第二次初始化计数不增加。
- [ ] **Step 2: 运行 `python -m unittest tests.test_campaign_storage -v`，确认缺表或接口缺失。**
- [ ] **Step 3: 在 `_ensure_schema` 新建 v4 表与索引。** 主键分别使用 Deal ticket、`account:position_id`、持久化 UUID；成员表保证 Position 只属于一个 Campaign；设置表写入 `scratch_threshold_r=0.15`。
- [ ] **Step 4: 实现旧数据重建。** 每条旧 `trades` 记录生成一个退出 Deal；同 `(account, position_id)` 合并为 `legacy_estimated` Position，开仓量取退出量之和，开仓价沿用旧记录，生命周期取最早开仓到最晚平仓；通过领域区间扫描创建 Campaign，并把来源交易关联到 Campaign。
- [ ] **Step 5: 实现稳定身份规则。** 已有关联优先复用最早创建的 Campaign ID；迟到 Position 桥接两个 Campaign 时迁移成员但保留来源片段，不覆盖已编辑的 Campaign 复盘字段。
- [ ] **Step 6: 实现 Campaign 汇总查询，单次批量读取成员计数与 R 完整性，避免列表 N+1。**
- [ ] **Step 7: 重跑迁移测试和完整后端测试，预期通过。**
- [ ] **Step 8: 提交 `feat: persist campaign trade model`。**

### Task 4: 全量 Deal 事件与 EA/导入器兼容

**Files:**
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/importer.py`
- Modify: `mt5-review-system/mt5-ea/MT5ReviewBridge.mq5`
- Modify: `mt5-review-system/server/tests/test_importer.py`
- Modify: `mt5-review-system/server/tests/test_bridge_sync.py`

**Interfaces:**
- Consumes: `type=deal` 新事件及既有 `type=trade_close` 事件。
- Produces: `_event_to_deal(payload) -> dict | None`；幂等 `upsert_deal_event(deal)`；每次写入后调用受影响账户/品种的 Campaign 重建。

- [ ] **Step 1: 写失败测试，导入完整 `DEAL_ENTRY_IN` 与 `DEAL_ENTRY_OUT` 后只产生一个 Position/Campaign；重复 ticket 不重复；平仓先到时状态不完整，开仓补到后转为完整。**
- [ ] **Step 2: 运行 importer/bridge 测试，确认新事件尚未持久化。**
- [ ] **Step 3: 实现 Deal 规范化，保存 `entry_kind`, `deal_type`, 秒/毫秒时间、方向、量、价格、利润和原始引用。旧 `trade_close` 同时保留现有 `trades` 写入并补一个 legacy 退出 Deal。**
- [ ] **Step 4: 修改 EA，使每个 `TRADE_TRANSACTION_DEAL_ADD` 发送 `type=deal`；用 `HistoryDealGet*` 填充全部字段，HTTP 与 JSONL 继续双写，截图只在退出事件触发。**
- [ ] **Step 5: 重跑 importer/bridge 与完整后端测试，预期通过。**
- [ ] **Step 6: 提交 `feat: ingest complete MT5 deal events`。**

### Task 5: 初始止损、分析设置与 Campaign API

**Files:**
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/server.py`
- Modify: `mt5-review-system/server/tests/test_campaign_storage.py`
- Modify: `mt5-review-system/server/tests/test_server_payload.py`

**Interfaces:**
- Produces: `PATCH /api/positions/{id}/initial-stop` body `{"initial_stop_price": number | null}`；`GET /api/campaigns`；`GET /api/campaigns/{id}`；`GET/PATCH /api/analysis-settings`。
- Returns: Position 保存接口返回 `{"position": ..., "campaign": ..., "analysis": ...}`；错误方向返回 400 且保留旧有效值；显式 `null` 清空为 missing。

- [ ] **Step 1: 写失败测试，调用存储层保存有效多/空止损、清空止损和错误方向；错误方向断言数据库旧值未改变。**
- [ ] **Step 2: 运行测试确认保存接口缺失。**
- [ ] **Step 3: 实现 `update_position_initial_stop(position_id, value)` 与 `update_analysis_settings(scratch_threshold_r)`；阈值要求有限数且 `0 <= value <= 5`。**
- [ ] **Step 4: 写 HTTP 路由契约测试，覆盖列表、详情、404、PATCH 400 和保存后 Campaign R 即时更新。**
- [ ] **Step 5: 在 `server.py` 注册精确路由和 JSON 校验；`GET /api/trades` 迁移期返回 Campaign 列表兼容结构。**
- [ ] **Step 6: 运行相关测试和完整后端测试，预期通过。**
- [ ] **Step 7: 提交 `feat: expose campaign risk APIs`。**

### Task 6: 分析接口切换到 Campaign 质量口径

**Files:**
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/analytics.py`
- Modify: `mt5-review-system/server/tests/test_metrics.py`
- Modify: `mt5-review-system/server/tests/test_campaign_storage.py`

**Interfaces:**
- Consumes: Campaign 最终平仓时间和 R 汇总、退出 Deal 的实际发生时间。
- Produces: `/api/analysis` 新增 `r_metrics`，日系统评估与 `mode_evaluation` 每行新增同一组 R 字段；保留 `cash_win_rate` 与 `profit_factor`。

- [ ] **Step 1: 写失败集成测试。** 一个 Position 有两次部分退出，另一个重叠 Position 加仓；断言 Campaign 指标 `trade_count == 1`，现金月历仍有两个实际退出日，Z 序列只出现一次。
- [ ] **Step 2: 运行测试确认现有分析按平仓记录重复计数。**
- [ ] **Step 3: 将 `get_analysis` 拆成 `cash_trades/cash_deals` 和 `quality_campaigns` 两路输入；日评估、模式评估按 Campaign 最终平仓日分组，月历、小时和曲线保留退出日。**
- [ ] **Step 4: 输出字段明确区分 `cash_win_rate`, `decisive_win_rate`, `all_sample_win_rate`, `scratch_rate`, `expectancy_r`, `sqn`, `r_coverage_rate`；Profit Factor 继续使用既有现金净盈亏口径。**
- [ ] **Step 5: 运行完整后端测试，预期通过。**
- [ ] **Step 6: 提交 `feat: evaluate systems by campaigns`。**

### Task 7: 订单流水 Campaign UI 与止损回填

**Files:**
- Modify: `mt5-review-system/web/index.html`
- Modify: `mt5-review-system/web/app.js`
- Modify: `mt5-review-system/web/styles.css`
- Create: `mt5-review-system/web/tests/r-multiple-ui.test.js`

**Interfaces:**
- Consumes: `/api/campaigns`, `/api/campaigns/{id}`, `PATCH /api/positions/{id}/initial-stop`。
- Produces: Campaign 一行、Position/Deal 展开明细、“仅看 R 缺失”筛选、保存后局部刷新。

- [ ] **Step 1: 写可执行前端契约测试，加载真实 `app.js` DOM 辅助函数，断言 `+0.12R`、`R 不完整 1/2`、`止损方向无效`、`加仓 x2 · 分批平仓 x3`，并断言缺失筛选排除完整 Campaign。**
- [ ] **Step 2: 运行 `node --test web/tests/r-multiple-ui.test.js`，确认渲染函数缺失。**
- [ ] **Step 3: 在筛选栏增加复选框 `riskMissingOnly`；`renderTradeHeader` 增加稳定宽度 R 列；`renderTrades` 改渲染 Campaign 汇总并保留既有分类、自定义字段和复盘入口。**
- [ ] **Step 4: `renderTradeDetail` 按 Position 输出普通明细区，显示隐私安全 ID、入场均价、手数、初始止损输入和退出 Deal；保存失败在输入旁显示服务端错误，成功后替换 Campaign 摘要并刷新分析。**
- [ ] **Step 5: 增加缺失/无效的文本、图标和颜色状态；展开缺失 Campaign 时聚焦第一个缺失输入。**
- [ ] **Step 6: 增加桌面固定网格与 390px 单列 CSS，确保长状态文本换行且不产生水平滚动。**
- [ ] **Step 7: 运行新增和既有前端测试、`node --check web/app.js`，预期通过。**
- [ ] **Step 8: 提交 `feat: review campaign risk in order flow`。**

### Task 8: R 指标卡、模式评估与共享解释说明

**Files:**
- Modify: `mt5-review-system/web/index.html`
- Modify: `mt5-review-system/web/app.js`
- Modify: `mt5-review-system/web/styles.css`
- Modify: `mt5-review-system/web/tests/r-multiple-ui.test.js`

**Interfaces:**
- Consumes: `/api/analysis.r_metrics`、各日/模式行的 R 字段、`scratch_threshold_r`。
- Produces: `metricInfoButton(metricKey, context) -> string`；共享 `#metricExplanationPopover`；`openMetricExplanation`/`closeMetricExplanation`。

- [ ] **Step 1: 写失败交互测试，打开订单 R、Scratch、双胜率、E_R、SQN 和覆盖率说明，断言公式、动态样本、`±0.15R`、`N < 30`、缺失 Position 数和“初始计划风险不代表最大浮亏”。**
- [ ] **Step 2: 写失败可访问性测试，断言信息按钮有 `aria-label`/`aria-expanded`，Enter/Space 可开，Escape 和点击外部可关，焦点返回触发按钮。**
- [ ] **Step 3: 在系统摘要和模式评估加入 R 指标，不创建嵌套卡片；Profit Factor 以“现金 Profit Factor”显示。**
- [ ] **Step 4: 建立单一指标定义映射，说明正文根据上下文插入公式、样本、阈值、缺失原因和限制；所有视图复用同一弹层。**
- [ ] **Step 5: 为弹层增加 `role=dialog`、焦点样式和 `max-width: min(420px, calc(100vw - 24px))`，移动端不越界。**
- [ ] **Step 6: 运行全部前端测试和语法检查，预期通过。**
- [ ] **Step 7: 提交 `feat: explain R metrics across evaluations`。**

### Task 9: Scratch 设置与即时重算

**Files:**
- Modify: `mt5-review-system/web/index.html`
- Modify: `mt5-review-system/web/app.js`
- Modify: `mt5-review-system/web/styles.css`
- Modify: `mt5-review-system/web/tests/r-multiple-ui.test.js`

**Interfaces:**
- Consumes: `GET/PATCH /api/analysis-settings`。
- Produces: 数值输入 `0..5`、步长 `0.01`；成功保存后刷新分析和解释文本，失败时恢复旧值并显示错误。

- [ ] **Step 1: 写失败测试覆盖默认 `0.15`、合法保存、非法值阻止提交和保存后 Scratch 文案更新。**
- [ ] **Step 2: 运行新增测试确认设置控件不存在。**
- [ ] **Step 3: 在分析工具栏加入紧凑数值控件与保存状态；初始化时读取设置，保存后调用 `loadAnalysis()`，不整页刷新。**
- [ ] **Step 4: 运行全部前端测试和语法检查，预期通过。**
- [ ] **Step 5: 提交 `feat: configure scratch R threshold`。**

### Task 10: 发布文档与全量验证

**Files:**
- Modify: `README.md`
- Modify: `VERSION`
- Modify: `docs/VERSION-ROUTE.md`
- Verify: `mt5-review-system/web/index.html`

**Interfaces:**
- Produces: `v0.5.0` 用户说明、迁移口径和本地运行说明。

- [ ] **Step 1: 在保留工作区既有修改的基础上，把 README 当前版本更新为 `v0.5.0`，说明 Campaign、Position 初始止损、R 缺失筛选、新指标解释与现金/质量双时间口径。**
- [ ] **Step 2: 在版本路线补充 v0.5.0 已实现内容和限制；`VERSION` 写入 `0.5.0`。**
- [ ] **Step 3: 运行后端全套：** `cd mt5-review-system/server; python -m unittest discover -s tests -p "test_*.py"`，预期全部通过且无警告。
- [ ] **Step 4: 运行前端全套：** `cd mt5-review-system; node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js web/tests/r-multiple-ui.test.js`，预期全部通过。
- [ ] **Step 5: 运行语法检查：** `node --check web/app.js` 与 `node --check web/album.js`，预期退出码 0。
- [ ] **Step 6: 仅用测试临时数据库启动 `127.0.0.1` 本地服务，浏览器检查桌面和 390px：无控制台错误、无水平溢出、弹层不越界、缺失筛选和止损保存可操作；不得连接或读取真实 `data/`。**
- [ ] **Step 7: 检查 `git diff --check`、`git status --short`，确认没有敏感目录或无关文件被纳入本功能变更。**
- [ ] **Step 8: 提交 `feat: release R-multiple campaign review`，只暂存本功能文件。**

## Self-Review Result

- Spec coverage: Deal 全量同步、历史兼容、Position/Campaign 重建、风险完整性、R 指标、双时间口径、订单流水、解释说明、设置、响应式和发布验证均有对应任务。
- Placeholder scan: 未使用 `TBD`、`TODO`、“稍后实现”或未定义接口；每个生产改动前均有明确失败测试与预期失败原因。
- Interface consistency: 全链路统一使用 `initial_stop_price`, `scratch_threshold_r`, `campaign_r`, `risk_positions_complete`, `risk_positions_total`；Campaign 质量时间统一为最终 `closed_at_utc`，现金时间统一为退出 Deal `time_utc`。

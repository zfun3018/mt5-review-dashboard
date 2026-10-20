# 合并交易组合订单化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将交易组合提升为用户侧唯一订单实体，使订单复盘、精选、打卡、仪表盘统计和图册截图都按合并后的交易组合工作。

**Architecture:** 保留 `trades`、`positions` 和 `deal_events` 作为原始导入与成交重建层，但将 `trade_campaigns` 作为唯一业务聚合层。数据库为每个交易组合持久化交易盈亏、手续费、净盈亏、精选状态和单张截图；历史打卡迁移到组合级表。所有分析查询只返回一行一个 campaign，右侧详情仅在成交流水中展开内部加减仓记录。

**Tech Stack:** Python 标准库、SQLite、原生 HTML/CSS/JavaScript、现有 unittest 测试体系。

---

### Task 1: 建立组合订单数据库契约

**Files:**
- Modify: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Test: `mt5-review-system/server/tests/test_campaign_storage.py`

**Step 1: Write the failing test**

增加测试，验证组合表拥有 `trade_pnl`、`commission`、`swap`、`fee`、`is_featured` 字段和 `campaign_checkins` 表，并且历史源交易精选/打卡可以迁移到组合级。

**Step 2: Run test to verify it fails**

Run: `python -m unittest mt5-review-system/server/tests/test_campaign_storage.py -v`

Expected: FAIL because the campaign aggregate columns and `campaign_checkins` table do not exist.

**Step 3: Write minimal implementation**

在基础 schema 和兼容迁移中增加组合级字段与索引；创建 `campaign_checkins(campaign_id, checkin_date)`，使用 `INSERT OR IGNORE ... SELECT` 将现有 `reading_checkins` 通过 `campaign_source_trades` 去重迁移。保留旧表作为兼容数据，不再让新业务写入旧表。

**Step 4: Run test to verify it passes**

Run: `python -m unittest mt5-review-system/server/tests/test_campaign_storage.py -v`

Expected: PASS.

### Task 2: 将 Campaign 重建改为持久化合并财务数据

**Files:**
- Modify: `mt5-review-system/server/app/data/campaign_repository.py`
- Modify: `mt5-review-system/server/app/application/campaign_response.py`
- Test: `mt5-review-system/server/tests/test_campaign_storage.py`
- Test: `mt5-review-system/server/tests/test_campaign_api.py`

**Step 1: Write the failing test**

用一个包含多笔源交易的交易组合验证：组合只返回一条记录，`trade_pnl`、三类手续费、`net_pnl` 均为源记录合计，精选状态在组合上，截图只返回组合截图。

**Step 2: Run test to verify it fails**

Run: `python -m unittest mt5-review-system/server/tests/test_campaign_storage.py mt5-review-system/server/tests/test_campaign_api.py -v`

Expected: FAIL because aggregate fee fields and campaign-level featured state are not serialized.

**Step 3: Write minimal implementation**

在 rebuild 中从活动源交易合计 `pnl`、`commission`、`swap`、`fee`，持久化组合级净盈亏；保留已有组合精选状态，首次迁移时吸收旧源交易精选状态。将截图、复盘文字和分类归属组合。响应中不把源交易作为订单列表记录返回，只作为详情中的成交流水数据。

**Step 4: Run test to verify it passes**

Run: `python -m unittest mt5-review-system/server/tests/test_campaign_storage.py mt5-review-system/server/tests/test_campaign_api.py -v`

Expected: PASS.

### Task 3: 统一组合级分析查询

**Files:**
- Modify: `mt5-review-system/server/app/data/campaign_repository.py`
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`
- Modify: `mt5-review-system/server/app/domain/domestic_futures_dashboard.py`
- Test: `mt5-review-system/server/tests/test_domestic_futures_dashboard.py`
- Test: `mt5-review-system/server/tests/test_architecture_contract.py`

**Step 1: Write the failing test**

增加两个源交易属于同一 campaign 的场景，验证仪表盘 `order_count` 为 1，手续费只计一次合计值，月度盈亏、合约榜单、风险摘要和固定周期均以 campaign 为单位。

**Step 2: Run test to verify it fails**

Run: `python -m unittest mt5-review-system/server/tests/test_domestic_futures_dashboard.py mt5-review-system/server/tests/test_architecture_contract.py -v`

Expected: FAIL because dashboard service still requests source trade analysis rows for several sections.

**Step 3: Write minimal implementation**

让 `CampaignRepository.query_analysis_rows` 返回组合级的 `trade_pnl`、费用字段、`net_pnl`、截图和复盘状态；`DashboardService` 的所有周期、曲线、日历、时段、国内期货固定周期、月度榜单和风险摘要统一使用 campaign rows。保留成交明细只供订单详情接口。

**Step 4: Run test to verify it passes**

Run: `python -m unittest mt5-review-system/server/tests/test_domestic_futures_dashboard.py mt5-review-system/server/tests/test_architecture_contract.py -v`

Expected: PASS.

### Task 4: 迁移精选、打卡和随机阅读到组合级

**Files:**
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/application/album_service.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/album.py`
- Test: `mt5-review-system/server/tests/test_review_album.py`

**Step 1: Write the failing test**

验证精选查询、随机选择、打卡状态、累计次数和日历均以 campaign 为单位；同一组合内多笔源交易的同一天打卡只能产生一条记录。

**Step 2: Run test to verify it fails**

Run: `python -m unittest mt5-review-system/server/tests/test_review_album.py -v`

Expected: FAIL because the current repository reads `trades.is_featured` and `reading_checkins.trade_id`.

**Step 3: Write minimal implementation**

增加组合级精选与打卡读写接口；旧的 `trade_id` 请求兼容解析到所属 campaign。随机功能从精选 campaign 中选取，返回完整组合详情；打卡日历按 campaign 去重计数。

**Step 4: Run test to verify it passes**

Run: `python -m unittest mt5-review-system/server/tests/test_review_album.py -v`

Expected: PASS.

### Task 5: 前端订单复盘和仪表盘口径回归

**Files:**
- Modify: `mt5-review-system/web/orders/orders.mjs`
- Modify: `mt5-review-system/web/orders/order-detail.mjs`
- Modify: `mt5-review-system/web/dashboard/domestic-futures-dashboard.mjs`
- Modify: `mt5-review-system/web/tests/orders-workspace.test.mjs`
- Modify: `mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`

**Step 1: Write the failing test**

验证订单列表一行一个 campaign、精选是同一列表的栏目、详情成交流水展示内部记录但不参与列表统计，仪表盘卡片读取组合级字段。

**Step 2: Run test to verify it fails**

Run: `node --test mt5-review-system/web/tests/orders-workspace.test.mjs mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`

Expected: FAIL on source-trade based selectors or missing campaign fields.

**Step 3: Write minimal implementation**

调整前端状态和接口参数，使列表、精选、随机和打卡都使用 campaign ID；详情区域保留成交流水；图册只渲染组合截图。仪表盘显示组合级交易盈亏、手续费和净盈亏。

**Step 4: Run test to verify it passes**

Run: `node --test mt5-review-system/web/tests/orders-workspace.test.mjs mt5-review-system/web/tests/domestic-futures-dashboard-real.test.mjs`

Expected: PASS.

### Task 6: 全量验证与版本文档

**Files:**
- Modify: `docs/VERSION-ROUTE.md`
- Modify: `CHANGELOG.md`

Run:

```powershell
Set-Location mt5-review-system/server
python -m unittest discover -s tests -p "test_*.py"
Set-Location ..
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js web/tests/orders-workspace.test.mjs web/tests/domestic-futures-dashboard-real.test.mjs
node --check web/orders/orders.mjs
node --check web/dashboard/domestic-futures-dashboard.mjs
```

最后检查桌面与 390px 移动端布局、控制台错误、接口响应和数据库迁移幂等性；未完成验证前不宣称功能完成。

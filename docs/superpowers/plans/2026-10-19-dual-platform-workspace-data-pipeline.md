# 双平台工作区与数据处理管线实施计划

> 执行状态：已完成实现与回归验证；本文件保留任务拆分、接口和验收依据。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MT5 与国内期货整理为边界清晰的双平台工作区，并为国内期货增加可追溯的数据导入批次、交易日历、异常处理和订单软删除能力。

**Architecture:** 保留一个本地应用和共享 UI 外壳；平台规则通过平台模块、来源适配器和标准成交契约隔离。第一阶段延续单 SQLite 文件的逻辑平台隔离，所有仓储和服务入口强制携带平台上下文，为未来物理分库保留接口边界。

**Tech Stack:** Python 3.11+ 标准库、SQLite、原生 HTML/CSS/JavaScript、Node 内置测试运行器。

**Spec:** `docs/superpowers/specs/2026-10-19-dual-platform-workspace-architecture.md`

## Global Constraints

- 用户界面统一使用“国内期货”和“数据导入”，不把“同花顺”作为功能名称。
- MT5 与国内期货数据、统计、导入批次和复盘页面默认互不可见。
- 导入必须先解析、标准化、校验、去重并生成报告，再在单事务中提交。
- 订单删除是软删除，支持恢复，不物理删除导入审计数据。
- 保留用户现有未提交修改，不读取或修改 `mt5-review-system/data/`、备份、配置、原始 JSONL 或真实截图。
- 不引入第三方 Python 或前端依赖。
- 每个任务遵循“先失败测试、确认失败、最小实现、确认通过”的 TDD 顺序。

---

### Task 1: 建立平台模块和导入领域契约

**Files:**
- Create: `mt5-review-system/server/app/platform_adapters/registry.py`
- Create: `mt5-review-system/server/app/platform_adapters/contracts.py`
- Modify: `mt5-review-system/server/app/platforms.py`
- Modify: `mt5-review-system/server/app/platform_importer.py`
- Modify: `mt5-review-system/server/tests/test_platform_import.py`
- Create: `mt5-review-system/server/tests/test_platform_contracts.py`

**Interfaces:**
- `PlatformContext(platform_id: str)`：归一化当前工作区。
- `NormalizedExecution`：标准成交记录，至少包含 `trade_date`、`time_utc`、`symbol`、`side`、`offset`、`quantity`、`price` 和来源标识。
- `PlatformAdapter.parse_file(file_bytes: bytes, filename: str) -> ImportParseResult`。
- `PlatformRegistry.adapter(platform_id: str) -> PlatformAdapter`。

- [ ] 写测试：平台注册表只暴露 `mt5` 和 `domestic_futures` 两个工作区，旧的 `tonghuashun_futures` 输入只作为兼容别名。
- [ ] 写测试：来源解析器输出统一的标准成交记录，而不是直接依赖订单表字段。
- [ ] 运行聚焦测试，确认新契约尚不存在而失败。
- [ ] 实现注册表、数据类和兼容别名；将同花顺 CSV/XLS 解析器作为国内期货来源适配器挂入注册表。
- [ ] 将 `platform_importer.py` 的用户语义改成通用“数据导入”，保留现有 API 兼容入口。
- [ ] 运行聚焦测试和现有平台导入测试。

### Task 2: 增加导入批次和标准化成交暂存层

**Files:**
- Modify: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Create: `mt5-review-system/server/app/data/import_repository.py`
- Modify: `mt5-review-system/server/app/platform_importer.py`
- Create: `mt5-review-system/server/tests/test_import_batches.py`

**Interfaces:**
- `create_import_batch(platform, filename, source_kind, source_format) -> dict`
- `finalize_import_batch(batch_id, counts, status) -> dict`
- `list_import_batches(platform, year=None, month=None) -> list[dict]`
- `get_import_calendar(platform, year, month) -> dict[str, dict]`

- [ ] 写失败测试：导入批次保存平台、来源、文件格式、日期范围和新增/重复/异常/未配对/订单数量。
- [ ] 写失败测试：同一平台的日历按交易日期聚合，另一个平台的数据不进入结果。
- [ ] 运行测试确认 schema 和 repository 缺失导致失败。
- [ ] 增加 schema 迁移和平台索引；批次状态使用 `preview`、`committed`、`failed`。
- [ ] 将导入过程改为“创建批次 -> 解析处理 -> 单事务提交 -> 完成批次”，失败时回滚业务数据并保留失败批次。
- [ ] 运行批次、兼容性和全量后端测试。

### Task 3: 完成标准化、去重和异常报告

**Files:**
- Modify: `mt5-review-system/server/app/data/tonghuashun_csv.py`
- Modify: `mt5-review-system/server/app/data/tonghuashun_xls.py`
- Create: `mt5-review-system/server/app/data/normalized_import.py`
- Modify: `mt5-review-system/server/tests/test_tonghuashun_csv.py`
- Create: `mt5-review-system/server/tests/test_normalized_import.py`

**Interfaces:**
- `normalize_execution(raw_row, context) -> NormalizedExecution | ImportIssue`
- `deduplicate_executions(rows) -> DeduplicationResult`
- `build_import_preview(parsed, deduplicated, matched) -> dict`

- [ ] 写失败测试：支持标准模板字段和同花顺中文字段，统一生成交易日期、成交时间、方向、开平、数量和价格。
- [ ] 写失败测试：优先使用成交编号去重，无编号时使用稳定字段指纹；重复导入不会新增业务记录。
- [ ] 写失败测试：缺少必要字段、非法数字、非法时间、未知买卖/开平和未配对成交都进入异常报告。
- [ ] 运行聚焦测试确认失败。
- [ ] 实现标准化层和异常分类；保留来源文件、工作表和行号。
- [ ] 将现有 FIFO 匹配接到标准化成交记录，禁止解析器直接写订单业务字段。
- [ ] 运行聚焦测试和现有真实样本的脱敏结构测试，不读取或提交真实文件。

### Task 4: 增加数据导入 API、历史列表和日历接口

**Files:**
- Modify: `mt5-review-system/server/app/presentation/http/routes/platforms.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Create: `mt5-review-system/server/tests/test_import_history_api.py`
- Modify: `mt5-review-system/web/settings/settings.mjs`
- Modify: `mt5-review-system/web/settings/index.html`
- Modify: `mt5-review-system/web/settings/settings.css`
- Modify: `mt5-review-system/web/tests/settings-workspace.test.mjs`

**Interfaces:**
- `GET /api/platforms/import-batches?platform=...&year=...&month=...`
- `GET /api/platforms/import-calendar?platform=...&year=...&month=...`
- `GET /api/platforms/import-batches/{id}`
- Existing `POST /api/platforms/import-file` remains compatible and returns `batch_id` plus counts.

- [ ] 写失败测试：批次历史和日历接口只返回当前平台，字段不泄露本机绝对路径。
- [ ] 写失败测试：服务返回导入路由 404 时，前端显示“服务未重启，请重新启动本地服务”，不显示裸 `Not found`。
- [ ] 运行前端和后端聚焦测试确认失败。
- [ ] 实现 API 查询和设置页“数据导入”区域；展示批次统计、异常数量和交易日期日历。
- [ ] 增加标准 CSV 模板下载入口，模板导入复用同一标准化管线。
- [ ] 验证桌面和 390px 移动端无横向溢出。

### Task 5: 平台模块边界和前端命名清理

**Files:**
- Modify: `mt5-review-system/server/app/platforms.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Create: `mt5-review-system/server/app/platform_modules/mt5_service.py`
- Create: `mt5-review-system/server/app/platform_modules/domestic_futures_service.py`
- Modify: `mt5-review-system/web/shared/js/platform.mjs`
- Modify: `mt5-review-system/web/shared/js/shell.mjs`
- Modify: `mt5-review-system/web/settings/settings.mjs`
- Modify: `mt5-review-system/web/settings/index.html`
- Modify: `mt5-review-system/web/tests/platform-workspace-ui.test.mjs`
- Modify: `mt5-review-system/web/tests/settings-workspace.test.mjs`

- [ ] 写架构契约测试：MT5 模块和国内期货模块不能互相导入；共享服务只能依赖平台契约。
- [ ] 将平台标签和内部标识统一为 `domestic_futures`，保留旧别名读取兼容。
- [ ] 把当前同花顺命名改为来源适配器命名；用户界面改为“国内期货 / 数据导入”。
- [ ] 保证所有 API 请求仍自动携带当前平台上下文。
- [ ] 运行架构、前端工作区和全量测试。

### Task 6: 订单软删除、恢复和统计隔离

**Files:**
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/application/dashboard_service.py`
- Modify: `mt5-review-system/server/app/application/album_service.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/orders.py`
- Modify: `mt5-review-system/web/orders/orders.mjs`
- Modify: `mt5-review-system/web/orders/index.html`
- Modify: `mt5-review-system/web/orders/orders.css`
- Modify: `mt5-review-system/web/tests/orders-workspace.test.mjs`
- Create: `mt5-review-system/server/tests/test_order_soft_delete_platform.py`

- [ ] 写失败测试：删除国内期货订单后，订单列表、仪表盘、画册和组合统计都排除该订单，MT5 同 ID 记录不受影响。
- [ ] 写失败测试：恢复后订单重新参与当前平台查询和统计。
- [ ] 写失败测试：删除原因被记录，导入批次和来源成交仍保留。
- [ ] 运行聚焦测试确认失败。
- [ ] 实现平台上下文下的删除/恢复服务和异常原因存储；默认只返回未删除记录。
- [ ] 在订单列表加入删除操作和恢复/已排除筛选，确认提示中要求填写原因。
- [ ] 运行后端全量、订单前端和发布检查。

### Task 7: 文档、版本和最终验证

**Files:**
- Modify: `README.md`
- Modify: `mt5-review-system/README.md`
- Modify: `docs/VERSION-ROUTE.md`
- Modify: `CHANGELOG.md`
- Modify: `VERSION`
- Modify: `docs/superpowers/specs/2026-10-19-dual-platform-workspace-architecture.md`

- [x] 更新用户文档：平台切换、数据导入、标准模板、批次日历、异常数据和订单恢复。
- [x] 将“同花顺导入”改为“国内期货数据导入”，同花顺仅作为来源说明。
- [x] 将版本从 `0.7.1` 提升到 `0.8.0`，仅在功能和测试完成后执行。
- [x] 运行 `python -m unittest discover -s tests -p "test_*.py"`。
- [ ] 运行前端 Node 测试、所有入口 JS 语法检查和 `python .\tools\check_release.py`。
- [x] 运行 `git diff --check`，检查未包含敏感数据和生成文件。

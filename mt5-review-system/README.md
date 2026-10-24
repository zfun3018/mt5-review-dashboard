# MT5 本地复盘系统

这是项目的运行与开发目录，提供本地 Python HTTP 服务、原生网页、SQLite 数据库适配、MT5 EA 桥接和测试工具。当前版本为 `v1.0.1`。

首次了解项目请先看 [根目录 README](../README.md) 和 [项目技术说明](../docs/PROJECT-GUIDE.md)。AI 协作部署请看 [AI 部署指南](../docs/AI-DEPLOYMENT-GUIDE.md)。版本规则见 [版本路线](../docs/VERSION-ROUTE.md)，已发布内容见 [CHANGELOG](../CHANGELOG.md)，正式版本操作见 [发布指南](../docs/RELEASE-GUIDE.md)。

## 运行环境

- Windows 10 或 Windows 11；
- Python 3.11 或更高版本，推荐 Python 3.12；
- PowerShell 5.1 或更高版本；
- Node.js 20 或更高版本仅用于前端测试；
- MetaTrader 5 和 MetaEditor 仅在需要实时同步和编译 EA 时需要。

后端只使用 Python 标准库，不需要安装 `requirements.txt` 或第三方 Python 包。

## 配置

从项目根目录复制配置模板：

```powershell
Copy-Item .\config.local.example.json .\config.local.json
```

编辑 `config.local.json` 中的本机路径：

| 配置字段 | 作用 |
| --- | --- |
| `mt5_install_dir` | MT5 安装目录 |
| `mt5_data_dir` | MT5 终端数据目录 |
| `mql5_experts_dir` | EA 安装到的 Experts 目录 |
| `mql5_files_bridge_dir` | EA 写入 JSONL 和截图的桥接目录 |
| `local_dashboard_url` | MT5 允许 WebRequest 的本地服务地址 |
| `local_bridge_endpoint` | EA 推送交易事件的 API 地址 |

`config.local.json` 已被 Git 忽略，只能保存在本机，不要提交。

## 启动服务

在当前目录运行：

```powershell
.\start.ps1
```

默认地址：

```text
http://127.0.0.1:8787
```

服务默认只监听本机。只有在可信局域网中明确需要手机访问时，才设置：

```powershell
$env:MT5_REVIEW_HOST = "0.0.0.0"
$env:MT5_REVIEW_PORT = "8787"
.\start.ps1
```

根目录的一键启动脚本默认启用可信局域网访问，并显示手机地址；它只为 Private/LocalSubnet 创建 TCP 8787 防火墙规则。服务没有登录认证，不要配置公网端口转发。

## 安装和使用 MT5 EA

1. 复制并编辑 `config.local.json`；
2. 安装 EA 源码：

```powershell
.\tools\install_ea.ps1
```

3. 在 MetaEditor 中分别打开并编译 `mt5-ea/MT5ReviewBridge.mq5` 与 `mt5-ea/MT5ReviewM1CsvExporter.mq5`；
4. 在 MT5 中刷新导航器，把 EA 挂载到长期打开的图表；
5. 在“工具 → 选项 → EA 交易”中允许 WebRequest：

```text
http://127.0.0.1:8787
```

如果服务运行在另一台电脑，改用那台电脑的可信局域网地址。EA 同时写入本地 JSONL，作为 WebRequest 失败时的兜底。

EA 行情请求默认使用 `http://127.0.0.1:8787/api/v1/market/bar-requests/claim` 和 `http://127.0.0.1:8787/api/v1/market/bar-requests`。若修改服务 host/port，必须同时修改 `InpBridgeUrl`、`InpMarketRequestsUrl` 和 `InpMarketResultsUrl`，并在 MT5 WebRequest 允许列表中加入对应 host。行情每轮最多领取并处理 1 个请求；MT5 的 `WebRequest` 是同步调用，行情轮询放在权益快照上报之后，每次 HTTP 超时默认 500ms，两次请求的最坏网络等待约 1 秒，无法保证交易回调零等待。

行情时间转换复用 `InpServerUtcOffsetHours` 固定 broker/server UTC 时差。该值必须按终端服务器当前时差配置；EA 尚不具备历史夏令时规则，跨 DST 区间的历史行情时间需要人工验收。接口会显式返回 `market_calendar_unmodeled` warning，固定周期缺口不能直接解释为行情丢失，因为交易时段、周末和节假日尚未建模。

`MT5ReviewM1CsvExporter` 是单独的行情导出 EA，不替换交易同步 Bridge。将它挂载到要导出品种的任意图表，设置 `InpServerUtcOffsetMinutes`、`InpOffsetValidFromServer` 和 `InpOffsetValidToServer`，确认所填偏移对整个导出区间都有效后，才将 `InpConfirmOffsetStableForExportRange` 设为 `true`。默认值会拒绝导出；如果最近最多 50,000 根 M1 K 线跨过经纪商夏令时切换点，单一偏移无法覆盖该范围，EA 会停止导出，需缩小 `InpMaxBars` 到一个偏移稳定区间。不得把服务器时间直接当 UTC 或北京时间。CSV 和 `.meta.json` 精度元数据写入终端 `MQL5/Files` 下，文件名按本地账户和品种隔离；账户号仅用于本地文件名，不要分享原始导出文件。当前版本先提供可靠拒绝机制，历史偏移表和自动分段导出仍待后续扩展。

如果实时 WebRequest 没有成功，可以增量回灌：

```powershell
.\tools\import_from_mt5.ps1
```

导入器读取桥接目录中的 `events_*.jsonl`，写入 SQLite，并补偿迟到的截图文件。

## 平台工作区

右上角平台按钮可以在 `MT5` 与 `国内期货` 之间直接切换。平台是当前工作区上下文，订单、Campaign、仪表盘、收益曲线和订单复盘只读取当前平台的数据。

国内期货通过“设置 → 数据导入”处理标准模板或同花顺来源的 CSV/XLS 文件。CSV 支持 UTF-8、GBK 或 Windows 常见中文编码；XLS 会自动选择“成交明细”表，不会把其他汇总页当作成交数据。导入器会定位表头、标准化字段、按成交序号幂等去重；对完整的一开一平订单，还会用合约、方向、开平时间、价格和数量做订单级兜底去重，报告同序号字段冲突、重复来源、无效字段和未匹配数量，合并“实际成交日期”和“成交时间”，将夜盘按同一交易日排在日盘之前，再按开仓和平仓成交 FIFO 配对；来源交易日期保持不变。订单列表和画册按开仓交易日筛选和分组，收益分析、日历和已实现盈亏按平仓成交时间统计。导入页面展示批次历史、按交易日期的日历以及全局未匹配开仓/平仓成交，支持重新导入、按手数手动配对和撤销导入批次；每个日期显示新增成交、重复成交、重复订单、字段冲突、异常和未配对数量。导入结果和批次详情会显示具体原因、文件名、原始行号、字段原值/新值、首次来源和剩余手数。订单来源会保留文件名、批次编号、工作表、原始行号、成交序号和 SHA-256 文件摘要。仪表盘会显示最近导入订单时间，国内期货订单会在导入时写入品种名和通用合约名称，例如 `FG701` 显示为品种 `玻璃`、合约 `玻璃2701`；原始合约代码仍保留用于去重和计算。原始数据没有提供平仓盈亏时，系统将盈亏记为 0，并在导入结果中提示。

系统提供固定的标准 CSV 模板下载入口。模板是推荐的稳定接口，但不要求用户预先手工清洗同花顺原始导出文件；所有来源都先经过统一数据处理管线，再进入订单和统计。

K 线截图由用户在同花顺中手动截图，再通过订单详情的截图上传入口保存。系统不自动截取交易软件窗口。

## 四个工作区

| 工作区 | 地址 | 主要用途 |
| --- | --- | --- |
| 分析仪表盘 | `/dashboard/` | 指标、收益曲线、月历、热力图和评估 |
| 订单流水 | `/orders/` | Campaign/Position、复盘、分类、自定义字段和截图 |
| 订单复盘 | `/orders/` | 全部/精选订单、组合截图、随机精选、打卡和成交流水 |
| 设置与系统 | `/settings/` | 分类、自定义字段、分析设置、状态和备份 |

根路径 `/` 是兼容入口，会把旧的 `?trade=` 或 `?campaign=` 深链导向订单流水，否则进入仪表盘。

## 本地数据

以下目录可能包含敏感数据，只在本机使用：

```text
data/
  journal.sqlite
  raw-events/
  screenshots/
backups/
config.local.json
```

不要读取、上传、暂存或提交这些目录中的内容。迁移项目时，使用本地备份或复制整个运行数据目录；不要把真实数据放入测试夹具。

## 后端和前端开发边界

后端依赖方向为：

1. `server/app/domain/`：Campaign、R 倍数和统计公式；
2. `server/app/data/`：数据库、迁移、仓储、导入、截图和备份；
3. `server/app/application/`：完整业务用例；
4. `server/app/presentation/`：HTTP 路由和响应格式。

前端每个工作区使用自己的入口和状态模块，共享样式与工具位于 `web/shared/`。不要把 SQL 放进路由或页面，不要让读取接口隐式重建模型，不要恢复单一全局前端脚本。

仪表盘的布局编辑器使用 GridStack 管理模块位置和宽高，图表使用 ECharts 管理坐标轴、数据更新和容器尺寸变化。业务数据仍由 SQLite 和分析接口提供，前端不得自行维护另一份统计结果。

## 常用接口

- `GET /api/analysis?equity_days=30`：日期范围分析、收益曲线和评估；
- `POST /api/sync`：执行一次 JSONL 增量同步；
- `GET /api/review-album`、`GET /api/review-album/random`：旧版画册兼容接口，新的页面入口统一为订单复盘；
- `GET /api/campaign-checkins?days=90`：读取组合级打卡日历；
- `PATCH /api/trades/{id}/review`：保存订单复盘；
- `PATCH /api/trades/{id}/archived`：归档或恢复画册交易；
- `GET /api/trades?page=1&page_size=50`：分页读取订单；
- `GET/POST /api/classification-options`：读取或新增交易分类；
- `DELETE /api/custom-fields/{id}`：停用自定义字段；
- `DELETE /api/custom-fields/{id}/purge`：永久删除字段及其历史填写。

统计展示按北京时间计算。净盈亏为利润、手续费、隔夜利息和费用的合计；R、SQN、Z 分数按 Campaign 统计。

## 测试

从 `server` 目录运行 Python 测试：

```powershell
Set-Location .\server
python -m unittest discover -s tests -p "test_*.py"
```

从 `mt5-review-system` 目录运行前端测试：

```powershell
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
node --check web/shared/js/shell.mjs
node --check web/dashboard/dashboard.mjs
node --check web/orders/orders.mjs
node --check web/album/album.mjs
node --check web/settings/settings.mjs
```

完整发布检查：

```powershell
python .\tools\check_release.py
python .\tools\check_release.py --skip-browser
```

UI 修改需要检查桌面端和 390px 移动端，不应出现横向溢出。涉及数据模型、统计口径、迁移或图片生命周期的变更，必须补充测试并更新版本路线。

## 相关档案

架构决策在 `../docs/adr/`，功能设计在 `../docs/superpowers/specs/`，实施计划在 `../docs/superpowers/plans/`。这些文件记录为什么这样设计，不替代本 README 的运行步骤。

# MT5 本地复盘系统

这是一个 local-first 的 MT5 交易复盘系统。项目代码开源，但订单数据库、截图、原始事件和本机配置默认只保存在当前电脑，不上传云端。

当前版本：`v0.6.0`。版本路线见上级目录 `docs/VERSION-ROUTE.md`。

GitHub 首页使用说明见上级目录 [`README.md`](../README.md)，Codex 等 AI 工具的项目规则见 [`AGENTS.md`](../AGENTS.md)。

## 已搭建内容

- 本地 HTTP 服务：`http://127.0.0.1:8787`
- 本地 SQLite 数据库：`data/journal.sqlite`
- 已检测到的 MT5 数据目录配置：`config.local.json`
- 示例订单和示例 5 分钟图表截图
- 订单流水、K 线截图、500 字以上复盘文本和自定义字段
- K 线截图支持直接粘贴、本地上传替换和删除，替换时自动清理旧文件
- 可新增、改名和停用的交易类型/交易策略，历史统计使用稳定标识
- 默认 30 天、可切换 3/7/30 天的资金曲线
- 月度盈亏日历
- 一周 x 24 小时盈亏热力图
- 北京时间亚盘、欧盘、美盘胜率
- 本地备份接口
- 今日/周/月/年指标、净盈亏口径和盈利因子
- 按日交易系统评估、Z 分数、交易类型/策略模式评估
- 收益累计曲线（左轴回报、右轴收益率）、分析范围联动筛选和系统评估摘要卡
- Z 分数解释说明与自适应评估表格
- 复盘画册：按北京时间交易日展示截图，支持品种、时间和选项标签筛选
- 画册短复盘内容默认展开，长内容按需折叠；画册与仪表盘使用统一顶部导航
- 画册直接复用现有 SQLite 和截图文件，不新增表、不复制图片、不做历史数据重处理
- JSONL 增量同步、事件规范化去重、订单分页、软删除/恢复
- MT5 EA 桥接源码骨架：`mt5-ea/MT5ReviewBridge.mq5`

## 功能边界

系统由四个独立工作区组成：

1. **订单流水**（`/orders/`）：订单字段、复盘内容、交易分类、自定义字段和截图生命周期管理；
2. **分析仪表盘**（`/dashboard/`）：指标卡、收益累计曲线、月历、热力图、交易系统评估、Z 分数和模式评估；
3. **复盘画册**（`/album/`）：按北京时间交易日查看截图，并用品种、日期和选项标签进行筛选；
4. **设置与系统**（`/settings/`）：交易分类与自定义字段 schema 管理、Scratch 阈值、系统状态和本地备份。

后端是 Python 标准库 HTTP 服务，前端是原生 HTML/CSS/JavaScript，SQLite 是唯一业务数据库，不需要 Node 构建或 Python 第三方依赖。

## 前端工作区所有权

前端拆分为四个独立入口页面，共享同一套左侧导航与 UI 系统，每个工作区只调用自己的 API：

| 工作区 | 入口 | 数据源 |
| --- | --- | --- |
| 分析仪表盘 | `/dashboard/` | 仅 `GET /api/analysis` |
| 订单流水 | `/orders/` | Campaign 列表/详情、Position 止损、交易复盘、截图、自定义值、分类与分析设置 |
| 复盘画册 | `/album/` | 仅 `GET /api/review-album`（只读，无变更操作） |
| 设置与系统 | `/settings/` | 分类、自定义字段、分析设置、状态、备份 |

共享模块位于 `web/shared/`：`css/tokens.css`、`base.css`、`shell.css`、`components.css` 提供设计令牌与通用组件；`js/api.mjs`、`shell.mjs`、`formatters.mjs`、`feedback.mjs`、`url-state.mjs` 提供请求、外壳、格式化、反馈与 URL 状态。根路径 `/` 是兼容重定向壳，把旧深链（`?trade=`/`?campaign=`）映射到 `/orders/`，否则跳转 `/dashboard/`。

## 后端架构边界

后端按四层组织，依赖只从外层指向内层：

1. **领域层 `app/domain/`**：只负责 Campaign、R 倍数和统计公式，不读取数据库、文件或 HTTP 请求；
2. **数据层 `app/data/`**：负责 SQLite 连接、迁移、仓储、写入命令、MT5 事件导入、截图与备份文件；
3. **应用层 `app/application/`**：组合一次完整用例，例如仪表盘分析、订单分页、画册筛选和首页数据装配，并统一 Campaign/Position 响应字段；
4. **展示层 `app/presentation/`**：负责 HTTP 路由、响应格式、交易界面字段，以及 Campaign 旧序列化入口的兼容适配。

`app/storage.py` 只保留旧脚本和测试仍会调用的兼容入口、运行目录同步与服务组装，不再保存 SQL、迁移表结构或统计公式。新代码应直接调用所属层的模块。

主要所有权如下：

- 数据库生命周期与事务：`data/database.py`、`data/migrations.py`、`data/bootstrap.py`；
- 交易、Campaign、分类和媒体读取：对应的 `*_repository.py`；
- 交易、Campaign、分类和 MT5 导入写入：对应的 `*_commands.py` 与 `ingestion_repository.py`；
- 仪表盘、订单、画册和设置用例：`application/*_service.py`；
- Campaign/Position 响应字段：`application/campaign_response.py`；
- HTTP 路由、交易界面字段和旧入口适配：`presentation/http/` 和展示序列化模块。

读取流程为“HTTP 路由 → 应用服务 → 仓储 → SQLite”，读取 Campaign 列表、详情和分析时不会写数据库，也不会顺带重建模型。Campaign 重建与对应写入在同一个事务内完成，重建或写入任一步失败都会整体回滚，全部成功后才提交；一批 JSONL 导入不论包含多少条成交记录，都只在批次末尾重建一次。启动时只有检测到模型版本过旧才执行兼容修复。

历史数据库继续通过幂等迁移升级，迁移前的本地 SQLite 快照、旧交易字段、复盘、分类、自定义字段、截图引用和软删除状态均保持兼容。不会为了新架构重新导入或重处理历史 JSONL。

## 启动

在项目目录运行：

```powershell
.\start.ps1
```

然后打开：

```text
http://127.0.0.1:8787
```

一键启动脚本默认只监听本机 `127.0.0.1:8787`。服务没有登录验证，不应暴露到公网。确实需要在可信局域网使用手机访问时，必须显式设置监听地址：

```powershell
$env:MT5_REVIEW_HOST = "0.0.0.0"  # 仅在可信局域网中显式开启
$env:MT5_REVIEW_PORT = "8787"
.\start.ps1
```

手机与电脑连接同一 Wi-Fi 后，再使用启动窗口显示的 `http://<电脑局域网IP>:8787` 访问。关闭窗口或清除该环境变量后，下次启动恢复为仅本机访问。

## 本地数据目录

```text
data/
  journal.sqlite
  raw-events/
  screenshots/
backups/
```

备份会把数据库、原始事件和截图打包到 `backups/`。

## MT5 EA 使用思路

检测到当前 MT5：

```text
安装目录：D:\Apps\MetaTrader5
数据目录：C:\Users\<USERNAME>\AppData\Roaming\MetaQuotes\Terminal\<TERMINAL_ID>
EA 目录：C:\Users\<USERNAME>\AppData\Roaming\MetaQuotes\Terminal\<TERMINAL_ID>\MQL5\Experts
Files 目录：C:\Users\<USERNAME>\AppData\Roaming\MetaQuotes\Terminal\<TERMINAL_ID>\MQL5\Files
```

以上路径仅为示例。新环境请复制 `config.local.example.json` 为
`config.local.json`，并替换为自己的 MT5 安装目录、终端数据目录和桥接目录。

安装 EA 源码：

```powershell
.\tools\install_ea.ps1
```

然后：

1. 在 MetaEditor 里编译 `MT5ReviewBridge.mq5`。
2. 在 MT5 里把 EA 挂到一个长期打开的图表。
3. 如果要让 EA 直接推送到本地服务，在 MT5 设置里允许：

```text
http://127.0.0.1:8787
```

EA 同时会写本地 JSONL，作为 WebRequest 失败时的兜底流水。

EA 源码需要复制到本机的 `Experts` 目录，并使用本机 MetaEditor 编译生成 `MT5ReviewBridge.ex5`。

## 从 MT5 JSONL 回灌

如果 EA 没有开启 WebRequest，或者 MT5 当时没连上本地服务，可运行：

```powershell
.\tools\import_from_mt5.ps1
```

这个脚本会读取 `MQL5\Files\MT5ReviewBridge` 下的 `events_*.jsonl`，并复制截图到本项目的 `data\screenshots`。

首次升级到 v0.2.0 时会自动执行 SQLite schema v2 迁移并建立 JSONL 读取游标。之后刷新页面只读取新增内容，不会重复扫描历史文件。

首次升级到 v0.3.0 时会自动执行 SQLite schema v3 迁移，建立交易分类配置表。分类改名不会改变历史订单的分类标识；界面中的删除为停用，历史订单和统计继续保留。备注已从订单复盘界面和保存流程移除，数据库中的旧备注数据保留以兼容历史版本。

v0.3.1 增加订单截图的手动替换与删除接口。新图片保存为本地截图目录中的唯一文件，订单路径和原始交易快照同步更新；确认没有其他订单引用后，旧图片文件自动清理。

v0.4.0 增加独立复盘画册页面。画册按北京时间平仓日期分组，桌面端左图右信息、移动端图下信息；筛选仅包含品种、时间范围、交易类型/策略和单选/多选自定义字段选项标签，不提供多空或文本字段筛选。

v0.4.1 增加画册短/长复盘自适应展开策略、统一顶部导航和深色筛选控件；一键启动脚本默认支持可信局域网访问，并在启动时显示手机访问地址。项目同时补充 MIT 许可证、贡献规范、安全策略、AI 协作规则和 GitHub Actions 测试。

## 统计与接口

- `GET /api/analysis?equity_days=30`：日期范围分析、资金曲线、系统评估和模式评估。
- `GET /api/review-album?symbol=XAUUSDc&tag=strategy:breakout`：按交易日返回画册卡片和标签目录。
- `GET /api/system-evaluation?start=YYYY-MM-DD&end=YYYY-MM-DD`：按日评估与 Z 分数。
- `GET /api/mode-evaluation?dimension=trade_type|strategy`：按交易类型或策略聚合。
- `GET/POST /api/classification-options`：查询或新增交易类型和策略。
- `PUT/DELETE /api/classification-options/{id}`：改名或停用分类，稳定标识不变。
- `GET /api/trades?page=1&page_size=50&side=long`：订单分页与筛选。
- `DELETE /api/trades/{id}` 与 `POST /api/trades/{id}/restore`：软删除和恢复。

统计中的净盈亏为利润 + 手续费 + 隔夜利息 + 费用；盈亏平衡交易不进入 Z 分数的胜负序列。

## 开发验证

从 `server` 目录运行 Python 测试（确保 `python` 指向 Python 3.12）：

```powershell
python -m unittest discover -s tests -v
```

从项目目录运行前端静态测试（需要 Node.js 20 或更高版本）：

```powershell
node --test web/tests/*.test.js
```

## 重要口径

- 统计展示按北京时间计算。
- 原始交易时间建议保留服务器时间和 UTC 时间，避免跨时区复盘错位。
- 美盘默认配置为北京时间 `20:00-02:00`，可后续改为可配置。
- 当前 EA 是桥接骨架，后续需要在你的 MT5 真实环境里编译验证。

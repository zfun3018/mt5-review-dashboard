# MT5 复盘仪表盘

当前稳定开发版本为 `v0.6.20`，主项目位于 `mt5-review-system/`。

- 项目说明：`mt5-review-system/README.md`
- 版本路线：`docs/VERSION-ROUTE.md`
- v0.2.0 实施记录：`docs/plans/2026-08-18-mt5-review-v02.md`
- 需求与优化依据：`MT交易复盘系统.md`

在 Windows 下可直接运行 `一键启动MT5复盘仪表盘.bat`。一键启动默认监听可信局域网，
电脑本机访问地址为 `http://127.0.0.1:8787`，启动窗口会显示手机访问地址。
如果只需要本机访问，也可以进入 `mt5-review-system/` 后运行 `start.ps1`，其默认地址为
`http://127.0.0.1:8787`。

一键启动只为 TCP 8787 创建“专用网络 / LocalSubnet”防火墙规则，不会开放公网；服务没有登录认证，
不要将端口转发到公网。

本地数据库、交易事件、截图、备份和机器配置不纳入版本控制。

## 项目能做什么

### 订单流水

- 订单流水以交易组合（Campaign）为一行，同品种、同方向且持仓时间重叠的独立 Position 自动识别为加仓。
- 一个 Position 的多次退出显示为分批平仓，不会重复增加交易笔数；展开组合可查看所有 Position 和退出成交。
- 每个 Position 可分别在订单流水表格中回填入场时采用的初始止损；缺失或方向无效时高亮 R 状态，并支持“仅看 R 缺失”。
- Scratch 订单在流水中以灰色标识；合并 Campaign 显示汇总入场价、出场价和持仓时间，展开后可逐 Position 查看和编辑。
- 支持软删除与恢复，已删除交易不会继续污染收益曲线和统计。
- 交易类型与交易策略支持新增、改名和停用，改名不会破坏历史统计。
- 设置页支持自定义交易场景和交易策略选项的颜色，并同步到订单列表、分析和复盘画册。
- 自定义字段支持文本、单选和多选；单选/多选选项可以作为画册标签筛选条件。
- 复盘文本编辑区支持 500 字以上内容。
- 备注字段已移除，旧数据库备注仅为历史兼容保留。

### 截图管理

- 自动同步 MT5 交易截图。
- 订单详情支持本地上传、直接粘贴、拖拽替换和删除图片。
- 替换时先保存新图片，再更新数据库路径；没有其他订单引用的旧图会自动清理。
- 支持常见图片格式和大小校验，避免无效文件进入截图目录。

### 仪表盘分析

- 今日、本周、本月、本年指标卡。
- 收益累计曲线：左轴为累计回报金额，右轴为收益率。
- 曲线根据分析范围筛选，并基于未删除交易重建。
- 月度盈亏日历、星期 × 小时盈亏热力图、北京时间交易时段胜率。
- 系统质量按 Campaign 统计 R、Scratch、净胜率、全样本胜率、R 期望、SQN、R 版 Z 分数和数据覆盖率。
- Scratch 默认阈值为 `±0.15R`，可在分析工具栏调整；新增指标均提供公式、阈值、样本、缺失原因和限制说明。
- 现金收益、日历和小时统计仍按实际退出成交时间；R 和模式评估按 Campaign 最终平仓时间，避免部分平仓重复计数。
- 汇总回报、交易笔数、盈亏比、胜率、盈利/亏损金额和盈利/亏损笔数。
- 仪表盘和订单列表支持一键分享当前完整页面：自动下载 PNG，并在浏览器允许时复制到剪贴板。
- 订单列表将交易场景和交易策略放在组合盈亏字段之后，桌面表格与移动端信息块顺序一致。
- 订单列表选中行使用高对比背景和边框；打平订单保留独立的选中配色。
- 合并订单的交易场景和交易策略按组合独立管理；筛选与仪表盘均按组合分类统计，展开后的子订单分类互不覆盖。

### 复盘画册

- 独立的“复盘画册”页面，以交易截图为主体。
- 按北京时间平仓日期分隔和排序，桌面端左图右信息，移动端图上信息下。
- 支持品种、起止日期、交易类型、交易策略和单选/多选选项标签筛选。
- 不提供多空筛选、文本字段筛选或全文搜索。
- 支持懒加载、大图预览、订单详情跳转；复盘内容在右栏独立滚动，长文本不会被裁切。
- 复盘内容沿用订单列表编辑器，支持直接编辑并保存订单复盘。
- 支持将画册归档和恢复；归档内容只在“归档画册”栏目显示。
- 页面顶部支持从全部未归档画册中随机抽取一笔交易阅读，且不受筛选条件影响。
- 随机阅读和画册图片支持按北京时间每日打卡，提供每日阅读目标和近 90 天打卡热力图。
- 复盘画册和设置页面不提供页面分享截图功能。

## 安装要求

### 必需环境

- Windows 10 或 Windows 11。
- Python 3.11 或更高版本，推荐 Python 3.12。
- PowerShell 5.1 或更高版本。
- Git。

后端只使用 Python 标准库，不需要安装第三方 Python 包，也没有 `requirements.txt`。

### 可选环境

- MetaTrader 5：需要实时同步订单和截图时使用。
- MetaEditor：需要编译 `MT5ReviewBridge.mq5` 时使用。
- Node.js 20 或更高版本：只运行前端静态测试时需要，不参与应用运行。

## 安装和配置

```powershell
git clone https://github.com/zfun3018/mt5-review-dashboard.git
Set-Location mt5-review-dashboard
Copy-Item .\mt5-review-system\config.local.example.json .\mt5-review-system\config.local.json
```

然后编辑 `mt5-review-system/config.local.json`，替换 MT5 安装目录、终端数据目录、Experts 目录和 `MQL5\Files\MT5ReviewBridge` 桥接目录。配置模板中的 `<USERNAME>` 和 `<TERMINAL_ID>` 只是占位符。

| 配置字段 | 作用 |
| --- | --- |
| `mt5_install_dir` | MT5 安装目录 |
| `mt5_data_dir` | MT5 终端数据目录 |
| `mql5_experts_dir` | EA 源码安装到的 Experts 目录 |
| `mql5_files_bridge_dir` | EA 写入 JSONL 和截图的桥接目录 |
| `local_dashboard_url` | MT5 允许 WebRequest 的本地服务地址 |
| `local_bridge_endpoint` | EA 推送交易事件的 API 地址 |

`config.local.json` 已被 `.gitignore` 忽略，只能在本机保存，不要提交到 GitHub。

## 启动方式

### 一键启动

在项目根目录双击：

```text
一键启动MT5复盘仪表盘.bat
```

或运行：

```powershell
.\mt5-review-system\start.ps1
```

一键启动会自动使用 `0.0.0.0` 监听可信局域网，并显示电脑本机地址、局域网地址和当前监听地址。
首次运行可能请求管理员权限，用于创建仅限“专用网络 / LocalSubnet”的 TCP 8787 防火墙规则。
电脑浏览器访问：

```text
http://127.0.0.1:8787
```

直接运行 `python run.py` 时默认只监听本机。需要手动指定监听方式时：

```powershell
$env:MT5_REVIEW_HOST = "127.0.0.1"  # 仅本机
$env:MT5_REVIEW_PORT = "8787"
Set-Location .\mt5-review-system
python .\run.py
```

启动脚本支持通过 `MT5_REVIEW_PYTHON` 指定 Python：

```powershell
$env:MT5_REVIEW_PYTHON = "C:\Path\To\python.exe"
.\mt5-review-system\start.ps1
```

## 手机和局域网访问

直接运行 `start.ps1` 时服务默认只监听本机 `127.0.0.1`。需要手动启用局域网时，可以使用：

```powershell
$env:MT5_REVIEW_HOST = "0.0.0.0"  # 仅在可信局域网中显式开启
$env:MT5_REVIEW_PORT = "8787"
Set-Location .\mt5-review-system
.\start.ps1
```

手机与电脑连接同一 Wi-Fi 后：

1. 在电脑上运行 `ipconfig`；
2. 找到 Wi-Fi 适配器的 IPv4 地址，例如 `192.168.10.73`；
3. 手机打开 `http://192.168.10.73:8787`。

关闭窗口或清除 `MT5_REVIEW_HOST` 环境变量后，下次启动恢复为仅本机访问。

手机不能使用 `127.0.0.1`，因为它代表手机自己。如果 Windows 防火墙拦截，在管理员 PowerShell 中仅对专用网络放行：

```powershell
New-NetFirewallRule `
  -DisplayName "MT5 Review Dashboard LAN" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Action Allow `
  -Profile Private `
  -RemoteAddress LocalSubnet
```

当前服务没有登录认证，只适合本机或可信局域网，不要配置路由器端口转发到公网。

## MT5 EA 配置

1. 复制并编辑 `config.local.json`；
2. 运行安装脚本：

```powershell
Set-Location .\mt5-review-system
.\tools\install_ea.ps1
```

3. 在 MetaEditor 中打开并编译 `mt5-ea/MT5ReviewBridge.mq5`；
4. 在 MT5 中刷新导航器，将 EA 挂载到长期打开的图表；
5. 在 MT5“工具 -> 选项 -> EA 交易”中允许 WebRequest：

```text
http://127.0.0.1:8787
```

如果 MT5 和服务不在同一台电脑，应改成服务电脑的局域网地址。EA 同时写入 JSONL 作为断线兜底。WebRequest 恢复后可运行：

```powershell
.\tools\import_from_mt5.ps1
```

导入器会增量读取 `MQL5\Files\MT5ReviewBridge\events_*.jsonl`，写入 SQLite，并补偿迟到的截图文件。

## 数据目录和隐私

```text
mt5-review-system/
├─ data/
│  ├─ journal.sqlite       # SQLite 主数据库
│  ├─ raw-events/          # MT5 原始 JSONL 事件
│  └─ screenshots/         # 订单截图
├─ backups/                # 数据库、事件和截图备份包
├─ config.local.json       # 本机路径配置
└─ config.local.example.json # 可公开模板
```

真实数据库、订单事件、截图、备份和本机配置均不会上传到 GitHub。`.gitignore` 已覆盖这些目录和常见的 `.sqlite`、`.db`、`.log`、`.ex5` 文件；不要使用 `git add -f` 强制添加它们。

## 使用 Codex、ChatGPT、Claude、Copilot 等 AI 工具

仓库根目录的 `AGENTS.md` 是项目级 AI 协作规则，Codex 会自动读取。其他工具可以把同样内容复制到自己的规则文件中，例如 Claude Code 的 `CLAUDE.md` 或 GitHub Copilot 的 `.github/copilot-instructions.md`。

推荐流程：

1. 让 AI 先读取 `README.md`、`AGENTS.md`、`docs/VERSION-ROUTE.md` 和相关测试；
2. 只分析源代码、测试和文档，不读取 `data/`、`backups/`、`config.local.json` 或真实截图；
3. 要求 AI 先说明根因、影响范围、修改文件和测试方案，再开始修改；
4. 完成后运行 Python 测试和前端静态测试；
5. 一个功能对应一个清晰的 Git 提交，方便审查和回滚。

可以直接使用以下提示词：

```text
请先阅读 README.md、AGENTS.md、docs/VERSION-ROUTE.md 和相关测试。
只分析源代码，不读取 data、backups、config.local.json 或真实截图。
先说明根因、影响范围、修改文件和验证方案，再实现最小范围修复。
完成后运行 server/tests 和 web/tests，并报告测试结果。
```

不要让 AI 上传真实订单、账户、截图或本机配置；不要让 AI 执行 `git push --force`、删除数据库或清理运行目录。涉及数据库、统计口径和图片生命周期的变更，必须增加测试并更新版本路线。

## 测试和开发验证

Python 测试需要从 `server` 目录运行：

```powershell
Set-Location .\mt5-review-system\server
python -m unittest discover -s tests -p "test_*.py"
```

前端测试需要 Node.js 20 或更高版本：

```powershell
Set-Location .\mt5-review-system
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
node --check web/app.js
node --check web/album.js
```

一键运行完整发布检查（Python、Node、语法、数据兼容、基准测试，可选浏览器）：

```powershell
Set-Location .\mt5-review-system
python .\tools\check_release.py             # 本地完整检查
python .\tools\check_release.py --skip-browser  # 不含浏览器
```

GitHub Actions 会在 `main` 推送和 Pull Request 时自动运行这些检查。

## 最近更新

### v0.6.0

- 前端拆分为四个独立工作区：分析仪表盘 `/dashboard/`、订单流水 `/orders/`、复盘画册 `/album/`、设置与系统 `/settings/`，共享统一左侧导航。
- 左侧导航提供统一的“刷新数据”操作，会先执行一次 JSONL 增量同步，再刷新当前页面。
- 后端重组为数据、领域分析、应用调度、表现四层，依赖只从外层指向内层。
- 每个页面只读取自身数据，仪表盘不再加载订单详情或完整 Campaign 列表，减少首屏等待。
- Campaign 重建从读取路径移到写入或显式修复路径，读取接口不再隐式写入数据库。
- 服务默认只监听 `127.0.0.1`，局域网访问需显式设置 `MT5_REVIEW_HOST`。
- 旧地址自动重定向到对应新页面，历史订单、截图、复盘、分类、自定义字段和统计口径保持不变。
- 自定义字段支持停用、恢复和永久删除；永久删除会清除该字段的历史填写内容，并要求二次确认。
- 新增 10,000 笔合成订单基准测试、数据兼容/回滚演练和一键发布检查 `tools/check_release.py`。
- Windows 桌面封装留待下一阶段，本次已完成程序目录与数据目录解耦等兼容边界。

### v0.6.1

- 左侧导航新增统一的“刷新数据”按钮，四个工作区均可使用。
- 刷新操作先执行 JSONL 增量同步，再刷新当前页面，避免新订单只在特定入口访问时更新。
- 同步失败显示错误提示，按钮在请求期间禁用，避免重复触发。
- 新增 `POST /api/sync` 接口及路由回归测试。
- 自定义字段支持停用、恢复和永久删除，补齐设置页说明与兼容文档。

### v0.5.0

- 新增 Deal、Position、Campaign 三层模型，自动合并同账户、同品种、同方向且持仓周期重叠的加仓交易；
- 每个 Position 独立记录初始计划止损，组合风险为所有 Position 风险之和，任一缺失时不显示部分估算 R；
- 新增 Scratch、双胜率、R 期望、SQN、R 数据覆盖率和 Campaign 版 Z 分数，Scratch 阈值可持久化调整；
- 订单流水、系统评估和模式评估共享可访问的指标说明，支持鼠标、键盘、Escape、点击外部和移动端操作；
- 订单流水支持 Scratch 灰显、表格内初始止损编辑、Campaign 汇总/展开和加权价格、持仓时间展示；
- EA 在保留旧平仓事件兼容性的同时同步全部 MT5 Deal；历史旧记录以 `legacy_estimated` 标记重建，不覆盖既有复盘、分类和截图引用。

### v0.5.1

- 订单流水仅为合并 Campaign 显示展开入口，展开后只展示对应的 Position 子订单；
- 移除全局表格最小宽度和内容裁切规则，桌面端使用紧凑列布局，390px 窄屏使用带字段标签的信息块；
- 初始止损直接在订单流水填写，缺失时显示“请输入初始止损”占位符并高亮，合并 Campaign 展开后可逐 Position 编辑。

### v0.5.2

- 读取订单流水前自动重建缺失的 Legacy Deal/Position 关系，避免 Campaign 有笔数但价格、持仓时间和 Position 摘要为空；
- R 状态不再重复显示“待补初始止损”，缺失时统一显示“R 缺失”，填写入口只保留输入框提示；
- 加宽桌面端初始止损输入框，确保占位提示和价格可读。

### v0.5.3

- Campaign 汇总行根据实际 Position 实时计算加权入场价、出场价、总手数和持仓时间；
- 合并 Campaign 展开后的 Position 子行补充该 Position 的盈亏，避免子订单关键结果显示为空。

### v0.5.4

- 订单流水移除复盘文本列，避免长文本挤压表格布局。
- 展开的 Position 子订单可独立选中，右侧显示对应来源订单的截图、复盘、自定义字段和成交详情。
- 子订单复盘保存直接写回对应来源订单，Campaign 汇总行继续只承担组合汇总展示。

### v0.5.5

- 指标卡和系统/模式评估不再展示 R 数据覆盖率；覆盖率仅保留为内部数据完整性检查。
- 指标名称改为直白中文：净胜率（剔除打平）、全样本胜率（有效盈利）、平均数学期望（ER）、收益稳定度（SQN）和交易组合数。
- 补充现金 PF、现金胜率和交易组合数的可读说明，明确计算方式与判断标准。

### v0.5.6

- 移除仪表盘顶部重复指标卡，避免与交易系统评估重复展示。
- 交易系统评估与交易模式评估改为上下排列，减少拥挤。
- 将总盈亏比、总胜率、交易笔数、有效胜率和打平占比等名称改为直白中文，并为指标结果增加好/一般/差/样本不足评价。

### v0.5.7

- 统一指标说明中的直白名称：总盈亏比、总胜率、交易笔数、有效胜率和打平占比，不再向用户展示现金 PF、现金胜率、Campaign 数和 Scratch 等术语。
- 在指标说明中直接列出好、一般、差和样本不足的判断标准；缺少数据时不再误标为“差”。
- 将交易结果连续性指标的 Z 分数说明改为普通用户可理解的名称。

### v0.5.8

- Z 分数改用与其他指标相同的说明弹层，不再单独占用评估区域。
- 交易系统评估摘要增加本年卡片和净盈亏比；按日统计增加总胜率、净盈亏比、净胜率和打平占比。

### v0.4.1

- 复盘内容按长度和换行数量自适应，短内容默认展开，长内容才折叠；
- 统一画册筛选栏与仪表盘的深色控件和页面配色；
- 仪表盘和画册增加统一顶部导航；
- 一键启动脚本支持局域网访问并自动显示手机访问地址；
- 增加 MIT 许可证、贡献规范、安全策略、AI 协作规则和 GitHub Actions。

### v0.4.2

- 长复盘默认展开，仍可手动收起，避免复盘内容进入画册后直接隐藏；
- 右侧信息栏利用截图旁的剩余高度展示复盘内容，超长文本仅在右栏内部滚动；
- 桌面端扩大右栏信息比例，移动端继续保持截图在上、信息在下的布局。

### v0.4.3

- 复盘内容统一使用右栏内的独立纵向滚动区域，避免长文本被卡片边界裁切；
- 滚动条在 Chromium 和 Firefox 下均保留清晰的轨道与滑块，操作按钮不再覆盖复盘文字；
- 增加长文本实际滚动、按钮避让和桌面/390px 无溢出的浏览器回归检查。

### v0.4.0

- 新增复盘画册页面；
- 按北京时间日期分隔交易截图；
- 支持品种、日期、交易类型、策略和选项标签筛选；
- 支持懒加载、大图预览和订单详情跳转。

### v0.3.1

- 截图支持上传、粘贴、拖拽替换和删除；
- 替换图片后自动清理不再引用的旧文件；
- 增加图片格式、大小和路径安全校验。

### v0.3.0

- 交易类型和交易策略改为可自定义配置；
- 自定义字段列宽调整为约 8 个汉字；
- 复盘编辑区扩大到支持 500 字以上；
- 移除备注字段。

### v0.2.x

- 增加收益累计曲线、系统评估、Z 分数、模式评估和日期筛选；
- 修复删除交易污染收益曲线、截图迟到导致缺图等问题；
- 完成桌面端和移动端布局优化。

完整版本路线见 [`docs/VERSION-ROUTE.md`](docs/VERSION-ROUTE.md)。

## 已知限制和后续方向

- 当前服务没有登录认证，不适合直接部署到公网；
- 当前模型主要围绕订单级复盘，部分平仓和多次成交模型将在后续版本处理；
- 账户筛选、导出、夏令时会话配置和备份校验计划在后续版本加入。

## 许可证

本项目使用 [MIT License](LICENSE)。

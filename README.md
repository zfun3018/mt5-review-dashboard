# MT5 复盘仪表盘

当前稳定开发版本为 `v0.4.1`，主项目位于 `mt5-review-system/`。

- 项目说明：`mt5-review-system/README.md`
- 版本路线：`docs/VERSION-ROUTE.md`
- v0.2.0 实施记录：`docs/plans/2026-08-18-mt5-review-v02.md`
- 需求与优化依据：`MT交易复盘系统.md`

在 Windows 下可直接运行 `一键启动MT5复盘仪表盘.bat`，或进入
`mt5-review-system/` 后运行 `start.ps1`。默认访问地址为
`http://127.0.0.1:8787`。

一键启动脚本默认同时监听可信局域网。电脑浏览器使用
`http://127.0.0.1:8787`，手机或其他局域网设备使用启动窗口显示的
`http://<电脑局域网IP>:8787`。如果 Windows 防火墙拦截，请仅在“专用网络”中放行 TCP 8787，
不要将端口转发到公网。

本地数据库、交易事件、截图、备份和机器配置不纳入版本控制。

## 项目能做什么

### 订单流水

- 分页查看订单、品种、方向、手数、开平仓时间、价格、持仓时长和盈亏。
- 支持软删除与恢复，已删除交易不会继续污染收益曲线和统计。
- 交易类型与交易策略支持新增、改名和停用，改名不会破坏历史统计。
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
- 按日交易系统评估、交易类型/策略模式评估和 Z 分数解释。
- 汇总回报、交易笔数、盈亏比、胜率、盈利/亏损金额和盈利/亏损笔数。

### 复盘画册

- 独立的“复盘画册”页面，以交易截图为主体。
- 按北京时间平仓日期分隔和排序，桌面端左图右信息，移动端图上信息下。
- 支持品种、起止日期、交易类型、交易策略和单选/多选选项标签筛选。
- 不提供多空筛选、文本字段筛选或全文搜索。
- 支持懒加载、大图预览、订单详情跳转；短复盘默认展开，长复盘才折叠。

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

启动窗口会显示电脑本机地址、局域网地址和当前监听地址。电脑浏览器访问：

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

一键启动脚本默认监听可信局域网。手机与电脑连接同一 Wi-Fi 后：

1. 在电脑上运行 `ipconfig`；
2. 找到 Wi-Fi 适配器的 IPv4 地址，例如 `192.168.10.73`；
3. 手机打开 `http://192.168.10.73:8787`。

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

GitHub Actions 会在 `main` 推送和 Pull Request 时自动运行这些检查。

## 最近更新

### v0.4.1

- 复盘内容按长度和换行数量自适应，短内容默认展开，长内容才折叠；
- 统一画册筛选栏与仪表盘的深色控件和页面配色；
- 仪表盘和画册增加统一顶部导航；
- 一键启动脚本支持局域网访问并自动显示手机访问地址；
- 增加 MIT 许可证、贡献规范、安全策略、AI 协作规则和 GitHub Actions。

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
- 账户筛选、导出、夏令时会话配置和备份校验计划在 `v0.5.0` 及以后加入。

## 许可证

本项目使用 [MIT License](LICENSE)。

# AI 部署指南

本指南用于让 AI 助手或自动化代理安全地部署、验证和发布 MT5 复盘仪表盘。项目是 local-first 应用：Python 标准库 HTTP 服务、SQLite 和原生 HTML/CSS/JavaScript 组成运行时，不需要云端数据库，也不应把真实账户数据交给 AI 或上传到公网。

## 1. 安全边界

以下路径只属于当前机器的运行数据，AI 不应读取、上传、暂存或提交：

```text
mt5-review-system/data/
mt5-review-system/backups/
mt5-review-system/config.local.json
mt5-review-system/data/raw-events/
mt5-review-system/data/screenshots/
```

这些目录可能包含账户号、订单号、终端 ID、本机路径、SQLite 数据库、原始 JSONL 和交易截图。AI 可以检查源代码、测试夹具和脱敏接口响应，但不能用真实数据库替代测试数据，也不能为了排查问题打印隐私字段。

服务没有登录认证。默认只监听 `127.0.0.1`，不要配置公网端口转发；需要手机访问时，只在可信局域网临时启用监听，并在使用后恢复本机监听。

## 2. 环境与启动

要求：Windows 10/11、Python 3.11+、PowerShell 5.1+。Node.js 20+ 仅用于前端测试；MT5 和 MetaEditor 只在需要实时同步时使用。

首次部署：

```powershell
Set-Location F:\文件\MT5复盘仪表盘
Copy-Item .\mt5-review-system\config.local.example.json .\mt5-review-system\config.local.json
notepad .\mt5-review-system\config.local.json
Set-Location .\mt5-review-system
.\start.ps1
```

浏览器打开 `http://127.0.0.1:8787`。如果默认端口被占用，可以仅对当前进程指定端口：

```powershell
$env:MT5_REVIEW_PORT = "8790"
.\start.ps1
```

不要把端口写入公开配置，也不要把 `config.local.json` 加入 Git。

## 3. AI 部署流程

### 3.1 检查仓库

AI 开始前先读取根目录 `README.md`、`AGENTS.md`、`docs/VERSION-ROUTE.md` 和相关测试，确认当前分支、版本和未提交改动。不要使用 `git reset --hard`、`git checkout` 或 `git clean` 覆盖用户改动。

```powershell
git status --short --branch
Get-Content .\VERSION
git diff --check
```

### 3.2 安装与验证

项目后端不需要安装 Python 第三方包。若需要浏览器门禁，先在 `mt5-review-system` 安装 Node 依赖；依赖目录和浏览器缓存不会提交。

```powershell
Set-Location .\mt5-review-system
python .\tools\check_release.py --skip-browser
python .\tools\check_release.py
```

完整门禁包含 Python、Node、语法、数据兼容性、基准和 Playwright 浏览器检查。浏览器检查应覆盖桌面宽度和 390px 移动宽度，并确认没有控制台错误或横向溢出。布局编辑器由 GridStack 管理模块拖拽和宽高，收益曲线与月度盈亏由 ECharts 绘制；修改这些功能时必须验证布局变化后图表重新计算尺寸，而不是被裁剪。

### 3.3 启动后的冒烟检查

1. 访问 `/dashboard/`，确认 MT5 和国内期货平台切换不会串数据。
2. 进入布局编辑器，拖动一个模块并调整宽高，刷新页面确认本地布局持久化。
3. 在订单复盘中检查全部/精选栏目、随机精选、打卡和取消打卡；确认打卡日历立即更新。
4. 检查累计收益、月度盈亏和盈亏日历的时间顺序、坐标轴和容器尺寸。
5. 在设置页确认导入、分类、自定义字段和系统状态可访问。

没有真实数据时，使用项目现有的合成测试数据和浏览器测试验证，不要创建或导入真实账户快照。

## 4. MT5 与国内期货配置

### MT5 EA

1. 编辑本地 `config.local.json`，填写 MT5 安装目录、终端数据目录和桥接目录。
2. 执行 `.\tools\install_ea.ps1`，在 MetaEditor 编译 `mt5-ea/MT5ReviewBridge.mq5`。
3. 在 MT5 的“工具 → 选项 → EA 交易”中允许 `http://127.0.0.1:8787` WebRequest。
4. EA 通过 WebRequest 推送事件，同时写入本地 JSONL；需要补偿时执行 `.\tools\import_from_mt5.ps1`。

### 国内期货

从页面的“设置 → 数据导入”选择标准 CSV 模板或同花顺 CSV/XLS。导入管线会解析、标准化、校验、稳定指纹去重和 FIFO 开平匹配；重复、异常和未配对行保留在批次报告中。原始文件只在本机处理，不提交到 Git。

交易组合是统计和复盘的统一单位。加减仓成交只在组合详情的成交流水中展示，仪表盘、订单列表和订单复盘不重复拆分统计；净盈亏统一包含交易盈亏、手续费、隔夜利息和其他费用。

## 5. 备份、恢复与回滚

发布前先停止服务，并使用设置页或项目备份工具生成备份。备份文件留在 `mt5-review-system/backups/`，只在本机保存。恢复前保留当前数据目录的副本，确认版本迁移说明后再恢复。

代码回滚使用新的修复提交或新的补丁版本，不移动已经推送的版本 tag，也不使用强制推送：

```powershell
git log --oneline -10
git show --stat <known-good-commit>
```

数据回滚和代码回滚是两件事：代码回退不会自动回退 SQLite。涉及迁移时必须先验证备份可读、记录恢复时间和版本，然后再启动服务并执行冒烟检查。

## 6. 发布检查清单

- [ ] `VERSION`、CHANGELOG、版本路线和 Release tag 一致；
- [ ] `python .\tools\check_release.py` 通过；
- [ ] `git diff --check` 通过；
- [ ] 暂存区不包含 `data/`、`backups/`、`config.local.json`、截图、JSONL、数据库、日志或生成二进制；
- [ ] 生产服务仍只监听本机或可信局域网；
- [ ] 桌面和 390px 浏览器冒烟检查通过；
- [ ] 只推送 `main` 和与 `VERSION` 一致的 annotated tag，不使用 force-push。

发布完成后记录提交号、tag、门禁结果和已知限制。发现统计口径、迁移或数据安全问题时，立即停止继续导入，保留备份，并用新的补丁版本修复。

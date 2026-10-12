# MT5 本地复盘系统

这是项目的运行与开发目录，提供本地 Python HTTP 服务、原生网页、SQLite 数据库适配、MT5 EA 桥接和测试工具。

首次了解项目请先看 [根目录 README](../README.md) 和 [项目技术说明](../docs/PROJECT-GUIDE.md)。版本规则见 [版本路线](../docs/VERSION-ROUTE.md)，已发布内容见 [CHANGELOG](../CHANGELOG.md)，正式版本操作见 [发布指南](../docs/RELEASE-GUIDE.md)。

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

3. 在 MetaEditor 中打开并编译 `mt5-ea/MT5ReviewBridge.mq5`；
4. 在 MT5 中刷新导航器，把 EA 挂载到长期打开的图表；
5. 在“工具 → 选项 → EA 交易”中允许 WebRequest：

```text
http://127.0.0.1:8787
```

如果服务运行在另一台电脑，改用那台电脑的可信局域网地址。EA 同时写入本地 JSONL，作为 WebRequest 失败时的兜底。

如果实时 WebRequest 没有成功，可以增量回灌：

```powershell
.\tools\import_from_mt5.ps1
```

导入器读取桥接目录中的 `events_*.jsonl`，写入 SQLite，并补偿迟到的截图文件。

## 四个工作区

| 工作区 | 地址 | 主要用途 |
| --- | --- | --- |
| 分析仪表盘 | `/dashboard/` | 指标、收益曲线、月历、热力图和评估 |
| 订单流水 | `/orders/` | Campaign/Position、复盘、分类、自定义字段和截图 |
| 复盘画册 | `/album/` | 截图筛选、归档、随机阅读和每日打卡 |
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

## 常用接口

- `GET /api/analysis?equity_days=30`：日期范围分析、收益曲线和评估；
- `POST /api/sync`：执行一次 JSONL 增量同步；
- `GET /api/review-album`：读取画册和标签；
- `GET /api/review-album/random`：随机读取一笔未归档交易；
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

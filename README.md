# MT5 复盘仪表盘

一个 local-first 的 MT5 交易复盘工具：交易事件和截图留在本机，订单、统计和复盘内容通过本地网页统一查看。

当前版本：`v0.6.22`，版本号以根目录 `VERSION` 为准。正式版本通过 [GitHub Releases](https://github.com/zfun3018/mt5-review-dashboard/releases) 发布。

## 项目适合谁

- 希望在自己的电脑上持续复盘 MT5 交易的人；
- 希望把订单、截图、复盘文字和收益统计放在一起的人；
- 不希望把账户数据上传到云端的人。

项目使用 Python 标准库 HTTP 服务、SQLite 和原生 HTML/CSS/JavaScript，不需要安装 Python 第三方包，也不需要前端构建工具。

## 核心能力

- 订单流水：按 Deal、Position、Campaign 组织交易，支持部分平仓、加仓组合、初始止损和 R 倍数；
- 分析仪表盘：周期指标、收益累计曲线、月度盈亏日历、时段热力图、系统评估和模式评估；
- 复盘画册：按北京时间浏览交易截图，支持标签筛选、归档、随机阅读和每日打卡；
- 交易管理：交易场景、交易策略、自定义字段、订单复盘、截图上传替换和软删除恢复；
- MT5 桥接：通过 EA 的 WebRequest 或本地 JSONL 增量同步交易数据。

## 最快启动

环境要求：

- Windows 10/11；
- Python 3.11 或更高版本；
- PowerShell 5.1 或更高版本；
- 使用 MT5 同步时需要 MetaTrader 5 和 MetaEditor。

首次使用时，复制并编辑本地配置：

```powershell
Copy-Item .\mt5-review-system\config.local.example.json .\mt5-review-system\config.local.json
```

然后在项目根目录双击：

```text
一键启动MT5复盘仪表盘.bat
```

或在 PowerShell 中启动本机服务：

```powershell
Set-Location .\mt5-review-system
.\start.ps1
```

浏览器访问：

```text
http://127.0.0.1:8787
```

完整的 MT5 EA 配置、手机访问、JSONL 回灌、数据迁移和接口说明见 [运行与开发说明](mt5-review-system/README.md)。

## 安全边界

服务没有登录认证，只适合本机或可信局域网。不要把端口转发到公网；需要手机访问时，也只在可信 Wi-Fi 中显式开启局域网监听。

以下内容是本机私有数据，绝不能提交到 GitHub：

- `mt5-review-system/data/`：数据库、原始 MT5 JSONL 和截图；
- `mt5-review-system/backups/`：本地备份包；
- `mt5-review-system/config.local.json`：本机路径和终端配置；
- 账户号、订单号、终端 ID、本机路径以及真实截图。

## 文档地图

- [项目技术说明](docs/PROJECT-GUIDE.md)：系统组成、数据流、架构边界和隐私规则；
- [运行与开发说明](mt5-review-system/README.md)：启动、EA 配置、回灌、接口和测试；
- [版本路线](docs/VERSION-ROUTE.md)：版本规则、当前状态和未来开发计划；
- [变更记录](CHANGELOG.md)：已交付版本的历史内容；
- [发布指南](docs/RELEASE-GUIDE.md)：如何准备版本并创建 GitHub Release；
- [贡献规范](CONTRIBUTING.md)、[安全策略](SECURITY.md) 和 [AI 协作规则](AGENTS.md)；
- [架构决策](docs/adr/) 与 [设计/实施档案](docs/superpowers/)。

## 开发验证

Python 测试：

```powershell
Set-Location .\mt5-review-system\server
python -m unittest discover -s tests -p "test_*.py"
```

前端静态测试：

```powershell
Set-Location .\mt5-review-system
node --test web/tests/custom-fields-ui.test.js web/tests/review-album-ui.test.js
node --check web/shared/js/shell.mjs
node --check web/dashboard/dashboard.mjs
node --check web/orders/orders.mjs
node --check web/album/album.mjs
node --check web/settings/settings.mjs
```

完整发布检查：

```powershell
Set-Location .\mt5-review-system
python .\tools\check_release.py
```

提交功能或修复时，请同时补充对应测试；准备正式版本时，按照 [发布指南](docs/RELEASE-GUIDE.md) 更新版本和变更记录，再创建版本 tag。

## 许可证

本项目使用 [MIT License](LICENSE)。

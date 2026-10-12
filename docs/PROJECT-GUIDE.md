# 项目说明

MT5 复盘仪表盘是一个 local-first 的本地交易复盘工具。它从 MetaTrader 5 接收成交事件和交易截图，在本机 SQLite 中保存数据，再通过原生网页提供订单复盘、统计分析和截图阅读能力。

项目代码公开，但交易数据库、原始事件、截图、备份和本机配置只应保留在当前电脑，不上传到 GitHub，也不提交到 Git。

## 给谁使用

- 想在自己的电脑上持续记录和复盘 MT5 交易的人；
- 希望按订单、交易组合、截图和复盘文字回看交易过程的人；
- 需要看到收益、胜率、R 倍数和交易模式统计，但不希望把账户数据上传到云端的人。

## 系统组成

```text
MT5 EA
  |  WebRequest 或本地 JSONL
  v
Python 标准库 HTTP 服务
  |
  +--> SQLite 交易与配置数据
  +--> 本地截图和原始事件
  v
原生 HTML / CSS / JavaScript 工作区
```

项目不依赖 Python 第三方运行库，不需要前端构建工具；Node.js 只用于开发测试。SQLite 是唯一的业务数据库，服务默认只监听本机地址。

## 四个工作区

| 工作区 | 入口 | 负责内容 |
| --- | --- | --- |
| 订单流水 | `/orders/` | Campaign、Position、成交明细、复盘、分类、自定义字段和截图 |
| 分析仪表盘 | `/dashboard/` | 周期指标、收益曲线、月历、热力图、系统评估和模式评估 |
| 复盘画册 | `/album/` | 按北京时间交易日浏览截图、筛选标签、归档和随机阅读 |
| 设置与系统 | `/settings/` | 分类、自定义字段、分析设置、系统状态和本地备份 |

### 订单层级

- `Deal`：MT5 产生的一次实际成交。
- `Position`：对冲账户中的一个独立持仓，可以包含多次开仓或部分平仓。
- `Campaign`：订单流水和系统评估使用的复盘单位。同账户、同品种、同方向且生命周期重叠的 Position 会组成一个交易组合。

订单流水默认以 Campaign 为一行，展开后查看 Position 和 Deal。现金收益按照真实平仓成交统计；R、SQN、Z 分数和模式评估按照 Campaign 统计。

## 后端边界

后端按四层组织，依赖从外层指向内层：

1. `server/app/domain/`：Campaign、R 倍数和统计公式，尽量保持为纯计算；
2. `server/app/data/`：SQLite、迁移、仓储、写入命令、MT5 导入、截图和备份文件；
3. `server/app/application/`：仪表盘、订单、画册和设置等完整用例；
4. `server/app/presentation/`：HTTP 路由、响应格式和兼容序列化。

读取流程是“HTTP 路由 → 应用服务 → 仓储 → SQLite”。读取页面不会隐式重建模型或写入数据库；模型重建在写入或显式维护路径中完成。

## 前端边界

每个工作区拥有独立入口和状态模块，共享模块位于 `mt5-review-system/web/shared/`：

- `css/` 保存设计令牌、基础样式、外壳和通用组件；
- `js/api.mjs` 负责请求；
- `js/shell.mjs` 负责导航和页面外壳；
- `js/formatters.mjs`、`feedback.mjs`、`url-state.mjs` 提供共享的格式化、反馈和 URL 状态能力。

新增页面或功能时，应先判断它属于哪个工作区，再沿用该工作区的 API 和状态边界，不恢复成一个全局脚本。

## 数据和隐私边界

以下内容是本机运行数据，不属于公开项目内容：

```text
mt5-review-system/data/
mt5-review-system/backups/
mt5-review-system/config.local.json
```

其中可能包含 SQLite 数据库、原始 MT5 JSONL 事件、交易截图、备份包、账户号、订单号、终端 ID 和本机路径。不要读取、上传、暂存或提交这些内容；不要用 `git add -f` 强制添加。

服务没有登录认证，只适合本机或可信局域网。不要将端口转发到公网，也不要把真实账户数据放进测试夹具、截图或公开 issue。

## 文档地图

- [根目录 README](../README.md)：首次了解项目、快速启动和安全提示；
- [运行与开发说明](../mt5-review-system/README.md)：启动服务、配置 EA、回灌 JSONL、接口和测试；
- [版本路线](VERSION-ROUTE.md)：版本规则、当前状态和未来计划；
- [变更记录](../CHANGELOG.md)：已经交付的版本内容；
- [发布指南](RELEASE-GUIDE.md)：如何准备版本并创建 GitHub Release；
- [ADR](adr/)：重要架构决策；
- [功能设计档案](superpowers/specs/) 与 [实施计划档案](superpowers/plans/)：已确认的功能设计和执行记录。

## 代码变更原则

- 保持 Python 标准库、SQLite 和原生前端架构，除非变更有明确且经过验证的收益；
- 数据模型、迁移、统计口径和图片生命周期变更必须补测试并更新版本路线；
- UI 修改需要检查桌面端和 390px 移动端，不应出现横向溢出；
- 正式版本必须先通过发布检查，再使用与 `VERSION` 一致的 `vX.Y.Z` tag 发布 GitHub Release。


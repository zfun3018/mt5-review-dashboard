# B 计划：下一代交易复盘工作台设计方案

## 文档状态

- 状态：方向确认，等待分阶段立项；
- 日期：2026-10-22；
- 目标平台：浏览器优先，Windows/macOS 桌面封装后置；
- 当前稳定路线：现有 v1.x 继续作为 A 计划维护；
- 关联决策：模块化单体、SQLite 单一事实来源、原生多页面现状；
- 本文不是版本承诺，任何阶段只有通过验收门禁后才进入正式版本。

## 1. 背景与目标

当前系统已经完成 MT5 与国内期货工作区、Campaign/Position/Deal 数据模型、分析仪表盘、订单复盘、复盘画册和设置页。现有实现适合作为稳定可用的 A 计划，但继续增加动态行情、PA 画线、专业数据表格、可插拔指标模块、AI Skills 和桌面封装后，前端表现层与本地 API 的长期扩展成本会明显上升。

B 计划不是在 KLineChart、ECharts 或某个后台模板上重建业务系统，而是在当前项目的数据与业务基础上形成下一代交易复盘工作台：

1. 保持 SQLite 是业务数据的唯一事实来源；
2. 保持 Campaign 是用户侧唯一订单实体；
3. 使用 KLineChart 负责行情浏览、成交标记和 PA 画线；
4. 使用 ECharts 负责账户、策略、风险与复盘质量分析；
5. 使用专业数据表格组件承载密集数据浏览与审计；
6. 建立可独立开发、注册、添加、删除、配置和调整布局的仪表盘模块体系；
7. 建立稳定的本地 API 和受控 AI Skills；
8. 先保留浏览器运行方式，同时预留 Windows/macOS 桌面宿主边界。

## 2. 非目标

B 计划第一阶段明确不做以下事情：

- 不 fork KLineChart 或把复盘业务写入图表库；
- 不把本地单用户工具拆成微服务；
- 不为桌面化重写 C#、Swift 或 Qt 原生客户端；
- 不把当前截图一次性删除，截图继续作为历史资料和行情不可用时的降级方案；
- 不允许仪表盘模块在浏览器重新计算交易事实；
- 不开放未经认证的公网服务；
- 不开放任意第三方插件执行本机代码；
- 不为了使用新技术而立即替换稳定的 A 计划页面。

## 3. 双路线策略

### 3.1 A 计划

A 计划继续维护当前 v1.x：

- 修复数据兼容、导入、统计和现有复盘流程问题；
- 保持现有页面、API 和数据库兼容；
- 不受 B 计划行情源、图表和前端工程化实验影响；
- 继续使用现有截图和浏览器启动方式；
- 通过正式 Release 交付稳定版本。

### 3.2 B 计划

B 计划通过新路由、功能开关或独立前端入口逐步交付。每一阶段都必须能够关闭和回退，不直接覆盖 A 计划。B 计划成熟后，按工作区逐项替换默认入口，而不是一次性切换整个产品。

## 4. 总体架构

```text
浏览器工作台 / 未来桌面宿主 / AI Skills
                    |
              本地 API v1
                    |
   +----------------+----------------+
   |                |                |
交易复盘域        行情数据域        展示配置域
Campaign/Deal     MarketBar         DashboardLayout
Position          Provider          ModuleInstance
Review            DataQuality       ChartAnnotation
   |                |                |
   +----------------+----------------+
                    |
              SQLite 单一来源
                    |
   +----------------+----------------+
   |                |                |
MT5 Provider    国内期货 Provider   未来 A 股 Provider

前端表现层
   + ECharts 分析模块
   + KLineChart 行情工作区
   + Tabulator 专业数据视图
   + GridStack 仪表盘布局
```

部署仍然保持一个本地服务和一个 SQLite 数据库。模块边界通过应用服务、API 契约、导入规则和架构测试维持，不引入分布式一致性问题。

## 5. 数据所有权与重建规则

| 数据或概念 | 实体所有者 | 数据来源 | 持久化与重建 | 平台范围 | 测试路径 |
| --- | --- | --- | --- | --- | --- |
| 用户侧订单 | `Campaign` | MT5/导入成交归并 | SQLite 事实记录 | 平台隔离 | 订单写入后由订单、画册、仪表盘和 API 读取 |
| 成交与持仓 | `Deal` / `Position` | MT5 或导入适配器 | SQLite 事实记录 | 平台隔离 | 成交流水、订单详情、行情标记一致 |
| OHLCV | `MarketBar` | 行情 Provider | SQLite 缓存，按唯一键幂等补拉 | Provider + 平台 + 品种 + 周期 | Provider 合成数据、缓存命中、缺口与覆盖更新 |
| 成交图表标记 | Deal 派生视图 | Campaign 关联的 Deal | 不重复保存，加载时重建 | 跟随 Campaign 平台 | Deal 写入后读取图表标记 API |
| 用户画线 | `ChartAnnotation` | 用户操作 | SQLite 持久化；以时间戳和价格保存 | 平台 + 品种 + 周期，可选 Campaign | 保存、重载、周期切换、删除与跨页面读取 |
| 模块定义 | `DashboardModuleDefinition` | 受信任代码注册表 | 随应用版本发布，不作为业务数据 | 声明支持的平台能力 | 注册表契约测试 |
| 模块实例 | `DashboardModuleInstance` | 用户添加和配置 | SQLite 用户偏好 | 工作区和平台隔离 | 添加、修改、删除、重载 |
| 仪表盘布局 | `DashboardLayout` | 用户拖拽与缩放 | SQLite 用户偏好；可由默认模板重建 | 工作区和平台隔离 | 保存、重载、版本迁移、恢复默认 |
| 模块结果 | `DashboardModuleResult` | 服务端指标引擎 | 默认不持久化；请求时计算或受控缓存 | 显式平台与分析范围 | 指标规范、合成数据、API 和渲染状态测试 |
| 导出图像 | Campaign 媒体附件 | 图表显式导出 | 文件附件，不是行情或画线来源 | 跟随 Campaign | 导出、关联和删除生命周期 |

行情唯一键建议使用：

```text
provider + platform + canonical_symbol + timeframe + open_time_utc
```

画线坐标必须保存为 `timestamp + price`，不能保存为 K 线数组索引。

## 6. 前端技术与视觉方向

### 6.1 已确认的视觉方向

B 计划采用深色专业交易工作台：

- 中性石墨色背景，不使用大面积深蓝或紫色渐变；
- 内容通过边框、间距和明暗层级分区，减少阴影和悬浮卡片；
- 面板圆角以 4 至 6px 为主，弹窗不超过 8px；
- 桌面控件高度以 32 至 36px 为主，数据表行高以 38 至 42px 为主；
- 价格、金额、数量和 R 倍数使用等宽数字并右对齐；
- K 线、订单和复盘内容处于视觉中心；
- 说明性文字进入 Tooltip、指标说明或帮助面板；
- 加载、空数据、数据不足、行情缺口、断线、错误和只读状态使用统一模式；
- 键盘焦点、选中订单和图表联动状态清楚可见；
- 深色为默认主题，未来浅色主题由同一套语义令牌派生。

盈亏颜色在数据模型中只能表达 `positive`、`negative`、`neutral` 和 `warning` 等语义，不写死为红或绿。表现层预留颜色习惯设置，可按工作区给出默认值，同时允许用户统一覆盖。

### 6.2 前端工程化决策门禁

React + TypeScript + Vite 是 B 计划的推荐候选，但在原型验证前不直接宣布替换现有原生 ES Modules。B0 阶段必须用同一个仪表盘模块和订单工作区完成两种实现的维护成本比较：

| 选项 | 优点 | 代价 |
| --- | --- | --- |
| 原生 ES Modules + 模块 SDK | 迁移风险低，与当前部署一致 | 复杂组件生命周期、类型契约和状态组织需要继续自建 |
| React + TypeScript + Vite | 适合模块化 UI、桌面宿主和长期组件维护 | 引入构建、依赖更新和新测试体系 |

选择标准不是流行度，而是能否明显降低模块开发、类型错误、组件销毁和跨页面复用成本。

## 7. 仪表盘模块体系

### 7.1 ECharts 的职责边界

ECharts 可以提供折线、柱状、散点、热力、箱线、桑基、雷达、K 线、关系图、自定义 Series、多坐标系、缩放、刷选、标线和图表联动，但它不是仪表盘模块管理器。

ECharts 不负责：

- 模块注册和发现；
- 模块添加、删除和复制；
- 多个模块之间的拖拽与缩放；
- 布局持久化与版本迁移；
- 模块权限与平台能力；
- 模块数据请求协调；
- 模块加载、错误和数据不足状态；
- 每个模块的配置表单；
- 模块销毁后的资源清理。

因此不能把整个仪表盘做成一个巨大的 ECharts 实例。正确结构是每个图表模块内部拥有自己的 ECharts 实例，外层由模块系统和布局引擎管理。

### 7.2 推荐的三层结构

```text
Dashboard Workspace
├── Module Registry
│   ├── 模块定义、版本、平台能力、默认尺寸
│   ├── 设置 Schema、数据依赖、指标规范
│   └── 创建渲染实例
├── Layout Engine
│   ├── 添加、删除、拖拽、缩放、可见性
│   ├── 桌面布局与移动端顺序
│   └── 序列化与恢复
└── Data Coordinator
    ├── 合并当前模块的数据需求
    ├── 统一分析范围、平台和时区
    ├── 取消过期请求、缓存同源结果
    └── 向模块分发规范 ModuleResult
```

ECharts 位于具体模块渲染器内部，GridStack 或替代布局引擎只管理模块容器。

### 7.3 当前实现不满意的根因

当前项目已经使用 GridStack，但模块仍然是预先写入页面的 HTML，模块定义由两个静态数组维护，布局保存在 `localStorage`，布局编辑器位于独立 mock 页面。当前规范化逻辑还会丢弃注册表之外的模块，并且每种模块只能有一个固定实例。

这使得当前实现能够调整已有面板的位置和标题，但还不是完整的模块平台：

- 新模块需要同时修改 HTML、定义数组、渲染控制器、样式和测试；
- 模块不能通过统一工厂独立挂载和销毁；
- 模块无法复用同一种定义并配置不同筛选条件；
- 模块直接依赖页面级数据和 DOM；
- 布局偏好不能由 API、AI 或未来桌面客户端管理；
- 独立 mock 编辑器与真实仪表盘存在漂移风险；
- 平台差异逐渐进入布局和页面分支。

问题主要不在 GridStack，更不在 ECharts，而在缺少模块注册、实例模型、生命周期和数据协调层。

### 7.4 布局引擎选择

第一选择是继续评估 GridStack：

- 当前已经引入，迁移成本最低；
- 支持动态添加、删除、拖拽、缩放、保存和恢复；
- 与原生 JavaScript、React 和桌面 WebView 都能组合；
- 布局引擎可以保持无业务状态。

只有在 B0 原型证明 GridStack 无法稳定处理 React 生命周期、移动端排序或所需交互时，才比较 React Grid Layout。Golden Layout 更适合可停靠窗口和多标签交易终端，不适合普通指标卡片网格，可在未来多图表工作区单独评估。

### 7.5 模块定义契约

概念接口如下：

```ts
interface DashboardModuleDefinition {
  type: string;
  version: number;
  title: string;
  category: "performance" | "risk" | "behavior" | "quality" | "market";
  supportedPlatforms: string[];
  requiredCapabilities: string[];
  defaultSize: { w: number; h: number };
  sizeLimits: { minW: number; minH: number; maxW: number; maxH: number };
  settingsSchema: object;
  dataContract: string;
  metricSpecIds: string[];
  createRenderer(context: ModuleContext): DashboardModuleRenderer;
}

interface DashboardModuleRenderer {
  mount(container: HTMLElement): void;
  update(result: DashboardModuleResult): void;
  resize(size: { width: number; height: number }): void;
  setTheme(theme: ThemeTokens): void;
  dispose(): void;
}
```

如果最终选择 React，`createRenderer` 可以由统一 React Host 实现，具体模块只导出组件和元数据；如果保留原生 ES Modules，则严格执行上述生命周期。

### 7.6 模块目录建议

```text
web-next/dashboard/modules/
├── equity-curve/
│   ├── manifest.ts
│   ├── view.tsx
│   ├── chart-options.ts
│   ├── states.tsx
│   └── equity-curve.test.tsx
├── drawdown/
├── monthly-pnl/
├── trade-calendar/
├── session-heatmap/
├── strategy-contribution/
├── risk-distribution/
└── review-coverage/
```

每个模块必须能单独开发和验证，不允许直接读取全局页面状态、SQLite 或其他模块 DOM。

### 7.7 模块实例和布局格式

一个定义可以产生多个实例，例如两个“累计收益”模块分别展示不同账户或时间范围：

```json
{
  "layout_id": "dashboard:mt5:default",
  "schema_version": 1,
  "platform": "mt5",
  "revision": 12,
  "instances": [
    {
      "instance_id": "mod_01",
      "module_type": "equity_curve",
      "module_version": 1,
      "title_override": null,
      "visible": true,
      "layout": {"x": 0, "y": 0, "w": 8, "h": 7},
      "mobile_order": 1,
      "settings": {"range_mode": "workspace", "account_ids": []}
    }
  ]
}
```

删除模块只删除实例，不删除指标定义或业务数据。模块版本升级必须提供设置迁移或回退到默认设置。

### 7.8 数据请求和一致性

模块不能各自无序请求后端。Dashboard Data Coordinator 收集当前可见实例的需求，通过一个批量请求获取结果：

```text
POST /api/v1/dashboard/query
```

请求携带平台、账户、日期范围、时区、模块实例及设置。响应以 `instance_id` 返回：

```json
{
  "analysis_context": {
    "platform": "mt5",
    "timezone": "Asia/Shanghai",
    "from": null,
    "to": null
  },
  "results": {
    "mod_01": {
      "status": "value",
      "definition_version": 1,
      "sample_size": 42,
      "quality": "complete",
      "data": {}
    }
  }
}
```

每个指标模块仍需声明统计单位、事实时间字段、时区、定义版本、样本质量和钻取过滤器。服务端负责计算，前端只渲染明确状态。

### 7.9 模块增删改与编辑体验

真实仪表盘直接进入编辑模式，不再跳转到独立 mock 页面：

- “添加模块”打开模块目录，可按性能、风险、行为、质量和市场分类；
- 添加后创建新的 `ModuleInstance`；
- 模块菜单支持设置、复制、隐藏、恢复默认尺寸和删除；
- 编辑模式显示网格、拖拽手柄和尺寸边界；
- 保存使用布局 `revision` 做并发检查；
- 取消编辑恢复进入编辑前的快照；
- 移动端不允许自由拖拽，只编辑显示顺序和可见性；
- 删除、重置和导入布局需要明确确认；
- 任何未知或不兼容模块显示占位错误，不得让整个仪表盘空白。

## 8. 行情图表体系

KLineChart 作为固定版本、本地打包的行情渲染依赖，由内部 `MarketChartAdapter` 隔离：

```text
setBars(bars)
setExecutions(executions)
loadAnnotations(annotations)
setTimeframe(timeframe)
setTheme(theme)
onAnnotationChanged(handler)
exportImage()
dispose()
```

KLineChart 不接触 Campaign、SQLite 或 Provider。成交标记由 Deal 派生，画线通过 ChartAnnotation API 保存。PA 第一阶段支持水平线、趋势线、射线、矩形区间、平行通道和文字标注；斐波那契、风险回报工具和复杂形态工具按实际需求追加。

截图在动态行情稳定前保持默认兜底。行情缺失、Provider 不可用或品种映射失败时，订单详情仍能展示原截图和复盘内容。

## 9. 行情 Provider 策略

统一 Provider 契约输出标准 OHLCV，不让前端识别供应商差异：

```text
MT5 CopyRates Provider
国内期货 TqSdk Provider
国内期货免费源降级 Provider
未来 A 股 Provider
```

免费数据只能作为入口和降级方案。Provider 必须返回来源、更新时间、覆盖范围、缺口和质量状态。底层代码开源不等于行情数据拥有稳定授权，正式发布前必须核实供应商条款。

## 10. Tabulator 专业数据视图

Tabulator 进入 B 计划，定位为 `Professional Data Grid`：

- 不直接替换当前复盘视图；
- 为订单提供密集数据浏览、列配置、远程筛选、排序和审计；
- 用于国内期货导入预览、异常行、重复记录和成交流水；
- 所有修改继续调用现有应用 API；
- Tabulator 只能持久化列宽、列顺序等 UI 偏好；
- 完整导出必须由服务端生成并进行隐私字段过滤。

是否进入正式依赖取决于一万条合成 Campaign、390px 布局、自定义编辑器、键盘操作和远程分页原型的验收结果。

## 11. 本地 API v1

建议逐步建立以下稳定接口：

```text
GET    /api/v1/system/capabilities
GET    /api/v1/system/health

GET    /api/v1/market-data/providers
GET    /api/v1/market-data/bars

GET    /api/v1/campaigns/{id}/executions
GET    /api/v1/campaigns/{id}/chart-annotations
POST   /api/v1/campaigns/{id}/chart-annotations
PUT    /api/v1/chart-annotations/{id}
DELETE /api/v1/chart-annotations/{id}

GET    /api/v1/dashboard/modules
GET    /api/v1/dashboard/layouts/{workspace}
PUT    /api/v1/dashboard/layouts/{workspace}
POST   /api/v1/dashboard/query
```

接口统一使用稳定 ID、毫秒 UTC 时间戳、规范品种标识、错误码、Schema 版本和数据质量状态。API 是本地应用内部契约，不等于开放公网服务。

## 12. AI Skills 与治理

AI 通过受控 API 和项目工具管理工作，不直接修改数据库或扫描私人数据目录：

| Skill | 作用 | 默认权限 |
| --- | --- | --- |
| `project-status` | 查看版本、路线、测试和能力 | 只读 |
| `trade-review` | 查询 Campaign 和复盘上下文 | 只读 |
| `market-data-diagnose` | 检查行情缺口、时区和品种映射 | 只读 |
| `provider-health` | 检查行情源与降级状态 | 只读 |
| `dashboard-layout` | 查询或生成布局变更建议 | 默认只读，应用变更需确认 |
| `chart-annotation` | 创建或修改指定画线 | 写操作，需明确目标 |
| `market-data-backfill` | 补拉历史行情 | 写操作，需预览与确认 |
| `release-check` | 执行测试和发布门禁 | 受控执行 |

所有写操作必须支持参数校验、dry-run、操作日志和明确授权。删除、批量回填、迁移和发布不能由 AI 静默执行。

## 13. 浏览器优先与桌面后手

### 13.1 当前决策

B 计划首先以浏览器方式运行：

```text
Python 本地服务 + SQLite + Web 前端
http://127.0.0.1:<port>
```

桌面化不进入第一阶段关键路径。业务域、API、前端和桌面宿主保持分离，未来通过 Tauri 2 或其他宿主包装同一套 Web 工作台。

### 13.2 现在必须预留的桌面边界

- 程序目录、数据目录、缓存目录和日志目录分离；
- 核心代码不写死 Windows 路径、PowerShell 或 `.bat`；
- 文件选择、打开目录、剪贴板和通知通过 Host Bridge 抽象；
- 浏览器模式提供纯 Web 降级实现；
- 本地服务只监听回环地址；
- 桌面宿主启动后端时使用随机端口和每次启动令牌，或使用受控 IPC；
- SQLite 迁移、备份和恢复不依赖宿主；
- Windows 与 macOS 分别构建、签名和验证；
- MT5 桥接按平台能力声明，不承诺 macOS 与 Windows 完全等价。

### 13.3 桌面技术选择门禁

正式桌面阶段再比较：

| 候选 | 适用性 |
| --- | --- |
| Tauri 2 | 正式产品首选候选，体积较小，但需要 Rust 与 Python sidecar 打包 |
| PyWebView | 内部原型成本较低，但跨平台 WebView 和更新体系需要验证 |
| Electron | 浏览器行为一致，生态成熟，但体积和资源占用较高 |

桌面技术选择必须在 Windows 安装、macOS 签名公证、自动更新、数据库备份和 Python sidecar 验证后作出。

## 14. 非功能需求

### 14.1 隐私与安全

- 默认离线和 local-first；
- 不上传账户、订单、截图、路径和终端标识；
- 未认证服务不得暴露公网；
- 第三方库固定版本并本地打包；
- 保存许可证、来源、版本和升级记录；
- AI 和导出默认排除敏感字段。

### 14.2 性能目标

- 常用页面本地首屏目标不超过 2 秒；
- 仪表盘不得因单个模块失败阻塞其他模块；
- 可见 ECharts 模块在容器变化后节流 resize；
- K 线初始加载目标支持 10,000 根以内流畅交互；
- Tabulator 原型使用至少 10,000 条合成 Campaign 验证；
- 服务端分页、筛选和聚合优先，不把完整数据库载入浏览器。

### 14.3 可用性与恢复

- A 计划始终可作为回退入口；
- 数据库迁移前自动备份并验证；
- 新布局 Schema 能恢复默认模板；
- 未知模块、失效 Provider 和损坏偏好不能导致页面整体不可用；
- 每个模块必须有 loading、empty、insufficient、warning、error 和 value 状态。

### 14.4 可访问性

- 键盘可到达所有主要操作；
- 焦点状态不可只依赖颜色；
- 文本和关键图形达到 WCAG AA 对比度目标；
- 图表提供摘要和可访问名称；
- 遵守减少动画偏好；
- 桌面与 390px 布局不产生不可控横向溢出。

## 15. 失败模式与降级

| 失败 | 影响 | 降级与恢复 |
| --- | --- | --- |
| 行情 Provider 不可用 | 无法加载动态 K 线 | 展示缓存、质量提示和历史截图 |
| KLineChart 初始化失败 | 订单行情区域不可用 | 保留订单详情和截图，记录局部错误 |
| 单个指标计算失败 | 一个模块不可用 | 模块显示错误状态，其他模块继续 |
| 布局 JSON 损坏 | 仪表盘位置异常 | 恢复默认布局并保留损坏快照供诊断 |
| 模块版本不兼容 | 模块无法载入 | 显示兼容占位，允许删除或重置 |
| AI 工具调用失败 | 自动化任务中止 | 不修改业务数据，返回可重试错误 |
| 桌面宿主启动失败 | 桌面入口不可用 | 继续支持浏览器启动方式 |

## 16. 测试策略

### 16.1 模块测试

每个仪表盘模块必须具备：

- 指标规范和人工可核对合成数据；
- 服务端计算测试；
- API 契约测试；
- value、empty、insufficient、warning、error 渲染测试；
- ResizeObserver 或布局尺寸变化测试；
- renderer `dispose` 资源释放测试；
- 钻取条件与订单 API 一致性测试。

### 16.2 跨视图测试

共享业务字段继续执行跨视图测试：从拥有者流程写入后，由订单、画册、仪表盘和相关 API 读取相同值与稳定 ID。布局偏好和画线分别测试其拥有 API，不建立页面私有副本。

### 16.3 浏览器与桌面准备测试

- Chromium 桌面宽度；
- 390px 移动宽度；
- Windows Edge/WebView2；
- macOS Safari/WKWebView 在桌面阶段加入；
- 无控制台错误、无非预期横向溢出；
- 图表像素非空、容器尺寸稳定、交互不遮挡；
- 深链、返回、刷新和工作区切换后状态正确。

## 17. 分阶段路线

### B0：架构与原型门禁

- 用合成数据完成 ECharts 模块 SDK、GridStack 动态增删和布局保存原型；
- 比较原生 ES Modules 与 React + TypeScript 的模块开发成本；
- 验证 KLineChart、Tabulator 和未来桌面 WebView 的基础兼容；
- 产出 ADR，决定 B 计划前端栈和布局引擎；
- 不接触真实交易数据。

完成条件：两个独立模块可以注册、添加、复制、配置、拖拽、缩放、删除和恢复，单模块失败不影响另一模块。

当前实验实现：

- 独立入口为 `/b0-lab/`，不修改现有仪表盘和订单工作区；
- 使用原生 ES Modules、ECharts 5.6.0、GridStack 和 Lucide，依赖均来自项目现有 vendor 目录；
- 默认提供累计权益与回撤、风险健康度、月度盈亏和策略贡献四类模块；
- 已验证同类型多实例、添加、复制、删除、拖拽、缩放、重置和 localStorage 恢复；
- 编辑模式提供 12 列画布网格、当前模块与尺寸状态、选中降噪、可见缩放边缘和尺寸持久化；
- 视觉基线采用深色 Apple 玻璃工作台方向，以大圆角、半透明材质、背景模糊和柔和投影建立层级，同时保留主分析、风险信号和辅助分析三级模块；
- 已提供加载中、空数据、样本不足、模块异常和正常值五种模块状态；
- 只使用确定性的合成数据，未连接 SQLite、生产 API、截图和真实账户信息；
- 桌面 1440×1000 与移动 390×844 的浏览器检查已覆盖无控制台错误和无页面级横向溢出。

该实现只完成 B0 的 GridStack/ECharts 技术探针，尚未完成 React 对照实现、KLineChart、Tabulator 和桌面 WebView 兼容验证，因此不能据此关闭 B0 门禁或直接进入生产迁移。

### B1：API 与数据契约

- 建立 `/api/v1` 错误格式、版本和能力接口；
- 建立 MarketBar、ChartAnnotation、DashboardLayout 和 ModuleInstance 契约；
- 增加迁移、仓储和契约测试；
- 保持旧 API 可用。

完成条件：新旧接口并行，SQLite 仍是唯一事实来源，迁移和回滚经过合成数据库验证。

### B2：设计系统与工作台外壳

- 落地深色专业交易设计令牌；
- 完成导航、命令栏、分栏、面板、表单、弹窗、反馈和状态组件；
- 建立组件目录和键盘/无障碍规范；
- 只使用合成数据验证布局。

完成条件：Dashboard、Orders 和 Market Chart 三个骨架在桌面与 390px 下稳定。

### B3：模块化仪表盘

- 建立模块注册表、实例模型、Data Coordinator 和真实编辑模式；
- 迁移收益曲线、回撤、月度盈亏、日历等第一批模块；
- 将布局从 localStorage 迁移到 SQLite API；
- 保留旧仪表盘回退入口。

完成条件：模块可以单独开发和发布，布局可持久化、恢复默认和版本迁移。

### B4：MT5 动态行情闭环

- 接入 MT5 CopyRates；
- 建立 MarketBar 缓存和质量状态；
- 在订单详情展示 KLineChart 与 Deal 成交标记；
- 保留截图切换和降级。

完成条件：合成数据与真实 MT5 环境分别验证时间、价格和开平点对齐。

### B5：PA 画线与持久化

- 实现第一批 PA 工具；
- 建立 ChartAnnotation API、撤销重做和冲突规则；
- 验证周期切换、补齐 K 线和重新打开后的坐标稳定性。

完成条件：画线可永久保存、恢复、修改和删除，不依赖数组索引。

### B6：Tabulator 专业数据视图

- 建立订单数据视图和远程查询适配器；
- 接入列偏好、自定义字段、详情跳转和受控导出；
- 扩展到导入审计和成交流水。

完成条件：大数据、键盘、390px、隐私导出和当前订单 API 回归通过。

### B7：国内期货行情

- 实现 Provider 接口和品种映射；
- 评估 TqSdk 及免费来源的覆盖、限制和授权；
- 建立缓存、缺口、降级和人工导入兜底。

完成条件：行情来源、覆盖区间和质量状态对用户透明，不把免费源当作无条件 SLA。

### B8：未来 A 股工作区

- 复用 MarketBar、图表、标注、模块和数据表格；
- 新增 A 股 Provider、交易日历、复权和颜色习惯配置；
- 不复制 Campaign 或指标引擎。

### B9：AI Skills

- 先开放 project-status、trade-review 和 provider-health 等只读 Skill；
- 再开放带 dry-run 和确认的布局、画线、回填和发布工具；
- 建立审计日志和权限测试。

### B10：桌面封装评估

- 比较 Tauri 2、PyWebView 和 Electron；
- 验证 Windows 安装、macOS 构建签名、Python sidecar、升级和回滚；
- 只有浏览器版稳定后才确定桌面交付路线。

## 18. ADR 待办

B0 阶段至少需要形成以下 ADR：

1. B 计划前端采用原生 ES Modules 还是 React + TypeScript；
2. 仪表盘继续使用 GridStack 还是更换布局引擎；
3. DashboardLayout 和 ModuleInstance 的 SQLite Schema；
4. MarketBar 缓存范围、唯一键和清理策略；
5. ChartAnnotation 坐标、范围和冲突规则；
6. 本地 API v1 的版本和兼容策略；
7. 第三方前端依赖固定、许可证和升级流程；
8. AI Skills 的权限、审计和确认策略；
9. 桌面 Host Bridge 契约与安全边界。

## 19. 风险与控制

| 风险 | 控制方式 |
| --- | --- |
| B 计划成为长期重写 | 每阶段必须交付可用能力并通过功能开关上线 |
| A/B 两套前端长期重复维护 | 只在迁移期并行，按工作区设置退出条件 |
| 指标模块产生不同统计口径 | 所有模块绑定服务端指标规范和定义版本 |
| 自由布局导致移动端失控 | 桌面自由网格，移动端只允许顺序与显隐 |
| 第三方组件升级破坏页面 | 固定版本、内部适配器、契约与视觉回归测试 |
| 免费行情不可用 | Provider 可替换、SQLite 缓存、质量状态和截图兜底 |
| 桌面化拖慢核心功能 | 浏览器优先，宿主只依赖稳定 API 与 Host Bridge |
| AI 权限过大 | 默认只读、写操作确认、dry-run 和审计日志 |

## 20. 下一步

下一步继续完成 B0，不直接建设完整 B 计划：

1. 为仪表盘模块 SDK 编写一份独立技术规格；
2. 以当前 `/b0-lab/` 作为原生 ES Modules 基线，补充模块 SDK 技术规格；
3. 在隔离原型中继续验证配置变更、模块故障隔离和布局版本迁移；
4. 对比原生 ES Modules 与 React + TypeScript 实现；
5. 根据原型结果接受或否决前端栈与布局引擎 ADR；
6. 原型不读取 `data/`、截图、原始事件或真实账户信息。

只有 B0 通过后，才为 B1 编写逐文件、逐测试的实施计划。

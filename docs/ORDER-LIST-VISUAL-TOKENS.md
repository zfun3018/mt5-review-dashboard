# 订单列表视觉令牌

这套令牌描述当前订单页左侧订单列表的视觉语言，适用于订单、画册索引、筛选结果列表等同类信息密集型组件。令牌只描述视觉和交互状态，不创建新的业务字段、订单 ID 或数据副本。

## 视觉方向

- **基调**：深色流体玻璃（dark fluid glass）。背景保持近黑，内容通过半透明层、折射边缘和内高光建立层次。
- **密度**：紧凑、可扫描。时间、合约、标记、盈亏在一行内完成阅读，日期组负责分组而不是额外装饰。
- **主强调**：低饱和青色，用于选中、焦点和主要操作；盈利使用青绿，风险和缺失使用琥珀，亏损使用珊瑚红。
- **材质规则**：日期组是外层玻璃卡，订单行是卡内的透明内容层，选中行才提升为胶囊形局部控制面。

## 令牌层级

优先使用已有共享基础令牌；下面的订单列表语义令牌只是别名，便于跨页面复用和统一调整。

```css
:root {
  /* Canvas */
  --order-list-canvas: var(--color-bg-atmosphere);

  /* Material */
  --order-list-surface-fill: var(--glass-refraction-fill);
  --order-list-surface-rim: var(--glass-refraction-rim);
  --order-list-surface-edge: var(--glass-refraction-edge);
  --order-list-surface-shadow: var(--glass-refraction-card-shadow);
  --order-list-surface-blur: var(--glass-refraction-blur);
  --order-list-surface-saturation: 155%;
  --order-list-surface-radius: var(--glass-refraction-radius);
  --order-list-surface-highlight: rgba(238, 252, 255, 0.14);
  --order-list-surface-shade: rgba(1, 5, 8, 0.24);
  --order-list-row-hover-fill: rgba(var(--color-accent-rgb), 0.09);

  /* Selected row material */
  --order-list-selected-fill: var(--glass-refraction-selected-fill);
  --order-list-selected-rim: var(--glass-refraction-selected-rim);
  --order-list-selected-shadow: var(--glass-refraction-selected-glow),
    0 8px 16px rgba(0, 0, 0, 0.34),
    var(--glass-refraction-selected-bevel);
  --order-list-selected-blur: var(--glass-refraction-selected-blur);
  --order-list-selected-saturation: 165%;

  /* Text and semantic color */
  --order-list-text: var(--color-text);
  --order-list-muted: var(--color-muted);
  --order-list-accent: var(--color-accent);
  --order-list-profit: var(--color-positive);
  --order-list-loss: var(--color-negative);
  --order-list-warning: var(--color-warning);
  --order-list-strategy: var(--color-tag-strategy);
  --order-list-text-glow: var(--glass-refraction-text-glow);

  /* Layout and density */
  --order-list-group-gap: 10px;
  --order-list-group-header-height: 42px;
  --order-list-group-header-padding: 8px 11px;
  --order-list-row-height: 42px;
  --order-list-row-padding: 8px 7px;
  --order-list-row-gap: 3px;
  --order-list-time-width: 3.05rem;
  --order-list-divider: rgba(216, 239, 247, 0.16);
  --order-list-header-divider: rgba(216, 239, 247, 0.20);

  /* Shape and motion */
  --order-list-group-radius: var(--glass-refraction-radius);
  --order-list-selected-radius: var(--radius-pill);
  --order-list-weekday-radius: 5px;
  --order-list-transition: var(--transition-fast);
}
```

### 排版可读性令牌

所有工作区共享同一组字号下限，避免页面在浏览器缩放或窄屏下出现难以阅读的正文：

```css
:root {
  --font-size-readable-min: 12px; /* 正常正文、表格、筛选器和字段标签 */
  --font-size-secondary: 11px;    /* 次要说明、时间、来源和辅助元信息 */
  --font-size-micro: 10px;        /* 徽标、状态点、热力图格内数字等非必要标记 */
}
```

页面样式应优先使用这三个语义令牌，而不是直接写入 `9px`、`10px` 或 `11px`。`--font-size-micro` 只适用于不影响主要阅读路径的短信息；订单合约、盈亏、日期、筛选控件、表格内容和详情字段统一使用 `--font-size-readable-min` 或更大的字号。

## 组件配方

### 1. 列表画布

列表所在页面使用 `var(--order-list-canvas)`。不要给订单索引列再添加一层不透明卡片；页面背景应保持可见，让日期组成为主要视觉框架。

### 2. 日期分组卡 `campaign-day-card`

```css
.campaign-day-card {
  border: 1px solid var(--order-list-surface-rim);
  border-radius: var(--order-list-group-radius);
  background: var(--order-list-surface-fill);
  box-shadow: var(--order-list-surface-shadow);
  backdrop-filter: blur(var(--order-list-surface-blur))
    saturate(var(--order-list-surface-saturation));
}
```

材质由三层组成：

1. 半透明折射填充；
2. 细亮边 `surface-rim`；
3. 内部上沿高光、底部暗边和轻微青色环境光。

边缘可使用 `var(--order-list-surface-edge)` 做 1px 的 conic-gradient 描边。它是材质特征，不应成为大面积彩色边框。

### 3. 日期组头部 `campaign-day-header`

- 高度：`42px`；内边距：`8px 11px`。
- 背景：从 `rgba(54, 59, 67, .45)` 到 `rgba(13, 14, 18, .18)` 的 145deg 线性渐变。
- 下边界：`var(--order-list-header-divider)`。
- 日期文字：`12px / 700`；星期徽记：`18px` 方形、`5px` 圆角、`9px / 700`。
- 左侧日期点：`7px` 圆点，使用 accent，并带 `0 0 10px` 的同色光晕。

### 4. 默认订单行 `campaign-card-order`

- 行高：`42px`；内边距：`8px 7px`；行内间距：`3px`。
- 时间固定占位 `3.05rem`，使用等宽数字，避免滚动时字段抖动。
- 合约名称使用主文字色、`12px / 650`；盈亏使用 `12px`，右对齐并保持不换行。
- 相邻行用 `1px solid var(--order-list-divider)` 分隔，不额外绘制卡片阴影。
- 悬停填充：`var(--order-list-row-hover-fill)`。
- 键盘焦点：使用 `var(--focus-ring-shadow)` 或等效的内描边，不能只依赖颜色变化。

### 5. 选中订单行 `campaign-card-order.active`

选中态是列表中唯一的局部“浮起”表面：

```css
.campaign-card-order.active .campaign-list-order {
  min-height: 40px;
  padding: 0 6px;
  border: 1px solid var(--order-list-selected-rim);
  border-radius: var(--order-list-selected-radius);
  background: var(--order-list-selected-fill);
  box-shadow: var(--order-list-selected-shadow);
  backdrop-filter: blur(var(--order-list-selected-blur))
    saturate(var(--order-list-selected-saturation));
}
```

选中合约名使用 `#e8fcff` 并可叠加 `var(--order-list-text-glow)`；时间文字保持 muted，避免整行都变成高亮色。

### 6. 交易语义状态

| 状态 | 视觉令牌 | 用途 |
| --- | --- | --- |
| 盈利 | `--order-list-profit` / `--color-positive-soft` | 盈亏数字、成功完成状态 |
| 亏损 | `--order-list-loss` / `--color-negative-soft` | 负盈亏、错误状态 |
| 风险缺失 | `--order-list-warning` | 初始止损未完整填写；建议使用左侧 `2px` 内标记 |
| 打平订单 | `--order-list-warning` 的低透明度填充 | `rgba(241, 198, 110, .06)`，只做弱提示 |
| 精选 | `--order-list-warning` | 星标图标或精选动作，不改变整行底色 |
| 交易场景 | `--color-tag-scene` | 场景标签 |
| 交易策略 | `--color-tag-strategy` | 策略标签 |
| 犯错 | `--color-tag-mistake` | 错误标签 |

语义色只表达状态，不用于装饰日期组或普通行。颜色之外要保留图标、文字或结构提示，以支持低视力和色觉差异用户。

## 控件令牌

订单范围切换器（全部订单 / 精选订单）使用单层胶囊容器：

- 外层：`3px` 内间距、`999px` 圆角、`rgba(10, 15, 21, .7)` 填充。
- 单项：最小高度 `28px`、水平内边距 `13px`、`12px` 字号。
- 激活项：`var(--glass-control-fill-selected)`，配合 `var(--glass-control-rim)` 和 `var(--glass-control-shadow)`，保持青色药丸的内上沿高光。
- 非激活项：muted 文字；悬停只增加 `rgba(var(--color-accent-rgb), .12)` 的局部填充。
- 焦点：使用 `var(--focus-ring-shadow)`。

## 订单详情媒体模块

截图编辑器等媒体容器沿用同一组材质令牌：外层使用 `surface-fill`、`surface-rim`、`surface-shadow` 和 `surface-blur`；图片或空态区域使用 `var(--glass-nested)`，避免在一个模块中叠加第二张亮卡；替换、删除等操作使用 `var(--glass-control-fill)` 和 `var(--glass-control-shadow)` 做小型药丸控件。

拖入状态使用 `selected-fill`、`selected-rim` 和 `selected-shadow`，键盘焦点使用 `var(--focus-ring-shadow)`。截图、空态和按钮都必须保持在容器边界内，不能被折射高光覆盖。

## 响应式规则

- 桌面：列表列宽约 `220–280px`，订单详情占主空间；列表自身滚动，页面背景和日期组结构保持不变。
- 窄屏：行高可降至 `40px`，列表改为自然高度，避免出现第二个嵌套滚动区域。
- 移动端不删除时间、合约或盈亏字段；通过省略号和固定时间列宽保持扫描顺序。
- 所有文本必须在父级内完整裁切，不能让选中态的光晕或边框覆盖相邻行。

## 可访问状态

- `hover`：轻微 accent 填充，不改变布局尺寸。
- `focus-visible`：至少 2px 可见内描边或 `--focus-ring-shadow`。
- `active/selected`：保留 `aria-selected` 或等效语义，同时使用材质和边框强化。
- `disabled/loading/empty/error`：沿用共享 muted、overlay 和状态色；不要用虚假的 0 或空订单替代未知状态。
- `prefers-reduced-motion: reduce`：移除浮动、位移和过渡，只保留颜色与边框状态。

## 复用约束

1. 新列表先复用基础 `tokens.css`，再通过本文件的语义别名覆盖组件差异。
2. 不要在页面 CSS 中重新定义一套近似的青色、阴影或玻璃透明度。
3. 不要把 `campaign-day-card` 或订单行做成白色实体卡；暗色画布必须可见。
4. 选中态只提升当前行，不能让每个订单都带发光阴影。
5. 业务字段、排序、分组和 ID 继续由现有 API 与实体关系提供；视觉令牌不参与数据计算。

## 当前实现映射

- 基础颜色、字体、半径、动效：`mt5-review-system/web/shared/css/tokens.css`
- 订单列表结构和密度：`mt5-review-system/web/orders/orders.css`
- 玻璃材质覆盖、折射边缘和选中态：`mt5-review-system/web/shared/css/surface-language.css`
- 日期分组和订单行 DOM：`mt5-review-system/web/orders/orders.mjs`

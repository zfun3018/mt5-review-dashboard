# Web AI Instructions

## View boundaries

- The frontend renders server-owned facts and analysis results; it cannot recompute trading facts from Deal, Position, or Campaign payloads.
- 前端不能重新计算交易事实，只负责渲染服务端返回的规范化数据和指标结果。
- Do not create page-specific copies, aliases, or generated IDs for shared business entities.
- Keep the current order review page layout and interaction model unchanged unless the user explicitly requests a redesign.
- 订单复盘页面的当前布局和交互保持不变，除非用户明确要求重做。
- Orders, album, dashboard, and settings must read the same canonical fields and stable IDs from their APIs.
- Analysis cards and charts must render explicit result states such as unavailable, insufficient, incomplete, estimated, or not applicable.

## Interaction and verification

- Keep platform-specific controls driven by server capability declarations.
- New dashboard modules need a rendering test for value, empty, warning, and error states.
- 新指标必须覆盖数值、空数据、警告和错误状态渲染。
- A UI change must be checked at desktop width and 390px mobile width for overflow and overlapping content.
- The frontend must not hide a server warning by displaying a fabricated zero or empty success state.

# Server AI Instructions

## Ownership and boundaries

- `trade_campaigns` is the owning record for Campaign-level review fields, classifications, strategy, mistake tags, review text, and custom fields.
- The database is the single source of truth. Application services orchestrate repositories and domain calculations; they must not create a second business-data store.
- `app/domain` contains pure calculations over normalized in-memory values. Calculation modules cannot read SQLite, HTTP requests, files, environment variables, or browser state.
- 计算模块只能读取规范化的内存数据和显式配置，不能自行查询数据库或请求页面。
- `app/data` owns persistence and query composition. It must not import application or presentation modules and must not emit page-specific aliases.
- `app/application` owns workflow orchestration and compatibility assembly. It must not import presentation code.
- `app/presentation` owns HTTP serialization and routing only.

## Analysis changes

- Every new metric needs a metric specification, an owner, a statistical unit, a fact time field, a timezone, a definition version, a sample-quality policy, and a test path.
- 新指标必须先有指标说明书；数据库单一事实源仍然是 `trade_campaigns` 所代表的 Campaign 业务记录。
- The metric specification must include a manually checkable synthetic dataset before the calculation module is changed.
- Use `Campaign` as the default order-count unit. Deal and Position rows are supporting detail unless a metric explicitly declares another unit.
- Missing or insufficient data must have an explicit status; do not replace unknown values with zero.
- New analysis endpoints must preserve the existing `/api/analysis` fields unless a compatibility change is explicitly planned.

## Verification

- Run focused tests after each change, then run the relevant server test group before committing.
- Shared data changes require a cross-view test through the owning workflow and the orders, album, dashboard, and relevant API reads.
- Do not read, stage, or commit private data directories or generated screenshots.

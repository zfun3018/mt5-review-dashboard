# Domain AI Instructions

## Pure domain rules

- Domain modules accept normalized in-memory records and explicit configuration only.
- 计算模块不能导入 SQLite、数据库仓储、HTTP、文件系统、环境变量或 DOM。
- Domain code must not know page layouts, route names, request objects, or frontend state.
- Shared calculations use canonical Campaign fields and must not invent page-specific aliases or IDs.
- Platform differences enter through explicit capabilities and data-quality states, not scattered presentation branches.

## Metric rules

- Every new metric starts with a metric specification and an owner in the metric registry.
- The specification must include formula, statistical unit, time field, timezone, missing-data behavior, minimum sample, definition version, and drill-down filter.
- Add manually checkable synthetic data before changing the formula. The test must cover complete, missing, and insufficient samples where applicable.
- 公式变更前必须准备人工可核对的合成数据，并用领域测试覆盖完整、缺失和样本不足等状态。
- Every `MetricResult` must make its status, sample count, definition version, coverage, and warnings observable.
- Do not return zero when the result is unknown, incomplete, or not applicable.

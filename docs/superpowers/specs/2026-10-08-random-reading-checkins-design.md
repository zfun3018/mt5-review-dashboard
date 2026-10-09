# 随机阅读打卡与热力图设计

## Goal

为复盘画册的随机阅读增加按图片每日打卡、每日阅读目标和打卡热力图，不复制截图、不影响交易统计，也不引入后台轮询。

## Behavior

- 每张画册卡片和全屏阅读器都提供打卡入口。
- 同一交易图片同一天只能成功打卡一次；重复请求返回幂等结果，不增加累计次数。
- 每日目标默认为 20，可在画册页保存为 1-500 张。
- 热力图默认显示最近 90 个北京时间日期。每日颜色按阅读次数分级，达到目标时使用完成态颜色和激励图标。
- 删除交易后通过外键级联清理打卡记录；归档交易保留历史打卡，但不再出现在随机阅读中。

## Architecture

SQLite 增加 `reading_checkins` 表，使用 `UNIQUE(trade_id, checkin_date)` 作为最终幂等保障，并建立日期索引。每日目标存入现有 `analysis_settings` 的 `reading_daily_goal` 键。新增画册专用 GET/POST/PUT 接口；前端在初始加载时并行读取画册和打卡概览，成功打卡后只刷新打卡概览及当前卡片状态。

所有日期按北京时间计算，客户端不能提交日期。统计只查询未软删除交易，读取量为固定 90 天聚合结果，不扫描截图文件。

## API contract

- `GET /api/review-album/checkins?days=90`
  - 返回 `daily_goal`、`today`、`days`、`range`。
- `POST /api/review-album/checkin` body `{ "trade_id": "..." }`
  - 返回 `trade_id`、`date`、`created`、`checked_in`。
- `PUT /api/review-album/goal` body `{ "daily_goal": 20 }`
  - 返回 `daily_goal`。

## Acceptance criteria

- 重复打卡不会增加日期计数。
- 不存在或已删除的交易不能打卡。
- 目标保存后热力图立即按新目标重新计算完成态。
- 390px 宽度无横向溢出；按钮有明确的禁用态、焦点态和 aria 状态。
- 既有 Python、Node 静态测试和语法检查继续通过。

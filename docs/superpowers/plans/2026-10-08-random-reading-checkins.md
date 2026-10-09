# 随机阅读打卡与热力图 Implementation Plan

> **For agentic workers:** Implement inline in this session with the task boundaries below.

**Goal:** 为随机阅读增加按图片每日唯一打卡、每日目标和近 90 天热力图。

**Architecture:** SQLite 通过 `reading_checkins` 的交易-日期唯一约束保证幂等，目标复用 `analysis_settings`。画册服务提供打卡概览和状态，原生前端并行加载并在打卡后局部更新。

**Tech Stack:** Python 3.11 标准库 HTTP、SQLite、原生 HTML/CSS/ES modules、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-10-08-random-reading-checkins-design.md`

## Global Constraints

- 不读取或修改 `data/`、`backups/`、`config.local.json`、真实截图和原始 MT5 JSONL。
- 保持 Python 标准库、SQLite、原生前端架构。
- 日期统计使用北京时间；服务不暴露公网；保持 390px 移动端无横向溢出。

### Task 1: Persistence and API contract

**Files:**
- Modify: `mt5-review-system/server/app/data/migrations.py`
- Modify: `mt5-review-system/server/app/data/bootstrap.py`
- Modify: `mt5-review-system/server/app/data/trade_repository.py`
- Modify: `mt5-review-system/server/app/data/trade_commands.py`
- Modify: `mt5-review-system/server/app/application/album_service.py`
- Modify: `mt5-review-system/server/app/storage.py`
- Modify: `mt5-review-system/server/app/presentation/http/routes/album.py`
- Test: `mt5-review-system/server/tests/test_review_album.py`
- Test: `mt5-review-system/server/tests/test_http_routes.py`

Implement schema, target validation, idempotent command, current-day status, aggregated overview, serialization and three routes. Run focused tests after the red phase and after the green phase.

### Task 2: Album UI

**Files:**
- Modify: `mt5-review-system/web/album/index.html`
- Modify: `mt5-review-system/web/album/album.mjs`
- Modify: `mt5-review-system/web/album/album.css`
- Test: `mt5-review-system/web/tests/review-album-ui.test.js`

Add the target control, heatmap, card/reader buttons, loading/error/disabled states, and partial refresh behavior. Verify Node tests and syntax checks.

### Task 3: Release metadata and verification

**Files:**
- Modify: `VERSION`
- Modify: `docs/VERSION-ROUTE.md`

Update the user-visible patch route, run the required Python and frontend suites, and inspect the final diff without accessing private data.

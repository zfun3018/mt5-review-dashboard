# Domestic Futures Import Reconciliation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make domestic-futures imports robust across night/day sessions, preserve the exchange trading date as the order date, and expose actionable unmatched executions without silently losing rows.

**Architecture:** Keep the existing Python standard-library HTTP server, SQLite database, and native frontend. The source trading date remains the canonical business date; actual execution timestamps are normalized separately, and import matching uses a derived trading-session sort key. Matched trades retain the opening trading date, while realized-P&L reports may use the closing trading date. Import batches retain normalized execution facts and match diagnostics so unmatched rows can be inspected and manually paired or safely re-imported.

**Tech Stack:** Python 3.11 standard library, SQLite, native HTML/CSS/JavaScript, unittest, Node test runner.

---

## Data ownership and invariants

- `trade_date` on a normalized execution is owned by the source execution/import fact and remains the exchange trading date from the file.
- `open_time_utc` and `close_time_utc` are the chronological execution timestamps. When only a trading date plus time is available, the night-session timestamp is constructed on the prior natural date without changing `trade_date`.
- `trades.trade_date` is owned by the matched order and is copied from its opening execution. It is used for order/archive views; realized-P&L metrics retain an explicit close-date fact time.
- Import rows and match links are platform-scoped to `domestic_futures`, rebuildable from persisted facts, and never become a page-local copy of business orders.
- Cross-view verification writes through the domestic-futures import workflow and reads the resulting order date, P&L, and unmatched state through orders, album, dashboard, import summary, and batch-detail APIs.

## Task 1: Fix trading-session normalization and FIFO ordering

**Files:** `server/app/data/normalized_import.py`, `server/app/platform_adapters/contracts.py`, `server/tests/test_normalized_import.py`, `server/tests/test_tonghuashun_csv.py`.

- Add a deterministic session-order key for domestic futures: night-session times sort before daytime times within the same source trading date.
- Parse time-only values using the source trading date while preserving the source date field; night timestamps may use the previous natural date solely for chronological time.
- Sort valid executions before FIFO matching, with source row and stable source ID as deterministic tie-breakers.
- Add synthetic tests with night open/day close and reversed source-row order, including an unmatched residual quantity.

## Task 2: Persist order trading date and separate report date semantics

**Files:** `server/app/data/migrations.py`, `server/app/data/bootstrap.py`, `server/app/data/trade_commands.py`, `server/app/data/trade_repository.py`, `server/app/data/normalized_import.py`, `server/app/domain/metrics/domestic_futures.py`, related tests.

- Add a nullable `trades.trade_date` compatibility column and populate new domestic-futures imports from the opening execution.
- Use order `trade_date` for domestic-futures order/archive grouping and import counts; keep close-time facts for realized-P&L reporting and label the two semantics in payloads.
- Preserve MT5 behavior and mark legacy domestic rows without a source trading date as fallback-derived during migration.

## Task 3: Make unmatched executions durable and actionable

**Files:** schema/migration, import repository, platform importer, facade/routes, server tests.

- Persist normalized import executions and quantity-level match links per batch.
- Expose unmatched open/close details with stable execution IDs, residual quantity, source row, trading date, and actual time.
- Add endpoints to fetch batch reconciliation details and submit a manual open/close match with server-side compatibility and quantity validation.
- Keep re-import idempotent through existing source fingerprints and mark resolved rows without deleting audit history.

## Task 4: Update the import workspace

**Files:** `web/settings/index.html`, `web/settings/settings.mjs`, `web/settings/settings.css`, frontend tests.

- Replace the single import result sentence with a summary showing source, matched, duplicate, invalid, unmatched-open, and unmatched-close quantities.
- Add an unmatched-execution table with filters and a direct select-open/select-close pairing flow; support partial quantities and refresh after pairing.
- Keep desktop and 390px mobile layouts stable and preserve the existing settings/order review layout.

## Task 5: Verify and document

- Run focused Python and Node tests after each task, then the full project verification commands from `AGENTS.md`.
- Add cross-view synthetic tests and release-route notes for the user-visible import behavior.
- Do not read or stage any sensitive runtime data, screenshots, raw JSONL, or local configuration.

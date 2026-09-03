-- Minimal synthetic v2 schema fixture.
--
-- v2 predates soft-delete, classification (trade_type/strategy), fee, and the
-- derived campaign tables. It contains only synthetic identifiers and one
-- representative record per feature the version supported. It must never
-- reference real account, order, terminal, path, or screenshot values.
PRAGMA foreign_keys = OFF;

CREATE TABLE trends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#4fd1c5',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trades (
    id TEXT PRIMARY KEY,
    account TEXT,
    order_no TEXT,
    position_id TEXT,
    order_ticket TEXT,
    deal_ticket TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    lots REAL NOT NULL,
    open_time_utc TEXT NOT NULL,
    close_time_utc TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    pnl REAL NOT NULL,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    screenshot_path TEXT,
    review_text TEXT NOT NULL DEFAULT '',
    trend_id INTEGER REFERENCES trends(id) ON DELETE SET NULL,
    remark TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_utc TEXT NOT NULL UNIQUE,
    balance REAL NOT NULL,
    equity REAL NOT NULL
);

CREATE TABLE raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    received_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE ingest_cursors (
    file_path TEXT PRIMARY KEY,
    byte_offset INTEGER NOT NULL DEFAULT 0,
    file_size INTEGER NOT NULL DEFAULT 0,
    modified_ns INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    size_bytes INTEGER NOT NULL
);

INSERT INTO trends (name, color, sort_order) VALUES ('顺势突破', '#2bd4ff', 1);

-- One active profitable trade with a review and a relative screenshot path.
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side,
    lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price,
    pnl, commission, swap, screenshot_path, review_text, trend_id, remark, source, raw_json
) VALUES (
    'V2-T1', 'SYNTHETIC', 'V2-T1', 'V2-T1', 'O-V2-T1', 'D-V2-T1', 'XAUUSD', 'long',
    1.0, '2026-01-05T08:00:00+00:00', '2026-01-05T09:00:00+00:00', 3600,
    2000.0, 2008.0, 8.0, 0.0, 0.0, 'screenshots/v2-placeholder.png',
    'V2 复盘文字', 1, '', 'manual', '{}'
);

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '2');

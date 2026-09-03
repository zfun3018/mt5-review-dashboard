-- Minimal synthetic v3 schema fixture.
--
-- v3 introduced soft-delete, classification (trade_type/strategy), fee, and
-- custom field values, but predates the derived deal/position/campaign tables.
-- Only synthetic identifiers are present; no real account, order, terminal,
-- path, or screenshot values.
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
    fee REAL NOT NULL DEFAULT 0,
    screenshot_path TEXT,
    review_text TEXT NOT NULL DEFAULT '',
    trend_id INTEGER REFERENCES trends(id) ON DELETE SET NULL,
    remark TEXT NOT NULL DEFAULT '',
    trade_type TEXT NOT NULL DEFAULT 'unclassified',
    strategy TEXT NOT NULL DEFAULT 'strategy_unclassified',
    deleted_at TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    field_type TEXT NOT NULL DEFAULT 'text',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE classification_options (
    id TEXT PRIMARY KEY,
    dimension TEXT NOT NULL CHECK (dimension IN ('trade_type', 'strategy')),
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2bd4ff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (dimension, label)
);

CREATE TABLE custom_field_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2bd4ff',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE trade_custom_values (
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (trade_id, field_id)
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
    event_hash TEXT UNIQUE,
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
INSERT INTO classification_options (id, dimension, label, color, sort_order, active)
    VALUES ('follow', 'trade_type', '跟随', '#2bd4ff', 1, 1);
INSERT INTO classification_options (id, dimension, label, color, sort_order, active)
    VALUES ('breakout', 'strategy', '突破/窄通道', '#2bd4ff', 1, 1);

INSERT INTO custom_fields (id, name, field_type, sort_order)
    VALUES (1, '进场理由', 'single', 1);
INSERT INTO custom_field_options (field_id, label, color, sort_order)
    VALUES (1, '结构突破', '#2bd4ff', 1);

-- One active profitable trade with a review, a custom value, and a screenshot.
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side,
    lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price,
    pnl, commission, swap, fee, screenshot_path, review_text, trend_id, remark,
    trade_type, strategy, source, raw_json
) VALUES (
    'V3-T1', 'SYNTHETIC', 'V3-T1', 'V3-T1', 'O-V3-T1', 'D-V3-T1', 'XAUUSD', 'long',
    1.0, '2026-01-06T08:00:00+00:00', '2026-01-06T09:00:00+00:00', 3600,
    2000.0, 2008.0, 8.0, 0.0, 0.0, 0.0, 'screenshots/v3-placeholder.png',
    'V3 复盘文字', 1, '', 'follow', 'breakout', 'manual', '{}'
);

-- One soft-deleted trade.
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side,
    lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price,
    pnl, commission, swap, fee, screenshot_path, review_text, trend_id, remark,
    trade_type, strategy, deleted_at, source, raw_json
) VALUES (
    'V3-T2', 'SYNTHETIC', 'V3-T2', 'V3-T2', 'O-V3-T2', 'D-V3-T2', 'EURUSD', 'short',
    1.0, '2026-01-06T10:00:00+00:00', '2026-01-06T10:30:00+00:00', 1800,
    1.1000, 1.1020, -2.0, 0.0, 0.0, 0.0, '', '', 1, '',
    'reversal', 'range', '2026-01-06T10:31:00+00:00', 'manual', '{}'
);

INSERT INTO trade_custom_values (trade_id, field_id, value)
    VALUES ('V3-T1', 1, '1');

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '3');

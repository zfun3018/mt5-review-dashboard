-- Minimal synthetic v4 schema fixture (current business schema version 4).
--
-- Contains the full derived deal/position/campaign model plus a representative
-- initial stop and analysis setting. Only synthetic identifiers are used; no
-- real account, order, terminal, path, or screenshot values.
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

CREATE TABLE deal_events (
    deal_ticket TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    position_id TEXT NOT NULL,
    order_ticket TEXT,
    entry_kind TEXT NOT NULL,
    deal_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    volume REAL NOT NULL,
    price REAL NOT NULL,
    time_utc TEXT NOT NULL,
    time_msc INTEGER NOT NULL,
    profit REAL NOT NULL DEFAULT 0,
    commission REAL NOT NULL DEFAULT 0,
    swap REAL NOT NULL DEFAULT 0,
    fee REAL NOT NULL DEFAULT 0,
    screenshot_path TEXT,
    source_kind TEXT NOT NULL DEFAULT 'mt5',
    source_trade_id TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE positions (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    position_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    opened_at_utc TEXT NOT NULL,
    closed_at_utc TEXT,
    opened_sort_msc INTEGER NOT NULL,
    opened_sort_ticket TEXT NOT NULL,
    closed_sort_msc INTEGER,
    closed_sort_ticket TEXT,
    entry_volume REAL NOT NULL,
    exit_volume REAL NOT NULL,
    weighted_entry_price REAL,
    reconstruction_status TEXT NOT NULL,
    initial_stop_price REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account, position_id)
);

CREATE TABLE trade_campaigns (
    id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    opened_at_utc TEXT NOT NULL,
    closed_at_utc TEXT,
    status TEXT NOT NULL,
    net_pnl REAL NOT NULL DEFAULT 0,
    review_text TEXT NOT NULL DEFAULT '',
    trade_type TEXT NOT NULL DEFAULT 'unclassified',
    strategy TEXT NOT NULL DEFAULT 'strategy_unclassified',
    screenshot_path TEXT,
    classification_conflict INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campaign_positions (
    campaign_id TEXT NOT NULL REFERENCES trade_campaigns(id) ON DELETE CASCADE,
    position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, position_id),
    UNIQUE (position_id)
);

CREATE TABLE campaign_source_trades (
    campaign_id TEXT NOT NULL REFERENCES trade_campaigns(id) ON DELETE CASCADE,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, trade_id)
);

CREATE TABLE campaign_position_history (
    position_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    campaign_created_at TEXT NOT NULL
);

CREATE TABLE analysis_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

-- One active profitable trade with review, custom value, and screenshot.
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side,
    lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price,
    pnl, commission, swap, fee, screenshot_path, review_text, trend_id, remark,
    trade_type, strategy, source, raw_json
) VALUES (
    'V4-T1', 'SYNTHETIC', 'V4-T1', 'V4-P1', 'O-V4-T1', 'D-V4-T1', 'XAUUSD', 'long',
    1.0, '2026-01-07T08:00:00+00:00', '2026-01-07T09:00:00+00:00', 3600,
    2000.0, 2008.0, 8.0, 0.0, 0.0, 0.0, 'screenshots/v4-placeholder.png',
    'V4 复盘文字', 1, '', 'follow', 'breakout', 'manual', '{}'
);

-- One soft-deleted trade.
INSERT INTO trades (
    id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side,
    lots, open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price,
    pnl, commission, swap, fee, screenshot_path, review_text, trend_id, remark,
    trade_type, strategy, deleted_at, source, raw_json
) VALUES (
    'V4-T2', 'SYNTHETIC', 'V4-T2', 'V4-P2', 'O-V4-T2', 'D-V4-T2', 'EURUSD', 'short',
    1.0, '2026-01-07T10:00:00+00:00', '2026-01-07T10:30:00+00:00', 1800,
    1.1000, 1.1020, -2.0, 0.0, 0.0, 0.0, '', '', 1, '',
    'reversal', 'range', '2026-01-07T10:31:00+00:00', 'manual', '{}'
);

INSERT INTO trade_custom_values (trade_id, field_id, value)
    VALUES ('V4-T1', 1, '1');

-- Native deal events for the active trade position.
INSERT INTO deal_events (
    deal_ticket, account, position_id, order_ticket, entry_kind, deal_type, symbol,
    volume, price, time_utc, time_msc, profit, commission, swap, fee, screenshot_path,
    source_kind, source_trade_id, raw_json
) VALUES (
    'D-IN-V4', 'SYNTHETIC', 'V4-P1', 'O-V4-T1', 'in', 'buy', 'XAUUSD',
    1.0, 2000.0, '2026-01-07T08:00:00+00:00', 1768000000000, 0.0, 0.0, 0.0, 0.0,
    '', 'mt5', 'V4-T1', '{}'
);
INSERT INTO deal_events (
    deal_ticket, account, position_id, order_ticket, entry_kind, deal_type, symbol,
    volume, price, time_utc, time_msc, profit, commission, swap, fee, screenshot_path,
    source_kind, source_trade_id, raw_json
) VALUES (
    'D-OUT-V4', 'SYNTHETIC', 'V4-P1', 'O-V4-T1', 'out', 'sell', 'XAUUSD',
    1.0, 2008.0, '2026-01-07T09:00:00+00:00', 1768003600000, 8.0, 0.0, 0.0, 0.0,
    'screenshots/v4-placeholder.png', 'mt5', 'V4-T1', '{}'
);

-- Reconstructed position with an initial stop.
INSERT INTO positions (
    id, account, position_id, symbol, side, opened_at_utc, closed_at_utc,
    opened_sort_msc, opened_sort_ticket, closed_sort_msc, closed_sort_ticket,
    entry_volume, exit_volume, weighted_entry_price, reconstruction_status,
    initial_stop_price
) VALUES (
    'SYNTHETIC:V4-P1', 'SYNTHETIC', 'V4-P1', 'XAUUSD', 'long',
    '2026-01-07T08:00:00+00:00', '2026-01-07T09:00:00+00:00',
    1768000000000, 'D-IN-V4', 1768003600000, 'D-OUT-V4',
    1.0, 1.0, 2000.0, 'complete', 1995.0
);

-- Derived campaign for the position.
INSERT INTO trade_campaigns (
    id, account, symbol, side, opened_at_utc, closed_at_utc, status, net_pnl,
    review_text, trade_type, strategy, screenshot_path, classification_conflict
) VALUES (
    'C-V4', 'SYNTHETIC', 'XAUUSD', 'long', '2026-01-07T08:00:00+00:00',
    '2026-01-07T09:00:00+00:00', 'closed', 8.0, 'V4 复盘文字',
    'follow', 'breakout', 'screenshots/v4-placeholder.png', 0
);

INSERT INTO campaign_positions (campaign_id, position_id, sort_order)
    VALUES ('C-V4', 'SYNTHETIC:V4-P1', 0);
INSERT INTO campaign_source_trades (campaign_id, trade_id)
    VALUES ('C-V4', 'V4-T1');
INSERT INTO campaign_position_history (position_id, campaign_id, campaign_created_at)
    VALUES ('SYNTHETIC:V4-P1', 'C-V4', '2026-01-07T09:01:00+00:00');

INSERT INTO analysis_settings (key, value) VALUES ('scratch_threshold_r', '0.15');

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4');
INSERT INTO schema_meta (key, value) VALUES ('model_revision', '2');

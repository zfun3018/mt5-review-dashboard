from __future__ import annotations

import sqlite3

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from ..domain.analytics import calculate_duration_seconds
from .campaign_repository import CAMPAIGN_MODEL_REVISION, CampaignRepository
from .catalog_commands import CLASSIFICATION_DIMENSIONS, _ensure_classification_option


DEFAULT_CLASSIFICATION_OPTIONS = (
    ("unclassified", "trade_type", "未分类", "#8ca29b", 0),
    ("follow", "trade_type", "跟随", "#2bd4ff", 1),
    ("reversal", "trade_type", "反转", "#f97316", 2),
    ("strategy_unclassified", "strategy", "未分类", "#8ca29b", 0),
    ("breakout", "strategy", "突破/窄通道", "#2bd4ff", 1),
    ("range", "strategy", "宽通道/震荡区间", "#f4c95d", 2),
    ("major_reversal", "strategy", "大反转交易", "#ff5c7a", 3),
)


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def rebuild_campaign_models(*, conn: sqlite3.Connection | None = None) -> None:
    _campaign_repository().rebuild(conn=conn)


def _ensure_schema(conn: sqlite3.Connection, previous_version: int = 0) -> None:
    trade_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(trades)").fetchall()
    }
    archive_column_added = "is_archived" not in trade_columns
    for name, definition in {
        "fee": "REAL NOT NULL DEFAULT 0",
        "trade_type": "TEXT NOT NULL DEFAULT 'unclassified'",
        "strategy": "TEXT NOT NULL DEFAULT 'strategy_unclassified'",
        "is_featured": "INTEGER NOT NULL DEFAULT 0",
        "is_archived": "INTEGER NOT NULL DEFAULT 0",
        "deleted_at": "TEXT",
    }.items():
        if name not in trade_columns:
            conn.execute(f"ALTER TABLE trades ADD COLUMN {name} {definition}")

    if archive_column_added:
        conn.execute(
            "UPDATE trades SET is_archived = CASE WHEN is_featured = 1 THEN 0 ELSE 1 END"
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_trades_archived_close "
        "ON trades(is_archived, close_time_utc)"
    )

    raw_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(raw_events)").fetchall()
    }
    if "event_hash" not in raw_columns:
        conn.execute("ALTER TABLE raw_events ADD COLUMN event_hash TEXT")

    raw_query = (
        "SELECT id, payload FROM raw_events ORDER BY id"
        if previous_version < 2
        else "SELECT id, payload FROM raw_events WHERE event_hash IS NULL ORDER BY id"
    )
    rows = conn.execute(raw_query).fetchall()
    seen_hashes: set[str] = set()
    for row in rows:
        try:
            fingerprint = _canonical_event_hash(json.loads(row["payload"]))
        except (json.JSONDecodeError, TypeError):
            fingerprint = _event_hash(row["payload"])
        if previous_version < 2 and fingerprint in seen_hashes:
            conn.execute("DELETE FROM raw_events WHERE id = ?", (row["id"],))
            continue
        seen_hashes.add(fingerprint)
        try:
            conn.execute(
                "UPDATE raw_events SET event_hash = ? WHERE id = ?",
                (fingerprint, row["id"]),
            )
        except sqlite3.IntegrityError:
            conn.execute("DELETE FROM raw_events WHERE id = ?", (row["id"],))

    custom_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(custom_fields)").fetchall()
    }
    if "field_type" not in custom_columns:
        conn.execute("ALTER TABLE custom_fields ADD COLUMN field_type TEXT NOT NULL DEFAULT 'text'")
    if "active" not in custom_columns:
        conn.execute("ALTER TABLE custom_fields ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_custom_fields_active ON custom_fields(active)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_field_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#2bd4ff',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS classification_options (
            id TEXT PRIMARY KEY,
            dimension TEXT NOT NULL CHECK (dimension IN ('trade_type', 'strategy')),
            label TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#2bd4ff',
            sort_order INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (dimension, label)
        )
        """
    )
    conn.executemany(
        """
        INSERT OR IGNORE INTO classification_options
            (id, dimension, label, color, sort_order, active)
        VALUES (?, ?, ?, ?, ?, 1)
        """,
        DEFAULT_CLASSIFICATION_OPTIONS,
    )
    conn.execute(
        "UPDATE trades SET strategy = 'strategy_unclassified' WHERE strategy = 'unclassified'"
    )
    for dimension in sorted(CLASSIFICATION_DIMENSIONS):
        rows = conn.execute(
            f"SELECT DISTINCT {dimension} AS value FROM trades WHERE {dimension} IS NOT NULL"
        ).fetchall()
        for row in rows:
            value = str(row["value"] or "unclassified").strip() or "unclassified"
            option_id = _ensure_classification_option(conn, dimension, value)
            if option_id != value:
                conn.execute(
                    f"UPDATE trades SET {dimension} = ? WHERE {dimension} = ?",
                    (option_id, value),
                )

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_event_hash ON raw_events(event_hash)"
    )
    # Performance indexes measured for the /api/analysis hot path (10k-trade
    # benchmark). EXPLAIN QUERY PLAN confirms these are hit (SEARCH, not SCAN)
    # when query_analysis_rows filters/orders by close_time_utc /
    # closed_at_utc with direct ISO-string comparisons.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_close_time ON trades(close_time_utc)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_side ON trades(side)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_type ON trades(trade_type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy)")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS deal_events (
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

        CREATE TABLE IF NOT EXISTS positions (
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

        CREATE TABLE IF NOT EXISTS trade_campaigns (
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

        CREATE TABLE IF NOT EXISTS campaign_positions (
            campaign_id TEXT NOT NULL REFERENCES trade_campaigns(id) ON DELETE CASCADE,
            position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (campaign_id, position_id),
            UNIQUE (position_id)
        );

        CREATE TABLE IF NOT EXISTS campaign_source_trades (
            campaign_id TEXT NOT NULL REFERENCES trade_campaigns(id) ON DELETE CASCADE,
            trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
            PRIMARY KEY (campaign_id, trade_id)
        );

        CREATE TABLE IF NOT EXISTS campaign_position_history (
            position_id TEXT PRIMARY KEY,
            campaign_id TEXT NOT NULL,
            campaign_created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS analysis_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_deal_position_time
            ON deal_events(account, position_id, time_msc, deal_ticket);
        CREATE INDEX IF NOT EXISTS idx_positions_campaign_lookup
            ON positions(account, symbol, side, closed_at_utc);
        CREATE INDEX IF NOT EXISTS idx_campaign_closed
            ON trade_campaigns(account, symbol, side, closed_at_utc);
        -- Hit by CampaignRepository.query_analysis_rows ORDER BY
        -- closed_at_utc DESC, id DESC (SEARCH per EXPLAIN QUERY PLAN).
        CREATE INDEX IF NOT EXISTS idx_campaign_closed_at
            ON trade_campaigns(closed_at_utc, id);
        CREATE INDEX IF NOT EXISTS idx_campaign_positions_campaign
            ON campaign_positions(campaign_id, sort_order);
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO analysis_settings (key, value) VALUES ('scratch_threshold_r', '0.15')"
    )
    campaign_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(trade_campaigns)").fetchall()
    }
    for name, definition in {
        "campaign_r": "REAL",
        "risk_status": "TEXT",
    }.items():
        if name not in campaign_columns:
            conn.execute(f"ALTER TABLE trade_campaigns ADD COLUMN {name} {definition}")
    revision = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'model_revision'"
    ).fetchone()
    if not revision or revision["value"] != CAMPAIGN_MODEL_REVISION:
        _campaign_repository().rebuild(conn=conn)


def seed_demo_data() -> None:
    with db() as conn:
        existing = conn.execute("SELECT COUNT(*) AS count FROM trades").fetchone()["count"]
        if existing:
            return

        trends = [
            ("顺势突破", "#2bd4ff", 1),
            ("回调进场", "#4ade80", 2),
            ("逆势试单", "#f97316", 3),
            ("震荡区间", "#a78bfa", 4),
        ]
        conn.executemany(
            "INSERT OR IGNORE INTO trends (name, color, sort_order) VALUES (?, ?, ?)",
            trends,
        )
        trend_ids = {
            row["name"]: row["id"]
            for row in conn.execute("SELECT id, name FROM trends").fetchall()
        }

        screenshots = _create_demo_screenshots()
        trades = [
            _trade(
                "DEMO-1001",
                "EURUSD",
                "long",
                0.2,
                "2026-08-10T00:10:00+00:00",
                "2026-08-10T01:05:00+00:00",
                1.0921,
                1.0964,
                86.0,
                screenshots[0],
                "顺势突破",
                trend_ids,
                "欧元突破前高后回踩有效，进场较稳。",
            ),
            _trade(
                "DEMO-1002",
                "XAUUSD",
                "short",
                0.1,
                "2026-08-10T07:20:00+00:00",
                "2026-08-10T08:05:00+00:00",
                2406.2,
                2411.8,
                -56.0,
                screenshots[1],
                "逆势试单",
                trend_ids,
                "逆势单进场太早，后续需要等待 M5 结构确认。",
            ),
            _trade(
                "DEMO-1003",
                "GBPUSD",
                "long",
                0.15,
                "2026-08-11T12:00:00+00:00",
                "2026-08-11T13:15:00+00:00",
                1.2762,
                1.2795,
                49.5,
                screenshots[2],
                "回调进场",
                trend_ids,
                "伦敦盘回调二次确认，出场保守。",
            ),
            _trade(
                "DEMO-1004",
                "USDJPY",
                "short",
                0.25,
                "2026-08-12T13:20:00+00:00",
                "2026-08-12T15:45:00+00:00",
                148.52,
                148.22,
                75.0,
                screenshots[3],
                "顺势突破",
                trend_ids,
                "美盘延续单，持仓期间未破结构。",
            ),
            _trade(
                "DEMO-1005",
                "XAUUSD",
                "long",
                0.1,
                "2026-08-13T00:35:00+00:00",
                "2026-08-13T02:25:00+00:00",
                2422.1,
                2418.4,
                -37.0,
                screenshots[4],
                "震荡区间",
                trend_ids,
                "区间顶部追多，方向判断和价格位置冲突。",
            ),
            _trade(
                "DEMO-1006",
                "EURUSD",
                "long",
                0.3,
                "2026-08-13T14:10:00+00:00",
                "2026-08-13T16:00:00+00:00",
                1.1014,
                1.1048,
                102.0,
                screenshots[5],
                "回调进场",
                trend_ids,
                "美盘前后共振，盈利后分批止盈更合理。",
            ),
            _trade(
                "DEMO-1007",
                "GBPJPY",
                "short",
                0.18,
                "2026-08-14T01:00:00+00:00",
                "2026-08-14T02:20:00+00:00",
                188.72,
                188.44,
                50.4,
                screenshots[6],
                "顺势突破",
                trend_ids,
                "亚盘波动虽小，但结构清楚，仓位控制合适。",
            ),
        ]

        conn.executemany(
            """
            INSERT INTO trades (
                id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side, lots,
                open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl,
                commission, swap, screenshot_path, review_text, trend_id, remark, source, raw_json
            ) VALUES (
                :id, :account, :order_no, :position_id, :order_ticket, :deal_ticket, :symbol, :side, :lots,
                :open_time_utc, :close_time_utc, :duration_seconds, :entry_price, :exit_price, :pnl,
                :commission, :swap, :screenshot_path, :review_text, :trend_id, :remark, :source, :raw_json
            )
            """,
            trades,
        )

        equity_start = datetime(2026, 8, 13, 0, 0, tzinfo=timezone.utc)
        snapshots = []
        equity = 10000.0
        for hour in range(0, 37):
            moment = equity_start + timedelta(hours=hour)
            drift = [0, 12, -5, 8, 0, 18, -10, 4, 26, 0, -8, 16][hour % 12]
            equity += drift
            snapshots.append((moment.isoformat(), round(equity, 2), round(equity, 2)))
        conn.executemany(
            "INSERT INTO equity_snapshots (time_utc, balance, equity) VALUES (?, ?, ?)",
            snapshots,
        )
    rebuild_campaign_models()


def _trade(
    trade_id: str,
    symbol: str,
    side: str,
    lots: float,
    open_time_utc: str,
    close_time_utc: str,
    entry_price: float,
    exit_price: float,
    pnl: float,
    screenshot_path: str,
    trend_name: str,
    trend_ids: dict[str, int],
    review: str,
) -> dict[str, Any]:
    ticket = trade_id.replace("DEMO-", "")
    return {
        "id": trade_id,
        "account": "LOCAL-DEMO",
        "order_no": ticket,
        "position_id": f"P-{ticket}",
        "order_ticket": f"O-{ticket}",
        "deal_ticket": f"D-{ticket}",
        "symbol": symbol,
        "side": side,
        "lots": lots,
        "open_time_utc": open_time_utc,
        "close_time_utc": close_time_utc,
        "duration_seconds": calculate_duration_seconds(open_time_utc, close_time_utc),
        "entry_price": entry_price,
        "exit_price": exit_price,
        "pnl": pnl,
        "commission": -2.0,
        "swap": 0.0,
        "screenshot_path": screenshot_path,
        "review_text": review,
        "trend_id": trend_ids[trend_name],
        "remark": "",
        "source": "demo",
        "raw_json": "{}",
    }


def _create_demo_screenshots() -> list[str]:
    paths = []
    colors = ["#2bd4ff", "#ff5c7a", "#4ade80", "#2bd4ff", "#ff5c7a", "#4ade80", "#2bd4ff"]
    for index, color in enumerate(colors, start=1):
        name = f"screenshots/demo-{index}.svg"
        file_path = get_runtime_paths().data / name
        file_path.parent.mkdir(parents=True, exist_ok=True)
        if not file_path.exists():
            file_path.write_text(_demo_chart_svg(index, color), encoding="utf-8")
        paths.append(name)
    return paths


def _demo_chart_svg(seed: int, accent: str) -> str:
    candles = []
    for i in range(24):
        x = 34 + i * 24
        wave = ((i * 7 + seed * 11) % 36) - 18
        top = 95 + wave
        bottom = top + 42 + ((i + seed) % 16)
        body_top = top + 10
        body_bottom = bottom - 12
        up = (i + seed) % 3 != 0
        fill = accent if up else "#ff5c7a"
        candles.append(f"<line x1='{x}' y1='{top}' x2='{x}' y2='{bottom}' stroke='{fill}' stroke-width='2'/>")
        candles.append(
            f"<rect x='{x - 6}' y='{body_top}' width='12' height='{max(8, body_bottom - body_top)}' rx='2' fill='{fill}' opacity='0.84'/>"
        )
    return (
        "<svg xmlns='http://www.w3.org/2000/svg' width='720' height='360' viewBox='0 0 720 360'>"
        "<rect width='720' height='360' fill='#071012'/>"
        "<g opacity='0.22' stroke='#9ad8e8' stroke-width='1'>"
        + "".join(f"<line x1='0' y1='{y}' x2='720' y2='{y}'/>" for y in range(60, 330, 45))
        + "".join(f"<line x1='{x}' y1='0' x2='{x}' y2='360'/>" for x in range(40, 720, 80))
        + "</g>"
        + "".join(candles)
        + f"<path d='M34 235 C140 180, 210 250, 310 190 S500 160, 662 122' fill='none' stroke='{accent}' stroke-width='3' opacity='0.85'/>"
        + "<text x='34' y='42' fill='#d9fbff' font-family='Segoe UI, sans-serif' font-size='20'>M5 Review Snapshot</text>"
        + "<text x='34' y='320' fill='#7f9ca5' font-family='Segoe UI, sans-serif' font-size='14'>demo chart placeholder - MT5 EA will replace with real screenshots</text>"
        + "</svg>"
    )


def _event_hash(raw_event: str) -> str:
    return hashlib.sha256(raw_event.encode("utf-8")).hexdigest()


def _canonical_event_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _event_hash(canonical)

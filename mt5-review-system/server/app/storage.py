from __future__ import annotations

import json
import base64
import binascii
import hashlib
import math
import mimetypes
import sqlite3
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from .campaigns import (
    build_r_metrics,
    calculate_campaign_r,
    calculate_position_risk,
    group_campaigns,
    reconstruct_positions,
)
from .analytics import (
    build_daily_system_evaluation,
    build_cumulative_return_curve,
    build_equity_curve,
    build_hour_heatmap,
    build_month_calendar,
    build_mode_evaluation,
    build_session_stats,
    build_trade_metrics,
    calculate_duration_seconds,
    calculate_runs_z,
    trade_net_pnl,
    to_beijing,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
SCREENSHOT_DIR = DATA_DIR / "screenshots"
RAW_EVENTS_DIR = DATA_DIR / "raw-events"
BACKUP_DIR = PROJECT_ROOT / "backups"
DB_PATH = DATA_DIR / "journal.sqlite"

CLASSIFICATION_DIMENSIONS = {"trade_type", "strategy"}
DEFAULT_CLASSIFICATION_OPTIONS = (
    ("unclassified", "trade_type", "未分类", "#8ca29b", 0),
    ("follow", "trade_type", "跟随", "#2bd4ff", 1),
    ("reversal", "trade_type", "反转", "#f97316", 2),
    ("strategy_unclassified", "strategy", "未分类", "#8ca29b", 0),
    ("breakout", "strategy", "突破/窄通道", "#2bd4ff", 1),
    ("range", "strategy", "宽通道/震荡区间", "#f4c95d", 2),
    ("major_reversal", "strategy", "大反转交易", "#ff5c7a", 3),
)


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def db():
    conn = connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _backup_before_v4_migration() -> dict[str, Any] | None:
    if not DB_PATH.exists() or DB_PATH.stat().st_size == 0:
        return None
    source = sqlite3.connect(DB_PATH, timeout=10)
    try:
        table = source.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'"
        ).fetchone()
        version_row = (
            source.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()
            if table
            else None
        )
        version = int(version_row[0]) if version_row else 0
        if version >= 4:
            return None
        created_at = datetime.now(timezone.utc)
        filename = (
            f"pre-v4-{created_at.strftime('%Y%m%d-%H%M%S')}-"
            f"{uuid.uuid4().hex[:6]}.sqlite"
        )
        snapshot_path = BACKUP_DIR / filename
        destination = sqlite3.connect(snapshot_path)
        try:
            source.backup(destination)
        finally:
            destination.close()
        return {
            "file_path": str(snapshot_path),
            "created_at": created_at.isoformat(),
            "size_bytes": snapshot_path.stat().st_size,
        }
    finally:
        source.close()


def init_db(seed: bool = True) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    RAW_EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    migration_backup = _backup_before_v4_migration()

    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS trends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL DEFAULT '#4fd1c5',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trades (
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

            CREATE TABLE IF NOT EXISTS custom_fields (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                field_type TEXT NOT NULL DEFAULT 'text',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

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
            );

            CREATE TABLE IF NOT EXISTS custom_field_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#2bd4ff',
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS trade_custom_values (
                trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
                field_id INTEGER NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
                value TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (trade_id, field_id)
            );

            CREATE TABLE IF NOT EXISTS equity_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time_utc TEXT NOT NULL UNIQUE,
                balance REAL NOT NULL,
                equity REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS raw_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                received_at TEXT NOT NULL,
                event_hash TEXT UNIQUE,
                payload TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ingest_cursors (
                file_path TEXT PRIMARY KEY,
                byte_offset INTEGER NOT NULL DEFAULT 0,
                file_size INTEGER NOT NULL DEFAULT 0,
                modified_ns INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL,
                size_bytes INTEGER NOT NULL
            );
            """
        )
        _ensure_schema(conn)
        if migration_backup:
            conn.execute(
                "INSERT INTO backups (file_path, created_at, size_bytes) VALUES (?, ?, ?)",
                (
                    migration_backup["file_path"],
                    migration_backup["created_at"],
                    migration_backup["size_bytes"],
                ),
            )
    if seed:
        seed_demo_data()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    version_row = conn.execute(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'"
    ).fetchone()
    previous_version = int(version_row["value"]) if version_row else 0
    trade_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(trades)").fetchall()
    }
    for name, definition in {
        "fee": "REAL NOT NULL DEFAULT 0",
        "trade_type": "TEXT NOT NULL DEFAULT 'unclassified'",
        "strategy": "TEXT NOT NULL DEFAULT 'strategy_unclassified'",
        "deleted_at": "TEXT",
    }.items():
        if name not in trade_columns:
            conn.execute(f"ALTER TABLE trades ADD COLUMN {name} {definition}")

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
        CREATE INDEX IF NOT EXISTS idx_campaign_positions_campaign
            ON campaign_positions(campaign_id, sort_order);
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO analysis_settings (key, value) VALUES ('scratch_threshold_r', '0.15')"
    )
    _rebuild_campaign_models_conn(conn)
    conn.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '4') "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )


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


def get_dashboard(year: int | None = None, month: int | None = None) -> dict[str, Any]:
    trades = list_trades()
    snapshots = list_equity_snapshots()
    classification_options = list_classification_options()
    with db() as conn:
        campaigns = [record for record in _campaign_records_conn(conn) if record.get("status") == "closed"]
    threshold = get_analysis_settings()["scratch_threshold_r"]
    anchor = _latest_activity_time(trades, snapshots)
    target = to_beijing(anchor)
    selected_year = year or target.year
    selected_month = month or target.month

    periods = build_period_summaries(trades, anchor)
    period_r_metrics = _build_campaign_period_metrics(campaigns, anchor, threshold)
    for key, metrics in period_r_metrics.items():
        periods.setdefault(key, {})["r_metrics"] = metrics
    return {
        "summary": build_summary(trades, snapshots, anchor),
        "status": get_local_status(),
        "trends": list_trends(),
        "custom_fields": list_custom_fields(),
        "classification_options": classification_options,
        "trades": trades,
        "campaigns": [
            _serialize_campaign_record(record, include_positions=False) for record in campaigns
        ],
        "r_metrics": build_r_metrics(campaigns, threshold),
        "periods": periods,
        "equity": build_cumulative_return_curve(trades, snapshots, now_utc=anchor, hours=24 * 30),
        "calendar": build_month_calendar(trades, selected_year, selected_month),
        "heatmap": build_hour_heatmap(trades, anchor_utc=anchor, days=7),
        "sessions": build_session_stats(trades),
        "system_evaluation": _build_daily_campaign_evaluation(campaigns, threshold),
        "mode_evaluation": {
            "trade_type": _labeled_campaign_mode_evaluation(
                campaigns, "trade_type", classification_options, threshold
            ),
            "strategy": _labeled_campaign_mode_evaluation(
                campaigns, "strategy", classification_options, threshold
            ),
        },
        "backups": list_backups(),
    }


def get_analysis(
    start_date: str | None = None,
    end_date: str | None = None,
    equity_days: int = 30,
) -> dict[str, Any]:
    trades = _filter_trades_by_date(list_trades(), start_date, end_date)
    snapshots = list_equity_snapshots()
    classification_options = list_classification_options()
    with db() as conn:
        all_campaigns = [
            record for record in _campaign_records_conn(conn) if record.get("status") == "closed"
        ]
    campaigns = _filter_campaigns_by_date(all_campaigns, start_date, end_date)
    threshold = get_analysis_settings()["scratch_threshold_r"]
    anchor = (
        datetime.fromisoformat(f"{end_date}T23:59:59+08:00").astimezone(timezone.utc)
        if end_date
        else _latest_activity_time(trades, snapshots)
    )
    days = max(1, min(int(equity_days), 366))
    periods = build_period_summaries(trades, anchor)
    period_r_metrics = _build_campaign_period_metrics(campaigns, anchor, threshold)
    for key, metrics in period_r_metrics.items():
        periods.setdefault(key, {})["r_metrics"] = metrics
    return {
        "start_date": start_date or "",
        "end_date": end_date or "",
        "metrics": build_trade_metrics(trades),
        "r_metrics": build_r_metrics(campaigns, threshold),
        "periods": periods,
        "equity": build_cumulative_return_curve(
            trades,
            snapshots,
            now_utc=anchor,
            hours=days * 24,
            start_date=start_date,
            end_date=end_date,
        ),
        "system_evaluation": _build_daily_campaign_evaluation(campaigns, threshold),
        "mode_evaluation": {
            "trade_type": _labeled_campaign_mode_evaluation(
                campaigns, "trade_type", classification_options, threshold
            ),
            "strategy": _labeled_campaign_mode_evaluation(
                campaigns, "strategy", classification_options, threshold
            ),
        },
    }


def _campaign_cash_metrics(campaigns: list[dict[str, Any]]) -> dict[str, Any]:
    proxy_trades = [
        {
            "pnl": float(campaign.get("net_pnl") or 0.0),
            "commission": 0.0,
            "swap": 0.0,
            "fee": 0.0,
        }
        for campaign in campaigns
    ]
    metrics = build_trade_metrics(proxy_trades)
    metrics["cash_win_rate"] = metrics["win_rate"]
    return metrics


def _campaign_evaluation_row(
    campaigns: list[dict[str, Any]], threshold: float
) -> dict[str, Any]:
    cash = _campaign_cash_metrics(campaigns)
    r_metrics = build_r_metrics(campaigns, threshold)
    return {
        **cash,
        "r_metrics": r_metrics,
        "z_score": r_metrics["z_score"],
    }


def _build_daily_campaign_evaluation(
    campaigns: list[dict[str, Any]], threshold: float
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for campaign in campaigns:
        closed_at = campaign.get("closed_at_utc")
        if not closed_at:
            continue
        key = to_beijing(closed_at).date().isoformat()
        grouped.setdefault(key, []).append(campaign)
    rows = []
    for key in sorted(grouped):
        rows.append({"date": key, **_campaign_evaluation_row(grouped[key], threshold)})
    return rows


def _labeled_campaign_mode_evaluation(
    campaigns: list[dict[str, Any]],
    dimension: str,
    options: list[dict[str, Any]],
    threshold: float,
) -> list[dict[str, Any]]:
    if dimension not in {"trade_type", "strategy"}:
        raise ValueError("dimension must be trade_type or strategy")
    labels = {
        str(option["id"]): str(option["label"])
        for option in options
        if option["dimension"] == dimension
    }
    grouped: dict[str, list[dict[str, Any]]] = {}
    for campaign in campaigns:
        key = str(campaign.get(dimension) or "unclassified")
        grouped.setdefault(key, []).append(campaign)
    total = len(campaigns)
    return [
        {
            "key": key,
            "label": labels.get(key, key),
            "share": len(grouped[key]) / total if total else 0.0,
            **_campaign_evaluation_row(grouped[key], threshold),
        }
        for key in sorted(grouped)
    ]


def _filter_campaigns_by_date(
    campaigns: list[dict[str, Any]],
    start_date: str | None,
    end_date: str | None,
) -> list[dict[str, Any]]:
    start = date.fromisoformat(start_date) if start_date else None
    end = date.fromisoformat(end_date) if end_date else None
    if start and end and start > end:
        raise ValueError("start_date cannot be after end_date")
    selected = []
    for campaign in campaigns:
        closed_at = campaign.get("closed_at_utc")
        if not closed_at:
            continue
        closed = to_beijing(closed_at).date()
        if start and closed < start:
            continue
        if end and closed > end:
            continue
        selected.append(campaign)
    return selected


def _build_campaign_period_metrics(
    campaigns: list[dict[str, Any]], anchor: datetime, threshold: float
) -> dict[str, dict[str, Any]]:
    anchor_date = to_beijing(anchor).date()
    windows = {
        "today": (anchor_date, anchor_date),
        "week": (anchor_date - timedelta(days=anchor_date.weekday()), anchor_date),
        "month": (anchor_date.replace(day=1), anchor_date),
        "year": (anchor_date.replace(month=1, day=1), anchor_date),
    }
    return {
        key: build_r_metrics(
            [
                campaign
                for campaign in campaigns
                if campaign.get("closed_at_utc")
                and start <= to_beijing(campaign["closed_at_utc"]).date() <= end
            ],
            threshold,
        )
        for key, (start, end) in windows.items()
    }


def _labeled_mode_evaluation(
    trades: list[dict[str, Any]],
    dimension: str,
    options: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    labels = {
        option["id"]: option["label"]
        for option in options
        if option["dimension"] == dimension
    }
    rows = build_mode_evaluation(trades, dimension)
    for row in rows:
        row["label"] = labels.get(row["key"], row["key"])
    return rows


def _filter_trades_by_date(
    trades: list[dict[str, Any]],
    start_date: str | None,
    end_date: str | None,
) -> list[dict[str, Any]]:
    start = date.fromisoformat(start_date) if start_date else None
    end = date.fromisoformat(end_date) if end_date else None
    if start and end and start > end:
        raise ValueError("start_date cannot be after end_date")
    selected = []
    for trade in trades:
        closed = to_beijing(trade["close_time_utc"]).date()
        if start and closed < start:
            continue
        if end and closed > end:
            continue
        selected.append(trade)
    return selected


def build_summary(
    trades: list[dict[str, Any]],
    snapshots: list[dict[str, Any]],
    anchor_utc: datetime | None = None,
) -> dict[str, Any]:
    anchor = anchor_utc or _latest_activity_time(trades, snapshots)
    overall = build_trade_metrics(trades)
    recent_curve = build_equity_curve(
        snapshots,
        now_utc=anchor,
        hours=24 * 30,
    )
    latest_equity = recent_curve[-1]["equity"] if recent_curve else 0.0
    first_equity = recent_curve[0]["equity"] if recent_curve else latest_equity
    curve_delta = round(float(latest_equity) - float(first_equity), 2)
    open_reviews = sum(1 for trade in trades if not trade.get("review_text"))
    periods = build_period_summaries(trades, anchor)
    today = periods["today"]
    week = periods["week"]
    month = periods["month"]
    year = periods["year"]

    return {
        "account": trades[0]["account"] if trades else "LOCAL-DEMO",
        "net_pnl": overall["net_pnl"],
        "order_count": overall["order_count"],
        "win_rate": overall["win_rate"],
        "profit_factor": overall["profit_factor"],
        "payoff_ratio": overall["payoff_ratio"],
        "gross_profit": overall["gross_profit"],
        "gross_loss": overall["gross_loss"],
        "max_profit": overall["max_profit"],
        "max_loss": overall["max_loss"],
        "avg_trade": overall["avg_trade"],
        "today": today,
        "week": week,
        "month": month,
        "year": year,
        "week_net_pnl": week["net_pnl"],
        "week_order_count": week["order_count"],
        "week_win_rate": week["win_rate"],
        "month_net_pnl": month["net_pnl"],
        "month_order_count": month["order_count"],
        "month_win_rate": month["win_rate"],
        "latest_equity": latest_equity,
        "curve_delta": curve_delta,
        "open_reviews": open_reviews,
        "storage_mode": "local",
    }


def build_period_summaries(trades: list[dict[str, Any]], anchor: datetime) -> dict[str, dict[str, Any]]:
    anchor_bj = to_beijing(anchor).date()

    def period(start_date: date, end_date: date) -> dict[str, Any]:
        selected = _trades_in_date_range(trades, start_date, end_date)
        metrics = build_trade_metrics(selected)
        metrics["z_score"] = calculate_runs_z(selected)
        return metrics

    return {
        "today": period(anchor_bj, anchor_bj),
        "week": period(anchor_bj - timedelta(days=anchor_bj.weekday()), anchor_bj),
        "month": period(anchor_bj.replace(day=1), anchor_bj),
        "year": period(anchor_bj.replace(month=1, day=1), anchor_bj),
    }


def _rolling_trade_stats(
    trades: list[dict[str, Any]],
    start_date,
    end_date,
) -> dict[str, Any]:
    return build_trade_metrics(_trades_in_date_range(trades, start_date, end_date))


def _trades_in_date_range(
    trades: list[dict[str, Any]],
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    selected = []
    for trade in trades:
        closed = to_beijing(trade["close_time_utc"]).date()
        if start_date <= closed <= end_date:
            selected.append(trade)
    return selected


def get_local_status() -> dict[str, Any]:
    with db() as conn:
        counts = {
            "trades": conn.execute("SELECT COUNT(*) AS value FROM trades").fetchone()["value"],
            "raw_events": conn.execute("SELECT COUNT(*) AS value FROM raw_events").fetchone()["value"],
            "equity_snapshots": conn.execute("SELECT COUNT(*) AS value FROM equity_snapshots").fetchone()[
                "value"
            ],
        }
        latest_trade = conn.execute(
            "SELECT id, symbol, close_time_utc, pnl FROM trades ORDER BY close_time_utc DESC LIMIT 1"
        ).fetchone()
        latest_backup = conn.execute(
            "SELECT file_path, created_at, size_bytes FROM backups ORDER BY created_at DESC LIMIT 1"
        ).fetchone()

    screenshot_count = len([path for path in SCREENSHOT_DIR.glob("*") if path.is_file()])
    latest_raw_file = max(RAW_EVENTS_DIR.glob("*.jsonl"), key=lambda path: path.stat().st_mtime, default=None)
    return {
        "database_path": str(DB_PATH),
        "data_dir": str(DATA_DIR),
        "database_size_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
        "data_size_bytes": _dir_size(DATA_DIR),
        "screenshot_count": screenshot_count,
        "counts": counts,
        "latest_trade": dict(latest_trade) if latest_trade else None,
        "latest_backup": dict(latest_backup) if latest_backup else None,
        "latest_raw_event_file": str(latest_raw_file) if latest_raw_file else "",
        "bridge_endpoint": "http://127.0.0.1:8787/api/mt5/events",
    }


def list_trades(include_deleted: bool = False) -> list[dict[str, Any]]:
    with db() as conn:
        deleted_clause = "" if include_deleted else "WHERE trades.deleted_at IS NULL"
        rows = conn.execute(
            f"""
            SELECT trades.*, trends.name AS trend_name, trends.color AS trend_color
            FROM trades
            LEFT JOIN trends ON trends.id = trades.trend_id
            {deleted_clause}
            ORDER BY trades.close_time_utc DESC
            """
        ).fetchall()
        custom_values = _custom_values_for_trade_ids(conn, [row["id"] for row in rows])
    return [_serialize_trade(row, custom_values) for row in rows]


def query_trades(
    query: str = "",
    symbol: str = "",
    side: str = "all",
    trade_type: str = "all",
    strategy: str = "all",
    start_date: str | None = None,
    end_date: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    trades = _filter_trades_by_date(list_trades(), start_date, end_date)
    needle = query.strip().lower()
    symbol_needle = symbol.strip().lower()
    selected = []
    for trade in trades:
        haystack = " ".join(
            str(trade.get(key) or "")
            for key in ("id", "order_no", "display_order_no", "symbol")
        ).lower()
        if needle and needle not in haystack:
            continue
        if symbol_needle and symbol_needle not in str(trade.get("symbol", "")).lower():
            continue
        if side != "all" and trade.get("side") != side:
            continue
        if trade_type != "all" and trade.get("trade_type") != trade_type:
            continue
        if strategy != "all" and trade.get("strategy") != strategy:
            continue
        selected.append(trade)
    safe_page = max(1, int(page))
    safe_size = max(1, min(int(page_size), 200))
    start = (safe_page - 1) * safe_size
    return {
        "trades": selected[start : start + safe_size],
        "total": len(selected),
        "page": safe_page,
        "page_size": safe_size,
    }


def query_review_album(
    start_date: str | None = None,
    end_date: str | None = None,
    symbols: list[str] | str | None = None,
    tags: list[str] | str | None = None,
    sort: str = "desc",
    page: int = 1,
    page_size: int = 24,
) -> dict[str, Any]:
    """Query the album from the existing active trade and option records."""
    if sort not in {"asc", "desc"}:
        raise ValueError("sort must be asc or desc")

    symbol_values = _album_values(symbols)
    tag_values = _album_values(tags)
    all_trades = list_trades()
    filtered = _filter_trades_by_date(all_trades, start_date, end_date)
    if symbol_values:
        symbol_set = {value.casefold() for value in symbol_values}
        filtered = [
            trade for trade in filtered if str(trade.get("symbol") or "").casefold() in symbol_set
        ]

    catalog = _album_catalog()
    selected_groups = _album_tag_groups(tag_values, catalog)
    selected = [trade for trade in filtered if _trade_matches_album_tags(trade, selected_groups, catalog)]
    selected.sort(
        key=lambda trade: (str(trade.get("close_time_utc") or ""), str(trade.get("id") or "")),
        reverse=sort == "desc",
    )
    album_trades = [_serialize_album_trade(trade, catalog) for trade in selected]

    safe_page = max(1, int(page))
    safe_size = max(1, min(int(page_size), 100))
    start = (safe_page - 1) * safe_size
    page_trades = album_trades[start : start + safe_size]
    days = _group_album_days(page_trades)
    return {
        "filters": {
            "start": start_date or "",
            "end": end_date or "",
            "symbols": symbol_values,
            "tags": tag_values,
            "sort": sort,
        },
        "trades": page_trades,
        "days": days,
        "total": len(album_trades),
        "page": safe_page,
        "page_size": safe_size,
        "available_filters": {
            "symbols": sorted({str(trade.get("symbol") or "") for trade in all_trades if trade.get("symbol")}),
            "tags": catalog["available_tags"],
            "custom_fields": catalog["all_fields"],
        },
    }


def _album_values(value: list[str] | str | None) -> list[str]:
    if value is None:
        return []
    raw_values = value if isinstance(value, list) else [value]
    values = []
    for raw_value in raw_values:
        values.extend(str(raw_value).split(","))
    return [item.strip() for item in values if item.strip()]


def _album_catalog() -> dict[str, Any]:
    all_options = list_classification_options(active_only=False)
    active_options = list_classification_options(active_only=True)
    classifications = {
        (str(option["dimension"]), str(option["id"])): option for option in all_options
    }
    all_fields = list_custom_fields()
    fields = {
        str(field["id"]): field
        for field in all_fields
        if field.get("field_type") in {"single", "multi"}
    }
    available_tags = []
    for option in active_options:
        dimension_label = "交易类型" if option["dimension"] == "trade_type" else "交易策略"
        available_tags.append(
            {
                "key": f"{option['dimension']}:{option['id']}",
                "label": f"{dimension_label} / {option['label']}",
                "dimension": option["dimension"],
                "color": option["color"],
            }
        )
    for field_id, field in fields.items():
        for option in field.get("options", []):
            available_tags.append(
                {
                    "key": f"field:{field_id}:{option['id']}",
                    "label": f"{field['name']} / {option['label']}",
                    "dimension": "custom_field",
                    "field_id": int(field_id),
                    "color": option["color"],
                }
            )
    return {
        "classifications": classifications,
        "fields": fields,
        "all_fields": all_fields,
        "available_tags": available_tags,
        "available_tag_keys": {str(tag["key"]) for tag in available_tags},
    }


def _album_tag_groups(tags: list[str], catalog: dict[str, Any]) -> dict[str, set[str]]:
    groups: dict[str, set[str]] = {}
    for tag in tags:
        parts = tag.split(":")
        if parts[0] in {"trade_type", "strategy"} and len(parts) == 2:
            key = (parts[0], parts[1])
            if key not in catalog["classifications"]:
                raise ValueError("Unknown album tag")
            groups.setdefault(parts[0], set()).add(tag)
            continue
        if parts[0] == "field" and len(parts) == 3:
            field_id, option_id = parts[1], parts[2]
            field = catalog["fields"].get(field_id)
            if not field or not any(str(option["id"]) == option_id for option in field.get("options", [])):
                raise ValueError("Unknown album tag")
            groups.setdefault(f"field:{field_id}", set()).add(tag)
            continue
        raise ValueError("Unknown album tag")
    return groups


def _trade_matches_album_tags(
    trade: dict[str, Any],
    groups: dict[str, set[str]],
    catalog: dict[str, Any],
) -> bool:
    if not groups:
        return True
    trade_tags = {
        tag["key"] for tag in _album_tags_for_trade(trade, catalog)
    }
    return all(trade_tags.intersection(group_tags) for group_tags in groups.values())


def _album_tags_for_trade(trade: dict[str, Any], catalog: dict[str, Any]) -> list[dict[str, Any]]:
    tags = []
    for dimension in ("trade_type", "strategy"):
        option_id = str(trade.get(dimension) or "")
        option = catalog["classifications"].get((dimension, option_id))
        if option:
            dimension_label = "交易类型" if dimension == "trade_type" else "交易策略"
            tags.append(
                {
                    "key": f"{dimension}:{option_id}",
                    "label": f"{dimension_label} / {option['label']}",
                    "dimension": dimension,
                    "color": option["color"],
                }
            )
    for field_id, field in catalog["fields"].items():
        value = trade.get("custom_fields", {}).get(field_id, "")
        values = value if isinstance(value, list) else [value]
        option_map = {str(option["id"]): option for option in field.get("options", [])}
        for option_id in values:
            option = option_map.get(str(option_id))
            if option:
                tags.append(
                    {
                        "key": f"field:{field_id}:{option_id}",
                        "label": f"{field['name']} / {option['label']}",
                        "dimension": "custom_field",
                        "field_id": int(field_id),
                        "color": option["color"],
                    }
                )
    return tags


def _serialize_album_trade(trade: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    serialized = dict(trade)
    serialized["album_date"] = to_beijing(trade["close_time_utc"]).date().isoformat()
    serialized["album_tags"] = _album_tags_for_trade(trade, catalog)
    return serialized


def _group_album_days(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for trade in trades:
        groups.setdefault(trade["album_date"], []).append(trade)
    return [
        {
            "date": day,
            "order_count": len(day_trades),
            "net_pnl": round(sum(float(trade.get("net_pnl") or 0) for trade in day_trades), 2),
            "trades": day_trades,
        }
        for day, day_trades in groups.items()
    ]


def get_trade(trade_id: str, include_deleted: bool = False) -> dict[str, Any] | None:
    with db() as conn:
        deleted_clause = "" if include_deleted else "AND trades.deleted_at IS NULL"
        row = conn.execute(
            f"""
            SELECT trades.*, trends.name AS trend_name, trends.color AS trend_color
            FROM trades
            LEFT JOIN trends ON trends.id = trades.trend_id
            WHERE trades.id = ? {deleted_clause}
            """,
            (trade_id,),
        ).fetchone()
        custom_values = _custom_values_for_trade_ids(conn, [row["id"]]) if row else {}
    return _serialize_trade(row, custom_values) if row else None


MAX_MANUAL_SCREENSHOT_BYTES = 15 * 1024 * 1024
SCREENSHOT_MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


def replace_trade_screenshot(trade_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    image_bytes, extension = _decode_manual_screenshot(payload)
    new_path = f"screenshots/manual-{uuid.uuid4().hex}{extension}"
    new_file = DATA_DIR / new_path
    new_file.parent.mkdir(parents=True, exist_ok=True)
    new_file.write_bytes(image_bytes)

    try:
        with db() as conn:
            current = conn.execute(
                "SELECT id, screenshot_path, raw_json FROM trades WHERE id = ? AND deleted_at IS NULL",
                (trade_id,),
            ).fetchone()
            if not current:
                raise KeyError(trade_id)
            old_path = str(current["screenshot_path"] or "")
            raw_json = _raw_json_with_screenshot_path(current["raw_json"], new_path)
            conn.execute(
                """
                UPDATE trades
                SET screenshot_path = ?, raw_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (new_path, raw_json, trade_id),
            )
    except Exception:
        new_file.unlink(missing_ok=True)
        raise

    _remove_unreferenced_screenshot(old_path, trade_id)
    trade = get_trade(trade_id)
    if not trade:
        raise KeyError(trade_id)
    return trade


def delete_trade_screenshot(trade_id: str) -> dict[str, Any]:
    with db() as conn:
        current = conn.execute(
            "SELECT id, screenshot_path, raw_json FROM trades WHERE id = ? AND deleted_at IS NULL",
            (trade_id,),
        ).fetchone()
        if not current:
            raise KeyError(trade_id)
        old_path = str(current["screenshot_path"] or "")
        raw_json = _raw_json_with_screenshot_path(current["raw_json"], "")
        conn.execute(
            """
            UPDATE trades
            SET screenshot_path = '', raw_json = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (raw_json, trade_id),
        )

    _remove_unreferenced_screenshot(old_path, trade_id)
    trade = get_trade(trade_id)
    if not trade:
        raise KeyError(trade_id)
    return trade


def _decode_manual_screenshot(payload: dict[str, Any]) -> tuple[bytes, str]:
    raw_data = str(payload.get("image_data", "")).strip()
    if not raw_data:
        raise ValueError("Screenshot image data is required")
    mime = ""
    encoded = raw_data
    if raw_data.startswith("data:"):
        header, separator, encoded = raw_data.partition(",")
        if not separator or ";base64" not in header:
            raise ValueError("Screenshot must be a base64 data URL")
        mime = header[5:].split(";", 1)[0].lower()
    if not mime:
        filename = str(payload.get("filename", "")).strip()
        mime = mimetypes.guess_type(filename)[0] or ""
    extension = SCREENSHOT_MIME_EXTENSIONS.get(mime)
    if not extension:
        raise ValueError("Unsupported screenshot format")
    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("Invalid screenshot image data") from exc
    if not image_bytes:
        raise ValueError("Screenshot image data is empty")
    if len(image_bytes) > MAX_MANUAL_SCREENSHOT_BYTES:
        raise ValueError("Screenshot image is too large")
    return image_bytes, extension


def _raw_json_with_screenshot_path(raw_json: Any, screenshot_path: str) -> str:
    try:
        parsed = json.loads(str(raw_json or "{}"))
    except (TypeError, json.JSONDecodeError):
        parsed = {}
    if not isinstance(parsed, dict):
        parsed = {}
    parsed["screenshot_path"] = screenshot_path
    return json.dumps(parsed, ensure_ascii=False)


def _remove_unreferenced_screenshot(path_value: str, trade_id: str) -> None:
    relative = str(path_value or "").replace("\\", "/").strip()
    if not relative:
        return
    candidate = (DATA_DIR / relative).resolve()
    screenshot_root = SCREENSHOT_DIR.resolve()
    if not candidate.is_relative_to(screenshot_root) or not candidate.is_file():
        return
    with db() as conn:
        references = conn.execute(
            "SELECT COUNT(*) AS count FROM trades WHERE screenshot_path = ? AND id != ?",
            (relative, trade_id),
        ).fetchone()["count"]
    if not references:
        candidate.unlink(missing_ok=True)


def update_trade_review(trade_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        existing = conn.execute(
            "SELECT id, review_text, trend_id, trade_type, strategy FROM trades WHERE id = ?",
            (trade_id,),
        ).fetchone()
        if not existing:
            raise KeyError(trade_id)
        trade_type = str(payload.get("trade_type", existing["trade_type"]) or "unclassified")
        strategy = str(payload.get("strategy", existing["strategy"]) or "strategy_unclassified")
        _validate_classification_assignment(
            conn, "trade_type", trade_type, existing["trade_type"]
        )
        _validate_classification_assignment(
            conn, "strategy", strategy, existing["strategy"]
        )
        conn.execute(
            """
            UPDATE trades
            SET review_text = ?, trend_id = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                str(payload.get("review_text", existing["review_text"])),
                payload.get("trend_id", existing["trend_id"]),
                trade_type,
                strategy,
                trade_id,
            ),
        )
    trade = get_trade(trade_id)
    if not trade:
        raise KeyError(trade_id)
    return trade


def delete_trade(trade_id: str) -> None:
    with db() as conn:
        cursor = conn.execute(
            "UPDATE trades SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL",
            (trade_id,),
        )
        if cursor.rowcount == 0:
            raise KeyError(trade_id)
    rebuild_campaign_models()


def restore_trade(trade_id: str) -> dict[str, Any]:
    with db() as conn:
        cursor = conn.execute(
            "UPDATE trades SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (trade_id,),
        )
        if cursor.rowcount == 0:
            raise KeyError(trade_id)
    rebuild_campaign_models()
    trade = get_trade(trade_id)
    if not trade:
        raise KeyError(trade_id)
    return trade


def _serialize_classification_option(row: sqlite3.Row) -> dict[str, Any]:
    option = dict(row)
    option["active"] = bool(option["active"])
    return option


def list_classification_options(
    dimension: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    if dimension is not None and dimension not in CLASSIFICATION_DIMENSIONS:
        raise ValueError("dimension must be trade_type or strategy")
    clauses = []
    values: list[Any] = []
    if dimension:
        clauses.append("dimension = ?")
        values.append(dimension)
    if active_only:
        clauses.append("active = 1")
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT id, dimension, label, color, sort_order, active
            FROM classification_options
            {where}
            ORDER BY dimension, active DESC, sort_order, label, id
            """,
            values,
        ).fetchall()
    return [_serialize_classification_option(row) for row in rows]


def create_classification_option(payload: dict[str, Any]) -> dict[str, Any]:
    dimension = str(payload.get("dimension", "")).strip()
    if dimension not in CLASSIFICATION_DIMENSIONS:
        raise ValueError("dimension must be trade_type or strategy")
    label = str(payload.get("label", "")).strip()
    if not label:
        raise ValueError("Option label is required")
    color = str(payload.get("color", "#2bd4ff")).strip() or "#2bd4ff"
    option_id = f"{dimension}_{uuid.uuid4().hex}"
    try:
        with db() as conn:
            max_order = conn.execute(
                "SELECT COALESCE(MAX(sort_order), 0) AS value FROM classification_options WHERE dimension = ?",
                (dimension,),
            ).fetchone()["value"]
            conn.execute(
                """
                INSERT INTO classification_options
                    (id, dimension, label, color, sort_order, active)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (option_id, dimension, label, color, int(max_order) + 1),
            )
            row = conn.execute(
                """
                SELECT id, dimension, label, color, sort_order, active
                FROM classification_options WHERE id = ?
                """,
                (option_id,),
            ).fetchone()
    except sqlite3.IntegrityError as exc:
        raise ValueError("Option label already exists") from exc
    return _serialize_classification_option(row)


def update_classification_option(option_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        current = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
        if not current:
            raise KeyError(option_id)
        label = str(payload.get("label", current["label"])).strip()
        if not label:
            raise ValueError("Option label is required")
        color = str(payload.get("color", current["color"])).strip() or current["color"]
        try:
            conn.execute(
                """
                UPDATE classification_options
                SET label = ?, color = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (label, color, option_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Option label already exists") from exc
        row = conn.execute(
            "SELECT id, dimension, label, color, sort_order, active FROM classification_options WHERE id = ?",
            (option_id,),
        ).fetchone()
    return _serialize_classification_option(row)


def delete_classification_option(option_id: str) -> None:
    with db() as conn:
        cursor = conn.execute(
            """
            UPDATE classification_options
            SET active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND active = 1
            """,
            (option_id,),
        )
        if cursor.rowcount == 0:
            raise KeyError(option_id)


def _validate_classification_assignment(
    conn: sqlite3.Connection,
    dimension: str,
    option_id: str,
    current_id: str,
) -> None:
    option = conn.execute(
        "SELECT dimension, active FROM classification_options WHERE id = ?",
        (option_id,),
    ).fetchone()
    if not option or option["dimension"] != dimension:
        raise ValueError(f"Invalid {dimension} option")
    if not option["active"] and option_id != current_id:
        raise ValueError(f"Inactive {dimension} option")


def _ensure_classification_option(
    conn: sqlite3.Connection,
    dimension: str,
    raw_value: Any,
) -> str:
    value = str(raw_value or "unclassified").strip() or "unclassified"
    if dimension == "strategy" and value == "unclassified":
        value = "strategy_unclassified"
    existing = conn.execute(
        "SELECT id, dimension FROM classification_options WHERE id = ?",
        (value,),
    ).fetchone()
    if existing and existing["dimension"] == dimension:
        return value
    by_label = conn.execute(
        "SELECT id FROM classification_options WHERE dimension = ? AND label = ?",
        (dimension, value),
    ).fetchone()
    if by_label:
        return str(by_label["id"])
    option_id = value
    if existing:
        digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]
        option_id = f"legacy_{dimension}_{digest}"
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS value FROM classification_options WHERE dimension = ?",
        (dimension,),
    ).fetchone()["value"]
    conn.execute(
        """
        INSERT OR IGNORE INTO classification_options
            (id, dimension, label, color, sort_order, active)
        VALUES (?, ?, ?, '#8ca29b', ?, 1)
        """,
        (option_id, dimension, value, int(max_order) + 1),
    )
    return option_id


def list_trends() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, color, sort_order FROM trends ORDER BY sort_order, id"
        ).fetchall()
    return [dict(row) for row in rows]


def create_trend(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Trend name is required")
    color = str(payload.get("color", "#4fd1c5")).strip() or "#4fd1c5"
    with db() as conn:
        max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS value FROM trends").fetchone()[
            "value"
        ]
        cursor = conn.execute(
            "INSERT INTO trends (name, color, sort_order) VALUES (?, ?, ?)",
            (name, color, int(max_order) + 1),
        )
        trend_id = cursor.lastrowid
        row = conn.execute(
            "SELECT id, name, color, sort_order FROM trends WHERE id = ?",
            (trend_id,),
        ).fetchone()
    return dict(row)


def update_trend(trend_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Trend name is required")
    color = str(payload.get("color", "#4fd1c5")).strip() or "#4fd1c5"
    with db() as conn:
        conn.execute(
            "UPDATE trends SET name = ?, color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (name, color, trend_id),
        )
        row = conn.execute(
            "SELECT id, name, color, sort_order FROM trends WHERE id = ?",
            (trend_id,),
        ).fetchone()
    if not row:
        raise KeyError(trend_id)
    return dict(row)


def delete_trend(trend_id: int) -> None:
    with db() as conn:
        cursor = conn.execute("DELETE FROM trends WHERE id = ?", (trend_id,))
        if cursor.rowcount == 0:
            raise KeyError(trend_id)


def _serialize_custom_field(
    row: sqlite3.Row,
    options_by_field: dict[int, list[dict[str, Any]]],
) -> dict[str, Any]:
    field = dict(row)
    field["field_type"] = field.get("field_type") or "text"
    field["options"] = options_by_field.get(int(field["id"]), [])
    return field


def _custom_options_for_field_ids(
    conn: sqlite3.Connection,
    field_ids: list[int],
) -> dict[int, list[dict[str, Any]]]:
    if not field_ids:
        return {}
    placeholders = ",".join("?" for _ in field_ids)
    rows = conn.execute(
        f"""
        SELECT id, field_id, label, color, sort_order
        FROM custom_field_options
        WHERE field_id IN ({placeholders})
        ORDER BY sort_order, id
        """,
        field_ids,
    ).fetchall()
    options: dict[int, list[dict[str, Any]]] = {int(field_id): [] for field_id in field_ids}
    for row in rows:
        options.setdefault(int(row["field_id"]), []).append(dict(row))
    return options


def _replace_custom_options(
    conn: sqlite3.Connection,
    field_id: int,
    raw_options: Any,
    field_type: str,
) -> None:
    if field_type == "text":
        conn.execute("DELETE FROM custom_field_options WHERE field_id = ?", (field_id,))
        return
    options = raw_options if isinstance(raw_options, list) else []
    kept_ids = []
    for index, option in enumerate(options, start=1):
        if not isinstance(option, dict):
            continue
        label = str(option.get("label", "")).strip()
        if not label:
            continue
        color = str(option.get("color", "#2bd4ff")).strip() or "#2bd4ff"
        option_id = option.get("id")
        if option_id:
            existing = conn.execute(
                "SELECT id FROM custom_field_options WHERE id = ? AND field_id = ?",
                (int(option_id), field_id),
            ).fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE custom_field_options
                    SET label = ?, color = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND field_id = ?
                    """,
                    (label, color, index, int(option_id), field_id),
                )
                kept_ids.append(int(option_id))
                continue
        cursor = conn.execute(
            """
            INSERT INTO custom_field_options (field_id, label, color, sort_order)
            VALUES (?, ?, ?, ?)
            """,
            (field_id, label, color, index),
        )
        kept_ids.append(int(cursor.lastrowid))
    if kept_ids:
        placeholders = ",".join("?" for _ in kept_ids)
        conn.execute(
            f"DELETE FROM custom_field_options WHERE field_id = ? AND id NOT IN ({placeholders})",
            [field_id, *kept_ids],
        )
    else:
        conn.execute("DELETE FROM custom_field_options WHERE field_id = ?", (field_id,))


def _option_ids_for_field(conn: sqlite3.Connection, field_id: int) -> set[str]:
    rows = conn.execute(
        "SELECT id FROM custom_field_options WHERE field_id = ?",
        (field_id,),
    ).fetchall()
    return {str(row["id"]) for row in rows}


def _normalize_field_type(value: Any) -> str:
    field_type = str(value or "text").strip().lower()
    if field_type not in {"text", "single", "multi"}:
        raise ValueError("Field type must be text, single, or multi")
    return field_type


def _normalize_custom_value(value: Any, field_type: str, allowed_options: set[str]) -> tuple[Any, str]:
    if field_type == "multi":
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                selected: list[str] = []
            else:
                try:
                    parsed = json.loads(stripped)
                    selected = parsed if isinstance(parsed, list) else [str(parsed)]
                except json.JSONDecodeError:
                    selected = [stripped]
        elif isinstance(value, list):
            selected = [str(item) for item in value if str(item).strip()]
        else:
            selected = []
        invalid = [item for item in selected if item not in allowed_options]
        if invalid:
            raise ValueError("Unknown option id")
        return selected, json.dumps(selected, ensure_ascii=False)
    if field_type == "single":
        selected = str(value or "").strip()
        if selected and selected not in allowed_options:
            raise ValueError("Unknown option id")
        return selected, selected
    return str(value or ""), str(value or "")

def list_custom_fields() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields ORDER BY sort_order, id"
        ).fetchall()
        options = _custom_options_for_field_ids(conn, [row["id"] for row in rows])
    return [_serialize_custom_field(row, options) for row in rows]


def create_custom_field(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Field name is required")
    field_type = _normalize_field_type(payload.get("field_type", "text"))
    with db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS value FROM custom_fields"
        ).fetchone()["value"]
        cursor = conn.execute(
            "INSERT INTO custom_fields (name, field_type, sort_order) VALUES (?, ?, ?)",
            (name, field_type, int(max_order) + 1),
        )
        field_id = cursor.lastrowid
        _replace_custom_options(conn, int(field_id), payload.get("options", []), field_type)
        row = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        options = _custom_options_for_field_ids(conn, [int(field_id)])
    return _serialize_custom_field(row, options)


def update_custom_field(field_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name", "")).strip()
    if not name:
        raise ValueError("Field name is required")
    with db() as conn:
        current = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if not current:
            raise KeyError(field_id)
        current_options = _custom_options_for_field_ids(conn, [field_id]).get(field_id, [])
        field_type = _normalize_field_type(payload.get("field_type", current["field_type"] or "text"))
        options = payload["options"] if "options" in payload else current_options
        conn.execute(
            """
            UPDATE custom_fields
            SET name = ?, field_type = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (name, field_type, field_id),
        )
        _replace_custom_options(conn, field_id, options, field_type)
        row = conn.execute(
            "SELECT id, name, field_type, sort_order FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        updated_options = _custom_options_for_field_ids(conn, [field_id])
    return _serialize_custom_field(row, updated_options)


def delete_custom_field(field_id: int) -> None:
    with db() as conn:
        cursor = conn.execute("DELETE FROM custom_fields WHERE id = ?", (field_id,))
        if cursor.rowcount == 0:
            raise KeyError(field_id)


def update_trade_custom_value(
    trade_id: str,
    field_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    with db() as conn:
        trade = conn.execute("SELECT id FROM trades WHERE id = ?", (trade_id,)).fetchone()
        if not trade:
            raise KeyError(trade_id)
        field = conn.execute(
            "SELECT id, field_type FROM custom_fields WHERE id = ?",
            (field_id,),
        ).fetchone()
        if not field:
            raise KeyError(field_id)
        allowed = _option_ids_for_field(conn, field_id)
        value, stored = _normalize_custom_value(payload.get("value", ""), field["field_type"], allowed)
        conn.execute(
            """
            INSERT INTO trade_custom_values (trade_id, field_id, value, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(trade_id, field_id) DO UPDATE SET
                value = excluded.value,
                updated_at = CURRENT_TIMESTAMP
            """,
            (trade_id, field_id, stored),
        )
    return {"trade_id": trade_id, "field_id": field_id, "value": value}


def list_equity_snapshots() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT time_utc, balance, equity FROM equity_snapshots ORDER BY time_utc"
        ).fetchall()
    return [dict(row) for row in rows]


def get_ingest_cursor(file_path: str) -> dict[str, Any] | None:
    with db() as conn:
        row = conn.execute(
            "SELECT file_path, byte_offset, file_size, modified_ns, updated_at FROM ingest_cursors WHERE file_path = ?",
            (file_path,),
        ).fetchone()
    return dict(row) if row else None


def update_ingest_cursor(
    file_path: str,
    byte_offset: int,
    file_size: int,
    modified_ns: int,
) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO ingest_cursors (file_path, byte_offset, file_size, modified_ns, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(file_path) DO UPDATE SET
                byte_offset = excluded.byte_offset,
                file_size = excluded.file_size,
                modified_ns = excluded.modified_ns,
                updated_at = CURRENT_TIMESTAMP
            """,
            (file_path, int(byte_offset), int(file_size), int(modified_ns)),
        )


def list_backups() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT id, file_path, created_at, size_bytes FROM backups ORDER BY created_at DESC LIMIT 10"
        ).fetchall()
    return [dict(row) for row in rows]


def create_backup() -> dict[str, Any]:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_path = BACKUP_DIR / f"mt5-review-backup-{timestamp}.zip"

    with zipfile.ZipFile(backup_path, "w", zipfile.ZIP_DEFLATED) as archive:
        if DB_PATH.exists():
            archive.write(DB_PATH, "data/journal.sqlite")
        for folder in (SCREENSHOT_DIR, RAW_EVENTS_DIR):
            for file_path in folder.rglob("*"):
                if file_path.is_file():
                    archive.write(file_path, file_path.relative_to(PROJECT_ROOT))

    size = backup_path.stat().st_size
    created_at = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        cursor = conn.execute(
            "INSERT INTO backups (file_path, created_at, size_bytes) VALUES (?, ?, ?)",
            (str(backup_path), created_at, size),
        )
        backup_id = cursor.lastrowid
    return {
        "id": backup_id,
        "file_path": str(backup_path),
        "created_at": created_at,
        "size_bytes": size,
    }


def ingest_mt5_event(
    payload: dict[str, Any],
    raw_event: str | None = None,
    event_hash: str | None = None,
) -> dict[str, Any]:
    received_at = datetime.now(timezone.utc).isoformat()
    line = raw_event or json.dumps(payload, ensure_ascii=False, sort_keys=True)
    fingerprint = event_hash or _canonical_event_hash(payload)

    raw_inserted = True
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO raw_events (received_at, event_hash, payload) VALUES (?, ?, ?)",
                (received_at, fingerprint, line),
            )
    except sqlite3.IntegrityError:
        raw_inserted = False

    if not raw_inserted:
        replayed = _apply_event_payload(payload)
        replayed.update({"received_at": received_at, "duplicate": True})
        return replayed

    RAW_EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    raw_file = RAW_EVENTS_DIR / f"events-{received_at[:10]}.jsonl"
    with raw_file.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")

    applied = _apply_event_payload(payload)
    applied.update({"received_at": received_at, "duplicate": False})
    return applied


def _apply_event_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("type") == "equity_snapshot":
        snapshot = upsert_equity_snapshot(payload)
        return {"trade_id": None, "snapshot": snapshot, "restored": False}

    if payload.get("type") == "deal":
        deal = _event_to_deal(payload)
        if not deal:
            return {"trade_id": None, "deal_ticket": None, "restored": False}
        upsert_deal_event(deal)
        return {
            "trade_id": None,
            "deal_ticket": deal["deal_ticket"],
            "restored": False,
        }

    trade = _event_to_trade(payload)
    if not trade:
        return {"trade_id": None, "restored": False}

    existed = get_trade(trade["id"]) is not None
    upsert_trade(trade)
    return {"trade_id": trade["id"], "restored": not existed}


def upsert_equity_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    time_utc = str(payload.get("time_utc") or datetime.now(timezone.utc).isoformat())
    balance = float(payload.get("balance", 0.0))
    equity = float(payload.get("equity", balance))
    with db() as conn:
        conn.execute(
            """
            INSERT INTO equity_snapshots (time_utc, balance, equity)
            VALUES (?, ?, ?)
            ON CONFLICT(time_utc) DO UPDATE SET
                balance = excluded.balance,
                equity = excluded.equity
            """,
            (time_utc, balance, equity),
        )
    return {"time_utc": time_utc, "balance": balance, "equity": equity}


def _event_to_deal(payload: dict[str, Any]) -> dict[str, Any] | None:
    required = (
        "deal_ticket",
        "position_id",
        "entry_kind",
        "deal_type",
        "symbol",
        "volume",
        "price",
        "time_utc",
    )
    if any(payload.get(key) in (None, "") for key in required):
        return None
    time_utc = str(payload["time_utc"])
    return {
        "deal_ticket": str(payload["deal_ticket"]),
        "account": str(payload.get("account") or "MT5-LOCAL"),
        "position_id": str(payload["position_id"]),
        "order_ticket": str(payload.get("order_ticket") or ""),
        "entry_kind": str(payload["entry_kind"]).lower(),
        "deal_type": str(payload["deal_type"]).lower(),
        "symbol": str(payload["symbol"]),
        "volume": float(payload["volume"]),
        "price": float(payload["price"]),
        "time_utc": time_utc,
        "time_msc": int(payload.get("time_msc") or _legacy_time_msc(time_utc)),
        "profit": float(payload.get("profit", 0.0) or 0.0),
        "commission": float(payload.get("commission", 0.0) or 0.0),
        "swap": float(payload.get("swap", 0.0) or 0.0),
        "fee": float(payload.get("fee", 0.0) or 0.0),
        "screenshot_path": str(payload.get("screenshot_path") or ""),
        "source_kind": "mt5",
        "source_trade_id": None,
        "raw_json": json.dumps(payload, ensure_ascii=False),
    }


def upsert_deal_event(deal: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO deal_events (
                deal_ticket, account, position_id, order_ticket, entry_kind, deal_type,
                symbol, volume, price, time_utc, time_msc, profit, commission, swap,
                fee, screenshot_path, source_kind, source_trade_id, raw_json
            ) VALUES (
                :deal_ticket, :account, :position_id, :order_ticket, :entry_kind, :deal_type,
                :symbol, :volume, :price, :time_utc, :time_msc, :profit, :commission, :swap,
                :fee, :screenshot_path, :source_kind, :source_trade_id, :raw_json
            )
            ON CONFLICT(deal_ticket) DO UPDATE SET
                account = excluded.account,
                position_id = excluded.position_id,
                order_ticket = excluded.order_ticket,
                entry_kind = excluded.entry_kind,
                deal_type = excluded.deal_type,
                symbol = excluded.symbol,
                volume = excluded.volume,
                price = excluded.price,
                time_utc = excluded.time_utc,
                time_msc = excluded.time_msc,
                profit = excluded.profit,
                commission = excluded.commission,
                swap = excluded.swap,
                fee = excluded.fee,
                screenshot_path = CASE
                    WHEN excluded.screenshot_path != '' THEN excluded.screenshot_path
                    ELSE deal_events.screenshot_path
                END,
                source_kind = excluded.source_kind,
                raw_json = excluded.raw_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            deal,
        )
        _rebuild_campaign_models_conn(conn)


def upsert_trade(trade: dict[str, Any]) -> None:
    open_time = trade["open_time_utc"]
    close_time = trade["close_time_utc"]
    trade["duration_seconds"] = calculate_duration_seconds(open_time, close_time)
    trade.setdefault("commission", 0.0)
    trade.setdefault("swap", 0.0)
    trade.setdefault("fee", 0.0)
    trade.setdefault("review_text", "")
    trade.setdefault("trend_id", None)
    trade.setdefault("remark", "")
    trade.setdefault("trade_type", "unclassified")
    trade.setdefault("strategy", "strategy_unclassified")
    trade.setdefault("source", "mt5")
    trade.setdefault("raw_json", json.dumps(trade, ensure_ascii=False))

    with db() as conn:
        trade["trade_type"] = _ensure_classification_option(
            conn, "trade_type", trade["trade_type"]
        )
        trade["strategy"] = _ensure_classification_option(
            conn, "strategy", trade["strategy"]
        )
        conn.execute(
            """
            INSERT INTO trades (
                id, account, order_no, position_id, order_ticket, deal_ticket, symbol, side, lots,
                open_time_utc, close_time_utc, duration_seconds, entry_price, exit_price, pnl,
                commission, swap, fee, screenshot_path, review_text, trend_id, remark,
                trade_type, strategy, source, raw_json
            ) VALUES (
                :id, :account, :order_no, :position_id, :order_ticket, :deal_ticket, :symbol, :side, :lots,
                :open_time_utc, :close_time_utc, :duration_seconds, :entry_price, :exit_price, :pnl,
                :commission, :swap, :fee, :screenshot_path, :review_text, :trend_id, :remark,
                :trade_type, :strategy, :source, :raw_json
            )
            ON CONFLICT(id) DO UPDATE SET
                account = excluded.account,
                order_no = excluded.order_no,
                position_id = excluded.position_id,
                order_ticket = excluded.order_ticket,
                deal_ticket = excluded.deal_ticket,
                symbol = excluded.symbol,
                side = excluded.side,
                lots = excluded.lots,
                open_time_utc = excluded.open_time_utc,
                close_time_utc = excluded.close_time_utc,
                duration_seconds = excluded.duration_seconds,
                entry_price = excluded.entry_price,
                exit_price = excluded.exit_price,
                pnl = excluded.pnl,
                commission = excluded.commission,
                swap = excluded.swap,
                fee = excluded.fee,
                screenshot_path = excluded.screenshot_path,
                raw_json = excluded.raw_json,
                updated_at = CURRENT_TIMESTAMP
            """,
            trade,
        )
    rebuild_campaign_models()


def _legacy_time_msc(value: str, fallback: int = 0) -> int:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError):
        return int(fallback)


def _sync_legacy_deal_events_conn(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM deal_events WHERE source_kind = 'legacy'")
    rows = [dict(row) for row in conn.execute("SELECT * FROM trades ORDER BY open_time_utc, id")]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        account = str(row.get("account") or "MT5-LOCAL")
        position_id = str(row.get("position_id") or row["id"])
        grouped.setdefault((account, position_id), []).append(row)

    for (account, position_id), source_rows in grouped.items():
        has_native = conn.execute(
            """
            SELECT 1 FROM deal_events
            WHERE account = ? AND position_id = ? AND source_kind = 'mt5'
            LIMIT 1
            """,
            (account, position_id),
        ).fetchone()
        if has_native:
            continue
        active = [row for row in source_rows if not row.get("deleted_at")]
        if not active:
            continue
        active.sort(key=lambda row: (str(row["open_time_utc"]), str(row["id"])))
        total_volume = sum(float(row.get("lots") or 0.0) for row in active)
        if total_volume <= 0:
            continue
        entry_price = sum(
            float(row.get("lots") or 0.0) * float(row.get("entry_price") or 0.0)
            for row in active
        ) / total_volume
        first = active[0]
        side = str(first.get("side") or "long").lower()
        entry_ticket = f"legacy-in:{account}:{position_id}"
        conn.execute(
            """
            INSERT INTO deal_events (
                deal_ticket, account, position_id, order_ticket, entry_kind, deal_type,
                symbol, volume, price, time_utc, time_msc, profit, commission, swap,
                fee, screenshot_path, source_kind, source_trade_id, raw_json
            ) VALUES (?, ?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, '', 'legacy', ?, ?)
            """,
            (
                entry_ticket,
                account,
                position_id,
                str(first.get("order_ticket") or ""),
                "buy" if side == "long" else "sell",
                str(first.get("symbol") or ""),
                total_volume,
                entry_price,
                str(first["open_time_utc"]),
                _legacy_time_msc(str(first["open_time_utc"])),
                str(first["id"]),
                json.dumps({"legacy_estimated": True, "source_trade_ids": [row["id"] for row in active]}),
            ),
        )
        for index, row in enumerate(active):
            close_time = str(row["close_time_utc"])
            conn.execute(
                """
                INSERT INTO deal_events (
                    deal_ticket, account, position_id, order_ticket, entry_kind, deal_type,
                    symbol, volume, price, time_utc, time_msc, profit, commission, swap,
                    fee, screenshot_path, source_kind, source_trade_id, raw_json
                ) VALUES (?, ?, ?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy', ?, ?)
                """,
                (
                    f"legacy-out:{row['id']}",
                    account,
                    position_id,
                    str(row.get("order_ticket") or ""),
                    "sell" if side == "long" else "buy",
                    str(row.get("symbol") or ""),
                    float(row.get("lots") or 0.0),
                    float(row.get("exit_price") or 0.0),
                    close_time,
                    _legacy_time_msc(close_time) + index,
                    float(row.get("pnl") or 0.0),
                    float(row.get("commission") or 0.0),
                    float(row.get("swap") or 0.0),
                    float(row.get("fee") or 0.0),
                    str(row.get("screenshot_path") or ""),
                    str(row["id"]),
                    str(row.get("raw_json") or ""),
                ),
            )


def _rebuild_campaign_models_conn(conn: sqlite3.Connection) -> None:
    _sync_legacy_deal_events_conn(conn)
    deal_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT deal_ticket, account, position_id, order_ticket, entry_kind,
                   deal_type, symbol, volume, price, time_utc, time_msc, profit,
                   commission, swap, fee, screenshot_path, source_kind, source_trade_id
            FROM deal_events
            ORDER BY time_msc, deal_ticket
            """
        )
    ]
    positions = reconstruct_positions(deal_rows)
    source_kinds: dict[str, set[str]] = {}
    for deal in deal_rows:
        key = f"{deal['account']}:{deal['position_id']}"
        source_kinds.setdefault(key, set()).add(str(deal.get("source_kind") or "mt5"))

    previous_stops = {
        row["id"]: row["initial_stop_price"]
        for row in conn.execute("SELECT id, initial_stop_price FROM positions")
    }
    previous_memberships = {
        row["position_id"]: {
            "campaign_id": row["campaign_id"],
            "created_at": row["created_at"],
        }
        for row in conn.execute(
            """
            SELECT campaign_positions.position_id, campaign_positions.campaign_id,
                   trade_campaigns.created_at
            FROM campaign_positions
            JOIN trade_campaigns ON trade_campaigns.id = campaign_positions.campaign_id
            """
        )
    }
    for row in conn.execute(
        "SELECT position_id, campaign_id, campaign_created_at FROM campaign_position_history"
    ):
        previous_memberships.setdefault(
            row["position_id"],
            {
                "campaign_id": row["campaign_id"],
                "created_at": row["campaign_created_at"],
            },
        )
    for position in positions:
        if (
            position["reconstruction_status"] == "complete"
            and source_kinds.get(position["id"]) == {"legacy"}
        ):
            position["reconstruction_status"] = "legacy_estimated"
        position["initial_stop_price"] = previous_stops.get(position["id"])
        opened_ticket = str(position["entry_deals"][0]["deal_ticket"] if position["entry_deals"] else "")
        closed_ticket = str(position["exit_deals"][-1]["deal_ticket"] if position["exit_deals"] else "")
        conn.execute(
            """
            INSERT INTO positions (
                id, account, position_id, symbol, side, opened_at_utc, closed_at_utc,
                opened_sort_msc, opened_sort_ticket, closed_sort_msc, closed_sort_ticket,
                entry_volume, exit_volume, weighted_entry_price, reconstruction_status,
                initial_stop_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                account = excluded.account,
                position_id = excluded.position_id,
                symbol = excluded.symbol,
                side = excluded.side,
                opened_at_utc = excluded.opened_at_utc,
                closed_at_utc = excluded.closed_at_utc,
                opened_sort_msc = excluded.opened_sort_msc,
                opened_sort_ticket = excluded.opened_sort_ticket,
                closed_sort_msc = excluded.closed_sort_msc,
                closed_sort_ticket = excluded.closed_sort_ticket,
                entry_volume = excluded.entry_volume,
                exit_volume = excluded.exit_volume,
                weighted_entry_price = excluded.weighted_entry_price,
                reconstruction_status = excluded.reconstruction_status,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                position["id"],
                position["account"],
                position["position_id"],
                position["symbol"],
                position["side"],
                position["opened_at_utc"],
                position["closed_at_utc"],
                int(position["opened_sort_key"][0]),
                opened_ticket,
                int(position["closed_sort_key"][0]) if position.get("closed_sort_key") else None,
                closed_ticket or None,
                position["entry_volume"],
                position["exit_volume"],
                position["weighted_entry_price"],
                position["reconstruction_status"],
                position["initial_stop_price"],
            ),
        )

    source_rows = [dict(row) for row in conn.execute("SELECT * FROM trades")]
    source_by_position: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in source_rows:
        key = (
            str(row.get("account") or "MT5-LOCAL"),
            str(row.get("position_id") or row["id"]),
        )
        source_by_position.setdefault(key, []).append(row)

    conn.execute("DELETE FROM campaign_positions")
    conn.execute("DELETE FROM campaign_source_trades")
    for campaign in group_campaigns(positions):
        candidates = {
            previous_memberships[position_id]["campaign_id"]: previous_memberships[position_id]["created_at"]
            for position_id in campaign["position_ids"]
            if position_id in previous_memberships
        }
        campaign_id = (
            min(candidates, key=lambda key: (str(candidates[key]), key))
            if candidates
            else str(uuid.uuid4())
        )
        members = campaign["positions"]
        related_rows = []
        for member in members:
            related_rows.extend(
                source_by_position.get((member["account"], member["position_id"]), [])
            )
        active_rows = [row for row in related_rows if not row.get("deleted_at")]
        active_rows.sort(key=lambda row: (str(row.get("close_time_utc") or ""), str(row["id"])))
        reviews = [
            f"来源 {row['id']}\n{str(row.get('review_text') or '').strip()}"
            for row in active_rows
            if str(row.get("review_text") or "").strip()
        ]
        trade_types = list(dict.fromkeys(str(row.get("trade_type") or "unclassified") for row in active_rows))
        strategies = list(
            dict.fromkeys(str(row.get("strategy") or "strategy_unclassified") for row in active_rows)
        )
        screenshot_path = next(
            (str(row.get("screenshot_path") or "") for row in reversed(active_rows) if row.get("screenshot_path")),
            "",
        )
        net_pnl = round(sum(trade_net_pnl(row) for row in active_rows), 2)
        conn.execute(
            """
            INSERT INTO trade_campaigns (
                id, account, symbol, side, opened_at_utc, closed_at_utc, status,
                net_pnl, review_text, trade_type, strategy, screenshot_path,
                classification_conflict
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                account = excluded.account,
                symbol = excluded.symbol,
                side = excluded.side,
                opened_at_utc = excluded.opened_at_utc,
                closed_at_utc = excluded.closed_at_utc,
                status = excluded.status,
                net_pnl = excluded.net_pnl,
                review_text = CASE
                    WHEN trade_campaigns.review_text = '' THEN excluded.review_text
                    ELSE trade_campaigns.review_text
                END,
                screenshot_path = CASE
                    WHEN excluded.screenshot_path != '' THEN excluded.screenshot_path
                    ELSE trade_campaigns.screenshot_path
                END,
                classification_conflict = excluded.classification_conflict,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                campaign_id,
                campaign["account"],
                campaign["symbol"],
                campaign["side"],
                campaign["opened_at_utc"],
                campaign["closed_at_utc"],
                campaign["status"],
                net_pnl,
                "\n\n".join(reviews),
                trade_types[0] if trade_types else "unclassified",
                strategies[0] if strategies else "strategy_unclassified",
                screenshot_path,
                int(len(trade_types) > 1 or len(strategies) > 1),
            ),
        )
        for index, member in enumerate(members):
            conn.execute(
                "INSERT INTO campaign_positions (campaign_id, position_id, sort_order) VALUES (?, ?, ?)",
                (campaign_id, member["id"], index),
            )
            created_at = conn.execute(
                "SELECT created_at FROM trade_campaigns WHERE id = ?", (campaign_id,)
            ).fetchone()["created_at"]
            conn.execute(
                """
                INSERT INTO campaign_position_history (
                    position_id, campaign_id, campaign_created_at
                ) VALUES (?, ?, ?)
                ON CONFLICT(position_id) DO UPDATE SET
                    campaign_id = excluded.campaign_id,
                    campaign_created_at = excluded.campaign_created_at
                """,
                (member["id"], campaign_id, created_at),
            )
        for row in related_rows:
            conn.execute(
                "INSERT OR IGNORE INTO campaign_source_trades (campaign_id, trade_id) VALUES (?, ?)",
                (campaign_id, row["id"]),
            )


def rebuild_campaign_models() -> None:
    with db() as conn:
        _rebuild_campaign_models_conn(conn)


def _campaign_records_conn(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    # The service can stay running while legacy/native deal files are imported.
    # Rebuild before reading so persisted Campaign rows cannot outlive their
    # Position membership or show an empty Position summary in the UI.
    _rebuild_campaign_models_conn(conn)
    campaigns = {
        row["id"]: dict(row)
        for row in conn.execute(
            """
            SELECT * FROM trade_campaigns
            WHERE deleted_at IS NULL
              AND EXISTS (
                  SELECT 1 FROM campaign_positions
                  WHERE campaign_positions.campaign_id = trade_campaigns.id
              )
            ORDER BY COALESCE(closed_at_utc, opened_at_utc) DESC, id DESC
            """
        )
    }
    position_rows = [dict(row) for row in conn.execute("SELECT * FROM positions")]
    deal_rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT deal_ticket, account, position_id, order_ticket, entry_kind,
                   deal_type, symbol, volume, price, time_utc, time_msc, profit,
                   commission, swap, fee, screenshot_path, source_kind, source_trade_id
            FROM deal_events ORDER BY time_msc, deal_ticket
            """
        )
    ]
    reconstructed = {position["id"]: position for position in reconstruct_positions(deal_rows)}
    position_domains: dict[str, dict[str, Any]] = {}
    for row in position_rows:
        position = reconstructed.get(row["id"])
        if not position:
            continue
        position = dict(position)
        position["initial_stop_price"] = row["initial_stop_price"]
        position["reconstruction_status"] = row["reconstruction_status"]
        position_domains[row["id"]] = position

    memberships: dict[str, list[str]] = {}
    for row in conn.execute(
        "SELECT campaign_id, position_id FROM campaign_positions ORDER BY campaign_id, sort_order"
    ):
        memberships.setdefault(row["campaign_id"], []).append(row["position_id"])
    source_ids: dict[str, list[str]] = {}
    for row in conn.execute(
        "SELECT campaign_id, trade_id FROM campaign_source_trades ORDER BY campaign_id, trade_id"
    ):
        source_ids.setdefault(row["campaign_id"], []).append(row["trade_id"])

    # Keep the Position summary self-contained for the order-flow table. A
    # Position is reconstructed from deals, while its review fields live on
    # the originating trade row, so attach the active source trade payload
    # before serializing Campaigns. This avoids empty child rows when the
    # source trade is not the Campaign's representative trade.
    source_rows = [
        dict(row)
        for row in conn.execute(
            "SELECT * FROM trades WHERE deleted_at IS NULL ORDER BY close_time_utc, id"
        )
    ]
    source_by_position: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in source_rows:
        key = (
            str(row.get("account") or "MT5-LOCAL"),
            str(row.get("position_id") or row.get("id") or ""),
        )
        source_by_position.setdefault(key, []).append(row)
    source_custom_values = _custom_values_for_trade_ids(
        conn, [str(row["id"]) for row in source_rows]
    )

    records = []
    for campaign_id, campaign in campaigns.items():
        members = [
            position_domains[position_id]
            for position_id in memberships.get(campaign_id, [])
            if position_id in position_domains
        ]
        for member in members:
            related_sources = source_by_position.get(
                (str(member.get("account") or "MT5-LOCAL"), str(member.get("position_id") or "")),
                [],
            )
            serialized_sources = [
                _serialize_trade(row, source_custom_values)
                for row in related_sources
            ]
            member["source_trades"] = serialized_sources
            member["source_trade"] = serialized_sources[-1] if serialized_sources else None
            if serialized_sources:
                representative = serialized_sources[-1]
                # Mirror the normal trade fields on the Position payload so
                # clients can render child rows without a second lookup.
                for key in ("review_text", "custom_fields", "screenshot_url", "trade_type", "strategy"):
                    member[key] = representative.get(key)
        risk = calculate_campaign_r(campaign, members)
        total_entry_volume = sum(float(member.get("entry_volume") or 0.0) for member in members)
        total_exit_volume = sum(float(member.get("exit_volume") or 0.0) for member in members)
        weighted_entry_price = (
            sum(
                float(member.get("weighted_entry_price") or 0.0)
                * float(member.get("entry_volume") or 0.0)
                for member in members
            )
            / total_entry_volume
            if total_entry_volume > 0
            else None
        )
        weighted_exit_price = (
            sum(
                float(member.get("weighted_exit_price") or 0.0)
                * float(member.get("exit_volume") or 0.0)
                for member in members
            )
            / total_exit_volume
            if total_exit_volume > 0
            else None
        )
        opened_sort = [member.get("opened_sort_key") for member in members if member.get("opened_sort_key")]
        closed_sort = [member.get("closed_sort_key") for member in members if member.get("closed_sort_key")]
        holding_seconds = (
            max(0, max(item[0] for item in closed_sort) - min(item[0] for item in opened_sort)) // 1000
            if opened_sort and len(closed_sort) == len(members)
            else None
        )
        record = {
            **campaign,
            **risk,
            "positions": members,
            "position_count": len(members),
            "scale_in_count": max(0, len(members) - 1),
            "partial_exit_count": sum(int(member.get("partial_exit_count") or 0) for member in members),
            "source_trade_ids": source_ids.get(campaign_id, []),
            "display_order_kind": "Campaign",
            "display_order_no": campaign_id[:8],
            "campaign_total_pnl": float(campaign.get("net_pnl") or 0.0),
            "net_pnl": float(campaign.get("net_pnl") or 0.0),
            "entry_volume": round(total_entry_volume, 10),
            "exit_volume": round(total_exit_volume, 10),
            "weighted_entry_price": weighted_entry_price,
            "weighted_exit_price": weighted_exit_price,
            "holding_seconds": holding_seconds,
            "open_time_utc": campaign.get("opened_at_utc"),
            "close_time_utc": campaign.get("closed_at_utc"),
        }
        records.append(record)
    return records


def _serialize_position_for_campaign(position: dict[str, Any]) -> dict[str, Any]:
    risk = calculate_position_risk(position)
    raw_id = str(position.get("position_id") or "")
    display_id = f"••••{raw_id[-4:]}" if len(raw_id) > 4 else raw_id
    position_pnl = round(
        sum(float(deal.get("profit") or 0.0) for deal in position.get("exit_deals") or []),
        2,
    )
    return {
        **position,
        **risk,
        "display_position_id": display_id,
        "position_pnl": position_pnl,
    }


def _serialize_position_summary_for_campaign(position: dict[str, Any]) -> dict[str, Any]:
    serialized = _serialize_position_for_campaign(position)
    keys = (
        "id",
        "position_id",
        "display_position_id",
        "side",
        "entry_volume",
        "exit_volume",
        "weighted_entry_price",
        "weighted_exit_price",
        "holding_seconds",
        "initial_stop_price",
        "partial_exit_count",
        "reconstruction_status",
        "planned_risk",
        "result",
        "position_pnl",
        "position_r",
        "risk_status",
        "risk_missing_reason",
        "source_trade",
        "review_text",
        "custom_fields",
        "screenshot_url",
        "trade_type",
        "strategy",
    )
    return {key: serialized.get(key) for key in keys}


def _serialize_campaign_record(record: dict[str, Any], *, include_positions: bool) -> dict[str, Any]:
    serialized = {key: value for key, value in record.items() if key != "positions"}
    serialized["position_summaries"] = [
        _serialize_position_summary_for_campaign(position)
        for position in record.get("positions", [])
    ]
    if record.get("opened_at_utc"):
        serialized["open_time_bj"] = to_beijing(record["opened_at_utc"]).isoformat()
    if record.get("closed_at_utc"):
        serialized["close_time_bj"] = to_beijing(record["closed_at_utc"]).isoformat()
    serialized["risk_missing_label"] = {
        "complete": "",
        "missing": "R 缺失",
        "invalid": "止损方向无效",
        "incomplete": "成交数据不完整",
    }.get(str(record.get("risk_status")), "R 数据不完整")
    if include_positions:
        serialized["positions"] = [
            _serialize_position_for_campaign(position) for position in record.get("positions", [])
        ]
    return serialized


def list_campaigns(
    query: str = "",
    symbol: str = "",
    side: str = "all",
    trade_type: str = "all",
    strategy: str = "all",
    start_date: str | None = None,
    end_date: str | None = None,
    r_missing_only: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    with db() as conn:
        records = _campaign_records_conn(conn)
    needle = query.strip().lower()
    symbol_needle = symbol.strip().lower()
    selected = []
    for record in records:
        closed_at = record.get("closed_at_utc")
        if start_date or end_date:
            if not closed_at:
                continue
            closed_date = to_beijing(closed_at).date()
            if start_date and closed_date < date.fromisoformat(start_date):
                continue
            if end_date and closed_date > date.fromisoformat(end_date):
                continue
        haystack = " ".join(
            [str(record.get("id") or ""), str(record.get("symbol") or "")]
            + [str(value) for value in record.get("source_trade_ids", [])]
        ).lower()
        if needle and needle not in haystack:
            continue
        if symbol_needle and symbol_needle not in str(record.get("symbol") or "").lower():
            continue
        if side != "all" and record.get("side") != side:
            continue
        if trade_type != "all" and record.get("trade_type") != trade_type:
            continue
        if strategy != "all" and record.get("strategy") != strategy:
            continue
        if r_missing_only and record.get("risk_status") == "complete":
            continue
        selected.append(_serialize_campaign_record(record, include_positions=False))
    safe_page = max(1, int(page))
    safe_size = max(1, min(int(page_size), 200))
    start = (safe_page - 1) * safe_size
    page_records = selected[start : start + safe_size]
    return {
        "campaigns": page_records,
        "trades": page_records,
        "total": len(selected),
        "page": safe_page,
        "page_size": safe_size,
    }


def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    with db() as conn:
        record = next(
            (item for item in _campaign_records_conn(conn) if item["id"] == campaign_id),
            None,
        )
    return _serialize_campaign_record(record, include_positions=True) if record else None


def update_position_initial_stop(position_id: str, value: Any) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT id FROM positions WHERE id = ?", (position_id,)).fetchone()
        if not row:
            raise KeyError(position_id)
        membership = conn.execute(
            "SELECT campaign_id FROM campaign_positions WHERE position_id = ?", (position_id,)
        ).fetchone()
        if value in (None, ""):
            stop = None
        else:
            try:
                stop = float(value)
            except (TypeError, ValueError) as exc:
                raise ValueError("初始止损必须是有效数字") from exc
            if not math.isfinite(stop):
                raise ValueError("初始止损必须是有效数字")
            records = _campaign_records_conn(conn)
            position = next(
                (
                    member
                    for campaign in records
                    for member in campaign.get("positions", [])
                    if member["id"] == position_id
                ),
                None,
            )
            if not position:
                raise KeyError(position_id)
            validation = calculate_position_risk({**position, "initial_stop_price": stop})
            if validation["risk_status"] == "invalid":
                raise ValueError("初始止损方向无效：多单止损须低于入场价，空单止损须高于入场价")
        conn.execute(
            "UPDATE positions SET initial_stop_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (stop, position_id),
        )
        campaign_id = str(membership["campaign_id"]) if membership else ""
    campaign = get_campaign(campaign_id)
    if not campaign:
        raise KeyError(campaign_id)
    position = next(item for item in campaign["positions"] if item["id"] == position_id)
    return {"position": position, "campaign": _serialize_campaign_record(campaign, include_positions=False)}


def get_analysis_settings() -> dict[str, Any]:
    with db() as conn:
        row = conn.execute(
            "SELECT value FROM analysis_settings WHERE key = 'scratch_threshold_r'"
        ).fetchone()
    return {"scratch_threshold_r": float(row["value"] if row else 0.15)}


def update_analysis_settings(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        threshold = float(payload.get("scratch_threshold_r"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Scratch 阈值必须是有效数字") from exc
    if not math.isfinite(threshold) or not 0 <= threshold <= 5:
        raise ValueError("Scratch 阈值必须在 0R 到 5R 之间")
    with db() as conn:
        conn.execute(
            """
            INSERT INTO analysis_settings (key, value, updated_at)
            VALUES ('scratch_threshold_r', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            """,
            (str(threshold),),
        )
    return {"scratch_threshold_r": threshold}


def update_campaign_review(campaign_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    review_text = str(payload.get("review_text") or "")
    if len(review_text) > 10000:
        raise ValueError("复盘内容不能超过 10000 个字符")
    with db() as conn:
        current = conn.execute(
            "SELECT trade_type, strategy FROM trade_campaigns WHERE id = ? AND deleted_at IS NULL",
            (campaign_id,),
        ).fetchone()
        if not current:
            raise KeyError(campaign_id)
        trade_type = _ensure_classification_option(
            conn,
            "trade_type",
            str(payload.get("trade_type") or current["trade_type"] or "unclassified"),
        )
        strategy = _ensure_classification_option(
            conn,
            "strategy",
            str(payload.get("strategy") or current["strategy"] or "strategy_unclassified"),
        )
        conn.execute(
            """
            UPDATE trade_campaigns
            SET review_text = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (review_text, trade_type, strategy, campaign_id),
        )
        source = conn.execute(
            """
            SELECT trade_id FROM campaign_source_trades
            WHERE campaign_id = ? ORDER BY trade_id LIMIT 1
            """,
            (campaign_id,),
        ).fetchone()
        if source:
            conn.execute(
                """
                UPDATE trades
                SET review_text = ?, trade_type = ?, strategy = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (review_text, trade_type, strategy, source["trade_id"]),
            )
    updated = get_campaign(campaign_id)
    if not updated:
        raise KeyError(campaign_id)
    return updated


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


def _serialize_trade(
    row: sqlite3.Row,
    custom_values: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    trade = dict(row)
    trade["net_pnl"] = trade_net_pnl(trade)
    trade["open_time_bj"] = to_beijing(trade["open_time_utc"]).isoformat()
    trade["close_time_bj"] = to_beijing(trade["close_time_utc"]).isoformat()
    trade["duration_label"] = _duration_label(int(trade["duration_seconds"]))
    display_kind, display_no = _display_order_number(trade)
    trade["display_order_kind"] = display_kind
    trade["display_order_no"] = display_no
    trade["custom_fields"] = (custom_values or {}).get(trade["id"], {})
    trade["session_label"] = _trade_session_label(trade["close_time_utc"])
    screenshot_file = (DATA_DIR / str(trade.get("screenshot_path") or "")).resolve()
    screenshot_exists = (
        bool(trade["screenshot_path"])
        and screenshot_file.is_file()
        and screenshot_file.is_relative_to(DATA_DIR.resolve())
    )
    trade["screenshot_missing"] = bool(trade["screenshot_path"]) and not screenshot_exists
    if screenshot_exists:
        trade["screenshot_url"] = f"/media/{trade['screenshot_path']}"
    else:
        trade["screenshot_url"] = ""
    return trade


def _custom_values_for_trade_ids(
    conn: sqlite3.Connection,
    trade_ids: list[str],
) -> dict[str, dict[str, Any]]:
    if not trade_ids:
        return {}
    placeholders = ",".join("?" for _ in trade_ids)
    rows = conn.execute(
        f"""
        SELECT trade_custom_values.trade_id,
               trade_custom_values.field_id,
               trade_custom_values.value,
               custom_fields.field_type
        FROM trade_custom_values
        JOIN custom_fields ON custom_fields.id = trade_custom_values.field_id
        WHERE trade_custom_values.trade_id IN ({placeholders})
        """,
        trade_ids,
    ).fetchall()
    values: dict[str, dict[str, Any]] = {trade_id: {} for trade_id in trade_ids}
    for row in rows:
        value: Any = row["value"]
        if row["field_type"] == "multi":
            try:
                parsed = json.loads(value or "[]")
                value = parsed if isinstance(parsed, list) else []
            except json.JSONDecodeError:
                value = []
        values.setdefault(row["trade_id"], {})[str(row["field_id"])] = value
    return values


def _display_order_number(trade: dict[str, Any]) -> tuple[str, str]:
    for kind, key in (("Order", "order_no"), ("Deal", "deal_ticket"), ("Position", "position_id")):
        value = str(trade.get(key) or "").strip()
        if value and value not in {"0", "None", "null"}:
            return kind, value
    return "Trade", str(trade.get("id", ""))


def _trade_session_label(close_time_utc: str) -> str:
    close_time = to_beijing(close_time_utc).time()
    minutes = close_time.hour * 60 + close_time.minute
    if 8 * 60 <= minutes < 15 * 60:
        return "亚盘"
    if 15 * 60 <= minutes < 20 * 60:
        return "欧盘"
    if minutes >= 20 * 60 or minutes < 2 * 60:
        return "美盘"
    return "其他"


def _duration_label(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, _ = divmod(remainder, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _latest_activity_time(trades: list[dict[str, Any]], snapshots: list[dict[str, Any]]) -> datetime:
    candidates = []
    if trades:
        candidates.append(max(trade["close_time_utc"] for trade in trades))
    if snapshots:
        candidates.append(max(snapshot["time_utc"] for snapshot in snapshots))
    if not candidates:
        return datetime.now(timezone.utc)
    return max(datetime.fromisoformat(str(value)) for value in candidates)


def _event_to_trade(payload: dict[str, Any]) -> dict[str, Any] | None:
    required = ["symbol", "side", "lots", "open_time_utc", "close_time_utc", "entry_price", "exit_price", "pnl"]
    if not all(payload.get(key) not in (None, "") for key in required):
        return None
    trade_id = str(
        payload.get("trade_id")
        or payload.get("position_id")
        or payload.get("order_ticket")
        or payload.get("deal_ticket")
    )
    if not trade_id or trade_id == "None":
        return None
    return {
        "id": trade_id,
        "account": str(payload.get("account", "MT5-LOCAL")),
        "order_no": str(payload.get("order_no") or payload.get("order_ticket") or trade_id),
        "position_id": str(payload.get("position_id", "")),
        "order_ticket": str(payload.get("order_ticket", "")),
        "deal_ticket": str(payload.get("deal_ticket", "")),
        "symbol": str(payload["symbol"]),
        "side": str(payload["side"]).lower(),
        "lots": float(payload["lots"]),
        "open_time_utc": str(payload["open_time_utc"]),
        "close_time_utc": str(payload["close_time_utc"]),
        "entry_price": float(payload["entry_price"]),
        "exit_price": float(payload["exit_price"]),
        "pnl": float(payload["pnl"]),
        "commission": float(payload.get("commission", 0.0)),
        "swap": float(payload.get("swap", 0.0)),
        "fee": float(payload.get("fee", 0.0)),
        "screenshot_path": str(payload.get("screenshot_path", "")),
        "trade_type": str(payload.get("trade_type", "unclassified") or "unclassified"),
        "strategy": str(payload.get("strategy", "unclassified") or "unclassified"),
        "source": "mt5",
        "raw_json": json.dumps(payload, ensure_ascii=False),
    }


def _create_demo_screenshots() -> list[str]:
    paths = []
    colors = ["#2bd4ff", "#ff5c7a", "#4ade80", "#2bd4ff", "#ff5c7a", "#4ade80", "#2bd4ff"]
    for index, color in enumerate(colors, start=1):
        name = f"screenshots/demo-{index}.svg"
        file_path = DATA_DIR / name
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


def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def _event_hash(raw_event: str) -> str:
    return hashlib.sha256(raw_event.encode("utf-8")).hexdigest()


def _canonical_event_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _event_hash(canonical)



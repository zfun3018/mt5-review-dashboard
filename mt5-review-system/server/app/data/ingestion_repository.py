from __future__ import annotations

import sqlite3

from ..core.config import get_runtime_paths
from .database import transaction


def db():
    return transaction(get_runtime_paths())

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Callable

from .campaign_repository import CampaignRepository
from .trade_commands import _upsert_trade_conn


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        get_runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


def list_equity_snapshots() -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT time_utc, balance, equity FROM equity_snapshots ORDER BY time_utc"
        ).fetchall()
    return [dict(row) for row in rows]


def get_ingest_cursor(
    file_path: str,
    *,
    _conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    if _conn is None:
        with db() as conn:
            return get_ingest_cursor(file_path, _conn=conn)
    row = _conn.execute(
        "SELECT file_path, byte_offset, file_size, modified_ns, updated_at FROM ingest_cursors WHERE file_path = ?",
        (file_path,),
    ).fetchone()
    return dict(row) if row else None


def update_ingest_cursor(
    file_path: str,
    byte_offset: int,
    file_size: int,
    modified_ns: int,
    *,
    _conn: sqlite3.Connection | None = None,
) -> None:
    if _conn is None:
        with db() as conn:
            update_ingest_cursor(
                file_path,
                byte_offset,
                file_size,
                modified_ns,
                _conn=conn,
            )
        return
    _conn.execute(
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


def ingest_mt5_event(
    payload: dict[str, Any],
    raw_event: str | None = None,
    event_hash: str | None = None,
    *,
    rebuild: bool = True,
    _conn: sqlite3.Connection | None = None,
    _upsert_trade: Callable[[sqlite3.Connection, dict[str, Any]], None] = _upsert_trade_conn,
) -> dict[str, Any]:
    received_at = datetime.now(timezone.utc).isoformat()
    line = raw_event or json.dumps(payload, ensure_ascii=False, sort_keys=True)
    fingerprint = event_hash or _canonical_event_hash(payload)

    if _conn is not None:
        result, raw_inserted = _ingest_mt5_event_conn(
            _conn, payload, line, fingerprint, received_at, rebuild, _upsert_trade
        )
        if raw_inserted:
            _append_raw_event(received_at, line)
        return result

    with db() as conn:
        result, raw_inserted = _ingest_mt5_event_conn(
            conn, payload, line, fingerprint, received_at, rebuild, _upsert_trade
        )
        if raw_inserted:
            _append_raw_event(received_at, line)
    return result


def _ingest_mt5_event_conn(
    conn: sqlite3.Connection,
    payload: dict[str, Any],
    line: str,
    fingerprint: str,
    received_at: str,
    rebuild: bool,
    upsert_trade_conn: Callable[[sqlite3.Connection, dict[str, Any]], None],
) -> tuple[dict[str, Any], bool]:
    try:
        conn.execute(
            "INSERT INTO raw_events (received_at, event_hash, payload) VALUES (?, ?, ?)",
            (received_at, fingerprint, line),
        )
        raw_inserted = True
    except sqlite3.IntegrityError:
        raw_inserted = False

    applied = _apply_event_payload(
        payload,
        conn=conn,
        rebuild=rebuild,
        upsert_trade_conn=upsert_trade_conn,
    )
    applied.update({"received_at": received_at, "duplicate": not raw_inserted})
    return applied, raw_inserted


def _append_raw_event(received_at: str, line: str) -> None:
    get_runtime_paths().raw_events.mkdir(parents=True, exist_ok=True)
    raw_file = get_runtime_paths().raw_events / f"events-{received_at[:10]}.jsonl"
    with raw_file.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def _apply_event_payload(
    payload: dict[str, Any],
    *,
    conn: sqlite3.Connection,
    rebuild: bool,
    upsert_trade_conn: Callable[[sqlite3.Connection, dict[str, Any]], None],
) -> dict[str, Any]:
    if payload.get("type") == "equity_snapshot":
        snapshot = _upsert_equity_snapshot_conn(conn, payload)
        return {"trade_id": None, "snapshot": snapshot, "restored": False}

    if payload.get("type") == "deal":
        deal = _event_to_deal(payload)
        if not deal:
            return {"trade_id": None, "deal_ticket": None, "restored": False}
        _upsert_deal_event_conn(conn, deal)
        if rebuild:
            _campaign_repository().rebuild(conn=conn)
        return {
            "trade_id": None,
            "deal_ticket": deal["deal_ticket"],
            "restored": False,
        }

    trade = _event_to_trade(payload)
    if not trade:
        return {"trade_id": None, "restored": False}

    existed = conn.execute(
        "SELECT 1 FROM trades WHERE id = ? AND deleted_at IS NULL", (trade["id"],)
    ).fetchone() is not None
    upsert_trade_conn(conn, trade)
    if rebuild:
        _campaign_repository().rebuild(conn=conn)
    return {"trade_id": trade["id"], "restored": not existed}


def upsert_equity_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    with db() as conn:
        return _upsert_equity_snapshot_conn(conn, payload)


def _upsert_equity_snapshot_conn(
    conn: sqlite3.Connection,
    payload: dict[str, Any],
) -> dict[str, Any]:
    time_utc = str(payload.get("time_utc") or datetime.now(timezone.utc).isoformat())
    balance = float(payload.get("balance", 0.0))
    equity = float(payload.get("equity", balance))
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
        _upsert_deal_event_conn(conn, deal)
        _campaign_repository().rebuild(conn=conn)


def _upsert_deal_event_conn(
    conn: sqlite3.Connection,
    deal: dict[str, Any],
) -> None:
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


def _legacy_time_msc(value: str, fallback: int = 0) -> int:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)
    except (TypeError, ValueError):
        return int(fallback)


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


def _event_hash(raw_event: str) -> str:
    return hashlib.sha256(raw_event.encode("utf-8")).hexdigest()


def _canonical_event_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _event_hash(canonical)

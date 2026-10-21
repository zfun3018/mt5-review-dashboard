from __future__ import annotations

import hashlib
import re
import json
import uuid
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Any, Iterable

from ..core.config import get_runtime_paths
from ..platforms import DOMESTIC_FUTURES_PLATFORM, normalize_platform
from ..platform_adapters.contracts import NormalizedExecution
from .database import connect, transaction


_COUNT_FIELDS = (
    "source_row_count",
    "new_row_count",
    "duplicate_count",
    "conflict_count",
    "invalid_count",
    "unpaired_count",
    "order_count",
)

LEGACY_RECOVERY_BATCH_ID = "IMP-LEGACY-DOMESTIC-FUTURES"


def create_import_batch(
    platform: str,
    filename: str,
    source_kind: str,
    source_format: str,
    file_sha256: str = "",
) -> dict[str, Any]:
    batch_id = f"IMP-{uuid.uuid4().hex[:24]}"
    started_at = datetime.now(timezone.utc).isoformat()
    safe_filename = _basename(filename)
    normalized = normalize_platform(platform)
    with transaction(get_runtime_paths()) as conn:
        conn.execute(
            """
            INSERT INTO import_batches (
                id, platform, source_kind, source_format, filename, file_sha256, status, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'preview', ?)
            """,
            (
                batch_id,
                normalized,
                str(source_kind or "unknown"),
                str(source_format or "unknown"),
                safe_filename,
                str(file_sha256 or ""),
                started_at,
            ),
        )
    return _batch_by_id(batch_id)


def record_import_batch_days(batch_id: str, days: Iterable[dict[str, Any]]) -> None:
    with transaction(get_runtime_paths()) as conn:
        batch = conn.execute(
            "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if batch is None:
            raise ValueError("导入批次不存在")
        for item in days:
            trade_date = str(item.get("trade_date") or "").strip()
            if not trade_date:
                continue
            values = [int(item.get(field) or 0) for field in _COUNT_FIELDS]
            conn.execute(
                """
                INSERT INTO import_batch_days (
                    batch_id, platform, trade_date,
                    source_row_count, new_row_count, duplicate_count,
                    conflict_count, invalid_count, unpaired_count, order_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(batch_id, trade_date) DO UPDATE SET
                    source_row_count = excluded.source_row_count,
                    new_row_count = excluded.new_row_count,
                    duplicate_count = excluded.duplicate_count,
                    conflict_count = excluded.conflict_count,
                    invalid_count = excluded.invalid_count,
                    unpaired_count = excluded.unpaired_count,
                    order_count = excluded.order_count
                """,
                (str(batch_id), batch["platform"], trade_date, *values),
            )


def record_import_batch_issues(batch_id: str, issues: Iterable[dict[str, Any]]) -> None:
    with transaction(get_runtime_paths()) as conn:
        batch = conn.execute(
            "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if batch is None:
            raise ValueError("导入批次不存在")
        for issue in issues:
            details = _safe_details(issue.get("details") or issue)
            conn.execute(
                """
                INSERT INTO import_batch_issues (
                    batch_id, platform, row_number, trade_date, code, message, details_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(batch_id),
                    batch["platform"],
                    _optional_int(issue.get("row_number")),
                    str(issue.get("trade_date") or details.get("trade_date") or "") or None,
                    str(issue.get("code") or "invalid"),
                    str(issue.get("message") or issue.get("error") or "导入数据异常"),
                    json.dumps(details, ensure_ascii=False),
                ),
            )


def record_import_executions(
    batch_id: str,
    executions: Iterable[NormalizedExecution],
    issues: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    with transaction(get_runtime_paths()) as conn:
        return record_import_executions_conn(conn, batch_id, executions, issues)


def record_import_executions_conn(
    conn,
    batch_id: str,
    executions: Iterable[NormalizedExecution],
    issues: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Persist new facts without changing the first-seen source of duplicates."""
    residuals: dict[int, float] = {}
    for issue in issues:
        if str(issue.get("code") or "") not in {"unpaired_open", "unpaired_close"}:
            continue
        row_number = _optional_int(issue.get("row_number"))
        if row_number is None:
            continue
        try:
            residuals[row_number] = max(
                residuals.get(row_number, 0.0),
                float(issue.get("quantity") or 0.0),
            )
        except (TypeError, ValueError):
            continue

    batch = conn.execute(
        "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
    ).fetchone()
    if batch is None:
        raise ValueError("导入批次不存在")
    new_executions: list[NormalizedExecution] = []
    duplicate_executions: list[NormalizedExecution] = []
    conflict_issues: list[dict[str, Any]] = []
    for execution in executions:
        fingerprint = _execution_fingerprint(execution)
        identity_key = _execution_identity(execution)
        existing = conn.execute(
            "SELECT * FROM import_executions WHERE fingerprint = ? AND status != 'reverted'",
            (fingerprint,),
        ).fetchone()
        if existing is None and identity_key:
            existing = conn.execute(
                """
                SELECT * FROM import_executions
                WHERE platform = ? AND identity_key = ? AND status != 'reverted'
                LIMIT 1
                """,
                (execution.platform, identity_key),
            ).fetchone()
            if existing is not None and not _execution_matches_row(execution, existing):
                conflict_issues.append(
                    {
                        "row_number": execution.source_row_number,
                        "trade_date": execution.trade_date,
                        "code": "execution_conflict",
                        "message": "成交序号已存在，但成交字段不一致",
                        "details": {
                            "trade_id": execution.trade_id,
                            "existing_execution_id": existing["id"],
                            "symbol": execution.symbol,
                        },
                    }
                )
                _link_batch_execution(
                    conn, batch_id, existing["id"], "conflict", execution.source_row_number
                )
                continue
        if existing is None:
            existing = conn.execute(
                "SELECT * FROM import_executions WHERE fingerprint = ? AND status = 'reverted'",
                (fingerprint,),
            ).fetchone()
        if existing is None and identity_key:
            existing = conn.execute(
                """
                SELECT * FROM import_executions
                WHERE platform = ? AND identity_key = ? AND status = 'reverted'
                LIMIT 1
                """,
                (execution.platform, identity_key),
            ).fetchone()
        if existing is not None:
            if not _execution_matches_row(execution, existing):
                conflict_issues.append(
                    {
                        "row_number": execution.source_row_number,
                        "trade_date": execution.trade_date,
                        "code": "execution_conflict",
                        "message": "成交序号已存在，但成交字段不一致",
                        "details": {
                            "trade_id": execution.trade_id,
                            "existing_execution_id": existing["id"],
                            "symbol": execution.symbol,
                        },
                    }
                )
                _link_batch_execution(conn, batch_id, existing["id"], "conflict", execution.source_row_number)
                continue
            if str(existing["status"] or "") == "reverted":
                remaining = min(
                    float(execution.quantity),
                    max(0.0, float(residuals.get(execution.source_row_number, 0.0))),
                )
                conn.execute(
                    """
                    UPDATE import_executions
                    SET batch_id = ?, trade_date = ?, time_utc = ?, symbol = ?, side = ?,
                        offset = ?, quantity = ?, remaining_quantity = ?, price = ?, fee = ?,
                        pnl = ?, trade_id = ?, order_id = ?, source_kind = ?, source_filename = ?,
                        source_sheet = ?, source_row_number = ?, raw_json = ?, status = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (
                        str(batch_id),
                        execution.trade_date,
                        execution.time_utc,
                        execution.symbol,
                        execution.side,
                        execution.offset,
                        execution.quantity,
                        remaining,
                        execution.price,
                        execution.fee,
                        execution.pnl,
                        execution.trade_id or "",
                        execution.order_id or "",
                        execution.source_kind or "",
                        execution.source_filename or "",
                        execution.source_sheet or "",
                        execution.source_row_number,
                        json.dumps(dict(execution.raw), ensure_ascii=False),
                        "unmatched" if remaining > 1e-9 else "matched",
                        existing["id"],
                    ),
                )
                _link_batch_execution(conn, batch_id, existing["id"], "new", execution.source_row_number)
                new_executions.append(execution)
                continue
            duplicate_executions.append(execution)
            _link_batch_execution(
                conn, batch_id, existing["id"], "duplicate", execution.source_row_number
            )
            continue

        execution_id = f"EXE-{hashlib.sha256(fingerprint.encode()).hexdigest()[:24]}"
        remaining = min(
            float(execution.quantity),
            max(0.0, float(residuals.get(execution.source_row_number, 0.0))),
        )
        status = "unmatched" if remaining > 1e-9 else "matched"
        conn.execute(
            """
            INSERT INTO import_executions (
                id, fingerprint, identity_key, batch_id, platform, account, trade_date, time_utc,
                symbol, side, offset, quantity, remaining_quantity, price, fee, pnl,
                trade_id, order_id, source_kind, source_filename, source_sheet,
                source_row_number, raw_json, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                execution_id,
                fingerprint,
                identity_key,
                str(batch_id),
                batch["platform"],
                execution.account,
                execution.trade_date,
                execution.time_utc,
                execution.symbol,
                execution.side,
                execution.offset,
                execution.quantity,
                remaining,
                execution.price,
                execution.fee,
                execution.pnl,
                execution.trade_id or "",
                execution.order_id or "",
                execution.source_kind or "",
                execution.source_filename or "",
                execution.source_sheet or "",
                execution.source_row_number,
                json.dumps(dict(execution.raw), ensure_ascii=False),
                status,
            ),
        )
        _link_batch_execution(conn, batch_id, execution_id, "new", execution.source_row_number)
        new_executions.append(execution)
    return {
        "new_executions": tuple(new_executions),
        "duplicate_executions": tuple(duplicate_executions),
        "conflict_issues": tuple(conflict_issues),
    }


def classify_import_executions_conn(
    conn,
    batch_id: str,
    executions: Iterable[NormalizedExecution],
) -> dict[str, Any]:
    """Classify executions before matching so duplicates never enter FIFO."""
    batch = conn.execute(
        "SELECT platform FROM import_batches WHERE id = ?", (str(batch_id),)
    ).fetchone()
    if batch is None:
        raise ValueError("导入批次不存在")
    new_executions: list[NormalizedExecution] = []
    duplicate_executions: list[NormalizedExecution] = []
    duplicate_issues: list[dict[str, Any]] = []
    conflict_issues: list[dict[str, Any]] = []
    for execution in executions:
        fingerprint = _execution_fingerprint(execution)
        identity_key = _execution_identity(execution)
        matched_by = "成交字段指纹"
        existing = conn.execute(
            "SELECT * FROM import_executions WHERE fingerprint = ? AND status != 'reverted'",
            (fingerprint,),
        ).fetchone()
        if existing is None and identity_key:
            matched_by = "成交序号"
            existing = conn.execute(
                """
                SELECT * FROM import_executions
                WHERE platform = ? AND identity_key = ? AND status != 'reverted'
                LIMIT 1
                """,
                (execution.platform, identity_key),
            ).fetchone()
            if existing is not None and str(existing["fingerprint"]) != fingerprint:
                conflict_issues.append(
                    {
                        "row_number": execution.source_row_number,
                        "trade_date": execution.trade_date,
                        "code": "execution_conflict",
                        "message": "成交序号已存在，但成交字段不一致",
                        "details": {
                            "trade_id": execution.trade_id,
                            "existing_execution_id": existing["id"],
                            "symbol": execution.symbol,
                            "matched_by": matched_by,
                            "differences": _execution_differences(execution, existing),
                        },
                    }
                )
                _link_batch_execution(
                    conn, batch_id, existing["id"], "conflict", execution.source_row_number
                )
                continue
        if existing is not None:
            duplicate_executions.append(execution)
            duplicate_issues.append(
                {
                    "row_number": execution.source_row_number,
                    "trade_date": execution.trade_date,
                    "code": "duplicate_execution",
                    "message": "成交记录已导入，未重复计入",
                    "details": _duplicate_execution_details(execution, existing, matched_by),
                }
            )
            _link_batch_execution(
                conn, batch_id, existing["id"], "duplicate", execution.source_row_number
            )
            continue
        new_executions.append(execution)
    return {
        "new_executions": tuple(new_executions),
        "duplicate_executions": tuple(duplicate_executions),
        "duplicate_issues": tuple(duplicate_issues),
        "conflict_issues": tuple(conflict_issues),
    }


def record_import_execution_matches_conn(
    conn,
    matches: Iterable[dict[str, Any]],
    *,
    match_kind: str = "fifo",
) -> None:
    for match in matches:
        opened = match["open_execution"]
        closed = match["close_execution"]
        conn.execute(
            """
            INSERT INTO import_execution_matches (
                id, platform, open_execution_id, close_execution_id, trade_id, quantity, match_kind
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"MATCH-{uuid.uuid4().hex[:24]}",
                opened.platform,
                f"EXE-{hashlib.sha256(_execution_fingerprint(opened).encode()).hexdigest()[:24]}",
                f"EXE-{hashlib.sha256(_execution_fingerprint(closed).encode()).hexdigest()[:24]}",
                str(match["trade_id"]),
                float(match["quantity"]),
                str(match.get("match_kind") or match_kind),
            ),
        )


def mark_order_duplicate_executions_conn(
    conn,
    batch_id: str,
    matches: Iterable[dict[str, Any]],
) -> None:
    """Keep duplicate-order sources traceable without making them revertable facts."""
    for match in matches:
        if str(match.get("match_kind") or "") != "order_duplicate":
            continue
        for execution in (match["open_execution"], match["close_execution"]):
            conn.execute(
                """
                UPDATE import_batch_executions
                SET disposition = 'duplicate'
                WHERE batch_id = ?
                  AND execution_id = (
                      SELECT id FROM import_executions WHERE fingerprint = ?
                  )
                """,
                (str(batch_id), _execution_fingerprint(execution)),
            )


def find_trade_by_order_signature_conn(conn, trade: dict[str, Any]) -> dict[str, Any] | None:
    """Find one active imported trade with the same complete order signature."""
    from .normalized_import import trade_order_signature

    if trade_order_signature(trade) is None:
        return None
    row = conn.execute(
        """
        SELECT *
        FROM trades
        WHERE deleted_at IS NULL
          AND platform = ?
          AND account = ?
          AND symbol = ?
          AND side = ?
          AND ABS(CAST(lots AS REAL) - CAST(? AS REAL)) <= 1e-9
          AND open_time_utc = ?
          AND ABS(CAST(entry_price AS REAL) - CAST(? AS REAL)) <= 1e-9
          AND close_time_utc = ?
          AND ABS(CAST(exit_price AS REAL) - CAST(? AS REAL)) <= 1e-9
        ORDER BY created_at, id
        LIMIT 1
        """,
        (
            str(trade["platform"]),
            str(trade["account"]),
            str(trade["symbol"]),
            str(trade["side"]),
            float(trade["lots"]),
            str(trade["open_time_utc"]),
            float(trade["entry_price"]),
            str(trade["close_time_utc"]),
            float(trade["exit_price"]),
        ),
    ).fetchone()
    if row is None:
        return None
    source = conn.execute(
        """
        SELECT batches.id AS batch_id, batches.filename, batches.file_sha256,
               links.source_row_number
        FROM import_execution_matches AS matches
        JOIN import_batch_executions AS links
          ON links.execution_id IN (matches.open_execution_id, matches.close_execution_id)
        JOIN import_batches AS batches ON batches.id = links.batch_id
        WHERE matches.trade_id = ?
          AND batches.status != 'reverted'
        ORDER BY batches.started_at, batches.id, links.source_row_number
        LIMIT 1
        """,
        (str(row["id"]),),
    ).fetchone()
    result = dict(row)
    result["source"] = dict(source) if source is not None else {}
    return result


def _link_batch_execution(
    conn,
    batch_id: str,
    execution_id: str,
    disposition: str,
    source_row_number: int | None,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO import_batch_executions (
            batch_id, execution_id, disposition, source_row_number
        ) VALUES (?, ?, ?, ?)
        """,
        (str(batch_id), str(execution_id), disposition, source_row_number),
    )


def backfill_legacy_import_executions_conn(conn) -> None:
    """Register pre-fingerprint domestic-futures imports for future deduplication."""
    rows = conn.execute(
        """
        SELECT id, platform, trade_date, account, symbol, side, lots,
               open_time_utc, close_time_utc, entry_price, exit_price,
               pnl, commission, raw_json, order_ticket, deal_ticket, source
        FROM trades
        WHERE platform = ? AND source = 'tonghuashun_import'
        ORDER BY created_at, id
        """,
        (DOMESTIC_FUTURES_PLATFORM,),
    ).fetchall()
    pending: list[tuple[Any, tuple[NormalizedExecution, NormalizedExecution]]] = []
    for row in rows:
        try:
            payload = json.loads(str(row["raw_json"] or "{}"))
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        executions = (
            _legacy_execution_from_trade(row, payload.get("open"), "open"),
            _legacy_execution_from_trade(row, payload.get("close"), "close"),
        )
        if not all(execution.trade_id for execution in executions):
            continue
        if any(
            conn.execute(
                "SELECT 1 FROM import_executions WHERE platform = ? AND identity_key = ? LIMIT 1",
                (execution.platform, _execution_identity(execution)),
            ).fetchone()
            is None
            for execution in executions
        ):
            pending.append((row, executions))

    if not pending:
        return

    started_at = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO import_batches (
            id, platform, source_kind, source_format, filename, status,
            started_at, completed_at, source_row_count, new_row_count, order_count
        ) VALUES (?, ?, 'legacy_recovery', 'internal', '历史导入数据（来源未知）', 'legacy', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
        """,
        (
            LEGACY_RECOVERY_BATCH_ID,
            DOMESTIC_FUTURES_PLATFORM,
            started_at,
            started_at,
            len(pending) * 2,
            0,
            len(pending),
        ),
    )

    for row, executions in pending:
        execution_ids: list[str] = []
        for execution in executions:
            identity_key = _execution_identity(execution)
            existing = conn.execute(
                "SELECT id FROM import_executions WHERE platform = ? AND identity_key = ? LIMIT 1",
                (execution.platform, identity_key),
            ).fetchone()
            if existing is not None:
                execution_id = str(existing["id"])
            else:
                fingerprint = _execution_fingerprint(execution)
                execution_id = f"EXE-{hashlib.sha256(fingerprint.encode()).hexdigest()[:24]}"
                conn.execute(
                    """
                    INSERT INTO import_executions (
                        id, fingerprint, identity_key, batch_id, platform, account, trade_date,
                        time_utc, symbol, side, offset, quantity, remaining_quantity, price,
                        fee, pnl, trade_id, order_id, source_kind, source_filename, source_sheet,
                        source_row_number, raw_json, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'matched')
                    """,
                    (
                        execution_id,
                        fingerprint,
                        identity_key,
                        LEGACY_RECOVERY_BATCH_ID,
                        execution.platform,
                        execution.account,
                        execution.trade_date,
                        execution.time_utc,
                        execution.symbol,
                        execution.side,
                        execution.offset,
                        execution.quantity,
                        execution.price,
                        execution.fee,
                        execution.pnl,
                        execution.trade_id,
                        execution.order_id,
                        execution.source_kind,
                        execution.source_filename,
                        execution.source_sheet,
                        execution.source_row_number,
                        json.dumps(dict(execution.raw), ensure_ascii=False),
                    ),
                )
            _link_batch_execution(conn, LEGACY_RECOVERY_BATCH_ID, execution_id, "new", None)
            execution_ids.append(execution_id)

        match_id = "MATCH-LEGACY-" + hashlib.sha256(
            f"{row['id']}|{execution_ids[0]}|{execution_ids[1]}".encode()
        ).hexdigest()[:24]
        conn.execute(
            """
            INSERT OR IGNORE INTO import_execution_matches (
                id, platform, open_execution_id, close_execution_id, trade_id, quantity, match_kind
            ) VALUES (?, ?, ?, ?, ?, ?, 'legacy_recovery')
            """,
            (
                match_id,
                DOMESTIC_FUTURES_PLATFORM,
                execution_ids[0],
                execution_ids[1],
                str(row["id"]),
                float(row["lots"] or 0.0),
            ),
        )

    recovered_count = conn.execute(
        "SELECT COUNT(*) AS value FROM import_batch_executions WHERE batch_id = ?",
        (LEGACY_RECOVERY_BATCH_ID,),
    ).fetchone()["value"]
    conn.execute(
        "UPDATE import_batches SET new_row_count = ? WHERE id = ?",
        (int(recovered_count), LEGACY_RECOVERY_BATCH_ID),
    )


def _legacy_execution_from_trade(
    row: Any,
    raw_value: Any,
    offset: str,
) -> NormalizedExecution:
    raw = dict(raw_value) if isinstance(raw_value, dict) else {}
    time_utc = str(row["open_time_utc"] if offset == "open" else row["close_time_utc"])
    fallback_date = str(row["trade_date"] or time_utc[:10])
    fallback_price = row["entry_price"] if offset == "open" else row["exit_price"]
    fallback_ticket = row["order_ticket"] if offset == "open" else row["deal_ticket"]
    return NormalizedExecution(
        platform=DOMESTIC_FUTURES_PLATFORM,
        trade_date=str(raw.get("trade_date") or fallback_date),
        time_utc=time_utc,
        symbol=str(raw.get("symbol") or row["symbol"] or ""),
        side=str(row["side"] or "long"),
        offset=offset,
        quantity=_legacy_float(raw.get("quantity"), row["lots"]),
        price=_legacy_float(raw.get("price"), fallback_price),
        account=str(raw.get("account") or row["account"] or "DOMESTIC-FUTURES-LOCAL"),
        fee=_legacy_float(raw.get("fee"), 0.0),
        pnl=_legacy_float(raw.get("pnl"), row["pnl"] if offset == "close" else 0.0),
        trade_id=str(raw.get("trade_id") or fallback_ticket or ""),
        order_id=str(raw.get("order_id") or fallback_ticket or ""),
        source_kind="legacy_recovery",
        raw=raw,
    )


def _legacy_float(value: Any, fallback: Any) -> float:
    try:
        return float(value) if value not in (None, "") else float(fallback or 0.0)
    except (TypeError, ValueError):
        return float(fallback or 0.0)


def list_unmatched_import_executions(
    platform: str,
    batch_id: str | None = None,
) -> list[dict[str, Any]]:
    normalized = normalize_platform(platform)
    conn = connect(get_runtime_paths())
    try:
        clauses = ["platform = ?", "remaining_quantity > 1e-9", "status != 'reverted'"]
        parameters: list[Any] = [normalized]
        if batch_id:
            clauses.append("batch_id = ?")
            parameters.append(str(batch_id))
        rows = conn.execute(
            f"""
            SELECT id, batch_id, platform, account, trade_date, time_utc, symbol,
                   side, offset, quantity, remaining_quantity, price, fee, pnl,
                   trade_id, order_id, source_kind, source_filename, source_sheet,
                   source_row_number, status
            FROM import_executions
            WHERE {' AND '.join(clauses)}
            ORDER BY trade_date, time_utc, source_row_number, id
            """,
            parameters,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_import_execution_conn(conn, execution_id: str, platform: str) -> Any | None:
    return conn.execute(
        "SELECT * FROM import_executions WHERE id = ? AND platform = ?",
        (str(execution_id), normalize_platform(platform)),
    ).fetchone()


def apply_import_execution_match_conn(
    conn,
    open_execution_id: str,
    close_execution_id: str,
    quantity: float,
    trade_id: str,
    platform: str,
) -> None:
    try:
        amount = float(quantity)
    except (TypeError, ValueError) as exc:
        raise ValueError("匹配手数必须是有效数字") from exc
    if amount <= 0:
        raise ValueError("匹配手数必须大于 0")
    normalized = normalize_platform(platform)
    opened = get_import_execution_conn(conn, open_execution_id, normalized)
    closed = get_import_execution_conn(conn, close_execution_id, normalized)
    if opened is None or closed is None:
        raise ValueError("待匹配成交不存在")
    if opened["offset"] != "open" or closed["offset"] != "close":
        raise ValueError("只能匹配开仓和对应的平仓成交")
    if (
        opened["account"], opened["symbol"], opened["side"]
    ) != (closed["account"], closed["symbol"], closed["side"]):
        raise ValueError("开仓和平仓的账户、合约或方向不一致")
    if amount > float(opened["remaining_quantity"]) + 1e-9:
        raise ValueError("匹配手数超过剩余开仓手数")
    if amount > float(closed["remaining_quantity"]) + 1e-9:
        raise ValueError("匹配手数超过剩余平仓手数")
    for execution_id, row in ((open_execution_id, opened), (close_execution_id, closed)):
        remaining = round(float(row["remaining_quantity"]) - amount, 10)
        conn.execute(
            """
            UPDATE import_executions
            SET remaining_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND platform = ?
            """,
            (remaining, "unmatched" if remaining > 1e-9 else "matched", execution_id, normalized),
        )
    conn.execute(
        """
        INSERT INTO import_execution_matches (
            id, platform, open_execution_id, close_execution_id, trade_id, quantity, match_kind
        ) VALUES (?, ?, ?, ?, ?, ?, 'manual')
        """,
        (
            f"MATCH-{uuid.uuid4().hex[:24]}",
            normalized,
            str(open_execution_id),
            str(close_execution_id),
            str(trade_id),
            amount,
        ),
    )


def finalize_import_batch(
    batch_id: str,
    counts: dict[str, Any],
    status: str,
) -> dict[str, Any]:
    if status not in {"preview", "committed", "failed", "reverted"}:
        raise ValueError("导入批次状态无效")
    completed_at = datetime.now(timezone.utc).isoformat()
    assignments = {
        field: int(counts.get(field) or 0)
        for field in _COUNT_FIELDS
    }
    assignments["trade_date_start"] = counts.get("trade_date_start")
    assignments["trade_date_end"] = counts.get("trade_date_end")
    with transaction(get_runtime_paths()) as conn:
        result = conn.execute(
            """
            UPDATE import_batches SET
                status = ?, completed_at = ?,
                trade_date_start = ?, trade_date_end = ?,
                source_row_count = ?, new_row_count = ?, duplicate_count = ?,
                conflict_count = ?, invalid_count = ?, unpaired_count = ?, order_count = ?
            WHERE id = ?
            """,
            (
                status,
                completed_at,
                assignments["trade_date_start"],
                assignments["trade_date_end"],
                *(assignments[field] for field in _COUNT_FIELDS),
                str(batch_id),
            ),
        )
        if result.rowcount != 1:
            raise ValueError("导入批次不存在")
    return _batch_by_id(batch_id)


def revert_import_batch(
    batch_id: str,
    platform: str,
    *,
    confirm: bool = False,
) -> dict[str, Any]:
    """Soft-revert facts first introduced by one committed import batch."""
    normalized = normalize_platform(platform)
    with transaction(get_runtime_paths()) as conn:
        batch = conn.execute(
            "SELECT * FROM import_batches WHERE id = ? AND platform = ?",
            (str(batch_id), normalized),
        ).fetchone()
        if batch is None:
            raise ValueError("导入批次不存在")
        if batch["status"] == "reverted":
            return {"batch_id": str(batch_id), "status": "reverted", "reverted": False}
        if batch["status"] != "committed":
            raise ValueError("只有已完成的导入批次可以撤销")

        linked_ids = [
            str(row["execution_id"])
            for row in conn.execute(
                """
                SELECT execution_id
                FROM import_batch_executions
                WHERE batch_id = ? AND disposition = 'new'
                """,
                (str(batch_id),),
            ).fetchall()
        ]
        revert_ids = []
        for execution_id in linked_ids:
            still_referenced = conn.execute(
                """
                SELECT 1
                FROM import_batch_executions AS links
                JOIN import_batches AS other_batches ON other_batches.id = links.batch_id
                WHERE links.execution_id = ?
                  AND links.batch_id != ?
                  AND links.disposition = 'new'
                  AND other_batches.status != 'reverted'
                LIMIT 1
                """,
                (execution_id, str(batch_id)),
            ).fetchone()
            if still_referenced is None:
                revert_ids.append(execution_id)

        trade_ids: list[str] = []
        if revert_ids:
            placeholders = ",".join("?" for _ in revert_ids)
            trade_ids = [
                str(row["trade_id"])
                for row in conn.execute(
                    f"""
                    SELECT DISTINCT trade_id
                    FROM import_execution_matches
                    WHERE open_execution_id IN ({placeholders})
                       OR close_execution_id IN ({placeholders})
                    """,
                    [*revert_ids, *revert_ids],
                ).fetchall()
            ]

        protected_trades = []
        if trade_ids:
            placeholders = ",".join("?" for _ in trade_ids)
            rows = conn.execute(
                f"""
                SELECT DISTINCT trades.id,
                       CASE WHEN COALESCE(trades.review_text, '') != ''
                                  OR COALESCE(trades.screenshot_path, '') != ''
                                  OR COALESCE(trades.is_featured, 0) = 1
                                  OR COALESCE(trades.trade_type, 'unclassified') != 'unclassified'
                                  OR COALESCE(trades.strategy, 'strategy_unclassified') != 'strategy_unclassified'
                                  OR EXISTS (
                                      SELECT 1 FROM campaign_source_trades AS links
                                      JOIN trade_campaigns AS campaigns ON campaigns.id = links.campaign_id
                                      WHERE links.trade_id = trades.id
                                        AND (COALESCE(campaigns.review_text, '') != ''
                                             OR COALESCE(campaigns.screenshot_path, '') != ''
                                             OR COALESCE(campaigns.is_featured, 0) = 1
                                             OR COALESCE(campaigns.trade_type_tags, '[]') NOT IN ('[]', '["unclassified"]')
                                             OR COALESCE(campaigns.strategy_tags, '[]') NOT IN ('[]', '["strategy_unclassified"]')
                                             OR COALESCE(campaigns.mistake_tags, '[]') != '[]')
                                  ) THEN 1 ELSE 0 END AS protected
                FROM trades
                WHERE trades.id IN ({placeholders})
                """,
                trade_ids,
            ).fetchall()
            protected_trades = [
                str(row["id"]) for row in rows if int(row["protected"] or 0)
            ]
        if protected_trades and not confirm:
            return {
                "batch_id": str(batch_id),
                "status": str(batch["status"]),
                "requires_confirmation": True,
                "protected_trade_ids": protected_trades,
                "affected_trade_ids": trade_ids,
            }

        if revert_ids:
            placeholders = ",".join("?" for _ in revert_ids)
            if trade_ids:
                trade_placeholders = ",".join("?" for _ in trade_ids)
                conn.execute(
                    f"DELETE FROM import_execution_matches WHERE trade_id IN ({trade_placeholders})",
                    trade_ids,
                )
                conn.execute(
                    f"""
                    UPDATE trades
                    SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
                        deleted_reason = CASE
                            WHEN COALESCE(deleted_at, '') = '' THEN 'import_batch_revert'
                            ELSE deleted_reason
                        END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id IN ({trade_placeholders}) AND platform = ?
                    """,
                    [*trade_ids, normalized],
                )
            conn.execute(
                f"""
                UPDATE import_executions
                SET remaining_quantity = 0, status = 'reverted', updated_at = CURRENT_TIMESTAMP
                WHERE id IN ({placeholders}) AND platform = ?
                """,
                [*revert_ids, normalized],
            )

        conn.execute(
            "UPDATE import_batches SET status = 'reverted', completed_at = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), str(batch_id)),
        )
        if trade_ids:
            from .campaign_repository import CampaignRepository

            CampaignRepository(get_runtime_paths()).rebuild(conn=conn)
        return {
            "batch_id": str(batch_id),
            "status": "reverted",
            "reverted": True,
            "reverted_execution_count": len(revert_ids),
            "affected_trade_ids": trade_ids,
        }


def list_import_batches(
    platform: str,
    year: int | None = None,
    month: int | None = None,
) -> list[dict[str, Any]]:
    normalized = normalize_platform(platform)
    clauses = ["platform = ?"]
    params: list[Any] = [normalized]
    if year is not None and month is not None:
        prefix = f"{int(year):04d}-{int(month):02d}%"
        clauses.append("started_at LIKE ?")
        params.append(prefix)
    conn = connect(get_runtime_paths())
    try:
        rows = conn.execute(
            f"""
            SELECT batches.*,
                   COALESCE((
                       SELECT COUNT(*)
                       FROM import_batch_issues AS issue_rows
                       WHERE issue_rows.batch_id = batches.id
                         AND issue_rows.code = 'duplicate_order'
                   ), 0) AS duplicate_order_count
            FROM import_batches AS batches
            WHERE {' AND '.join(clauses)}
            ORDER BY batches.started_at DESC, batches.id DESC
            """,
            params,
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


def get_import_batch(batch_id: str, platform: str) -> dict[str, Any] | None:
    normalized = normalize_platform(platform)
    conn = connect(get_runtime_paths())
    try:
        row = conn.execute(
            "SELECT * FROM import_batches WHERE id = ? AND platform = ?",
            (str(batch_id), normalized),
        ).fetchone()
        if row is None:
            return None
        result = dict(row)
        result["issues"] = _issues_for_batch(conn, str(batch_id))
        result["unmatched_executions"] = _unmatched_for_batch_conn(conn, str(batch_id))
        return result
    finally:
        conn.close()


def get_import_calendar(platform: str, year: int, month: int) -> dict[str, dict[str, int | str]]:
    normalized = normalize_platform(platform)
    prefix = f"{int(year):04d}-{int(month):02d}%"
    conn = connect(get_runtime_paths())
    try:
        rows = conn.execute(
            """
            SELECT trade_date,
                   SUM(source_row_count) AS source_row_count,
                   SUM(new_row_count) AS new_row_count,
                   SUM(duplicate_count) AS duplicate_count,
                   SUM(conflict_count) AS conflict_count,
                   SUM(invalid_count) AS invalid_count,
                   SUM(unpaired_count) AS unpaired_count,
                   SUM(order_count) AS order_count
            FROM import_batch_days
            WHERE platform = ? AND trade_date LIKE ?
            GROUP BY trade_date
            ORDER BY trade_date
            """,
            (normalized, prefix),
        ).fetchall()
        calendar = {
            str(row["trade_date"]): {
                field: int(row[field] or 0)
                for field in _COUNT_FIELDS
            }
            for row in rows
        }
        issue_rows = conn.execute(
            """
            SELECT trade_date, COUNT(*) AS duplicate_order_count
            FROM import_batch_issues
            WHERE platform = ? AND trade_date LIKE ? AND code = 'duplicate_order'
            GROUP BY trade_date
            """,
            (normalized, prefix),
        ).fetchall()
        for row in issue_rows:
            calendar.setdefault(str(row["trade_date"]), {})["duplicate_order_count"] = int(
                row["duplicate_order_count"] or 0
            )
        return calendar
    finally:
        conn.close()


def _batch_by_id(batch_id: str) -> dict[str, Any]:
    conn = connect(get_runtime_paths())
    try:
        row = conn.execute(
            "SELECT * FROM import_batches WHERE id = ?", (str(batch_id),)
        ).fetchone()
        if row is None:
            raise ValueError("导入批次不存在")
        result = dict(row)
        result["issues"] = _issues_for_batch(conn, str(batch_id))
        result["unmatched_executions"] = _unmatched_for_batch_conn(conn, str(batch_id))
        return result
    finally:
        conn.close()


def _basename(filename: str) -> str:
    text = str(filename or "").strip()
    if not text:
        return "未命名文件"
    return re.split(r"[\\/]", text)[-1] or PurePath(text).name


def _issues_for_batch(conn, batch_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, row_number, trade_date, code, message, details_json FROM import_batch_issues WHERE batch_id = ? ORDER BY row_number, id",
        (batch_id,),
    ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        try:
            details = json.loads(item.pop("details_json") or "{}")
        except json.JSONDecodeError:
            details = {}
        item.update(details)
        result.append(item)
    return result


def _unmatched_for_batch_conn(conn, batch_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT id, batch_id, platform, account, trade_date, time_utc, symbol,
               side, offset, quantity, remaining_quantity, price, fee, pnl,
               trade_id, order_id, source_kind, source_filename, source_sheet,
               source_row_number, status
        FROM import_executions
        WHERE batch_id = ? AND remaining_quantity > 1e-9 AND status != 'reverted'
        ORDER BY trade_date, time_utc, source_row_number, id
        """,
        (str(batch_id),),
    ).fetchall()
    return [dict(row) for row in rows]


def _duplicate_execution_details(
    execution: NormalizedExecution,
    existing: Any,
    matched_by: str,
) -> dict[str, Any]:
    return {
        "duplicate_reason": (
            "成交序号和成交字段完全一致"
            if matched_by == "成交序号"
            else "成交字段完全一致"
        ),
        "matched_by": matched_by,
        "existing_execution_id": str(existing["id"]),
        "existing_batch_id": str(existing["batch_id"] or ""),
        "existing_source_filename": str(existing["source_filename"] or ""),
        "existing_source_sheet": str(existing["source_sheet"] or ""),
        "existing_source_row_number": existing["source_row_number"],
        "source_filename": execution.source_filename,
        "source_sheet": execution.source_sheet,
        "source_row_number": execution.source_row_number,
        "trade_id": execution.trade_id,
        "symbol": execution.symbol,
    }


def _execution_differences(execution: NormalizedExecution, existing: Any) -> list[dict[str, Any]]:
    fields = (
        ("trade_date", existing["trade_date"], execution.trade_date, False),
        ("time_utc", existing["time_utc"], execution.time_utc, False),
        ("symbol", existing["symbol"], execution.symbol, False),
        ("side", existing["side"], execution.side, False),
        ("offset", existing["offset"], execution.offset, False),
        ("quantity", existing["quantity"], execution.quantity, True),
        ("price", existing["price"], execution.price, True),
        ("fee", existing["fee"], execution.fee, True),
        ("pnl", existing["pnl"], execution.pnl, True),
        ("trade_id", existing["trade_id"], execution.trade_id, False),
    )
    differences = []
    for field, current, imported, numeric in fields:
        equal = (
            abs(float(current or 0.0) - float(imported or 0.0)) <= 1e-9
            if numeric
            else str(current or "") == str(imported or "")
        )
        if not equal:
            differences.append(
                {
                    "field": field,
                    "existing": float(current) if numeric else str(current or ""),
                    "imported": float(imported) if numeric else str(imported or ""),
                }
            )
    return differences


def _execution_fingerprint(execution: NormalizedExecution) -> str:
    if execution.trade_id:
        values = (
            "id",
            execution.platform,
            execution.account,
            execution.trade_id,
            execution.trade_date,
            execution.time_utc,
            execution.symbol,
            execution.side,
            execution.offset,
            str(execution.quantity),
            str(execution.price),
            str(execution.fee),
            str(execution.pnl),
        )
    else:
        values = (
            "signature",
            execution.platform,
            execution.account,
            execution.trade_date,
            execution.time_utc,
            execution.symbol,
            execution.side,
            execution.offset,
            str(execution.quantity),
            str(execution.price),
            str(execution.fee),
            str(execution.pnl),
        )
    return "|".join(str(value) for value in values)


def _execution_identity(execution: NormalizedExecution) -> str:
    if not execution.trade_id:
        return ""
    return "|".join(
        (
            execution.platform,
            execution.account,
            execution.trade_id,
        )
    )


def _execution_matches_row(execution: NormalizedExecution, row: Any) -> bool:
    return all(
        (
            str(row["platform"] or "") == execution.platform,
            str(row["account"] or "") == execution.account,
            str(row["trade_date"] or "") == execution.trade_date,
            str(row["time_utc"] or "") == execution.time_utc,
            str(row["symbol"] or "") == execution.symbol,
            str(row["side"] or "") == execution.side,
            str(row["offset"] or "") == execution.offset,
            abs(float(row["quantity"] or 0.0) - float(execution.quantity)) <= 1e-9,
            abs(float(row["price"] or 0.0) - float(execution.price)) <= 1e-9,
            abs(float(row["fee"] or 0.0) - float(execution.fee)) <= 1e-9,
            abs(float(row["pnl"] or 0.0) - float(execution.pnl)) <= 1e-9,
            str(row["trade_id"] or "") == execution.trade_id,
        )
    )


def import_sources_for_trade_ids(conn, trade_ids: Iterable[str]) -> dict[str, list[dict[str, Any]]]:
    ids = [str(trade_id) for trade_id in trade_ids if str(trade_id)]
    if not ids:
        return {}
    placeholders = ",".join("?" for _ in ids)
    rows = conn.execute(
        f"""
        SELECT DISTINCT matches.trade_id, batches.id AS batch_id, batches.filename,
               batches.started_at, batches.file_sha256, executions.id AS execution_id,
               executions.trade_id AS source_trade_id, executions.offset,
               executions.source_sheet, executions.source_row_number
        FROM import_execution_matches AS matches
        JOIN import_batch_executions AS batch_links
          ON batch_links.execution_id IN (matches.open_execution_id, matches.close_execution_id)
         AND batch_links.disposition IN ('new', 'duplicate')
        JOIN import_batches AS batches
          ON batches.id = batch_links.batch_id
         AND batches.status != 'reverted'
        JOIN import_executions AS executions
          ON executions.id = batch_links.execution_id
        WHERE matches.trade_id IN ({placeholders})
        ORDER BY batches.started_at, executions.source_row_number, executions.id
        """,
        ids,
    ).fetchall()
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (str(row["trade_id"]), str(row["batch_id"]))
        item = grouped.setdefault(
            key,
            {
                "batch_id": str(row["batch_id"]),
                "filename": str(row["filename"] or ""),
                "started_at": row["started_at"],
                "file_sha256": str(row["file_sha256"] or ""),
                "source_sheet": str(row["source_sheet"] or ""),
                "source_rows": [],
                "execution_ids": [],
                "trade_ids": [],
            },
        )
        if row["source_row_number"] is not None:
            item["source_rows"].append(int(row["source_row_number"]))
        item["execution_ids"].append(str(row["execution_id"]))
        if row["source_trade_id"]:
            item["trade_ids"].append(str(row["source_trade_id"]))
    result: dict[str, list[dict[str, Any]]] = {}
    for (trade_id, _), item in grouped.items():
        item["source_rows"] = sorted(set(item["source_rows"]))
        item["execution_ids"] = sorted(set(item["execution_ids"]))
        item["trade_ids"] = sorted(set(item["trade_ids"]))
        result.setdefault(trade_id, []).append(item)
    return result


def _safe_details(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    result = dict(value)
    for key in ("source_filename", "filename", "file_path", "path"):
        if key in result:
            result[key] = _basename(str(result[key]))
    return result


def _optional_int(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None

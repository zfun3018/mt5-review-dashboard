from __future__ import annotations

import math
from collections import defaultdict
from statistics import mean, stdev
from typing import Any


VOLUME_EPSILON = 1e-9


def _ticket_sort_value(value: Any) -> tuple[int, int | str]:
    text = str(value or "")
    try:
        return (0, int(text))
    except ValueError:
        return (1, text)


def deal_sort_key(deal: dict[str, Any]) -> tuple[int, tuple[int, int | str]]:
    return (int(deal.get("time_msc") or 0), _ticket_sort_value(deal.get("deal_ticket")))


def _normalized_entry_kind(value: Any) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "deal_entry_in": "in",
        "deal_entry_out": "out",
        "deal_entry_inout": "inout",
        "deal_entry_out_by": "out_by",
        "0": "in",
        "1": "out",
        "2": "inout",
        "3": "out_by",
    }
    return aliases.get(text, text)


def _side_from_deal(deal_type: Any, *, exiting: bool = False) -> str:
    text = str(deal_type or "").strip().lower()
    is_buy = text in {"buy", "deal_type_buy", "0"}
    if exiting:
        return "short" if is_buy else "long"
    return "long" if is_buy else "short"


def reconstruct_positions(deals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for source in deals:
        deal = dict(source)
        account = str(deal.get("account") or "MT5-LOCAL")
        position_id = str(deal.get("position_id") or "")
        if not position_id:
            continue
        deal["account"] = account
        deal["position_id"] = position_id
        deal["entry_kind"] = _normalized_entry_kind(deal.get("entry_kind"))
        deal["volume"] = float(deal.get("volume") or 0.0)
        deal["price"] = float(deal.get("price") or 0.0)
        deal["profit"] = float(deal.get("profit") or 0.0)
        grouped[(account, position_id)].append(deal)

    positions: list[dict[str, Any]] = []
    for (account, position_id), position_deals in grouped.items():
        ordered = sorted(position_deals, key=deal_sort_key)
        entries: list[dict[str, Any]] = []
        exits: list[dict[str, Any]] = []
        side = ""
        remaining = 0.0
        reversal_seen = False

        for deal in ordered:
            kind = deal["entry_kind"]
            volume = max(0.0, deal["volume"])
            if kind == "in":
                side = side or _side_from_deal(deal.get("deal_type"))
                entries.append(deal)
                remaining += volume
            elif kind in {"out", "out_by"}:
                side = side or _side_from_deal(deal.get("deal_type"), exiting=True)
                exits.append(deal)
                remaining -= volume
            elif kind == "inout":
                side = side or _side_from_deal(deal.get("deal_type"), exiting=True)
                closing_volume = min(max(remaining, 0.0), volume)
                if closing_volume:
                    exit_part = dict(deal)
                    exit_part["volume"] = closing_volume
                    exits.append(exit_part)
                    remaining -= closing_volume
                if volume - closing_volume > VOLUME_EPSILON:
                    reversal_seen = True
            if abs(remaining) <= VOLUME_EPSILON:
                remaining = 0.0

        entry_volume = sum(deal["volume"] for deal in entries)
        exit_volume = sum(deal["volume"] for deal in exits)
        weighted_entry_price = (
            sum(deal["volume"] * deal["price"] for deal in entries) / entry_volume
            if entry_volume > VOLUME_EPSILON
            else None
        )
        if not entries or remaining < -VOLUME_EPSILON or reversal_seen:
            status = "incomplete"
        elif remaining > VOLUME_EPSILON:
            status = "open"
        elif abs(entry_volume - exit_volume) <= VOLUME_EPSILON:
            status = "complete"
        else:
            status = "incomplete"

        first_deal = ordered[0]
        last_exit = exits[-1] if exits else None
        opened_deal = entries[0] if entries else first_deal
        position = {
            "id": f"{account}:{position_id}",
            "account": account,
            "position_id": position_id,
            "symbol": str(first_deal.get("symbol") or ""),
            "side": side,
            "opened_at_utc": str(opened_deal.get("time_utc") or ""),
            "closed_at_utc": str(last_exit.get("time_utc") or "") if status == "complete" else None,
            "opened_sort_key": deal_sort_key(opened_deal),
            "closed_sort_key": deal_sort_key(last_exit) if status == "complete" and last_exit else None,
            "entry_deals": entries,
            "exit_deals": exits,
            "entry_volume": round(entry_volume, 10),
            "exit_volume": round(exit_volume, 10),
            "remaining_volume": round(max(remaining, 0.0), 10),
            "weighted_entry_price": weighted_entry_price,
            "partial_exit_count": max(0, len(exits) - 1),
            "reconstruction_status": status,
            "initial_stop_price": None,
        }
        positions.append(position)

    return sorted(positions, key=lambda item: (item["opened_sort_key"], item["id"]))


def group_campaigns(positions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for position in positions:
        grouped[
            (
                str(position.get("account") or ""),
                str(position.get("symbol") or ""),
                str(position.get("side") or ""),
            )
        ].append(position)

    campaigns: list[dict[str, Any]] = []
    infinite_key = (math.inf, (2, ""))
    for (account, symbol, side), members in grouped.items():
        ordered = sorted(members, key=lambda item: (item["opened_sort_key"], item["id"]))
        current: list[dict[str, Any]] = []
        active_until: tuple[Any, Any] | None = None

        def finish() -> None:
            if not current:
                return
            closed = all(member.get("closed_sort_key") is not None for member in current)
            campaigns.append(
                {
                    "account": account,
                    "symbol": symbol,
                    "side": side,
                    "position_ids": [member["id"] for member in current],
                    "positions": list(current),
                    "position_count": len(current),
                    "scale_in_count": max(0, len(current) - 1),
                    "partial_exit_count": sum(int(member.get("partial_exit_count") or 0) for member in current),
                    "opened_at_utc": current[0]["opened_at_utc"],
                    "closed_at_utc": max(
                        (str(member.get("closed_at_utc") or "") for member in current),
                        default="",
                    )
                    if closed
                    else None,
                    "status": "closed" if closed else "open",
                }
            )

        for position in ordered:
            opened_key = position["opened_sort_key"]
            if current and active_until is not None and opened_key > active_until:
                finish()
                current = []
                active_until = None
            current.append(position)
            closed_key = position.get("closed_sort_key") or infinite_key
            if active_until is None or closed_key > active_until:
                active_until = closed_key
        finish()

    return sorted(
        campaigns,
        key=lambda item: (
            item["positions"][0]["opened_sort_key"],
            item["account"],
            item["symbol"],
            item["side"],
        ),
    )


def calculate_position_risk(position: dict[str, Any]) -> dict[str, Any]:
    entries = list(position.get("entry_deals") or [])
    exits = list(position.get("exit_deals") or [])
    stop_value = position.get("initial_stop_price")
    base = {
        "planned_risk": None,
        "result": None,
        "position_r": None,
        "risk_status": "missing",
        "risk_missing_reason": "missing_initial_stop",
    }
    if stop_value in (None, ""):
        return base
    try:
        stop = float(stop_value)
    except (TypeError, ValueError):
        return {**base, "risk_status": "invalid", "risk_missing_reason": "invalid_initial_stop"}
    if not math.isfinite(stop) or not entries:
        return {**base, "risk_status": "invalid", "risk_missing_reason": "invalid_initial_stop"}

    side = str(position.get("side") or "").lower()
    entry_prices = [float(deal.get("price") or 0.0) for deal in entries]
    direction_valid = (
        side == "long" and all(stop < price for price in entry_prices)
    ) or (
        side == "short" and all(stop > price for price in entry_prices)
    )
    if not direction_valid:
        return {**base, "risk_status": "invalid", "risk_missing_reason": "invalid_stop_direction"}
    if position.get("reconstruction_status") not in {"complete", "legacy_estimated"}:
        return {**base, "risk_status": "incomplete", "risk_missing_reason": "position_incomplete"}

    entry_volume = float(
        position.get("entry_volume")
        if position.get("entry_volume") is not None
        else sum(float(deal.get("volume") or 0.0) for deal in entries)
    )
    exit_volume = float(
        position.get("exit_volume")
        if position.get("exit_volume") is not None
        else sum(float(deal.get("volume") or 0.0) for deal in exits)
    )
    if entry_volume <= VOLUME_EPSILON or abs(entry_volume - exit_volume) > VOLUME_EPSILON:
        return {**base, "risk_status": "incomplete", "risk_missing_reason": "volume_mismatch"}

    planned_risk = sum(
        float(deal.get("volume") or 0.0) * abs(float(deal.get("price") or 0.0) - stop)
        for deal in entries
    )
    if planned_risk <= VOLUME_EPSILON:
        return {**base, "risk_status": "invalid", "risk_missing_reason": "zero_risk"}

    weighted_entry = sum(
        float(deal.get("volume") or 0.0) * float(deal.get("price") or 0.0)
        for deal in entries
    ) / entry_volume
    if side == "long":
        result = sum(
            float(deal.get("volume") or 0.0)
            * (float(deal.get("price") or 0.0) - weighted_entry)
            for deal in exits
        )
    else:
        result = sum(
            float(deal.get("volume") or 0.0)
            * (weighted_entry - float(deal.get("price") or 0.0))
            for deal in exits
        )
    planned_risk = round(planned_risk, 10)
    result = round(result, 10)
    return {
        "planned_risk": planned_risk,
        "result": result,
        "position_r": round(result / planned_risk, 10),
        "risk_status": "complete",
        "risk_missing_reason": None,
    }


def calculate_campaign_r(
    campaign: dict[str, Any], positions: list[dict[str, Any]]
) -> dict[str, Any]:
    risk_results = [calculate_position_risk(position) for position in positions]
    reasons = [
        str(result["risk_missing_reason"])
        for result in risk_results
        if result.get("risk_missing_reason")
    ]
    if campaign.get("status") != "closed":
        reasons.insert(0, "campaign_open")

    complete_count = sum(result["risk_status"] == "complete" for result in risk_results)
    total_count = len(positions)
    total_risk = sum(float(result["planned_risk"] or 0.0) for result in risk_results)
    total_result = sum(float(result["result"] or 0.0) for result in risk_results)
    all_complete = (
        campaign.get("status") == "closed"
        and total_count > 0
        and complete_count == total_count
        and total_risk > VOLUME_EPSILON
    )
    statuses = {str(result["risk_status"]) for result in risk_results}
    if all_complete:
        risk_status = "complete"
    elif "invalid" in statuses:
        risk_status = "invalid"
    elif "incomplete" in statuses or campaign.get("status") != "closed":
        risk_status = "incomplete"
    else:
        risk_status = "missing"

    return {
        "campaign_r": round(total_result / total_risk, 10) if all_complete else None,
        "campaign_total_risk": round(total_risk, 10) if all_complete else None,
        "campaign_total_result": round(total_result, 10) if all_complete else None,
        "risk_status": risk_status,
        "risk_positions_complete": complete_count,
        "risk_positions_total": total_count,
        "risk_missing_reasons": list(dict.fromkeys(reasons)),
        "position_risks": risk_results,
    }


def _calculate_r_runs_z(
    campaigns: list[dict[str, Any]], scratch_threshold_r: float
) -> dict[str, Any]:
    ordered = sorted(
        campaigns,
        key=lambda campaign: (
            str(campaign.get("closed_at_utc") or ""),
            str(campaign.get("id") or ""),
        ),
    )
    outcomes = []
    for campaign in ordered:
        value = campaign.get("campaign_r")
        if value is None:
            continue
        numeric = float(value)
        if abs(numeric) <= scratch_threshold_r:
            continue
        outcomes.append(1 if numeric > 0 else -1)
    n = len(outcomes)
    wins = sum(outcome > 0 for outcome in outcomes)
    losses = n - wins
    runs = sum(
        outcomes[index] != outcomes[index - 1] for index in range(1, n)
    ) + (1 if n else 0)
    result: dict[str, Any] = {
        "n": n,
        "wins": wins,
        "losses": losses,
        "runs": runs,
        "z": None,
        "classification": "insufficient_data",
    }
    if n < 2 or not wins or not losses:
        return result
    x = 2 * wins * losses
    denominator = math.sqrt(x * (x - n) / (n - 1)) if x > n else 0.0
    if denominator <= 0:
        return result
    z = (n * (runs - 0.5) - x) / denominator
    result["z"] = round(z, 4)
    if z > 1.96:
        result["classification"] = "alternating"
    elif z < -1.96:
        result["classification"] = "clustered"
    else:
        result["classification"] = "independent"
    return result


def build_r_metrics(
    campaigns: list[dict[str, Any]], scratch_threshold_r: float = 0.15
) -> dict[str, Any]:
    threshold = float(scratch_threshold_r)
    complete = [
        campaign
        for campaign in campaigns
        if campaign.get("campaign_r") is not None
        and math.isfinite(float(campaign["campaign_r"]))
    ]
    values = [float(campaign["campaign_r"]) for campaign in complete]
    wins = [value for value in values if value > threshold]
    losses = [value for value in values if value < -threshold]
    scratches = [value for value in values if abs(value) <= threshold]
    decisive_count = len(wins) + len(losses)

    sqn = None
    if len(values) < 30:
        sqn_status = "insufficient_sample"
    elif stdev(values) <= VOLUME_EPSILON:
        sqn_status = "zero_variance"
    else:
        sqn_status = "available"
        sqn = round(mean(values) / stdev(values) * math.sqrt(len(values)), 4)

    total_count = len(campaigns)
    complete_count = len(complete)
    return {
        "sample_count": total_count,
        "complete_count": complete_count,
        "missing_count": total_count - complete_count,
        "coverage_rate": complete_count / total_count if total_count else 0.0,
        "scratch_threshold_r": threshold,
        "scratch_count": len(scratches),
        "scratch_rate": len(scratches) / complete_count if complete_count else 0.0,
        "win_count": len(wins),
        "loss_count": len(losses),
        "decisive_win_rate": len(wins) / decisive_count if decisive_count else 0.0,
        "all_sample_win_rate": len(wins) / complete_count if complete_count else 0.0,
        "expectancy_r": sum(values) / complete_count if complete_count else None,
        "sqn": sqn,
        "sqn_status": sqn_status,
        "sqn_minimum_sample": 30,
        "z_score": _calculate_r_runs_z(complete, threshold),
    }

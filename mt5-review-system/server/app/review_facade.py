from __future__ import annotations

from typing import Any

from .data import trade_commands


def checkin_review_trade(
    trade_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    return trade_commands.checkin_review_trade(trade_id, checkin_date, platform)


def cancel_review_trade(
    trade_id: str,
    checkin_date: str | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    return trade_commands.cancel_review_trade(trade_id, checkin_date, platform)


def set_review_daily_goal(daily_goal: int) -> dict[str, int]:
    return trade_commands.set_review_daily_goal(daily_goal)

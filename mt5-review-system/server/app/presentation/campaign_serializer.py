from __future__ import annotations

from typing import Any

from ..application.campaign_response import CampaignResponseSerializer
from .trade_serializer import _serialize_trade


def _serialize_source_trade(source: dict[str, Any]) -> dict[str, Any]:
    source_id = str(source["id"])
    return _serialize_trade(source, {source_id: source.get("custom_fields", {})})


_serializer = CampaignResponseSerializer(_serialize_source_trade)


def _serialize_position_for_campaign(position: dict[str, Any]) -> dict[str, Any]:
    return _serializer.serialize_position(position)


def _serialize_position_summary_for_campaign(position: dict[str, Any]) -> dict[str, Any]:
    return _serializer.serialize_position_summary(position)


def _serialize_campaign_record(
    record: dict[str, Any], *, include_positions: bool
) -> dict[str, Any]:
    return _serializer.serialize_campaign(record, include_positions=include_positions)

from __future__ import annotations

from typing import Any, Callable

from . import PageRequest
from .campaign_response import CampaignResponseSerializer


class OrdersService:
    def __init__(
        self,
        campaigns,
        trade_serializer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.campaigns = campaigns
        self.trade_serializer = trade_serializer or dict
        self.response_serializer = CampaignResponseSerializer(self.trade_serializer)

    def list_campaigns(
        self,
        filters: dict[str, Any] | None = None,
        page: PageRequest | None = None,
    ) -> dict[str, Any]:
        request = page or PageRequest()
        result = self.campaigns.query(
            dict(filters or {}), request.page, request.page_size
        )
        records = [
            self._serialize_campaign(record, include_positions=False)
            for record in result.items
        ]
        return {
            "campaigns": records,
            "trades": records,
            "total": result.total,
            "page": result.page,
            "page_size": result.page_size,
        }

    def get_campaign(self, campaign_id: str) -> dict[str, Any] | None:
        record = self.campaigns.get(campaign_id)
        return self._serialize_campaign(record, include_positions=True) if record else None

    def _serialize_position(self, position: dict[str, Any]) -> dict[str, Any]:
        return self.response_serializer.serialize_position(position)

    def _serialize_position_summary(
        self, position: dict[str, Any]
    ) -> dict[str, Any]:
        return self.response_serializer.serialize_position_summary(position)

    def _serialize_campaign(
        self, record: dict[str, Any], *, include_positions: bool
    ) -> dict[str, Any]:
        return self.response_serializer.serialize_campaign(
            record, include_positions=include_positions
        )

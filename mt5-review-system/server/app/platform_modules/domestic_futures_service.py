from __future__ import annotations

from ..platforms import DOMESTIC_FUTURES_PLATFORM


class DomesticFuturesService:
    """Boundary marker for domestic futures data import behavior."""

    platform_id = DOMESTIC_FUTURES_PLATFORM
    ingestion_kind = "data_import"

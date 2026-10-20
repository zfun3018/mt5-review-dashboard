from __future__ import annotations

from ..platforms import DOMESTIC_FUTURES_PLATFORM
from ..platform_adapters.contracts import DOMESTIC_FUTURES_CAPABILITIES


class DomesticFuturesService:
    """Boundary marker for domestic futures data import behavior."""

    platform_id = DOMESTIC_FUTURES_PLATFORM
    ingestion_kind = "data_import"
    capabilities = DOMESTIC_FUTURES_CAPABILITIES

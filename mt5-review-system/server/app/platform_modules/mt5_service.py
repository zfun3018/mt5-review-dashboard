from __future__ import annotations

from ..platforms import DEFAULT_PLATFORM
from ..platform_adapters.contracts import MT5_CAPABILITIES


class MT5Service:
    """Boundary marker for MT5 bridge and event reconstruction behavior."""

    platform_id = DEFAULT_PLATFORM
    ingestion_kind = "mt5_bridge"
    capabilities = MT5_CAPABILITIES

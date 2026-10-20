from __future__ import annotations

from ..platforms import DEFAULT_PLATFORM


class MT5Service:
    """Boundary marker for MT5 bridge and event reconstruction behavior."""

    platform_id = DEFAULT_PLATFORM
    ingestion_kind = "mt5_bridge"

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ..platforms import DEFAULT_PLATFORM, DOMESTIC_FUTURES_PLATFORM, normalize_platform


@dataclass(frozen=True)
class PlatformAdapterDescriptor:
    platform_id: str
    supported_formats: tuple[str, ...]
    source_kinds: tuple[str, ...]


class PlatformRegistry:
    def __init__(self, descriptors: tuple[PlatformAdapterDescriptor, ...]) -> None:
        self._descriptors = {item.platform_id: item for item in descriptors}

    def adapter(self, platform: str) -> PlatformAdapterDescriptor:
        platform_id = normalize_platform(platform)
        try:
            return self._descriptors[platform_id]
        except KeyError as exc:
            raise ValueError(f"Unsupported platform: {platform}") from exc

    def platform_ids(self) -> tuple[str, ...]:
        return tuple(self._descriptors)


platform_registry = PlatformRegistry(
    (
        PlatformAdapterDescriptor(DEFAULT_PLATFORM, ("jsonl",), ("mt5_bridge",)),
        PlatformAdapterDescriptor(
            DOMESTIC_FUTURES_PLATFORM,
            ("csv", "xls"),
            ("standard_template", "tonghuashun"),
        ),
    )
)

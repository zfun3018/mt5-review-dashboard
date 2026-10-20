from __future__ import annotations


DEFAULT_PLATFORM = "mt5"
DOMESTIC_FUTURES_PLATFORM = "domestic_futures"
# Kept for callers that still import the old symbol name. The stored platform
# identity is now the product workspace, not the export application.
TONGHUASHUN_PLATFORM = DOMESTIC_FUTURES_PLATFORM

PLATFORM_OPTIONS = (
    {"id": DEFAULT_PLATFORM, "label": "MT5"},
    {"id": DOMESTIC_FUTURES_PLATFORM, "label": "国内期货"},
)


def normalize_platform(value: str | None) -> str:
    text = str(value or DEFAULT_PLATFORM).strip().lower()
    aliases = {
        "mt5": DEFAULT_PLATFORM,
        "metatrader5": DEFAULT_PLATFORM,
        "domestic_futures": DOMESTIC_FUTURES_PLATFORM,
        "tonghuashun": DOMESTIC_FUTURES_PLATFORM,
        "ths": DOMESTIC_FUTURES_PLATFORM,
        "tonghuashun_futures": DOMESTIC_FUTURES_PLATFORM,
    }
    try:
        return aliases[text]
    except KeyError as exc:
        raise ValueError(f"Unsupported platform: {value}") from exc


def platform_options() -> list[dict[str, str]]:
    return [dict(option) for option in PLATFORM_OPTIONS]

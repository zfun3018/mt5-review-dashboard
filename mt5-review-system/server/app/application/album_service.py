from __future__ import annotations

from typing import Any, Callable

from ..domain.analytics import to_beijing
from . import PageRequest


class AlbumService:
    def __init__(
        self,
        trades,
        catalogs,
        trade_serializer: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> None:
        self.trades = trades
        self.catalogs = catalogs
        self.trade_serializer = trade_serializer or dict

    def query(
        self,
        filters: dict[str, Any] | None = None,
        page: PageRequest | None = None,
    ) -> dict[str, Any]:
        values = dict(filters or {})
        start_date = values.get("start_date") or values.get("start")
        end_date = values.get("end_date") or values.get("end")
        sort = str(values.get("sort") or "desc")
        if sort not in {"asc", "desc"}:
            raise ValueError("sort must be asc or desc")
        request = page or PageRequest(page_size=24)
        if request.page_size > 100:
            raise ValueError("album page_size must be between 1 and 100")

        symbol_values = _values(values.get("symbols") or values.get("symbol"))
        tag_values = _values(values.get("tags") or values.get("tag"))
        catalog = _build_catalog(
            self.catalogs.list_classifications(active_only=True),
            self.catalogs.list_classifications(active_only=True),
            _active_custom_fields(self.catalogs),
        )
        selected_groups = _tag_groups(tag_values, catalog)
        repository_filters: dict[str, Any] = {
            "start_date": start_date,
            "end_date": end_date,
            "symbols": symbol_values,
            "sort": sort,
            "custom_fields": {},
        }
        for dimension, group_tags in selected_groups.items():
            if dimension in {"trade_type", "strategy"}:
                repository_filters[dimension] = sorted(
                    tag.split(":", 1)[1] for tag in group_tags
                )
                continue
            field_id = dimension.split(":", 1)[1]
            repository_filters["custom_fields"][field_id] = {
                "field_type": catalog["fields"][field_id]["field_type"],
                "option_ids": sorted(tag.rsplit(":", 1)[1] for tag in group_tags),
            }
        result = self.trades.query_album(
            repository_filters,
            request.page,
            request.page_size,
        )
        page_trades = [
            _serialize_trade(self.trade_serializer(trade), catalog)
            for trade in result.items
        ]
        return {
            "filters": {
                "start": start_date or "",
                "end": end_date or "",
                "symbols": symbol_values,
                "tags": tag_values,
                "sort": sort,
            },
            "trades": page_trades,
            "days": _group_days(page_trades),
            "total": result.total,
            "page": result.page,
            "page_size": result.page_size,
            "available_filters": {
                "symbols": self.trades.list_active_symbols(),
                "tags": catalog["available_tags"],
                "custom_fields": catalog["all_fields"],
            },
        }


def _values(value: list[str] | str | None) -> list[str]:
    if value is None:
        return []
    raw_values = value if isinstance(value, list) else [value]
    split_values = []
    for raw_value in raw_values:
        split_values.extend(str(raw_value).split(","))
    return [item.strip() for item in split_values if item.strip()]


def _active_custom_fields(catalogs) -> list[dict[str, Any]]:
    """Read active fields while keeping small legacy test adapters usable."""
    try:
        return catalogs.list_custom_fields(active_only=True)
    except TypeError:
        return [field for field in catalogs.list_custom_fields() if field.get("active", True)]


def _build_catalog(
    all_options: list[dict[str, Any]],
    active_options: list[dict[str, Any]],
    all_fields: list[dict[str, Any]],
) -> dict[str, Any]:
    classifications = {
        (str(option["dimension"]), str(option["id"])): option
        for option in all_options
    }
    fields = {
        str(field["id"]): field
        for field in all_fields
        if field.get("field_type") in {"single", "multi"}
    }
    available_tags = []
    for option in active_options:
        dimension_label = (
            "交易场景" if option["dimension"] == "trade_type" else "交易策略"
        )
        available_tags.append(
            {
                "key": f"{option['dimension']}:{option['id']}",
                "label": f"{dimension_label} / {option['label']}",
                "dimension": option["dimension"],
                "color": option["color"],
            }
        )
    for field_id, field in fields.items():
        for option in field.get("options", []):
            available_tags.append(
                {
                    "key": f"field:{field_id}:{option['id']}",
                    "label": f"{field['name']} / {option['label']}",
                    "dimension": "custom_field",
                    "field_id": int(field_id),
                    "color": option["color"],
                }
            )
    return {
        "classifications": classifications,
        "fields": fields,
        "all_fields": all_fields,
        "available_tags": available_tags,
    }


def _tag_groups(
    tags: list[str], catalog: dict[str, Any]
) -> dict[str, set[str]]:
    groups: dict[str, set[str]] = {}
    for tag in tags:
        parts = tag.split(":")
        if parts[0] in {"trade_type", "strategy"} and len(parts) == 2:
            if (parts[0], parts[1]) not in catalog["classifications"]:
                raise ValueError("Unknown album tag")
            groups.setdefault(parts[0], set()).add(tag)
            continue
        if parts[0] == "field" and len(parts) == 3:
            field_id, option_id = parts[1], parts[2]
            field = catalog["fields"].get(field_id)
            if not field or not any(
                str(option["id"]) == option_id
                for option in field.get("options", [])
            ):
                raise ValueError("Unknown album tag")
            groups.setdefault(f"field:{field_id}", set()).add(tag)
            continue
        raise ValueError("Unknown album tag")
    return groups


def _tags_for_trade(
    trade: dict[str, Any], catalog: dict[str, Any]
) -> list[dict[str, Any]]:
    tags = []
    for dimension in ("trade_type", "strategy"):
        option_id = str(trade.get(dimension) or "")
        option = catalog["classifications"].get((dimension, option_id))
        if option:
            dimension_label = "交易场景" if dimension == "trade_type" else "交易策略"
            tags.append(
                {
                    "key": f"{dimension}:{option_id}",
                    "label": f"{dimension_label} / {option['label']}",
                    "dimension": dimension,
                    "color": option["color"],
                }
            )
    for field_id, field in catalog["fields"].items():
        value = trade.get("custom_fields", {}).get(field_id, "")
        values = value if isinstance(value, list) else [value]
        option_map = {
            str(option["id"]): option for option in field.get("options", [])
        }
        for option_id in values:
            option = option_map.get(str(option_id))
            if option:
                tags.append(
                    {
                        "key": f"field:{field_id}:{option_id}",
                        "label": f"{field['name']} / {option['label']}",
                        "dimension": "custom_field",
                        "field_id": int(field_id),
                        "color": option["color"],
                    }
                )
    return tags


def _serialize_trade(
    trade: dict[str, Any], catalog: dict[str, Any]
) -> dict[str, Any]:
    serialized = dict(trade)
    serialized["album_date"] = to_beijing(trade["close_time_utc"]).date().isoformat()
    serialized["album_tags"] = _tags_for_trade(trade, catalog)
    return serialized


def _group_days(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for trade in trades:
        groups.setdefault(trade["album_date"], []).append(trade)
    return [
        {
            "date": day,
            "order_count": len(day_trades),
            "net_pnl": round(
                sum(float(trade.get("net_pnl") or 0) for trade in day_trades), 2
            ),
            "trades": day_trades,
        }
        for day, day_trades in groups.items()
    ]

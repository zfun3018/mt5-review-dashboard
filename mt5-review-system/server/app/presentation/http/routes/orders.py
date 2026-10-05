from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import unquote

from ..responses import not_found, ok
from . import Body, Query, first, optional_int, path_part, request_body

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage) -> None:
    def trades(path: str, query: Query, body: Body):
        return ok(
            storage.query_trades(
                query=first(query, "q", "") or "",
                symbol=first(query, "symbol", "") or "",
                side=first(query, "side", "all") or "all",
                trade_type=first(query, "trade_type", "all") or "all",
                strategy=first(query, "strategy", "all") or "all",
                start_date=first(query, "start", None),
                end_date=first(query, "end", None),
                page=optional_int(first(query, "page", "1")) or 1,
                page_size=optional_int(first(query, "page_size", "50")) or 50,
            )
        )

    def campaigns(path: str, query: Query, body: Body):
        return ok(
            storage.list_campaigns(
                query=first(query, "q", "") or "",
                symbol=first(query, "symbol", "") or "",
                side=first(query, "side", "all") or "all",
                trade_type=first(query, "trade_type", "all") or "all",
                strategy=first(query, "strategy", "all") or "all",
                start_date=first(query, "start", None),
                end_date=first(query, "end", None),
                r_missing_only=(first(query, "r_missing", "0") or "0")
                in {"1", "true"},
                page=optional_int(first(query, "page", "1")) or 1,
                page_size=optional_int(first(query, "page_size", "50")) or 50,
            )
        )

    def campaign_detail(path: str, query: Query, body: Body):
        campaign_id = unquote(path_part(path, 3))
        campaign = storage.get_campaign(campaign_id)
        return ok(campaign) if campaign else not_found("Campaign not found")

    def trade_post(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/restore"):
            try:
                return ok(storage.restore_trade(trade_id))
            except KeyError:
                return not_found("Trade not found")
        if path.endswith("/screenshot"):
            try:
                return ok(
                    storage.replace_trade_screenshot(trade_id, request_body(body))
                )
            except KeyError:
                return not_found("Trade not found")
        return not_found()

    def campaign_patch(path: str, query: Query, body: Body):
        if not path.endswith("/review"):
            return not_found()
        campaign_id = unquote(path_part(path, 3))
        try:
            return ok(storage.update_campaign_review(campaign_id, request_body(body)))
        except KeyError:
            return not_found("Campaign not found")

    def position_patch(path: str, query: Query, body: Body):
        if not path.endswith("/initial-stop"):
            return not_found()
        position_id = unquote(path_part(path, 3))
        payload = request_body(body)
        try:
            return ok(
                storage.update_position_initial_stop(
                    position_id, payload.get("initial_stop_price")
                )
            )
        except KeyError:
            return not_found("Position not found")

    def trade_patch(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/review"):
            try:
                return ok(storage.update_trade_review(trade_id, request_body(body)))
            except KeyError:
                return not_found("Trade not found")
        if path.endswith("/archived"):
            payload = request_body(body)
            archived = payload.get("archived")
            if not isinstance(archived, bool):
                raise ValueError("archived must be a boolean")
            try:
                return ok(storage.update_trade_archived(trade_id, archived))
            except KeyError:
                return not_found("Trade not found")
        if "/custom-fields/" in path:
            try:
                field_id = int(path_part(path, 5))
                return ok(
                    storage.update_trade_custom_value(
                        trade_id, field_id, request_body(body)
                    )
                )
            except KeyError:
                return not_found("Trade or field not found")
        return not_found()

    def trade_delete(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/screenshot"):
            try:
                return ok(storage.delete_trade_screenshot(trade_id))
            except KeyError:
                return not_found("Trade not found")
        try:
            storage.delete_trade(trade_id)
        except KeyError:
            return not_found("Trade not found")
        return ok({"ok": True})

    router.add("GET", "/api/trades", trades)
    router.add("GET", "/api/campaigns", campaigns)
    router.add_prefix("GET", "/api/campaigns/", campaign_detail)
    router.add_prefix("POST", "/api/trades/", trade_post, suffix="/restore")
    router.add_prefix(
        "POST",
        "/api/trades/",
        trade_post,
        suffix="/screenshot",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/campaigns/",
        campaign_patch,
        suffix="/review",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/positions/",
        position_patch,
        suffix="/initial-stop",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/trades/",
        trade_patch,
        suffix="/review",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/trades/",
        trade_patch,
        suffix="/archived",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/trades/",
        trade_patch,
        contains="/custom-fields/",
        reads_body=True,
    )
    router.add_prefix("DELETE", "/api/trades/", trade_delete)

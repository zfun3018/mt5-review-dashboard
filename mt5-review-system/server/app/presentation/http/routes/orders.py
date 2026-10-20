from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import unquote

from ..responses import not_found, ok
from ....platforms import normalize_platform
from . import Body, Query, first, optional_int, path_part, platform_kwargs, request_body

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
                **platform_kwargs(query),
            )
        )

    def campaigns(path: str, query: Query, body: Body):
        campaign_kwargs = platform_kwargs(query)
        if "deleted" in query:
            campaign_kwargs["deleted"] = first(query, "deleted", "active") or "active"
        list_kwargs = {
                "query": first(query, "q", "") or "",
                "symbol": first(query, "symbol", "") or "",
                "side": first(query, "side", "all") or "all",
                "trade_type": first(query, "trade_type", "all") or "all",
                "strategy": first(query, "strategy", "all") or "all",
                "start_date": first(query, "start", None),
                "end_date": first(query, "end", None),
                "r_missing_only": (first(query, "r_missing", "0") or "0")
                in {"1", "true"},
                "page": optional_int(first(query, "page", "1")) or 1,
                "page_size": optional_int(first(query, "page_size", "50")) or 50,
                **campaign_kwargs,
        }
        if (first(query, "featured", "0") or "0") in {"1", "true"}:
            list_kwargs["featured"] = True
        return ok(storage.list_campaigns(**list_kwargs))

    def campaign_checkins(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"days", "platform"})
        if unknown:
            raise ValueError(f"Unsupported campaign check-in filter: {unknown[0]}")
        return ok(
            storage.get_campaign_checkins(
                days=optional_int(first(query, "days", "90")) or 90,
                **platform_kwargs(query),
            )
        )

    def random_featured_campaign(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"platform"})
        if unknown:
            raise ValueError(f"Unsupported random featured filter: {unknown[0]}")
        return ok({
            "campaign": storage.get_random_featured_campaign(**platform_kwargs(query)),
        })

    def campaign_detail(path: str, query: Query, body: Body):
        campaign_id = unquote(path_part(path, 3))
        campaign_kwargs = platform_kwargs(query)
        if "deleted" in query:
            campaign_kwargs["deleted"] = first(query, "deleted", "active") or "active"
        campaign = storage.get_campaign(campaign_id, **campaign_kwargs)
        return ok(campaign) if campaign else not_found("Campaign not found")

    def campaign_post(path: str, query: Query, body: Body):
        if path.endswith("/screenshot"):
            campaign_id = unquote(path_part(path, 3))
            try:
                return ok(
                    storage.replace_campaign_screenshot(
                        campaign_id, request_body(body), **platform_kwargs(query)
                    )
                )
            except KeyError:
                return not_found("Campaign not found")
        if not path.endswith("/checkin"):
            return not_found()
        campaign_id = unquote(path_part(path, 3))
        payload = request_body(body)
        try:
            return ok(
                storage.checkin_review_campaign(
                    campaign_id,
                    payload.get("checkin_date"),
                    **platform_kwargs(query),
                )
            )
        except KeyError:
            return not_found("Campaign not found")

    def trade_post(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/restore"):
            try:
                return ok(storage.restore_trade(trade_id, **platform_kwargs(query)))
            except KeyError:
                return not_found("Trade not found")
        if path.endswith("/screenshot"):
            try:
                return ok(
                    storage.replace_trade_screenshot(
                        trade_id, request_body(body), **platform_kwargs(query)
                    )
                )
            except KeyError:
                return not_found("Trade not found")
        return not_found()

    def campaign_patch(path: str, query: Query, body: Body):
        if path.endswith("/featured"):
            campaign_id = unquote(path_part(path, 3))
            payload = request_body(body)
            featured = payload.get("featured")
            if not isinstance(featured, bool):
                raise ValueError("featured must be a boolean")
            try:
                return ok(
                    storage.update_campaign_featured(
                        campaign_id,
                        featured,
                        **platform_kwargs(query),
                    )
                )
            except KeyError:
                return not_found("Campaign not found")
        if path.endswith("/initial-stop"):
            campaign_id = unquote(path_part(path, 3))
            payload = request_body(body)
            try:
                return ok(
                    storage.update_campaign_initial_stop(
                        campaign_id,
                        payload.get("initial_stop_price"),
                        **platform_kwargs(query),
                    )
                )
            except KeyError:
                return not_found("Campaign not found")
        if not path.endswith("/review"):
            return not_found()
        campaign_id = unquote(path_part(path, 3))
        try:
            return ok(
                storage.update_campaign_review(
                    campaign_id, request_body(body), **platform_kwargs(query)
                )
            )
        except KeyError:
            return not_found("Campaign not found")

    def campaign_delete(path: str, query: Query, body: Body):
        if path.endswith("/checkin"):
            campaign_id = unquote(path_part(path, 3))
            try:
                return ok(
                    storage.cancel_review_campaign(
                        campaign_id,
                        first(query, "checkin_date", None),
                        **platform_kwargs(query),
                    )
                )
            except KeyError:
                return not_found("Campaign not found")
        if not path.endswith("/screenshot"):
            return not_found()
        campaign_id = unquote(path_part(path, 3))
        try:
            return ok(
                storage.delete_campaign_screenshot(
                    campaign_id, **platform_kwargs(query)
                )
            )
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
                    position_id,
                    payload.get("initial_stop_price"),
                    **platform_kwargs(query),
                )
            )
        except KeyError:
            return not_found("Position not found")

    def trade_patch(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/review"):
            try:
                return ok(
                    storage.update_trade_review(
                        trade_id, request_body(body), **platform_kwargs(query)
                    )
                )
            except KeyError:
                return not_found("Trade not found")
        if path.endswith("/archived"):
            payload = request_body(body)
            archived = payload.get("archived")
            if not isinstance(archived, bool):
                raise ValueError("archived must be a boolean")
            try:
                return ok(
                    storage.update_trade_archived(
                        trade_id, archived, **platform_kwargs(query)
                    )
                )
            except KeyError:
                return not_found("Trade not found")
        if "/custom-fields/" in path:
            try:
                field_id = int(path_part(path, 5))
                return ok(
                    storage.update_trade_custom_value(
                        trade_id,
                        field_id,
                        request_body(body),
                        **platform_kwargs(query),
                    )
                )
            except KeyError:
                return not_found("Trade or field not found")
        return not_found()

    def trade_delete(path: str, query: Query, body: Body):
        trade_id = unquote(path_part(path, 3))
        if path.endswith("/screenshot"):
            try:
                return ok(
                    storage.delete_trade_screenshot(
                        trade_id, **platform_kwargs(query)
                    )
                )
            except KeyError:
                return not_found("Trade not found")
        try:
            payload = request_body(body)
            delete_kwargs = platform_kwargs(query)
            reason = str(payload.get("reason") or "").strip()
            if reason:
                delete_kwargs["reason"] = reason
            storage.delete_trade(trade_id, **delete_kwargs)
        except KeyError:
            return not_found("Trade not found")
        return ok({"ok": True})

    router.add("GET", "/api/trades", trades)
    router.add("GET", "/api/campaigns", campaigns)
    router.add("GET", "/api/campaign-checkins", campaign_checkins)
    router.add("GET", "/api/campaigns/random-featured", random_featured_campaign)
    router.add_prefix("GET", "/api/campaigns/", campaign_detail)
    router.add_prefix(
        "POST",
        "/api/campaigns/",
        campaign_post,
        suffix="/checkin",
        reads_body=True,
    )
    router.add_prefix(
        "POST",
        "/api/campaigns/",
        campaign_post,
        suffix="/screenshot",
        reads_body=True,
    )
    router.add_prefix(
        "DELETE",
        "/api/campaigns/",
        campaign_delete,
        suffix="/checkin",
    )
    router.add_prefix(
        "DELETE",
        "/api/campaigns/",
        campaign_delete,
        suffix="/screenshot",
    )
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
        "/api/campaigns/",
        campaign_patch,
        suffix="/initial-stop",
        reads_body=True,
    )
    router.add_prefix(
        "PATCH",
        "/api/campaigns/",
        campaign_patch,
        suffix="/featured",
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
    router.add_prefix("DELETE", "/api/trades/", trade_delete, suffix="/screenshot")
    router.add_prefix("DELETE", "/api/trades/", trade_delete, reads_body=True)

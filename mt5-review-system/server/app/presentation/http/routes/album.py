from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import unquote

from ..responses import not_found, ok
from ....platforms import normalize_platform
from . import Body, Query, first, optional_int, platform_kwargs, request_body

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage) -> None:
    def random_review_album(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"platform"})
        if unknown:
            raise ValueError("Random album does not accept filters")
        return ok(storage.get_random_review_album(normalize_platform(first(query, "platform", "mt5"))))

    def review_checkins(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"days", "platform"})
        if unknown:
            raise ValueError(f"Unsupported check-in filter: {unknown[0]}")
        days = optional_int(first(query, "days", "90")) or 90
        kwargs = {"days": days}
        if "platform" in query:
            kwargs["platform"] = normalize_platform(first(query, "platform", "mt5"))
        return ok(storage.get_review_checkins(**kwargs))

    def checkin_review_trade(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"platform"})
        if unknown:
            raise ValueError(f"Unsupported check-in filter: {unknown[0]}")
        payload = request_body(body)
        trade_id = str(payload.get("trade_id", "")).strip()
        if not trade_id:
            raise ValueError("trade_id is required")
        try:
            kwargs = {}
            if "platform" in query:
                kwargs["platform"] = normalize_platform(first(query, "platform", "mt5"))
            return ok(storage.checkin_review_trade(trade_id, **kwargs))
        except KeyError:
            return not_found("Trade not found")

    def cancel_review_trade(path: str, query: Query, body: Body):
        unknown = sorted(set(query) - {"platform"})
        if unknown:
            raise ValueError(f"Unsupported check-in filter: {unknown[0]}")
        prefix = "/api/review-album/checkin/"
        trade_id = unquote(path[len(prefix):]).strip()
        if not trade_id:
            raise ValueError("trade_id is required")
        try:
            kwargs = {}
            if "platform" in query:
                kwargs["platform"] = normalize_platform(first(query, "platform", "mt5"))
            return ok(storage.cancel_review_trade(trade_id, **kwargs))
        except KeyError:
            return not_found("Trade not found")

    def set_review_daily_goal(path: str, query: Query, body: Body):
        payload = request_body(body)
        if "daily_goal" not in payload:
            raise ValueError("daily_goal is required")
        return ok(storage.set_review_daily_goal(payload["daily_goal"]))

    def review_album(path: str, query: Query, body: Body):
        allowed = {
            "start",
            "end",
            "symbol",
            "tag",
            "sort",
            "archived",
            "page",
            "page_size",
            "platform",
        }
        unknown = sorted(set(query) - allowed)
        if unknown:
            raise ValueError(f"Unsupported album filter: {unknown[0]}")
        archived_value = first(query, "archived", "false") or "false"
        if archived_value not in {"true", "false"}:
            raise ValueError("archived must be true or false")
        return ok(
            storage.query_review_album(
                start_date=first(query, "start", None),
                end_date=first(query, "end", None),
                symbols=query.get("symbol", []),
                tags=query.get("tag", []),
                sort=first(query, "sort", "desc") or "desc",
                archived=archived_value == "true",
                page=optional_int(first(query, "page", "1")) or 1,
                page_size=optional_int(first(query, "page_size", "24")) or 24,
                **platform_kwargs(query),
            )
        )

    router.add("GET", "/api/review-album/checkins", review_checkins)
    router.add("POST", "/api/review-album/checkin", checkin_review_trade, reads_body=True)
    router.add_prefix("DELETE", "/api/review-album/checkin/", cancel_review_trade)
    router.add("PUT", "/api/review-album/goal", set_review_daily_goal, reads_body=True)
    router.add("GET", "/api/review-album/random", random_review_album)
    router.add("GET", "/api/review-album", review_album)

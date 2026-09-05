from __future__ import annotations

from typing import TYPE_CHECKING

from ..responses import ok
from . import Body, Query, first, optional_int

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage) -> None:
    def review_album(path: str, query: Query, body: Body):
        allowed = {"start", "end", "symbol", "tag", "sort", "page", "page_size"}
        unknown = sorted(set(query) - allowed)
        if unknown:
            raise ValueError(f"Unsupported album filter: {unknown[0]}")
        return ok(
            storage.query_review_album(
                start_date=first(query, "start", None),
                end_date=first(query, "end", None),
                symbols=query.get("symbol", []),
                tags=query.get("tag", []),
                sort=first(query, "sort", "desc") or "desc",
                page=optional_int(first(query, "page", "1")) or 1,
                page_size=optional_int(first(query, "page_size", "24")) or 24,
            )
        )

    router.add("GET", "/api/review-album", review_album)

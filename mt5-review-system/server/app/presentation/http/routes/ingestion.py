from __future__ import annotations

from typing import TYPE_CHECKING

from ..responses import created
from . import Body, Query, request_body

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage) -> None:
    def ingest_event(path: str, query: Query, body: Body):
        return created(storage.ingest_mt5_event(request_body(body)))

    router.add("POST", "/api/mt5/events", ingest_event, reads_body=True)

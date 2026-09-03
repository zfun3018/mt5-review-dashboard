from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .responses import ApiResponse, bad_request, internal_error, not_found
from .routes import Body, Query


RouteHandler = Callable[[str, Query, Body], ApiResponse]


@dataclass(frozen=True)
class _Route:
    method: str
    path: str
    handler: RouteHandler
    suffix: str | None = None
    contains: str | None = None
    reads_body: bool = False


class Router:
    def __init__(self) -> None:
        self._exact: list[_Route] = []
        self._prefixes: list[_Route] = []

    def add(
        self,
        method: str,
        path: str,
        handler: RouteHandler,
        *,
        reads_body: bool = False,
    ) -> None:
        self._exact.append(
            _Route(method.upper(), path, handler, reads_body=reads_body)
        )

    def add_prefix(
        self,
        method: str,
        prefix: str,
        handler: RouteHandler,
        *,
        suffix: str | None = None,
        contains: str | None = None,
        reads_body: bool = False,
    ) -> None:
        self._prefixes.append(
            _Route(
                method.upper(),
                prefix,
                handler,
                suffix=suffix,
                contains=contains,
                reads_body=reads_body,
            )
        )

    def route_requires_body(self, method: str, path: str) -> bool:
        route = self._resolve(method, path)
        return bool(route and route.reads_body)

    def dispatch(
        self,
        method: str,
        path: str,
        query: Query | None,
        body: Body,
    ) -> ApiResponse:
        request_query = query or {}
        route = self._resolve(method, path)
        if route is None:
            return not_found()
        try:
            return route.handler(path, request_query, body)
        except ValueError as exc:
            return bad_request(str(exc))
        except Exception:
            return internal_error()

    def _resolve(self, method: str, path: str) -> _Route | None:
        normalized_method = method.upper()
        exact = next(
            (
                item
                for item in self._exact
                if item.method == normalized_method and item.path == path
            ),
            None,
        )
        if exact is not None:
            return exact
        return next(
            (
                item
                for item in self._prefixes
                if item.method == normalized_method
                and path.startswith(item.path)
                and (item.suffix is None or path.endswith(item.suffix))
                and (item.contains is None or item.contains in path)
            ),
            None,
        )


def build_router(storage, auto_import: Callable[[], object]) -> Router:
    from .routes import album, dashboard, ingestion, orders, settings

    router = Router()
    dashboard.register(router, storage, auto_import)
    orders.register(router, storage)
    album.register(router, storage)
    settings.register(router, storage, auto_import)
    ingestion.register(router, storage)
    return router

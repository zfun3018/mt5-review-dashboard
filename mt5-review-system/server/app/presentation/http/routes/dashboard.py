from __future__ import annotations

from typing import Callable, TYPE_CHECKING

from ..responses import ok
from ....platforms import normalize_platform
from . import Body, Query, first, optional_int, platform_kwargs

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage, auto_import: Callable[[], object]) -> None:
    def bootstrap(path: str, query: Query, body: Body):
        year = optional_int(first(query, "year", None))
        month = optional_int(first(query, "month", None))
        platform = normalize_platform(first(query, "platform", "mt5"))
        if platform == "mt5":
            auto_import()
        return ok(storage.get_dashboard(year=year, month=month, **platform_kwargs(query)))

    def analysis(path: str, query: Query, body: Body):
        equity_days_value = first(query, "equity_days", None)
        return ok(storage.get_analysis(
                start_date=first(query, "start", None),
                end_date=first(query, "end", None),
                equity_days=optional_int(equity_days_value) if equity_days_value else None,
                year=optional_int(first(query, "year", None)),
                month=optional_int(first(query, "month", None)),
                **platform_kwargs(query),
            ))

    def system_evaluation(path: str, query: Query, body: Body):
        result = storage.get_analysis(
            start_date=first(query, "start", None),
            end_date=first(query, "end", None),
            **platform_kwargs(query),
        )
        return ok({"rows": result["system_evaluation"]})

    def mode_evaluation(path: str, query: Query, body: Body):
        dimension = first(query, "dimension", "trade_type") or "trade_type"
        if dimension not in {"trade_type", "strategy"}:
            raise ValueError("dimension must be trade_type or strategy")
        result = storage.get_analysis(
            start_date=first(query, "start", None),
            end_date=first(query, "end", None),
            **platform_kwargs(query),
        )
        return ok(
            {
                "dimension": dimension,
                "rows": result["mode_evaluation"][dimension],
            }
        )

    def health(path: str, query: Query, body: Body):
        return ok(
            {
                "ok": True,
                "mode": "local",
                "database": str(storage.DB_PATH),
            }
        )

    router.add("GET", "/api/bootstrap", bootstrap)
    router.add("GET", "/api/analysis", analysis)
    router.add("GET", "/api/system-evaluation", system_evaluation)
    router.add("GET", "/api/mode-evaluation", mode_evaluation)
    router.add("GET", "/api/health", health)

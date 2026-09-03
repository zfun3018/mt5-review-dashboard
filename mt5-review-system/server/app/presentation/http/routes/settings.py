from __future__ import annotations

from typing import Callable, TYPE_CHECKING
from urllib.parse import unquote

from ..responses import created, not_found, ok
from . import Body, Query, first, path_part, request_body

if TYPE_CHECKING:
    from ..router import Router


def register(router: Router, storage, auto_import: Callable[[], object]) -> None:
    def analysis_settings(path: str, query: Query, body: Body):
        return ok(storage.get_analysis_settings())

    def update_analysis_settings(path: str, query: Query, body: Body):
        return ok(storage.update_analysis_settings(request_body(body)))

    def trends(path: str, query: Query, body: Body):
        return ok({"trends": storage.list_trends()})

    def create_trend(path: str, query: Query, body: Body):
        return created(storage.create_trend(request_body(body)))

    def trend_put(path: str, query: Query, body: Body):
        trend_id = int(path_part(path, 3))
        try:
            return ok(storage.update_trend(trend_id, request_body(body)))
        except KeyError:
            return not_found("Trend not found")

    def trend_delete(path: str, query: Query, body: Body):
        trend_id = int(path_part(path, 3))
        try:
            storage.delete_trend(trend_id)
        except KeyError:
            return not_found("Trend not found")
        return ok({"ok": True})

    def custom_fields(path: str, query: Query, body: Body):
        return ok({"custom_fields": storage.list_custom_fields()})

    def create_custom_field(path: str, query: Query, body: Body):
        return created(storage.create_custom_field(request_body(body)))

    def custom_field_put(path: str, query: Query, body: Body):
        field_id = int(path_part(path, 3))
        try:
            return ok(storage.update_custom_field(field_id, request_body(body)))
        except KeyError:
            return not_found("Field not found")

    def custom_field_delete(path: str, query: Query, body: Body):
        field_id = int(path_part(path, 3))
        try:
            storage.delete_custom_field(field_id)
        except KeyError:
            return not_found("Field not found")
        return ok({"ok": True})

    def classification_options(path: str, query: Query, body: Body):
        dimension = first(query, "dimension", None)
        active_only = (first(query, "active_only", "0") or "0") in {"1", "true"}
        return ok(
            {
                "classification_options": storage.list_classification_options(
                    dimension=dimension,
                    active_only=active_only,
                )
            }
        )

    def create_classification_option(path: str, query: Query, body: Body):
        return created(storage.create_classification_option(request_body(body)))

    def classification_put(path: str, query: Query, body: Body):
        option_id = unquote(path_part(path, 3))
        try:
            return ok(
                storage.update_classification_option(option_id, request_body(body))
            )
        except KeyError:
            return not_found("Option not found")

    def classification_delete(path: str, query: Query, body: Body):
        option_id = unquote(path_part(path, 3))
        try:
            storage.delete_classification_option(option_id)
        except KeyError:
            return not_found("Option not found")
        return ok({"ok": True})

    def backups(path: str, query: Query, body: Body):
        return ok({"backups": storage.list_backups()})

    def create_backup(path: str, query: Query, body: Body):
        return created(storage.create_backup())

    def status(path: str, query: Query, body: Body):
        auto_import()
        return ok(storage.get_local_status())

    router.add("GET", "/api/analysis-settings", analysis_settings)
    router.add(
        "PATCH",
        "/api/analysis-settings",
        update_analysis_settings,
        reads_body=True,
    )
    router.add("GET", "/api/trends", trends)
    router.add("POST", "/api/trends", create_trend, reads_body=True)
    router.add_prefix("PUT", "/api/trends/", trend_put, reads_body=True)
    router.add_prefix("DELETE", "/api/trends/", trend_delete)
    router.add("GET", "/api/custom-fields", custom_fields)
    router.add("POST", "/api/custom-fields", create_custom_field, reads_body=True)
    router.add_prefix(
        "PUT", "/api/custom-fields/", custom_field_put, reads_body=True
    )
    router.add_prefix("DELETE", "/api/custom-fields/", custom_field_delete)
    router.add("GET", "/api/classification-options", classification_options)
    router.add(
        "POST",
        "/api/classification-options",
        create_classification_option,
        reads_body=True,
    )
    router.add_prefix(
        "PUT",
        "/api/classification-options/",
        classification_put,
        reads_body=True,
    )
    router.add_prefix("DELETE", "/api/classification-options/", classification_delete)
    router.add("GET", "/api/backups", backups)
    router.add("POST", "/api/backups", create_backup)
    router.add("GET", "/api/status", status)

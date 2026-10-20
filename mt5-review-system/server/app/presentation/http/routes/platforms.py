from __future__ import annotations

import base64
import binascii

from ..responses import created, not_found, ok
from . import Body, Query, first, optional_int, path_part, request_body


def register(router, storage) -> None:
    def platforms(path: str, query: Query, body: Body):
        return ok({"platforms": storage.list_platforms()})

    def import_csv(path: str, query: Query, body: Body):
        payload = request_body(body)
        csv_text = payload.get("csv_text")
        if not isinstance(csv_text, str) or not csv_text.strip():
            raise ValueError("csv_text is required")
        return created(
            storage.import_csv(
                str(payload.get("platform") or ""),
                csv_text,
                str(payload.get("filename") or ""),
            )
        )

    def import_file(path: str, query: Query, body: Body):
        payload = request_body(body)
        encoded = payload.get("file_base64")
        if not isinstance(encoded, str) or not encoded.strip():
            raise ValueError("file_base64 is required")
        try:
            file_bytes = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("file_base64 不是有效的 Base64 数据") from exc
        if not file_bytes:
            raise ValueError("导入文件不能为空")
        return created(
            storage.import_file(
                str(payload.get("platform") or ""),
                file_bytes,
                str(payload.get("filename") or ""),
            )
        )

    def import_batches(path: str, query: Query, body: Body):
        platform = first(query, "platform", "mt5") or "mt5"
        return ok(
            {
                "batches": storage.list_import_batches(
                    platform,
                    optional_int(first(query, "year", "")),
                    optional_int(first(query, "month", "")),
                )
            }
        )

    def import_calendar(path: str, query: Query, body: Body):
        platform = first(query, "platform", "mt5") or "mt5"
        year = optional_int(first(query, "year", ""))
        month = optional_int(first(query, "month", ""))
        return ok({"calendar": storage.get_import_calendar(platform, year, month)})

    def import_summary(path: str, query: Query, body: Body):
        platform = first(query, "platform", "mt5") or "mt5"
        return ok(storage.latest_import_summary(platform))

    def import_batch_detail(path: str, query: Query, body: Body):
        batch_id = path_part(path, 4)
        platform = first(query, "platform", "mt5") or "mt5"
        batch = storage.get_import_batch(batch_id, platform)
        return ok({"batch": batch}) if batch else not_found("Import batch not found")

    router.add("GET", "/api/platforms", platforms)
    router.add("GET", "/api/platforms/import-batches", import_batches)
    router.add("GET", "/api/platforms/import-calendar", import_calendar)
    router.add("GET", "/api/platforms/import-summary", import_summary)
    router.add_prefix("GET", "/api/platforms/import-batches/", import_batch_detail)
    router.add("POST", "/api/platforms/import-csv", import_csv, reads_body=True)
    router.add("POST", "/api/platforms/import-file", import_file, reads_body=True)

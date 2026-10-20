import base64
import unittest

from app.presentation.http.router import build_router


class _Storage:
    def __init__(self):
        self.payload = None

    def list_platforms(self):
        return []

    def import_file(self, platform, file_bytes, filename):
        self.payload = (platform, file_bytes, filename)
        return {"imported": 0, "skipped": 0}

    def list_import_batches(self, platform, year=None, month=None):
        return [{"id": "IMP-1", "platform": platform, "filename": "trades.xls"}]

    def get_import_calendar(self, platform, year, month):
        return {"2026-10-19": {"new_row_count": 2, "order_count": 1}}

    def get_import_batch(self, batch_id, platform):
        return {"id": batch_id, "platform": platform, "status": "committed"}


class PlatformImportApiTest(unittest.TestCase):
    def test_import_file_route_decodes_base64_payload(self):
        storage = _Storage()
        router = build_router(storage, lambda: None)

        response = router.dispatch(
            "POST",
            "/api/platforms/import-file",
            {},
            {
                "platform": "tonghuashun_futures",
                "filename": "trades.xls",
                "file_base64": base64.b64encode(b"xls bytes").decode("ascii"),
            },
        )

        self.assertEqual(response.status, 201)
        self.assertEqual(storage.payload, ("tonghuashun_futures", b"xls bytes", "trades.xls"))

    def test_import_history_and_calendar_are_platform_scoped(self):
        storage = _Storage()
        router = build_router(storage, lambda: None)

        batches = router.dispatch(
            "GET",
            "/api/platforms/import-batches",
            {"platform": ["domestic_futures"], "year": ["2026"], "month": ["10"]},
            {},
        )
        calendar = router.dispatch(
            "GET",
            "/api/platforms/import-calendar",
            {"platform": ["domestic_futures"], "year": ["2026"], "month": ["10"]},
            {},
        )
        detail = router.dispatch(
            "GET",
            "/api/platforms/import-batches/IMP-1",
            {"platform": ["domestic_futures"]},
            {},
        )

        self.assertEqual(batches.status, 200)
        self.assertEqual(batches.payload["batches"][0]["platform"], "domestic_futures")
        self.assertEqual(calendar.payload["calendar"]["2026-10-19"]["order_count"], 1)
        self.assertEqual(detail.payload["batch"]["id"], "IMP-1")


if __name__ == "__main__":
    unittest.main()

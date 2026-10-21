import base64
import unittest

from app.presentation.http.router import build_router


class _Storage:
    def __init__(self):
        self.payload = None
        self.match_payload = None
        self.revert_payload = None

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

    def list_unmatched_import_executions(self, platform, batch_id=None):
        return [{"id": "EXE-1", "platform": platform, "remaining_quantity": 1.0}]

    def match_import_executions(self, open_id, close_id, quantity, platform="mt5"):
        self.match_payload = (open_id, close_id, quantity, platform)
        return {"trade": {"id": "FUT-1"}, "unmatched_executions": []}

    def revert_import_batch(self, batch_id, platform="mt5", confirm=False):
        self.revert_payload = (batch_id, platform, confirm)
        return {"batch_id": batch_id, "status": "reverted"}


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

    def test_unmatched_execution_routes_list_and_match(self):
        storage = _Storage()
        router = build_router(storage, lambda: None)

        unmatched = router.dispatch(
            "GET",
            "/api/platforms/unmatched-executions",
            {"platform": ["domestic_futures"]},
            {},
        )
        matched = router.dispatch(
            "POST",
            "/api/platforms/unmatched-executions/match",
            {},
            {
                "platform": "domestic_futures",
                "open_execution_id": "EXE-OPEN",
                "close_execution_id": "EXE-CLOSE",
                "quantity": 1,
            },
        )

        self.assertEqual(unmatched.status, 200)
        self.assertEqual(unmatched.payload["executions"][0]["id"], "EXE-1")
        self.assertEqual(matched.status, 201)
        self.assertEqual(
            storage.match_payload,
            ("EXE-OPEN", "EXE-CLOSE", 1, "domestic_futures"),
        )

    def test_import_batch_revert_route_passes_confirmation(self):
        storage = _Storage()
        router = build_router(storage, lambda: None)

        response = router.dispatch(
            "POST",
            "/api/platforms/import-batches/IMP-1/revert",
            {"platform": ["domestic_futures"]},
            {"confirm": True},
        )

        self.assertEqual(response.status, 200)
        self.assertEqual(
            storage.revert_payload,
            ("IMP-1", "domestic_futures", True),
        )


if __name__ == "__main__":
    unittest.main()

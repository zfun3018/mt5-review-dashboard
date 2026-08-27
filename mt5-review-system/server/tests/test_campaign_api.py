import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from app import storage
from app.server import ReviewRequestHandler


class CampaignApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.originals = {
            "PROJECT_ROOT": storage.PROJECT_ROOT,
            "DATA_DIR": storage.DATA_DIR,
            "SCREENSHOT_DIR": storage.SCREENSHOT_DIR,
            "RAW_EVENTS_DIR": storage.RAW_EVENTS_DIR,
            "BACKUP_DIR": storage.BACKUP_DIR,
            "DB_PATH": storage.DB_PATH,
        }
        storage.PROJECT_ROOT = self.root
        storage.DATA_DIR = self.root / "data"
        storage.SCREENSHOT_DIR = storage.DATA_DIR / "screenshots"
        storage.RAW_EVENTS_DIR = storage.DATA_DIR / "raw-events"
        storage.BACKUP_DIR = self.root / "backups"
        storage.DB_PATH = storage.DATA_DIR / "journal.sqlite"
        storage.init_db(seed=False)
        storage.upsert_trade(
            {
                "id": "T1",
                "account": "ACC",
                "order_no": "T1",
                "position_id": "P1",
                "order_ticket": "O1",
                "deal_ticket": "D1",
                "symbol": "XAUUSD",
                "side": "long",
                "lots": 1.0,
                "open_time_utc": "2026-08-01T00:00:00+00:00",
                "close_time_utc": "2026-08-01T00:30:00+00:00",
                "entry_price": 100.0,
                "exit_price": 104.0,
                "pnl": 4.0,
                "screenshot_path": "",
            }
        )
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), ReviewRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        for name, value in self.originals.items():
            setattr(storage, name, value)
        self.tmp.cleanup()

    def request(self, path, method="GET", payload=None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=3) as response:
            return response.status, json.loads(response.read())

    def test_campaign_routes_and_position_stop_patch(self):
        status, listing = self.request("/api/campaigns?r_missing=1")
        campaign_id = listing["campaigns"][0]["id"]
        status_detail, detail = self.request(f"/api/campaigns/{campaign_id}")
        position_id = detail["positions"][0]["id"]
        patch_status, result = self.request(
            f"/api/positions/{position_id}/initial-stop",
            method="PATCH",
            payload={"initial_stop_price": 98.0},
        )

        self.assertEqual(status, 200)
        self.assertEqual(status_detail, 200)
        self.assertEqual(patch_status, 200)
        self.assertEqual(result["campaign"]["campaign_r"], 2.0)

        with self.assertRaises(HTTPError) as context:
            self.request(
                f"/api/positions/{position_id}/initial-stop",
                method="PATCH",
                payload={"initial_stop_price": 101.0},
            )
        self.assertEqual(context.exception.code, 400)

    def test_analysis_settings_routes(self):
        status, settings = self.request("/api/analysis-settings")
        patch_status, updated = self.request(
            "/api/analysis-settings",
            method="PATCH",
            payload={"scratch_threshold_r": 0.2},
        )

        self.assertEqual(status, 200)
        self.assertEqual(settings["scratch_threshold_r"], 0.15)
        self.assertEqual(patch_status, 200)
        self.assertEqual(updated["scratch_threshold_r"], 0.2)

    def test_campaign_review_is_saved_on_campaign(self):
        campaign_id = self.request("/api/campaigns")[1]["campaigns"][0]["id"]

        status, updated = self.request(
            f"/api/campaigns/{campaign_id}/review",
            method="PATCH",
            payload={
                "review_text": "按组合复盘",
                "trade_type": "follow",
                "strategy": "breakout",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(updated["review_text"], "按组合复盘")


if __name__ == "__main__":
    unittest.main()

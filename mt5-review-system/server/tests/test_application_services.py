from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from app import storage
from app.application import AnalysisWindow, PageRequest
from app.application.album_service import AlbumService
from app.application.dashboard_service import DashboardService
from app.application.orders_service import OrdersService
from app.application.settings_service import SettingsService
from app.data.campaign_repository import CampaignRepository
from app.data.catalog_repository import CatalogRepository
from app.data.media_repository import MediaRepository
from app.data.trade_repository import TradeRepository
from tests.support import TemporaryStorageCase, insert_trade


TRADES = [
    {
        "id": "T-1",
        "account": "SYNTHETIC",
        "symbol": "EURUSD",
        "close_time_utc": "2026-08-18T01:00:00+00:00",
        "pnl": 10.0,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "trade_type": "follow",
        "strategy": "breakout",
        "custom_fields": {"7": "70"},
    },
    {
        "id": "T-2",
        "account": "SYNTHETIC",
        "symbol": "XAUUSD",
        "close_time_utc": "2026-08-18T02:00:00+00:00",
        "pnl": -4.0,
        "commission": 0.0,
        "swap": 0.0,
        "fee": 0.0,
        "trade_type": "reversal",
        "strategy": "breakout",
        "custom_fields": {"7": "71"},
    },
]

CAMPAIGNS = [
    {
        "id": "C-1",
        "status": "closed",
        "closed_at_utc": "2026-08-18T02:00:00+00:00",
        "net_pnl": 6.0,
        "campaign_r": 1.5,
        "trade_type": "follow",
        "strategy": "breakout",
        "positions": [],
    }
]

CLASSIFICATIONS = [
    {
        "id": "follow",
        "dimension": "trade_type",
        "label": "Follow",
        "color": "#00aaff",
        "sort_order": 1,
        "active": True,
    },
    {
        "id": "reversal",
        "dimension": "trade_type",
        "label": "Reversal",
        "color": "#ff6600",
        "sort_order": 2,
        "active": True,
    },
    {
        "id": "breakout",
        "dimension": "strategy",
        "label": "Breakout",
        "color": "#00cc88",
        "sort_order": 1,
        "active": True,
    },
]


class FakeTradeRepository:
    def __init__(self) -> None:
        self.analysis_calls = []
        self.equity_calls = 0
        self.album_calls = []
        self.symbol_calls = 0

    def query_analysis_rows(self, start_date, end_date, conn=None):
        self.analysis_calls.append((start_date, end_date))
        return TRADES

    def list_equity_snapshots(self, conn=None):
        self.equity_calls += 1
        return [
            {
                "time_utc": "2026-08-18T00:00:00+00:00",
                "balance": 100.0,
                "equity": 100.0,
            }
        ]

    def query_album(self, filters, page, page_size):
        self.album_calls.append((dict(filters), page, page_size))
        return SimpleNamespace(items=[TRADES[0]], total=1, page=page, page_size=page_size)

    def list_active_symbols(self):
        self.symbol_calls += 1
        return ["EURUSD", "XAUUSD"]


class FakeCampaignRepository:
    def __init__(self) -> None:
        self.analysis_calls = []
        self.query_calls = []
        self.get_calls = []

    def query_analysis_rows(self, start_date, end_date, conn=None):
        self.analysis_calls.append((start_date, end_date))
        return CAMPAIGNS

    def query(self, filters, page, page_size):
        self.query_calls.append((dict(filters), page, page_size))
        return SimpleNamespace(items=CAMPAIGNS, total=1, page=page, page_size=page_size)

    def get(self, campaign_id):
        self.get_calls.append(campaign_id)
        return CAMPAIGNS[0] if campaign_id == "C-1" else None


class FakeCatalogRepository:
    def __init__(self) -> None:
        self.classification_calls = []
        self.custom_field_calls = 0

    def list_classifications(self, dimension=None, active_only=False, conn=None):
        self.classification_calls.append((dimension, active_only))
        rows = CLASSIFICATIONS
        if dimension:
            rows = [row for row in rows if row["dimension"] == dimension]
        if active_only:
            rows = [row for row in rows if row["active"]]
        return rows

    def list_custom_fields(self):
        self.custom_field_calls += 1
        return [
            {
                "id": 7,
                "name": "Setup",
                "field_type": "single",
                "sort_order": 1,
                "options": [
                    {"id": 70, "field_id": 7, "label": "Alpha", "color": "#123456", "sort_order": 1},
                    {"id": 71, "field_id": 7, "label": "Beta", "color": "#654321", "sort_order": 2},
                ],
            }
        ]


class FakeSettingsRepository:
    def __init__(self) -> None:
        self.calls = 0

    def get_analysis_settings(self, conn=None):
        self.calls += 1
        return {"scratch_threshold_r": 0.15}


class FakeStatusProvider:
    def __init__(self) -> None:
        self.calls = 0

    def get_status(self):
        self.calls += 1
        return {"counts": {"trades": 2}}


class FakeBackupRepository:
    def __init__(self) -> None:
        self.calls = 0

    def list_backups(self):
        self.calls += 1
        return [{"id": 1, "size_bytes": 42}]


class RequestValueTest(unittest.TestCase):
    def test_analysis_window_is_immutable_and_rejects_invalid_ranges(self):
        window = AnalysisWindow("2026-08-01", "2026-08-31", 30)

        with self.assertRaises(FrozenInstanceError):
            window.equity_days = 7
        with self.assertRaises(ValueError):
            AnalysisWindow("2026-09-01", "2026-08-31", 30)
        with self.assertRaises(ValueError):
            AnalysisWindow(None, None, 0)
        with self.assertRaises(ValueError):
            AnalysisWindow(None, None, 367)

    def test_page_request_is_immutable_and_rejects_out_of_bounds_values(self):
        page = PageRequest(2, 50)

        with self.assertRaises(FrozenInstanceError):
            page.page = 3
        with self.assertRaises(ValueError):
            PageRequest(0, 50)
        with self.assertRaises(ValueError):
            PageRequest(1, 0)
        with self.assertRaises(ValueError):
            PageRequest(1, 201)


class DashboardServiceTest(unittest.TestCase):
    def test_analysis_uses_slim_queries_and_preserves_the_legacy_payload(self):
        trades = FakeTradeRepository()
        campaigns = FakeCampaignRepository()
        catalogs = FakeCatalogRepository()
        settings = FakeSettingsRepository()
        service = DashboardService(trades, campaigns, catalogs, settings)

        payload = service.get_analysis(AnalysisWindow("2026-08-18", "2026-08-18", 30))

        self.assertEqual(
            set(payload),
            {
                "start_date",
                "end_date",
                "metrics",
                "r_metrics",
                "periods",
                "equity",
                "calendar",
                "heatmap",
                "sessions",
                "system_evaluation",
                "mode_evaluation",
            },
        )
        self.assertNotIn("trades", payload)
        self.assertNotIn("campaigns", payload)
        self.assertEqual(payload["metrics"]["net_pnl"], 6.0)
        self.assertEqual(payload["metrics"]["order_count"], 2)
        self.assertEqual(payload["r_metrics"]["sample_count"], 1)
        self.assertEqual(payload["r_metrics"]["expectancy_r"], 1.5)
        self.assertEqual(payload["periods"]["today"]["order_count"], 2)
        self.assertEqual(payload["equity"][-1]["cumulative_return"], 6.0)
        self.assertEqual(payload["calendar"]["year"], 2026)
        self.assertEqual(payload["calendar"]["month"], 8)
        self.assertEqual(len(payload["heatmap"]["days"]), 7)
        self.assertIn("asia", payload["sessions"])
        self.assertEqual(payload["system_evaluation"][0]["order_count"], 1)
        self.assertEqual(payload["mode_evaluation"]["trade_type"][0]["label"], "Follow")
        self.assertEqual(trades.analysis_calls, [("2026-08-18", "2026-08-18")])
        self.assertEqual(trades.equity_calls, 1)
        self.assertEqual(campaigns.analysis_calls, [("2026-08-18", "2026-08-18")])
        self.assertEqual(campaigns.get_calls, [])
        self.assertEqual(campaigns.query_calls, [])
        self.assertEqual(catalogs.classification_calls, [(None, False)])
        self.assertEqual(settings.calls, 1)


class OrdersServiceTest(unittest.TestCase):
    def test_list_and_detail_use_repository_paging_and_detail(self):
        campaigns = FakeCampaignRepository()
        service = OrdersService(campaigns)

        listing = service.list_campaigns({"symbol": "EURUSD"}, PageRequest(2, 25))
        detail = service.get_campaign("C-1")
        missing = service.get_campaign("missing")

        self.assertEqual(campaigns.query_calls, [({"symbol": "EURUSD"}, 2, 25)])
        self.assertEqual(campaigns.get_calls, ["C-1", "missing"])
        self.assertEqual(set(listing), {"campaigns", "trades", "total", "page", "page_size"})
        self.assertIs(listing["campaigns"], listing["trades"])
        self.assertEqual(listing["campaigns"][0]["display_order_kind"], "Campaign")
        self.assertEqual(listing["campaigns"][0]["display_order_no"], "C-1")
        self.assertEqual(detail["id"], "C-1")
        self.assertEqual(detail["positions"], [])
        self.assertIsNone(missing)


class AlbumServiceTest(unittest.TestCase):
    def test_query_uses_default_24_page_and_or_within_and_across_dimensions(self):
        trades = FakeTradeRepository()
        catalogs = FakeCatalogRepository()
        service = AlbumService(trades, catalogs)

        result = service.query(
            {
                "tags": [
                    "trade_type:follow",
                    "trade_type:reversal",
                    "strategy:breakout",
                    "field:7:70",
                ]
            }
        )

        self.assertEqual([trade["id"] for trade in result["trades"]], ["T-1"])
        self.assertEqual(result["page"], 1)
        self.assertEqual(result["page_size"], 24)
        self.assertEqual(result["days"][0]["date"], "2026-08-18")
        self.assertEqual(len(trades.album_calls), 1)
        query_filters, page, page_size = trades.album_calls[0]
        self.assertEqual((page, page_size), (1, 24))
        self.assertEqual(query_filters["trade_type"], ["follow", "reversal"])
        self.assertEqual(query_filters["strategy"], ["breakout"])
        self.assertEqual(
            query_filters["custom_fields"],
            {"7": {"field_type": "single", "option_ids": ["70"]}},
        )
        self.assertEqual(trades.symbol_calls, 1)
        self.assertEqual(catalogs.classification_calls, [(None, True), (None, True)])
        self.assertEqual(catalogs.custom_field_calls, 1)


class SettingsServiceTest(unittest.TestCase):
    def setUp(self):
        self.catalogs = FakeCatalogRepository()
        self.settings = FakeSettingsRepository()
        self.status = FakeStatusProvider()
        self.backups = FakeBackupRepository()
        self.service = SettingsService(self.catalogs, self.settings, self.status, self.backups)

    def test_each_read_delegates_only_to_its_relevant_provider(self):
        self.assertEqual(len(self.service.get_classifications("trade_type", True)), 2)
        self.assertEqual(self.catalogs.classification_calls, [("trade_type", True)])
        self.assertEqual((self.catalogs.custom_field_calls, self.settings.calls, self.status.calls, self.backups.calls), (0, 0, 0, 0))

        self.assertEqual(self.service.get_custom_fields()[0]["id"], 7)
        self.assertEqual((self.catalogs.custom_field_calls, self.settings.calls, self.status.calls, self.backups.calls), (1, 0, 0, 0))

        self.assertEqual(self.service.get_analysis_settings()["scratch_threshold_r"], 0.15)
        self.assertEqual((self.settings.calls, self.status.calls, self.backups.calls), (1, 0, 0))

        self.assertEqual(self.service.get_status()["counts"]["trades"], 2)
        self.assertEqual((self.status.calls, self.backups.calls), (1, 0))

        self.assertEqual(self.service.list_backups()[0]["size_bytes"], 42)
        self.assertEqual(self.backups.calls, 1)


class ApplicationRepositoryReadTest(TemporaryStorageCase):
    def test_dashboard_repository_reads_are_date_scoped_and_do_not_load_detail(self):
        insert_trade(storage, id="IN", close_time_utc="2026-08-18T01:00:00+00:00")
        insert_trade(
            storage,
            id="OUT",
            symbol="EURUSD",
            close_time_utc="2026-08-19T16:00:00+00:00",
        )
        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-18T00:00:00+00:00", "balance": 100.0, "equity": 101.0}
        )
        trades = TradeRepository(storage.runtime_paths())
        campaigns = CampaignRepository(storage.runtime_paths())

        trade_rows = trades.query_analysis_rows("2026-08-18", "2026-08-18")
        snapshots = trades.list_equity_snapshots()
        with patch.object(
            campaigns,
            "get",
            side_effect=AssertionError("dashboard loaded Campaign detail"),
        ), patch.object(
            campaigns,
            "records",
            side_effect=AssertionError("dashboard loaded full Campaign records"),
        ):
            campaign_rows = campaigns.query_analysis_rows("2026-08-18", "2026-08-18")

        self.assertEqual([row["id"] for row in trade_rows], ["IN"])
        self.assertEqual(snapshots[0]["equity"], 101.0)
        self.assertEqual(len(campaign_rows), 1)
        expected_id = storage.list_campaigns(symbol="XAUUSD")["campaigns"][0]["id"]
        self.assertEqual(campaign_rows[0]["id"], expected_id)
        self.assertIn("campaign_r", campaign_rows[0])
        self.assertNotIn("positions", campaign_rows[0])
        self.assertNotIn("source_trade_ids", campaign_rows[0])

    def test_catalog_repository_owns_settings_page_reads(self):
        field = storage.create_custom_field({"name": "Plan", "field_type": "text"})
        catalogs = CatalogRepository(storage.runtime_paths())

        classifications = catalogs.list_classifications("trade_type", True)
        custom_fields = catalogs.list_custom_fields()
        analysis_settings = catalogs.get_analysis_settings()

        self.assertTrue(classifications)
        self.assertTrue(all(row["dimension"] == "trade_type" for row in classifications))
        self.assertTrue(all(row["active"] for row in classifications))
        self.assertEqual(custom_fields, [{**field, "options": []}])
        self.assertEqual(analysis_settings, {"scratch_threshold_r": 0.15})

    def test_album_repository_filters_counts_and_pages_before_custom_values(self):
        single = storage.create_custom_field(
            {
                "name": "Setup",
                "field_type": "single",
                "options": [{"label": "A"}, {"label": "B"}],
            }
        )
        multi = storage.create_custom_field(
            {
                "name": "Session",
                "field_type": "multi",
                "options": [{"label": "X"}, {"label": "Y"}],
            }
        )
        single_a, single_b = [str(option["id"]) for option in single["options"]]
        multi_x, multi_y = [str(option["id"]) for option in multi["options"]]
        base = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
        with storage.db() as conn:
            for index in range(130):
                close_time = base + timedelta(minutes=index)
                symbol = "EURUSD" if index < 120 or index >= 125 else "XAUUSD"
                if 125 <= index < 128:
                    close_time += timedelta(days=1)
                trade = {
                    "id": f"ALBUM-{index:03d}",
                    "account": "SYNTHETIC",
                    "order_no": str(index),
                    "position_id": f"P-{index}",
                    "order_ticket": f"O-{index}",
                    "deal_ticket": f"D-{index}",
                    "symbol": symbol,
                    "side": "long",
                    "lots": 0.01,
                    "open_time_utc": (close_time - timedelta(minutes=5)).isoformat(),
                    "close_time_utc": close_time.isoformat(),
                    "entry_price": 1.0,
                    "exit_price": 1.1,
                    "pnl": float(index),
                    "screenshot_path": "",
                    "trade_type": "follow" if index % 2 == 0 else "reversal",
                    "strategy": "range" if index % 3 == 0 else "breakout",
                }
                storage._upsert_trade_conn(conn, trade)
                conn.execute(
                    "INSERT INTO trade_custom_values (trade_id, field_id, value) VALUES (?, ?, ?)",
                    (
                        trade["id"],
                        single["id"],
                        single_a if index % 4 < 2 else single_b,
                    ),
                )
                conn.execute(
                    "INSERT INTO trade_custom_values (trade_id, field_id, value) VALUES (?, ?, ?)",
                    (
                        trade["id"],
                        multi["id"],
                        f'["{multi_x}"]' if index % 5 == 0 else f'["{multi_y}"]',
                    ),
                )
            conn.execute(
                "UPDATE trades SET deleted_at = CURRENT_TIMESTAMP WHERE id IN (?, ?)",
                ("ALBUM-128", "ALBUM-129"),
            )

        repository = TradeRepository(storage.runtime_paths())
        filters = {
            "start_date": "2026-08-21",
            "end_date": "2026-08-21",
            "symbols": ["eurusd"],
            "trade_type": ["follow", "reversal"],
            "strategy": ["breakout"],
            "custom_fields": {
                str(single["id"]): {
                    "field_type": "single",
                    "option_ids": [single_a, single_b],
                }
            },
            "sort": "desc",
        }
        original = repository.catalog.custom_values_for_trade_ids
        with patch.object(
            repository.catalog,
            "custom_values_for_trade_ids",
            wraps=original,
        ) as custom_values:
            result = repository.query_album(filters, page=2, page_size=24)

        expected_ids = [
            "ALBUM-083", "ALBUM-082", "ALBUM-080", "ALBUM-079",
            "ALBUM-077", "ALBUM-076", "ALBUM-074", "ALBUM-073",
            "ALBUM-071", "ALBUM-070", "ALBUM-068", "ALBUM-067",
            "ALBUM-065", "ALBUM-064", "ALBUM-062", "ALBUM-061",
            "ALBUM-059", "ALBUM-058", "ALBUM-056", "ALBUM-055",
            "ALBUM-053", "ALBUM-052", "ALBUM-050", "ALBUM-049",
        ]
        self.assertEqual((result.total, result.page, result.page_size), (80, 2, 24))
        self.assertEqual([row["id"] for row in result.items], expected_ids)
        custom_values.assert_called_once()
        self.assertEqual(custom_values.call_args.args[1], expected_ids)

        multi_result = repository.query_album(
            {
                **filters,
                "custom_fields": {
                    **filters["custom_fields"],
                    str(multi["id"]): {
                        "field_type": "multi",
                        "option_ids": [multi_x],
                    },
                },
            },
            page=1,
            page_size=24,
        )
        self.assertEqual(multi_result.total, 16)

    def test_album_storage_adapter_serializes_only_the_requested_page(self):
        base = datetime(2026, 8, 20, 16, 0, tzinfo=timezone.utc)
        with storage.db() as conn:
            for index in range(105):
                close_time = base + timedelta(minutes=index)
                storage._upsert_trade_conn(
                    conn,
                    {
                        "id": f"PAGE-{index:03d}",
                        "account": "SYNTHETIC",
                        "order_no": str(index),
                        "position_id": f"P-{index}",
                        "order_ticket": f"O-{index}",
                        "deal_ticket": f"D-{index}",
                        "symbol": "EURUSD",
                        "side": "long",
                        "lots": 0.01,
                        "open_time_utc": (close_time - timedelta(minutes=5)).isoformat(),
                        "close_time_utc": close_time.isoformat(),
                        "entry_price": 1.0,
                        "exit_price": 1.1,
                        "pnl": 1.0,
                        "screenshot_path": "",
                        "trade_type": "follow",
                        "strategy": "breakout",
                    },
                )

        with patch.object(
            storage,
            "list_trades",
            side_effect=AssertionError("album loaded all trades"),
        ), patch.object(MediaRepository, "exists", return_value=False) as media_exists:
            result = storage.query_review_album(page=1, page_size=24)

        self.assertEqual(result["total"], 105)
        self.assertEqual(len(result["trades"]), 24)
        self.assertEqual(media_exists.call_count, 24)


class StorageApplicationAdapterTest(unittest.TestCase):
    def test_legacy_entry_points_delegate_with_historical_bounds(self):
        calls = []

        class Dashboard:
            def get_analysis(self, window, year=None, month=None):
                calls.append(("analysis", window, year, month))
                return {"adapter": "analysis"}

        class Orders:
            def list_campaigns(self, filters, page):
                calls.append(("campaigns", filters, page))
                return {"adapter": "campaigns"}

            def get_campaign(self, campaign_id):
                calls.append(("campaign", campaign_id))
                return {"adapter": campaign_id}

        class Album:
            def query(self, filters, page):
                calls.append(("album", filters, page))
                return {"adapter": "album"}

        class Settings:
            def get_classifications(self, dimension, active_only):
                calls.append(("classifications", dimension, active_only))
                return ["classification"]

            def get_custom_fields(self):
                calls.append(("custom_fields",))
                return ["field"]

            def get_analysis_settings(self):
                calls.append(("analysis_settings",))
                return {"scratch_threshold_r": 0.2}

            def get_status(self):
                calls.append(("status",))
                return {"ready": True}

            def list_backups(self):
                calls.append(("backups",))
                return ["backup"]

        services = SimpleNamespace(
            dashboard=Dashboard(), orders=Orders(), album=Album(), settings=Settings()
        )
        with patch.object(storage, "_application_services", return_value=services):
            self.assertEqual(storage.get_analysis("2026-08-01", "2026-08-31", 999), {"adapter": "analysis"})
            self.assertEqual(storage.list_campaigns(symbol="EURUSD", page=0, page_size=999), {"adapter": "campaigns"})
            self.assertEqual(storage.get_campaign("C-1"), {"adapter": "C-1"})
            self.assertEqual(storage.query_review_album(page=0, page_size=999), {"adapter": "album"})
            self.assertEqual(storage.list_classification_options("trade_type", True), ["classification"])
            self.assertEqual(storage.list_custom_fields(), ["field"])
            self.assertEqual(storage.get_analysis_settings(), {"scratch_threshold_r": 0.2})
            self.assertEqual(storage.get_local_status(), {"ready": True})
            self.assertEqual(storage.list_backups(), ["backup"])

        self.assertEqual(calls[0], ("analysis", AnalysisWindow("2026-08-01", "2026-08-31", 366), None, None))
        self.assertEqual(calls[1][0], "campaigns")
        self.assertEqual(calls[1][1]["symbol"], "EURUSD")
        self.assertEqual(calls[1][2], PageRequest(1, 200))
        self.assertEqual(calls[3][0], "album")
        self.assertEqual(calls[3][2], PageRequest(1, 100))


if __name__ == "__main__":
    unittest.main()

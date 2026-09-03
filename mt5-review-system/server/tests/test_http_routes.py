from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError
from http import HTTPStatus
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading

from app import server, storage
from app.server import ReviewRequestHandler
from app.presentation.http.responses import ApiResponse
from app.presentation.http.router import Router, build_router


class CapturingHttpServer(ThreadingHTTPServer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.handler_errors = 0
        self.handler_error_event = threading.Event()
        self.handler_exceptions: list[str] = []

    def handle_error(self, request, client_address):
        self.handler_errors += 1
        self.handler_exceptions.append(repr(sys.exc_info()[1]))
        self.handler_error_event.set()


class RecordingStorage:
    DB_PATH = "C:/private/journal.sqlite"

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple, dict]] = []
        self.failures: dict[str, Exception] = {}
        self.results = {
            "get_dashboard": {"summary": {"net_pnl": 12.5}},
            "query_trades": {"trades": [{"id": "T-1"}], "total": 1},
            "list_campaigns": {
                "campaigns": [{"id": "C-1"}],
                "trades": [{"id": "C-1"}],
                "total": 1,
            },
            "get_analysis_settings": {"scratch_threshold_r": 0.15},
            "query_review_album": {"trades": [{"id": "T-1"}], "total": 1},
            "list_trends": [{"id": 2, "name": "up"}],
            "list_custom_fields": [{"id": 7, "name": "setup"}],
            "list_classification_options": [{"id": "follow"}],
            "list_backups": [{"name": "synthetic.zip"}],
            "get_local_status": {"database_exists": True},
            "restore_trade": {"id": "T/1", "deleted_at": None},
            "replace_trade_screenshot": {
                "id": "T/1",
                "screenshot_url": "/media/screenshots/synthetic.png",
            },
            "create_trend": {"id": 3, "name": "range"},
            "create_custom_field": {"id": 8, "name": "quality"},
            "create_classification_option": {"id": "scalp", "label": "Scalp"},
            "create_backup": {"name": "created.zip"},
            "ingest_mt5_event": {"ok": True, "event": "accepted"},
            "update_campaign_review": {"id": "C/1", "review_text": "reviewed"},
            "update_position_initial_stop": {
                "position": {"id": "P/1", "initial_stop_price": 98.0},
                "campaign": {"id": "C-1", "campaign_r": 2.0},
                "analysis": {"scratch_threshold_r": 0.15},
            },
            "update_analysis_settings": {"scratch_threshold_r": 0.2},
            "update_trade_review": {"id": "T/1", "review_text": "reviewed"},
            "update_trade_custom_value": {"trade_id": "T/1", "field_id": 7},
            "update_classification_option": {"id": "follow/revised"},
            "update_trend": {"id": 2, "name": "updated"},
            "update_custom_field": {"id": 7, "name": "updated"},
            "delete_trade_screenshot": {"id": "T/1", "screenshot_path": ""},
        }

    def _record(self, name: str, *args, **kwargs):
        self.calls.append((name, args, kwargs))
        if name in self.failures:
            raise self.failures[name]
        if name in self.results:
            return self.results[name]
        if name == "get_analysis":
            return {
                "system_evaluation": [{"date": "2026-09-02"}],
                "mode_evaluation": {
                    "trade_type": [{"key": "follow"}],
                    "strategy": [{"key": "breakout"}],
                },
            }
        if name == "get_campaign":
            return {"id": args[0]} if args[0] else None
        if name in {
            "delete_classification_option",
            "delete_trade",
            "delete_trend",
            "delete_custom_field",
        }:
            return None
        return {"operation": name}

    def __getattr__(self, name):
        return lambda *args, **kwargs: self._record(name, *args, **kwargs)


class HttpRouterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = RecordingStorage()
        self.import_calls = 0

        def auto_import():
            self.import_calls += 1

        self.router = build_router(self.storage, auto_import)

    def assert_route_contracts(self, cases):
        for case in cases:
            with self.subTest(name=case["name"]):
                self.storage.calls.clear()
                before_imports = self.import_calls
                response = self.router.dispatch(
                    case["method"],
                    case["path"],
                    case["query"],
                    case["body"],
                )
                self.assertEqual(response.status, case["status"])
                self.assertEqual(response.payload, case["payload"])
                expected_call = case["call"]
                self.assertEqual(
                    self.storage.calls,
                    [] if expected_call is None else [expected_call],
                )
                self.assertEqual(
                    self.import_calls - before_imports,
                    case.get("imports", 0),
                )

    def test_api_response_is_immutable(self):
        response = ApiResponse(HTTPStatus.OK, {"ok": True})

        with self.assertRaises(FrozenInstanceError):
            response.status = HTTPStatus.CREATED

        self.assertEqual(response.headers["Content-Type"], "application/json; charset=utf-8")

    def test_every_legacy_get_route_preserves_query_call_status_and_payload(self):
        analysis = {
            "system_evaluation": [{"date": "2026-09-02"}],
            "mode_evaluation": {
                "trade_type": [{"key": "follow"}],
                "strategy": [{"key": "breakout"}],
            },
        }
        cases = (
            {
                "name": "bootstrap",
                "method": "GET",
                "path": "/api/bootstrap",
                "query": {"year": ["2025"], "month": ["8"]},
                "body": None,
                "call": ("get_dashboard", (), {"year": 2025, "month": 8}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["get_dashboard"],
                "imports": 1,
            },
            {
                "name": "trades",
                "method": "GET",
                "path": "/api/trades",
                "query": {
                    "q": ["gold"],
                    "symbol": ["XAUUSD"],
                    "side": ["long"],
                    "trade_type": ["follow"],
                    "strategy": ["breakout"],
                    "start": ["2026-09-01"],
                    "end": ["2026-09-02"],
                    "page": ["2"],
                    "page_size": ["25"],
                },
                "body": None,
                "call": (
                    "query_trades",
                    (),
                    {
                        "query": "gold",
                        "symbol": "XAUUSD",
                        "side": "long",
                        "trade_type": "follow",
                        "strategy": "breakout",
                        "start_date": "2026-09-01",
                        "end_date": "2026-09-02",
                        "page": 2,
                        "page_size": 25,
                    },
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["query_trades"],
            },
            {
                "name": "campaigns",
                "method": "GET",
                "path": "/api/campaigns",
                "query": {
                    "q": ["gold"],
                    "symbol": ["XAUUSD"],
                    "side": ["short"],
                    "trade_type": ["reversal"],
                    "strategy": ["range"],
                    "start": ["2026-08-01"],
                    "end": ["2026-08-31"],
                    "r_missing": ["1"],
                    "page": ["3"],
                    "page_size": ["40"],
                },
                "body": None,
                "call": (
                    "list_campaigns",
                    (),
                    {
                        "query": "gold",
                        "symbol": "XAUUSD",
                        "side": "short",
                        "trade_type": "reversal",
                        "strategy": "range",
                        "start_date": "2026-08-01",
                        "end_date": "2026-08-31",
                        "r_missing_only": True,
                        "page": 3,
                        "page_size": 40,
                    },
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["list_campaigns"],
            },
            {
                "name": "campaign detail",
                "method": "GET",
                "path": "/api/campaigns/C%2F1",
                "query": {},
                "body": None,
                "call": ("get_campaign", ("C/1",), {}),
                "status": HTTPStatus.OK,
                "payload": {"id": "C/1"},
            },
            {
                "name": "analysis settings",
                "method": "GET",
                "path": "/api/analysis-settings",
                "query": {},
                "body": None,
                "call": ("get_analysis_settings", (), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["get_analysis_settings"],
            },
            {
                "name": "review album",
                "method": "GET",
                "path": "/api/review-album",
                "query": {
                    "start": ["2026-09-01"],
                    "end": ["2026-09-02"],
                    "symbol": ["XAUUSD", "EURUSD"],
                    "tag": ["trade_type:follow", "strategy:breakout"],
                    "sort": ["asc"],
                    "page": ["2"],
                    "page_size": ["12"],
                },
                "body": None,
                "call": (
                    "query_review_album",
                    (),
                    {
                        "start_date": "2026-09-01",
                        "end_date": "2026-09-02",
                        "symbols": ["XAUUSD", "EURUSD"],
                        "tags": ["trade_type:follow", "strategy:breakout"],
                        "sort": "asc",
                        "page": 2,
                        "page_size": 12,
                    },
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["query_review_album"],
            },
            {
                "name": "analysis",
                "method": "GET",
                "path": "/api/analysis",
                "query": {
                    "start": ["2026-09-01"],
                    "end": ["2026-09-02"],
                    "equity_days": ["7"],
                },
                "body": None,
                "call": (
                    "get_analysis",
                    (),
                    {
                        "start_date": "2026-09-01",
                        "end_date": "2026-09-02",
                        "equity_days": 7,
                        "year": None,
                        "month": None,
                    },
                ),
                "status": HTTPStatus.OK,
                "payload": analysis,
            },
            {
                "name": "system evaluation",
                "method": "GET",
                "path": "/api/system-evaluation",
                "query": {"start": ["2026-09-01"], "end": ["2026-09-02"]},
                "body": None,
                "call": (
                    "get_analysis",
                    (),
                    {"start_date": "2026-09-01", "end_date": "2026-09-02"},
                ),
                "status": HTTPStatus.OK,
                "payload": {"rows": analysis["system_evaluation"]},
            },
            {
                "name": "mode evaluation",
                "method": "GET",
                "path": "/api/mode-evaluation",
                "query": {
                    "dimension": ["strategy"],
                    "start": ["2026-09-01"],
                    "end": ["2026-09-02"],
                },
                "body": None,
                "call": (
                    "get_analysis",
                    (),
                    {"start_date": "2026-09-01", "end_date": "2026-09-02"},
                ),
                "status": HTTPStatus.OK,
                "payload": {
                    "dimension": "strategy",
                    "rows": analysis["mode_evaluation"]["strategy"],
                },
            },
            {
                "name": "trends",
                "method": "GET",
                "path": "/api/trends",
                "query": {},
                "body": None,
                "call": ("list_trends", (), {}),
                "status": HTTPStatus.OK,
                "payload": {"trends": self.storage.results["list_trends"]},
            },
            {
                "name": "custom fields",
                "method": "GET",
                "path": "/api/custom-fields",
                "query": {},
                "body": None,
                "call": ("list_custom_fields", (), {}),
                "status": HTTPStatus.OK,
                "payload": {
                    "custom_fields": self.storage.results["list_custom_fields"]
                },
            },
            {
                "name": "classification options",
                "method": "GET",
                "path": "/api/classification-options",
                "query": {"dimension": ["strategy"], "active_only": ["true"]},
                "body": None,
                "call": (
                    "list_classification_options",
                    (),
                    {"dimension": "strategy", "active_only": True},
                ),
                "status": HTTPStatus.OK,
                "payload": {
                    "classification_options": self.storage.results[
                        "list_classification_options"
                    ]
                },
            },
            {
                "name": "backups",
                "method": "GET",
                "path": "/api/backups",
                "query": {},
                "body": None,
                "call": ("list_backups", (), {}),
                "status": HTTPStatus.OK,
                "payload": {"backups": self.storage.results["list_backups"]},
            },
            {
                "name": "status",
                "method": "GET",
                "path": "/api/status",
                "query": {},
                "body": None,
                "call": ("get_local_status", (), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["get_local_status"],
                "imports": 1,
            },
            {
                "name": "health",
                "method": "GET",
                "path": "/api/health",
                "query": {},
                "body": None,
                "call": None,
                "status": HTTPStatus.OK,
                "payload": {
                    "ok": True,
                    "mode": "local",
                    "database": "C:/private/journal.sqlite",
                },
            },
        )

        self.assertEqual(len(cases), 15)
        self.assert_route_contracts(cases)

    def test_every_legacy_mutation_route_preserves_body_call_status_and_payload(self):
        screenshot_body = {
            "image_data": "data:image/png;base64,c3ludGhldGlj",
            "filename": "synthetic.png",
        }
        review_body = {"review_text": "reviewed"}
        cases = (
            {
                "name": "restore trade",
                "method": "POST",
                "path": "/api/trades/T%2F1/restore",
                "query": {},
                "body": {"ignored": True},
                "call": ("restore_trade", ("T/1",), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["restore_trade"],
            },
            {
                "name": "replace screenshot",
                "method": "POST",
                "path": "/api/trades/T%2F1/screenshot",
                "query": {},
                "body": screenshot_body,
                "call": (
                    "replace_trade_screenshot",
                    ("T/1", screenshot_body),
                    {},
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["replace_trade_screenshot"],
            },
            {
                "name": "create trend",
                "method": "POST",
                "path": "/api/trends",
                "query": {},
                "body": {"name": "range", "color": "#123456"},
                "call": (
                    "create_trend",
                    ({"name": "range", "color": "#123456"},),
                    {},
                ),
                "status": HTTPStatus.CREATED,
                "payload": self.storage.results["create_trend"],
            },
            {
                "name": "create custom field",
                "method": "POST",
                "path": "/api/custom-fields",
                "query": {},
                "body": {"name": "quality", "field_type": "text"},
                "call": (
                    "create_custom_field",
                    ({"name": "quality", "field_type": "text"},),
                    {},
                ),
                "status": HTTPStatus.CREATED,
                "payload": self.storage.results["create_custom_field"],
            },
            {
                "name": "create classification option",
                "method": "POST",
                "path": "/api/classification-options",
                "query": {},
                "body": {"dimension": "trade_type", "label": "Scalp"},
                "call": (
                    "create_classification_option",
                    ({"dimension": "trade_type", "label": "Scalp"},),
                    {},
                ),
                "status": HTTPStatus.CREATED,
                "payload": self.storage.results["create_classification_option"],
            },
            {
                "name": "create backup",
                "method": "POST",
                "path": "/api/backups",
                "query": {},
                "body": {"ignored": True},
                "call": ("create_backup", (), {}),
                "status": HTTPStatus.CREATED,
                "payload": self.storage.results["create_backup"],
            },
            {
                "name": "ingest MT5 event",
                "method": "POST",
                "path": "/api/mt5/events",
                "query": {},
                "body": {"type": "equity_snapshot", "equity": 100.5},
                "call": (
                    "ingest_mt5_event",
                    ({"type": "equity_snapshot", "equity": 100.5},),
                    {},
                ),
                "status": HTTPStatus.CREATED,
                "payload": self.storage.results["ingest_mt5_event"],
            },
            {
                "name": "update Campaign review",
                "method": "PATCH",
                "path": "/api/campaigns/C%2F1/review",
                "query": {},
                "body": review_body,
                "call": ("update_campaign_review", ("C/1", review_body), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_campaign_review"],
            },
            {
                "name": "update Position initial stop",
                "method": "PATCH",
                "path": "/api/positions/P%2F1/initial-stop",
                "query": {},
                "body": {"initial_stop_price": 98.0, "ignored": "value"},
                "call": ("update_position_initial_stop", ("P/1", 98.0), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_position_initial_stop"],
            },
            {
                "name": "update analysis settings",
                "method": "PATCH",
                "path": "/api/analysis-settings",
                "query": {},
                "body": {"scratch_threshold_r": 0.2},
                "call": (
                    "update_analysis_settings",
                    ({"scratch_threshold_r": 0.2},),
                    {},
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_analysis_settings"],
            },
            {
                "name": "update trade review",
                "method": "PATCH",
                "path": "/api/trades/T%2F1/review",
                "query": {},
                "body": review_body,
                "call": ("update_trade_review", ("T/1", review_body), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_trade_review"],
            },
            {
                "name": "update trade custom value",
                "method": "PATCH",
                "path": "/api/trades/T%2F1/custom-fields/7",
                "query": {},
                "body": {"value": "disciplined"},
                "call": (
                    "update_trade_custom_value",
                    ("T/1", 7, {"value": "disciplined"}),
                    {},
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_trade_custom_value"],
            },
            {
                "name": "update classification option",
                "method": "PUT",
                "path": "/api/classification-options/follow%2Frevised",
                "query": {},
                "body": {"label": "Follow revised"},
                "call": (
                    "update_classification_option",
                    ("follow/revised", {"label": "Follow revised"}),
                    {},
                ),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_classification_option"],
            },
            {
                "name": "update trend",
                "method": "PUT",
                "path": "/api/trends/2",
                "query": {},
                "body": {"name": "updated"},
                "call": ("update_trend", (2, {"name": "updated"}), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_trend"],
            },
            {
                "name": "update custom field",
                "method": "PUT",
                "path": "/api/custom-fields/7",
                "query": {},
                "body": {"name": "updated"},
                "call": ("update_custom_field", (7, {"name": "updated"}), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["update_custom_field"],
            },
            {
                "name": "delete classification option",
                "method": "DELETE",
                "path": "/api/classification-options/follow%2Frevised",
                "query": {},
                "body": None,
                "call": ("delete_classification_option", ("follow/revised",), {}),
                "status": HTTPStatus.OK,
                "payload": {"ok": True},
            },
            {
                "name": "delete screenshot",
                "method": "DELETE",
                "path": "/api/trades/T%2F1/screenshot",
                "query": {},
                "body": None,
                "call": ("delete_trade_screenshot", ("T/1",), {}),
                "status": HTTPStatus.OK,
                "payload": self.storage.results["delete_trade_screenshot"],
            },
            {
                "name": "delete trade",
                "method": "DELETE",
                "path": "/api/trades/T%2F1",
                "query": {},
                "body": None,
                "call": ("delete_trade", ("T/1",), {}),
                "status": HTTPStatus.OK,
                "payload": {"ok": True},
            },
            {
                "name": "delete trend",
                "method": "DELETE",
                "path": "/api/trends/2",
                "query": {},
                "body": None,
                "call": ("delete_trend", (2,), {}),
                "status": HTTPStatus.OK,
                "payload": {"ok": True},
            },
            {
                "name": "delete custom field",
                "method": "DELETE",
                "path": "/api/custom-fields/7",
                "query": {},
                "body": None,
                "call": ("delete_custom_field", (7,), {}),
                "status": HTTPStatus.OK,
                "payload": {"ok": True},
            },
        )

        self.assertEqual(len(cases), 20)
        self.assert_route_contracts(cases)

    def test_empty_campaign_prefix_keeps_legacy_not_found_semantics(self):
        response = self.router.dispatch("GET", "/api/campaigns/", {}, None)

        self.assertEqual(response.status, HTTPStatus.NOT_FOUND)
        self.assertEqual(response.payload, {"error": "Campaign not found"})

    def test_unexpected_errors_return_generic_500_without_private_details(self):
        self.storage.failures["get_analysis"] = RuntimeError(
            "database failed at C:/private/journal.sqlite"
        )

        response = self.router.dispatch("GET", "/api/analysis", {}, None)

        self.assertEqual(response.status, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.assertEqual(response.payload, {"error": "Internal server error"})
        self.assertNotIn("private", str(response.payload).lower())

    def test_endpoint_specific_missing_resources_preserve_404_error_text(self):
        cases = (
            ("GET", "/api/campaigns/C-404", "get_campaign", "Campaign not found", None),
            ("POST", "/api/trades/T-404/restore", "restore_trade", "Trade not found", {}),
            (
                "POST",
                "/api/trades/T-404/screenshot",
                "replace_trade_screenshot",
                "Trade not found",
                {"image_data": "synthetic"},
            ),
            (
                "PATCH",
                "/api/campaigns/C-404/review",
                "update_campaign_review",
                "Campaign not found",
                {},
            ),
            (
                "PATCH",
                "/api/positions/P-404/initial-stop",
                "update_position_initial_stop",
                "Position not found",
                {},
            ),
            (
                "PATCH",
                "/api/trades/T-404/review",
                "update_trade_review",
                "Trade not found",
                {},
            ),
            (
                "PATCH",
                "/api/trades/T-404/custom-fields/7",
                "update_trade_custom_value",
                "Trade or field not found",
                {},
            ),
            (
                "PUT",
                "/api/classification-options/missing",
                "update_classification_option",
                "Option not found",
                {},
            ),
            ("PUT", "/api/trends/404", "update_trend", "Trend not found", {}),
            (
                "PUT",
                "/api/custom-fields/404",
                "update_custom_field",
                "Field not found",
                {},
            ),
            (
                "DELETE",
                "/api/classification-options/missing",
                "delete_classification_option",
                "Option not found",
                None,
            ),
            (
                "DELETE",
                "/api/trades/T-404/screenshot",
                "delete_trade_screenshot",
                "Trade not found",
                None,
            ),
            ("DELETE", "/api/trades/T-404", "delete_trade", "Trade not found", None),
            ("DELETE", "/api/trends/404", "delete_trend", "Trend not found", None),
            (
                "DELETE",
                "/api/custom-fields/404",
                "delete_custom_field",
                "Field not found",
                None,
            ),
        )

        for method, path, storage_method, message, body in cases:
            with self.subTest(method=method, path=path):
                self.storage.calls.clear()
                self.storage.failures.clear()
                if storage_method == "get_campaign":
                    self.storage.results[storage_method] = None
                else:
                    self.storage.failures[storage_method] = KeyError("missing")

                response = self.router.dispatch(method, path, {}, body)

                self.assertEqual(response.status, HTTPStatus.NOT_FOUND)
                self.assertEqual(response.payload, {"error": message})
                self.storage.results.pop("get_campaign", None)

    def test_validation_failures_preserve_400_error_payloads(self):
        cases = (
            (
                "/api/review-album",
                {"unknown": ["x"]},
                "Unsupported album filter: unknown",
            ),
            (
                "/api/mode-evaluation",
                {"dimension": ["side"]},
                "dimension must be trade_type or strategy",
            ),
            (
                "/api/analysis",
                {"equity_days": ["seven"]},
                "invalid literal for int() with base 10: 'seven'",
            ),
        )
        for path, query, message in cases:
            with self.subTest(path=path):
                response = self.router.dispatch("GET", path, query, None)
                self.assertEqual(response.status, HTTPStatus.BAD_REQUEST)
                self.assertEqual(response.payload, {"error": message})

    def test_reads_body_contract_covers_every_registered_api_route(self):
        requires_body = {
            ("POST", "/api/trades/T-1/screenshot"),
            ("POST", "/api/trends"),
            ("POST", "/api/custom-fields"),
            ("POST", "/api/classification-options"),
            ("POST", "/api/mt5/events"),
            ("PATCH", "/api/campaigns/C-1/review"),
            ("PATCH", "/api/positions/P-1/initial-stop"),
            ("PATCH", "/api/analysis-settings"),
            ("PATCH", "/api/trades/T-1/review"),
            ("PATCH", "/api/trades/T-1/custom-fields/7"),
            ("PUT", "/api/classification-options/follow"),
            ("PUT", "/api/trends/2"),
            ("PUT", "/api/custom-fields/7"),
        }
        does_not_require_body = {
            ("GET", "/api/bootstrap"),
            ("GET", "/api/trades"),
            ("GET", "/api/campaigns"),
            ("GET", "/api/campaigns/C-1"),
            ("GET", "/api/analysis-settings"),
            ("GET", "/api/review-album"),
            ("GET", "/api/analysis"),
            ("GET", "/api/system-evaluation"),
            ("GET", "/api/mode-evaluation"),
            ("GET", "/api/trends"),
            ("GET", "/api/custom-fields"),
            ("GET", "/api/classification-options"),
            ("GET", "/api/backups"),
            ("GET", "/api/status"),
            ("GET", "/api/health"),
            ("POST", "/api/trades/T-1/restore"),
            ("POST", "/api/backups"),
            ("DELETE", "/api/classification-options/follow"),
            ("DELETE", "/api/trades/T-1/screenshot"),
            ("DELETE", "/api/trades/T-1"),
            ("DELETE", "/api/trends/2"),
            ("DELETE", "/api/custom-fields/7"),
        }

        self.assertEqual(len(requires_body | does_not_require_body), 35)
        for method, path in requires_body:
            with self.subTest(method=method, path=path, expected=True):
                self.assertTrue(self.router.route_requires_body(method, path))
        for method, path in does_not_require_body:
            with self.subTest(method=method, path=path, expected=False):
                self.assertFalse(self.router.route_requires_body(method, path))

    def test_exact_routes_take_precedence_over_prefix_routes(self):
        router = Router()
        router.add_prefix(
            "GET",
            "/api/campaigns/",
            lambda path, query, body: ApiResponse(HTTPStatus.OK, {"match": "prefix"}),
        )
        router.add(
            "GET",
            "/api/campaigns/special",
            lambda path, query, body: ApiResponse(HTTPStatus.OK, {"match": "exact"}),
        )

        response = router.dispatch("GET", "/api/campaigns/special", {}, None)

        self.assertEqual(response.payload, {"match": "exact"})

    def test_overlapping_suffix_and_contains_routes_use_registration_order(self):
        path = "/api/trades/T-1/custom-fields/7/review"

        def matched(name):
            return lambda route_path, query, body: ApiResponse(
                HTTPStatus.OK, {"match": name}
            )

        contains_first = Router()
        contains_first.add_prefix(
            "PATCH",
            "/api/trades/",
            matched("contains"),
            contains="/custom-fields/",
        )
        contains_first.add_prefix(
            "PATCH", "/api/trades/", matched("suffix"), suffix="/review"
        )
        suffix_first = Router()
        suffix_first.add_prefix(
            "PATCH", "/api/trades/", matched("suffix"), suffix="/review"
        )
        suffix_first.add_prefix(
            "PATCH",
            "/api/trades/",
            matched("contains"),
            contains="/custom-fields/",
        )

        self.assertEqual(
            contains_first.dispatch("PATCH", path, {}, {}).payload,
            {"match": "contains"},
        )
        self.assertEqual(
            suffix_first.dispatch("PATCH", path, {}, {}).payload,
            {"match": "suffix"},
        )

    def test_unknown_path_or_method_returns_404(self):
        self.assertEqual(
            self.router.dispatch("GET", "/api/not-real", {}, None).status,
            HTTPStatus.NOT_FOUND,
        )

class HttpAdapterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.web = self.root / "web"
        self.data = self.root / "data"
        self.web.mkdir()
        self.data.mkdir()
        (self.web / "index.html").write_text("synthetic index", encoding="utf-8")
        (self.data / "sample.txt").write_text("synthetic media", encoding="utf-8")
        (self.data / "sample image.txt").write_text(
            "encoded synthetic media", encoding="utf-8"
        )
        (self.root / "private.txt").write_text("private", encoding="utf-8")
        self.original_web = server.WEB_DIR
        self.original_data = storage.DATA_DIR
        self.original_router = server.API_ROUTER
        server.WEB_DIR = self.web
        storage.DATA_DIR = self.data
        self.httpd = CapturingHttpServer(("127.0.0.1", 0), ReviewRequestHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        server.WEB_DIR = self.original_web
        storage.DATA_DIR = self.original_data
        server.API_ROUTER = self.original_router
        self.tmp.cleanup()

    def request(self, method: str, path: str, body: bytes | None = None):
        connection = HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=3)
        try:
            connection.request(
                method,
                path,
                body=body,
                headers={"Content-Type": "application/json"},
            )
            try:
                response = connection.getresponse()
            except OSError as exc:
                self.httpd.handler_error_event.wait(0.2)
                raise AssertionError(self.httpd.handler_exceptions) from exc
            return response.status, response.read(), response.getheaders()
        finally:
            connection.close()

    def test_malformed_json_returns_one_clean_bad_request_response(self):
        class RouterProbe:
            dispatch_calls = 0

            def route_requires_body(self, method, path):
                return True

            def dispatch(self, method, path, query, body):
                self.dispatch_calls += 1
                return ApiResponse(HTTPStatus.OK, {"unexpected": True})

        probe = RouterProbe()
        server.API_ROUTER = probe
        status, payload, headers = self.request(
            "PATCH", "/api/analysis-settings", b'{"scratch_threshold_r":'
        )

        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertIn(b'"error"', payload)
        self.assertEqual(
            sum(1 for name, _ in headers if name.lower() == "content-type"),
            1,
        )
        self.assertFalse(self.httpd.handler_error_event.wait(0.2))
        self.assertEqual(self.httpd.handler_errors, 0)
        self.assertEqual(probe.dispatch_calls, 0)

    def test_static_fallback_and_media_paths_stay_inside_their_roots(self):
        static_status, static_body, _ = self.request("GET", "/missing/page")
        media_status, media_body, _ = self.request("GET", "/media/sample.txt")
        encoded_status, encoded_body, _ = self.request(
            "GET", "/media/sample%20image.txt"
        )
        traversal_status, traversal_body, _ = self.request(
            "GET", "/media/../private.txt"
        )

        self.assertEqual((static_status, static_body), (HTTPStatus.OK, b"synthetic index"))
        self.assertEqual((media_status, media_body), (HTTPStatus.OK, b"synthetic media"))
        self.assertEqual(
            (encoded_status, encoded_body),
            (HTTPStatus.OK, b"encoded synthetic media"),
        )
        self.assertEqual(traversal_status, HTTPStatus.NOT_FOUND)
        self.assertNotIn(b"private", traversal_body)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .bridge_sync import auto_import_from_config
from . import storage

WEB_DIR = storage.PROJECT_ROOT / "web"


class ReviewRequestHandler(BaseHTTPRequestHandler):
    server_version = "MT5ReviewLocal/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_get(parsed.path, parse_qs(parsed.query))
            return
        if parsed.path.startswith("/media/"):
            self._serve_media(parsed.path.removeprefix("/media/"))
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/trades/") and parsed.path.endswith("/restore"):
            trade_id = unquote(parsed.path.split("/")[3])
            try:
                self._json_response(storage.restore_trade(trade_id))
            except KeyError:
                self._json_response({"error": "Trade not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/trades/") and parsed.path.endswith("/screenshot"):
            trade_id = unquote(parsed.path.split("/")[3])
            try:
                self._json_response(storage.replace_trade_screenshot(trade_id, self._read_json()))
            except KeyError:
                self._json_response({"error": "Trade not found"}, HTTPStatus.NOT_FOUND)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/trends":
            self._json_response(storage.create_trend(self._read_json()), HTTPStatus.CREATED)
            return
        if parsed.path == "/api/custom-fields":
            try:
                self._json_response(storage.create_custom_field(self._read_json()), HTTPStatus.CREATED)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/classification-options":
            try:
                self._json_response(
                    storage.create_classification_option(self._read_json()),
                    HTTPStatus.CREATED,
                )
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path == "/api/backups":
            self._json_response(storage.create_backup(), HTTPStatus.CREATED)
            return
        if parsed.path == "/api/mt5/events":
            self._json_response(storage.ingest_mt5_event(self._read_json()), HTTPStatus.CREATED)
            return
        self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/trades/") and parsed.path.endswith("/review"):
            trade_id = unquote(parsed.path.split("/")[3])
            try:
                self._json_response(storage.update_trade_review(trade_id, self._read_json()))
            except KeyError:
                self._json_response({"error": "Trade not found"}, HTTPStatus.NOT_FOUND)
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if parsed.path.startswith("/api/trades/") and "/custom-fields/" in parsed.path:
            parts = parsed.path.split("/")
            try:
                trade_id = unquote(parts[3])
                field_id = int(parts[5])
                self._json_response(
                    storage.update_trade_custom_value(trade_id, field_id, self._read_json())
                )
            except (IndexError, ValueError) as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Trade or field not found"}, HTTPStatus.NOT_FOUND)
            return
        self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/classification-options/"):
            option_id = unquote(parsed.path.split("/")[3])
            try:
                self._json_response(
                    storage.update_classification_option(option_id, self._read_json())
                )
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Option not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/trends/"):
            try:
                trend_id = int(parsed.path.split("/")[3])
                self._json_response(storage.update_trend(trend_id, self._read_json()))
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Trend not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/custom-fields/"):
            try:
                field_id = int(parsed.path.split("/")[3])
                self._json_response(storage.update_custom_field(field_id, self._read_json()))
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Field not found"}, HTTPStatus.NOT_FOUND)
            return
        self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/classification-options/"):
            option_id = unquote(parsed.path.split("/")[3])
            try:
                storage.delete_classification_option(option_id)
                self._json_response({"ok": True})
            except KeyError:
                self._json_response({"error": "Option not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/trades/") and parsed.path.endswith("/screenshot"):
            trade_id = unquote(parsed.path.split("/")[3])
            try:
                self._json_response(storage.delete_trade_screenshot(trade_id))
            except KeyError:
                self._json_response({"error": "Trade not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/trades/"):
            trade_id = unquote(parsed.path.split("/")[3])
            try:
                storage.delete_trade(trade_id)
                self._json_response({"ok": True})
            except KeyError:
                self._json_response({"error": "Trade not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/trends/"):
            try:
                trend_id = int(parsed.path.split("/")[3])
                storage.delete_trend(trend_id)
                self._json_response({"ok": True})
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Trend not found"}, HTTPStatus.NOT_FOUND)
            return
        if parsed.path.startswith("/api/custom-fields/"):
            try:
                field_id = int(parsed.path.split("/")[3])
                storage.delete_custom_field(field_id)
                self._json_response({"ok": True})
            except ValueError as exc:
                self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            except KeyError:
                self._json_response({"error": "Field not found"}, HTTPStatus.NOT_FOUND)
            return
        self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _handle_api_get(self, path: str, query: dict[str, list[str]]) -> None:
        try:
            if path == "/api/bootstrap":
                year = _optional_int(query.get("year", [None])[0])
                month = _optional_int(query.get("month", [None])[0])
                auto_import_from_config()
                self._json_response(storage.get_dashboard(year=year, month=month))
            elif path == "/api/trades":
                self._json_response(
                    storage.query_trades(
                        query=_first(query, "q", "") or "",
                        symbol=_first(query, "symbol", "") or "",
                        side=_first(query, "side", "all") or "all",
                        trade_type=_first(query, "trade_type", "all") or "all",
                        strategy=_first(query, "strategy", "all") or "all",
                        start_date=_first(query, "start", None),
                        end_date=_first(query, "end", None),
                        page=_optional_int(_first(query, "page", "1")) or 1,
                        page_size=_optional_int(_first(query, "page_size", "50")) or 50,
                    )
                )
            elif path == "/api/review-album":
                allowed = {"start", "end", "symbol", "tag", "sort", "page", "page_size"}
                unknown = sorted(set(query) - allowed)
                if unknown:
                    raise ValueError(f"Unsupported album filter: {unknown[0]}")
                self._json_response(
                    storage.query_review_album(
                        start_date=_first(query, "start", None),
                        end_date=_first(query, "end", None),
                        symbols=query.get("symbol", []),
                        tags=query.get("tag", []),
                        sort=_first(query, "sort", "desc") or "desc",
                        page=_optional_int(_first(query, "page", "1")) or 1,
                        page_size=_optional_int(_first(query, "page_size", "24")) or 24,
                    )
                )
            elif path == "/api/analysis":
                self._json_response(
                    storage.get_analysis(
                        start_date=_first(query, "start", None),
                        end_date=_first(query, "end", None),
                        equity_days=_optional_int(_first(query, "equity_days", "30")) or 30,
                    )
                )
            elif path == "/api/system-evaluation":
                analysis = storage.get_analysis(
                    start_date=_first(query, "start", None),
                    end_date=_first(query, "end", None),
                )
                self._json_response({"rows": analysis["system_evaluation"]})
            elif path == "/api/mode-evaluation":
                dimension = _first(query, "dimension", "trade_type") or "trade_type"
                if dimension not in {"trade_type", "strategy"}:
                    raise ValueError("dimension must be trade_type or strategy")
                analysis = storage.get_analysis(
                    start_date=_first(query, "start", None),
                    end_date=_first(query, "end", None),
                )
                self._json_response({"dimension": dimension, "rows": analysis["mode_evaluation"][dimension]})
            elif path == "/api/trends":
                self._json_response({"trends": storage.list_trends()})
            elif path == "/api/custom-fields":
                self._json_response({"custom_fields": storage.list_custom_fields()})
            elif path == "/api/classification-options":
                dimension = _first(query, "dimension", None)
                active_only = (_first(query, "active_only", "0") or "0") in {"1", "true"}
                self._json_response(
                    {
                        "classification_options": storage.list_classification_options(
                            dimension=dimension,
                            active_only=active_only,
                        )
                    }
                )
            elif path == "/api/backups":
                self._json_response({"backups": storage.list_backups()})
            elif path == "/api/status":
                auto_import_from_config()
                self._json_response(storage.get_local_status())
            elif path == "/api/health":
                self._json_response(
                    {
                        "ok": True,
                        "mode": "local",
                        "database": str(storage.DB_PATH),
                    }
                )
            else:
                self._json_response({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            self._json_response({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except Exception as exc:
            self._json_response({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _serve_static(self, request_path: str) -> None:
        relative = request_path.strip("/") or "index.html"
        file_path = (WEB_DIR / relative).resolve()
        if not _inside(file_path, WEB_DIR) or not file_path.exists() or not file_path.is_file():
            file_path = WEB_DIR / "index.html"
        self._send_file(file_path)

    def _serve_media(self, relative_path: str) -> None:
        file_path = (storage.DATA_DIR / unquote(relative_path)).resolve()
        if not _inside(file_path, storage.DATA_DIR) or not file_path.exists() or not file_path.is_file():
            self._json_response({"error": "Media not found"}, HTTPStatus.NOT_FOUND)
            return
        self._send_file(file_path)

    def _send_file(self, file_path: Path) -> None:
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        content = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if not length:
            return {}
        return parse_json_payload(self.rfile.read(length))

    def _json_response(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def resolve_runtime_config(host: str | None = None, port: int | None = None) -> tuple[str, int]:
    bind_host = host or os.environ.get("MT5_REVIEW_HOST") or "127.0.0.1"
    raw_port = port if port is not None else os.environ.get("MT5_REVIEW_PORT", "8787")
    bind_port = int(raw_port)
    if not 1 <= bind_port <= 65535:
        raise ValueError("MT5_REVIEW_PORT must be between 1 and 65535")
    return bind_host, bind_port


def run(host: str | None = None, port: int | None = None) -> None:
    host, port = resolve_runtime_config(host, port)
    storage.init_db(seed=True)
    httpd = ThreadingHTTPServer((host, port), ReviewRequestHandler)
    print(f"MT5 Review System running at http://{host}:{port}")
    print(f"Local database: {storage.DB_PATH}")
    httpd.serve_forever()


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _optional_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


def _first(query: dict[str, list[str]], key: str, default: str | None) -> str | None:
    values = query.get(key)
    return values[0] if values else default


def parse_json_payload(raw: bytes) -> dict:
    text = raw.decode("utf-8-sig", errors="ignore")
    text = text.lstrip("\x00\r\n\t ")
    if not text:
        return {}
    decoder = json.JSONDecoder()
    payload, index = decoder.raw_decode(text)
    tail = text[index:].strip("\x00\r\n\t ")
    if tail:
        raise json.JSONDecodeError("Extra non-null data", text, index)
    return payload


if __name__ == "__main__":
    run()


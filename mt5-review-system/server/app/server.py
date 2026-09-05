from __future__ import annotations

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .bridge_sync import auto_import_from_config
from .core.config import RuntimeConfig
from .presentation.http.responses import ApiResponse, bad_request, internal_error
from .presentation.http.router import build_router
from . import storage

WEB_DIR = storage.PROJECT_ROOT / "web"
API_ROUTER = build_router(storage, auto_import_from_config)

# Legacy flat pages that now live behind a workspace directory. Requests are
# redirected with a 302 so existing bookmarks and internal links keep working.
LEGACY_REDIRECTS = {
    "/album.html": "/album/",
}


def legacy_redirect_target(request_path: str) -> str | None:
    return LEGACY_REDIRECTS.get(request_path)


class ReviewRequestHandler(BaseHTTPRequestHandler):
    server_version = "MT5ReviewLocal/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._dispatch_api("GET", parsed.path, parse_qs(parsed.query), None)
            return
        if parsed.path.startswith("/media/"):
            self._serve_media(parsed.path.removeprefix("/media/"))
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        self._dispatch_api("POST", parsed.path, parse_qs(parsed.query))

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        self._dispatch_api("PATCH", parsed.path, parse_qs(parsed.query))

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        self._dispatch_api("PUT", parsed.path, parse_qs(parsed.query))

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        self._dispatch_api("DELETE", parsed.path, parse_qs(parsed.query), None)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _dispatch_api(
        self,
        method: str,
        path: str,
        query: dict[str, list[str]],
        body: dict | None = None,
    ) -> None:
        if API_ROUTER.route_requires_body(method, path):
            try:
                body = self._read_json()
            except ValueError as exc:
                self._write_api_response(bad_request(str(exc)))
                return
            except Exception:
                self._write_api_response(internal_error())
                return
        self._write_api_response(API_ROUTER.dispatch(method, path, query, body))

    def _serve_static(self, request_path: str) -> None:
        target = legacy_redirect_target(request_path)
        if target is not None:
            self._redirect(target)
            return
        self._send_file(resolve_static_path(request_path, WEB_DIR))

    def _redirect(self, target: str) -> None:
        query = ""
        if "?" in self.path:
            query = self.path[self.path.index("?"):]
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", f"{target}{query}")
        self.send_header("Content-Length", "0")
        self.end_headers()

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
        self._write_api_response(ApiResponse(status, payload))

    def _write_api_response(self, response: ApiResponse) -> None:
        payload = response.payload
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(response.status)
        for name, value in response.headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def build_runtime_config(
    host: str | None = None, port: int | None = None
) -> RuntimeConfig:
    env = dict(os.environ)
    if host is not None:
        env["MT5_REVIEW_HOST"] = host
    if port is not None:
        env["MT5_REVIEW_PORT"] = str(port)
    return RuntimeConfig.from_environment(env, project_root=storage.runtime_paths().root)


def resolve_runtime_config(host: str | None = None, port: int | None = None) -> tuple[str, int]:
    config = build_runtime_config(host, port)
    return config.host, config.port


def run(host: str | None = None, port: int | None = None) -> None:
    config = build_runtime_config(host, port)
    storage.configure_runtime_paths(config.paths)
    storage.init_db(seed=True)
    httpd = ThreadingHTTPServer((config.host, config.port), ReviewRequestHandler)
    actual_port = httpd.server_address[1]
    print(f"MT5 Review System running at http://{config.host}:{actual_port}")
    print(f"Local database: {storage.DB_PATH}")
    httpd.serve_forever()


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def resolve_static_path(request_path: str, web_root: Path = WEB_DIR) -> Path:
    root = web_root.resolve()
    relative = unquote(request_path).strip("/") or "index.html"
    candidate = (root / relative).resolve()
    if _inside(candidate, root) and candidate.is_dir():
        candidate = (candidate / "index.html").resolve()
    if _inside(candidate, root) and candidate.exists() and candidate.is_file():
        return candidate
    return root / "index.html"


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


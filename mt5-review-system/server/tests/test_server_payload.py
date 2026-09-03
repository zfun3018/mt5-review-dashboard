import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.server import (
    legacy_redirect_target,
    parse_json_payload,
    resolve_runtime_config,
    resolve_static_path,
)


class ServerPayloadTest(unittest.TestCase):
    def test_static_directories_resolve_index_without_escaping_web_root(self):
        with TemporaryDirectory() as tmp:
            web_root = Path(tmp) / "web"
            web_root.mkdir()
            root_index = web_root / "index.html"
            root_index.write_text("root", encoding="utf-8")
            expected = {}
            for route in ("dashboard", "orders", "album", "settings"):
                directory = web_root / route
                directory.mkdir()
                index = directory / "index.html"
                index.write_text(route, encoding="utf-8")
                expected[f"/{route}/"] = index

            resolved = {
                route: resolve_static_path(route, web_root) for route in expected
            }

            self.assertEqual(resolved, expected)
            self.assertEqual(resolve_static_path("/", web_root), root_index)
            self.assertEqual(resolve_static_path("/../private.txt", web_root), root_index)

    def test_parses_mql5_json_with_trailing_nulls(self):
        payload = b'{"type":"equity_snapshot","equity":100.5}\x00\x00'

        parsed = parse_json_payload(payload)

        self.assertEqual(parsed["type"], "equity_snapshot")
        self.assertEqual(parsed["equity"], 100.5)

    def test_legacy_album_page_redirects_to_workspace(self):
        self.assertEqual(legacy_redirect_target("/album.html"), "/album/")
        self.assertIsNone(legacy_redirect_target("/album/"))
        self.assertIsNone(legacy_redirect_target("/orders/"))

    def test_runtime_config_can_switch_to_lan_binding(self):
        import os

        original_host = os.environ.get("MT5_REVIEW_HOST")
        original_port = os.environ.get("MT5_REVIEW_PORT")
        try:
            os.environ["MT5_REVIEW_HOST"] = "0.0.0.0"
            os.environ["MT5_REVIEW_PORT"] = "8899"
            self.assertEqual(resolve_runtime_config(), ("0.0.0.0", 8899))
        finally:
            if original_host is None:
                os.environ.pop("MT5_REVIEW_HOST", None)
            else:
                os.environ["MT5_REVIEW_HOST"] = original_host
            if original_port is None:
                os.environ.pop("MT5_REVIEW_PORT", None)
            else:
                os.environ["MT5_REVIEW_PORT"] = original_port


if __name__ == "__main__":
    unittest.main()

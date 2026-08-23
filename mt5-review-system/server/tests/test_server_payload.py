import unittest

from app.server import parse_json_payload, resolve_runtime_config


class ServerPayloadTest(unittest.TestCase):
    def test_parses_mql5_json_with_trailing_nulls(self):
        payload = b'{"type":"equity_snapshot","equity":100.5}\x00\x00'

        parsed = parse_json_payload(payload)

        self.assertEqual(parsed["type"], "equity_snapshot")
        self.assertEqual(parsed["equity"], 100.5)

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

import json
import os
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from app import storage
from app.core.config import RuntimeConfig, set_runtime_paths
from app.server import ReviewRequestHandler, build_runtime_config


class RuntimePathsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self._saved_env = {
            key: os.environ.get(key)
            for key in (
                "MT5_REVIEW_HOST",
                "MT5_REVIEW_PORT",
                "MT5_REVIEW_DATA_DIR",
                "MT5_REVIEW_CONFIG_FILE",
            )
        }
        self._saved_paths = storage.runtime_paths()

    def tearDown(self):
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        set_runtime_paths(self._saved_paths)
        self.tmp.cleanup()

    def test_explicit_data_directory_does_not_move_project_files(self):
        config = RuntimeConfig.from_environment(
            {"MT5_REVIEW_DATA_DIR": str(self.root / "user-data")}
        )

        self.assertEqual(
            config.paths.database, self.root / "user-data" / "journal.sqlite"
        )
        self.assertEqual(
            config.paths.screenshots, self.root / "user-data" / "screenshots"
        )

    def test_lan_binding_requires_explicit_value(self):
        self.assertEqual(RuntimeConfig.from_environment({}).host, "127.0.0.1")
        self.assertEqual(
            RuntimeConfig.from_environment({"MT5_REVIEW_HOST": "0.0.0.0"}).host,
            "0.0.0.0",
        )

    def test_explicit_config_file_overrides_default_location(self):
        config = RuntimeConfig.from_environment(
            {"MT5_REVIEW_CONFIG_FILE": str(self.root / "settings.json")}
        )

        self.assertEqual(config.paths.config_file, self.root / "settings.json")

    def test_startup_keeps_created_files_inside_temporary_root(self):
        data_dir = self.root / "user-data"
        config_file = data_dir / "config.local.json"
        os.environ["MT5_REVIEW_DATA_DIR"] = str(data_dir)
        os.environ["MT5_REVIEW_CONFIG_FILE"] = str(config_file)

        config = build_runtime_config("127.0.0.1", 0)
        storage.configure_runtime_paths(config.paths)
        storage.init_db(seed=False)

        self.assertTrue((data_dir / "journal.sqlite").exists())
        self.assertTrue((data_dir / "screenshots").is_dir())
        self.assertEqual(storage.DB_PATH, data_dir / "journal.sqlite")
        self.assertEqual(storage.runtime_paths().config_file, config_file)

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), ReviewRequestHandler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            port = httpd.server_address[1]
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/health", timeout=5
            ) as response:
                body = json.loads(response.read().decode("utf-8"))
                self.assertEqual(response.status, 200)
                self.assertTrue(body["ok"])
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()

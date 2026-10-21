import subprocess
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class PackageImportTest(unittest.TestCase):
    def test_server_package_imports_from_project_root(self):
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "import os, sys; sys.path.insert(0, os.getcwd()); import server.app.server",
            ],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()

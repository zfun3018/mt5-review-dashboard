import ast
import unittest
from pathlib import Path

from app.platform_modules.domestic_futures_service import DomesticFuturesService
from app.platform_modules.mt5_service import MT5Service
from app.platforms import DEFAULT_PLATFORM, DOMESTIC_FUTURES_PLATFORM


MODULE_DIR = Path(__file__).resolve().parents[1] / "app" / "platform_modules"


class PlatformModuleContractTest(unittest.TestCase):
    def test_platform_services_expose_dashboard_capabilities(self):
        self.assertEqual(MT5Service.capabilities.show_market_clock, True)
        self.assertEqual(MT5Service.capabilities.show_sessions, True)
        self.assertEqual(MT5Service.capabilities.supports_r_metrics, True)
        self.assertEqual(DomesticFuturesService.capabilities.show_market_clock, False)
        self.assertEqual(DomesticFuturesService.capabilities.show_sessions, False)
        self.assertEqual(DomesticFuturesService.capabilities.show_contract_rankings, True)

    def test_platform_services_expose_only_their_own_workspace_identity(self):
        self.assertEqual(MT5Service.platform_id, DEFAULT_PLATFORM)
        self.assertEqual(DomesticFuturesService.platform_id, DOMESTIC_FUTURES_PLATFORM)
        self.assertEqual(MT5Service.ingestion_kind, "mt5_bridge")
        self.assertEqual(DomesticFuturesService.ingestion_kind, "data_import")

    def test_platform_modules_do_not_import_each_other(self):
        imports = {}
        for path in MODULE_DIR.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            imports[path.name] = [
                alias.name
                for node in ast.walk(tree)
                if isinstance(node, ast.Import)
                for alias in node.names
            ] + [
                node.module or ""
                for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom)
            ]

        self.assertNotIn("app.platform_modules.domestic_futures_service", imports["mt5_service.py"])
        self.assertNotIn("app.platform_modules.mt5_service", imports["domestic_futures_service.py"])


if __name__ == "__main__":
    unittest.main()

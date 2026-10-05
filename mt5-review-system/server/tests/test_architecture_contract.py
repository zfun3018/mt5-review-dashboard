import ast
import sqlite3
import tempfile
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path
from unittest.mock import patch

from app import storage
from app.core.config import RuntimeConfig, RuntimePaths, set_runtime_paths
from app.data.database import connect, transaction
from app.data.migrations import ensure_schema
from tests.support import TemporaryStorageCase, insert_trade


DOMAIN_DIR = Path(__file__).resolve().parents[1] / "app" / "domain"
APPLICATION_DIR = Path(__file__).resolve().parents[1] / "app" / "application"
STORAGE_MODULE = Path(__file__).resolve().parents[1] / "app" / "storage.py"
OWNED_INTEGRATION_MODULES = (
    Path(__file__).resolve().parents[1] / "app" / "data" / "migrations.py",
    Path(__file__).resolve().parents[1] / "app" / "importer.py",
    Path(__file__).resolve().parents[1] / "app" / "bridge_sync.py",
)
START_SCRIPT = STORAGE_MODULE.parents[2] / "start.ps1"
FORBIDDEN_DOMAIN_IMPORT_COMPONENTS = frozenset(
    {
        # Persistence and storage infrastructure.
        "data",
        "database",
        "persistence",
        "repositories",
        "repository",
        "sqlite3",
        "storage",
        # HTTP and presentation assembly.
        "api",
        "http",
        "presentation",
        "router",
        "routes",
        "server",
        "ui",
        # Runtime configuration and filesystem access.
        "config",
        "filesystem",
        "glob",
        "os",
        "pathlib",
        "shutil",
        "tempfile",
    }
)


def _import_candidates(node: ast.Import | ast.ImportFrom) -> list[str]:
    if isinstance(node, ast.Import):
        return [alias.name for alias in node.names]

    module = node.module or ""
    candidates = [module] if module else []
    candidates.extend(
        f"{module}.{alias.name}" if module else alias.name
        for alias in node.names
    )
    return candidates


def _is_forbidden_domain_import(node: ast.Import | ast.ImportFrom) -> bool:
    return any(
        FORBIDDEN_DOMAIN_IMPORT_COMPONENTS.intersection(candidate.split("."))
        for candidate in _import_candidates(node)
    )


def find_domain_boundary_violations(domain_dir: Path) -> list[str]:
    violations: list[str] = []
    for module_path in sorted(domain_dir.rglob("*.py")):
        source = module_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(module_path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            if not _is_forbidden_domain_import(node):
                continue
            statement = ast.get_source_segment(source, node) or ast.unparse(node)
            statement = " ".join(statement.split())
            violations.append(f"{module_path}:{node.lineno}: {statement}")
    return violations


class DomainBoundaryTest(unittest.TestCase):
    def test_domain_modules_do_not_import_infrastructure(self):
        self.assertTrue(DOMAIN_DIR.is_dir(), f"missing domain package: {DOMAIN_DIR}")
        violations = find_domain_boundary_violations(DOMAIN_DIR)

        self.assertEqual(violations, [], "\n".join(violations))

    def test_domain_import_checker_rejects_realistic_forbidden_forms_recursively(self):
        forbidden_source = "\n".join(
            (
                "import app.storage as legacy_storage",
                "from sqlite3 import connect as db_connect",
                "from .. import storage as sibling_storage",
                "from app.data import database",
                "from pathlib import Path",
                "import os.path",
                "from http.server import BaseHTTPRequestHandler",
                "from app.presentation.http import router",
                "from app.core.config import RuntimePaths",
                "from app import server",
            )
        )
        allowed_source = "\n".join(
            (
                "from datetime import datetime, timezone",
                "from math import sqrt",
                "from collections import defaultdict",
                "from statistics import mean, stdev",
                "from .campaigns import calculate_campaign_r",
                "from app.domain.r_metrics import build_r_metrics",
            )
        )
        with tempfile.TemporaryDirectory() as tmp:
            domain_dir = Path(tmp) / "domain"
            nested_dir = domain_dir / "nested"
            nested_dir.mkdir(parents=True)
            forbidden_path = nested_dir / "forbidden.py"
            forbidden_path.write_text(forbidden_source + "\n", encoding="utf-8")
            (domain_dir / "allowed.py").write_text(allowed_source + "\n", encoding="utf-8")

            violations = find_domain_boundary_violations(domain_dir)

        expected = [
            f"{forbidden_path}:{line}: {statement}"
            for line, statement in enumerate(forbidden_source.splitlines(), start=1)
        ]
        self.assertEqual(violations, expected)

    def test_domain_package_exports_trading_calculations(self):
        from app import domain

        expected = (
            "reconstruct_positions",
            "group_campaigns",
            "calculate_position_risk",
            "calculate_campaign_r",
            "build_r_metrics",
        )
        for name in expected:
            self.assertTrue(callable(getattr(domain, name, None)), f"missing domain export: {name}")


class ArchitectureContractTest(TemporaryStorageCase):
    def test_application_modules_do_not_import_presentation(self):
        violations = []
        for module_path in sorted(APPLICATION_DIR.rglob("*.py")):
            source = module_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(module_path))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.Import, ast.ImportFrom)):
                    continue
                for candidate in _import_candidates(node):
                    if "presentation" in candidate.split("."):
                        violations.append(f"{module_path.name}:{node.lineno}: {candidate}")

        self.assertEqual(violations, [], "\n".join(violations))

    def test_dashboard_trade_payload_matches_legacy_trade_serialization(self):
        insert_trade(
            storage,
            id="DASHBOARD-CONTRACT",
            order_no="0",
            deal_ticket="DEAL-DASHBOARD",
            screenshot_path="screenshots/missing-dashboard.png",
        )

        listed = storage.list_trades()[0]
        dashboard_trade = storage.get_dashboard()["trades"][0]
        keys = (
            "net_pnl",
            "open_time_bj",
            "close_time_bj",
            "duration_label",
            "display_order_kind",
            "display_order_no",
            "custom_fields",
            "session_label",
            "screenshot_url",
            "screenshot_missing",
        )

        self.assertEqual(
            {key: dashboard_trade[key] for key in keys},
            {key: listed[key] for key in keys},
        )

    def test_campaign_payload_is_shared_by_dashboard_orders_and_write_paths(self):
        insert_trade(storage, id="CAMPAIGN-SERIALIZER-CONTRACT")
        campaign_id = storage.list_campaigns()["campaigns"][0]["id"]

        updated = storage.update_campaign_review(
            campaign_id,
            {"review_text": "shared serializer contract"},
        )
        listed = storage.list_campaigns()["campaigns"][0]
        dashboard_campaign = storage.get_dashboard()["campaigns"][0]

        self.assertEqual(dashboard_campaign, listed)
        self.assertEqual(
            {key: updated[key] for key in listed},
            listed,
        )

    def test_one_click_launcher_enables_lan_binding_without_changing_direct_start(self):
        source = START_SCRIPT.read_text(encoding="utf-8")
        launcher = START_SCRIPT.parents[1] / "一键启动MT5复盘仪表盘.bat"
        launcher_source = launcher.read_text(encoding="utf-8")

        self.assertNotIn(
            'if (-not $env:MT5_REVIEW_HOST) { $env:MT5_REVIEW_HOST = "0.0.0.0" }',
            source,
        )
        self.assertIn(
            'if (-not $env:MT5_REVIEW_HOST) { $env:MT5_REVIEW_HOST = "127.0.0.1" }',
            source,
        )
        self.assertIn('if "%MT5_REVIEW_HOST%"=="" set "MT5_REVIEW_HOST=0.0.0.0"', launcher_source)
        self.assertIn("ensure-lan-firewall.ps1", launcher_source)

    def test_lan_firewall_rule_is_private_and_local_subnet_only(self):
        firewall_script = START_SCRIPT.parent / "tools" / "ensure-lan-firewall.ps1"
        source = firewall_script.read_text(encoding="utf-8")

        self.assertIn("-Profile Private", source)
        self.assertIn("-RemoteAddress LocalSubnet", source)
        self.assertIn("-Protocol TCP", source)

    def test_owned_integration_modules_do_not_depend_on_storage_facade(self):
        violations = []
        for module_path in OWNED_INTEGRATION_MODULES:
            source = module_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(module_path))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.Import, ast.ImportFrom)):
                    continue
                if any(
                    "storage" in candidate.split(".")
                    for candidate in _import_candidates(node)
                ):
                    violations.append(f"{module_path.name}:{node.lineno}")

        self.assertEqual(violations, [], "facade imports: " + ", ".join(violations))

    def test_data_modules_do_not_import_application_or_presentation(self):
        data_dir = STORAGE_MODULE.parent / "data"
        violations = []
        for module_path in sorted(data_dir.glob("*.py")):
            source = module_path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(module_path))
            for node in ast.walk(tree):
                if not isinstance(node, (ast.Import, ast.ImportFrom)):
                    continue
                for candidate in _import_candidates(node):
                    components = set(candidate.split("."))
                    if components.intersection({"application", "presentation", "storage"}):
                        violations.append(f"{module_path.name}:{node.lineno}: {candidate}")

        self.assertEqual(violations, [], "\n".join(violations))

    def test_storage_is_an_explicit_compatibility_facade(self):
        source = STORAGE_MODULE.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(STORAGE_MODULE))
        function_names = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        forbidden_definitions = {
            "_labeled_mode_evaluation",
            "_rolling_trade_stats",
            "_trades_in_date_range",
            "calculate_duration_seconds",
            "calculate_runs_z",
            "query_review_album",
        }
        wildcard_imports = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
            if alias.name == "*"
        ]
        sqlite_imports = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, (ast.Import, ast.ImportFrom))
            and any(
                candidate == "sqlite3" or candidate.startswith("sqlite3.")
                for candidate in _import_candidates(node)
            )
        ]
        sql_calls = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in {"execute", "executemany", "executescript"}
        ]

        violations = []
        if len(source.splitlines()) >= 500:
            violations.append(f"storage.py has {len(source.splitlines())} lines (limit: 499)")
        if "CREATE TABLE" in source.upper():
            violations.append("storage.py contains schema SQL")
        if forbidden_definitions.intersection(function_names):
            violations.append(
                "storage.py owns domain/query functions: "
                + ", ".join(sorted(forbidden_definitions.intersection(function_names)))
            )
        if wildcard_imports:
            violations.append(f"storage.py has wildcard imports on lines {wildcard_imports}")
        if sqlite_imports:
            violations.append(f"storage.py imports sqlite3 on lines {sqlite_imports}")
        if sql_calls:
            violations.append(f"storage.py executes SQL on lines {sql_calls}")

        self.assertEqual(violations, [], "\n".join(violations))

    def test_runtime_paths_are_derived_from_one_root(self):
        paths = RuntimePaths.from_root(Path("C:/synthetic/mt5-review"))

        self.assertEqual(paths.database, paths.data / "journal.sqlite")
        self.assertEqual(paths.screenshots, paths.data / "screenshots")
        self.assertEqual(paths.raw_events, paths.data / "raw-events")
        self.assertEqual(paths.backups, paths.root / "backups")
        self.assertEqual(paths.config_file, paths.root / "config.local.json")

    def test_runtime_paths_are_immutable(self):
        paths = RuntimePaths.from_root(self.root)

        with self.assertRaises(FrozenInstanceError):
            paths.database = self.root / "other.sqlite"

    def test_runtime_config_defaults_to_loopback_and_accepts_explicit_overrides(self):
        default = RuntimeConfig.from_environment({}, project_root=self.root)
        overridden = RuntimeConfig.from_environment(
            {"MT5_REVIEW_HOST": "0.0.0.0", "MT5_REVIEW_PORT": "8899"},
            project_root=self.root,
        )

        self.assertEqual((default.host, default.port), ("127.0.0.1", 8787))
        self.assertEqual((overridden.host, overridden.port), ("0.0.0.0", 8899))
        self.assertEqual(default.paths, RuntimePaths.from_root(self.root))

    def test_database_connection_applies_runtime_pragmas(self):
        paths = RuntimePaths.from_root(self.root / "database-policy")
        paths.data.mkdir(parents=True)

        conn = connect(paths)
        try:
            self.assertIs(conn.row_factory, sqlite3.Row)
            self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 10000)
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        finally:
            conn.close()

    def test_transaction_commits_success_and_rolls_back_failure(self):
        paths = RuntimePaths.from_root(self.root / "transaction-policy")
        paths.data.mkdir(parents=True)
        with transaction(paths) as conn:
            conn.execute("CREATE TABLE contract_probe (value TEXT NOT NULL)")
            conn.execute("INSERT INTO contract_probe (value) VALUES ('committed')")

        with self.assertRaisesRegex(RuntimeError, "rollback probe"):
            with transaction(paths) as conn:
                conn.execute("INSERT INTO contract_probe (value) VALUES ('rolled-back')")
                raise RuntimeError("rollback probe")

        conn = connect(paths)
        try:
            values = [row["value"] for row in conn.execute("SELECT value FROM contract_probe")]
        finally:
            conn.close()
        self.assertEqual(values, ["committed"])

    def test_transactional_script_accepts_trailing_line_comment(self):
        paths = RuntimePaths.from_root(self.root / "trailing-line-comment")
        paths.data.mkdir(parents=True)

        with transaction(paths) as conn:
            conn.executescript(
                "CREATE TABLE script_probe (value TEXT NOT NULL);\n"
                "INSERT INTO script_probe (value) VALUES ('committed');\n"
                "-- valid trailing comment"
            )

        conn = connect(paths)
        try:
            value = conn.execute("SELECT value FROM script_probe").fetchone()["value"]
        finally:
            conn.close()
        self.assertEqual(value, "committed")

    def test_schema_entry_point_creates_v4_schema_and_invokes_seed(self):
        paths = RuntimePaths.from_root(self.root / "schema-entry-point")
        seed_calls = []

        ensure_schema(paths, lambda: seed_calls.append(paths.database.exists()))

        conn = connect(paths)
        try:
            version = conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()["value"]
        finally:
            conn.close()
        self.assertEqual(version, "4")
        self.assertEqual(seed_calls, [True])

    def test_failed_migration_rolls_back_all_schema_data_and_version_state(self):
        paths = RuntimePaths.from_root(self.root / "failed-migration")
        seed_calls = []
        paths.data.mkdir(parents=True)
        with transaction(paths) as conn:
            conn.execute("CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            conn.execute(
                "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '3')"
            )
            conn.execute("CREATE TABLE legacy_state (value TEXT NOT NULL)")
            conn.execute("INSERT INTO legacy_state (value) VALUES ('original')")

        def fail_after_script(conn, previous_version):
            self.assertEqual(previous_version, 3)
            conn.executescript(
                """
                CREATE TABLE migration_probe (value TEXT NOT NULL);
                INSERT INTO migration_probe (value) VALUES ('must; roll back');
                UPDATE legacy_state SET value = 'changed';
                UPDATE schema_meta SET value = '999' WHERE key = 'schema_version';
                """
            )
            raise RuntimeError("injected migration failure")

        with self.assertRaisesRegex(RuntimeError, "injected migration failure"):
            ensure_schema(
                paths,
                seed=lambda: seed_calls.append(True),
                migrate=fail_after_script,
            )

        conn = connect(paths)
        try:
            user_tables = [
                row["name"]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )
            ]
            schema_version = conn.execute(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'"
            ).fetchone()["value"]
            legacy_value = conn.execute(
                "SELECT value FROM legacy_state"
            ).fetchone()["value"]
        finally:
            conn.close()

        self.assertEqual(user_tables, ["legacy_state", "schema_meta"])
        self.assertEqual(schema_version, "3")
        self.assertEqual(legacy_value, "original")
        self.assertEqual(seed_calls, [])

    def test_legacy_path_assignments_update_runtime_source_of_truth(self):
        legacy_database = self.root / "legacy-data" / "legacy.sqlite"
        legacy_database.parent.mkdir(parents=True)
        storage.DB_PATH = legacy_database

        conn = storage.connect()
        try:
            database_path = Path(conn.execute("PRAGMA database_list").fetchone()[2])
        finally:
            conn.close()

        self.assertEqual(storage.runtime_paths().database, legacy_database)
        self.assertEqual(database_path, legacy_database)

    def test_legacy_path_assignments_apply_to_imported_command_adapters(self):
        original = storage.runtime_paths()
        alternate = RuntimePaths.from_root(self.root / "legacy-command-adapter")
        storage.configure_runtime_paths(alternate)
        storage.init_db(seed=False)
        storage.configure_runtime_paths(original)
        storage.DB_PATH = alternate.database

        storage.create_custom_field({"name": "legacy-path-field"})

        conn = connect(alternate)
        try:
            row = conn.execute(
                "SELECT name FROM custom_fields WHERE name = ?",
                ("legacy-path-field",),
            ).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(storage.runtime_paths().database, alternate.database)

    def test_ingestion_uses_legacy_upsert_monkeypatch_seam(self):
        payload = {
            "trade_id": "PATCH-SEAM-1",
            "symbol": "EURUSD",
            "side": "long",
            "lots": 0.1,
            "open_time_utc": "2026-08-01T00:00:00+00:00",
            "close_time_utc": "2026-08-01T00:05:00+00:00",
            "entry_price": 1.1,
            "exit_price": 1.2,
            "pnl": 10.0,
        }
        original = storage._upsert_trade_conn

        with patch.object(storage, "_upsert_trade_conn", wraps=original) as upsert:
            storage.ingest_mt5_event(payload)

        upsert.assert_called_once()

    def test_runtime_path_configuration_mirrors_legacy_constants(self):
        configured = RuntimePaths.from_root(self.root / "configured")

        storage.configure_runtime_paths(configured)

        self.assertEqual(storage.runtime_paths(), configured)
        self.assertEqual(storage.PROJECT_ROOT, configured.root)
        self.assertEqual(storage.DATA_DIR, configured.data)
        self.assertEqual(storage.SCREENSHOT_DIR, configured.screenshots)
        self.assertEqual(storage.RAW_EVENTS_DIR, configured.raw_events)
        self.assertEqual(storage.BACKUP_DIR, configured.backups)
        self.assertEqual(storage.DB_PATH, configured.database)

    def test_direct_runtime_path_update_is_mirrored_by_storage_adapter(self):
        configured = RuntimePaths.from_root(self.root / "direct-configured")

        set_runtime_paths(configured)

        self.assertEqual(storage.PROJECT_ROOT, configured.root)
        self.assertEqual(storage.DATA_DIR, configured.data)
        self.assertEqual(storage.SCREENSHOT_DIR, configured.screenshots)
        self.assertEqual(storage.RAW_EVENTS_DIR, configured.raw_events)
        self.assertEqual(storage.BACKUP_DIR, configured.backups)
        self.assertEqual(storage.DB_PATH, configured.database)

    def test_campaign_analysis_and_detail_contracts(self):
        field = storage.create_custom_field({"name": "执行质量", "field_type": "text"})
        insert_trade(
            storage,
            id="SYN-1",
            position_id="POSITION-1",
            review_text="按计划执行",
            screenshot_path="screenshots/synthetic.png",
        )
        insert_trade(
            storage,
            id="SYN-2",
            position_id="POSITION-2",
            lots=0.5,
            open_time_utc="2026-08-01T00:15:00+00:00",
            close_time_utc="2026-08-01T00:45:00+00:00",
            entry_price=102.0,
            exit_price=106.0,
            pnl=2.0,
        )
        insert_trade(
            storage,
            id="SYN-DELETED",
            position_id="POSITION-DELETED",
            open_time_utc="2026-08-01T01:00:00+00:00",
            close_time_utc="2026-08-01T01:30:00+00:00",
            pnl=100.0,
        )
        storage.delete_trade("SYN-DELETED")
        storage.update_trade_custom_value("SYN-1", field["id"], {"value": "完整"})
        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-01T00:00:00+00:00", "balance": 100.0, "equity": 100.0}
        )
        storage.upsert_equity_snapshot(
            {"time_utc": "2026-08-01T01:00:00+00:00", "balance": 106.0, "equity": 106.0}
        )

        page = storage.list_campaigns()
        detail = storage.get_campaign(page["campaigns"][0]["id"])
        for position in detail["positions"]:
            storage.update_position_initial_stop(
                position["id"], 98.0 if position["position_id"] == "POSITION-1" else 100.0
            )
        detail = storage.get_campaign(page["campaigns"][0]["id"])
        analysis = storage.get_analysis("2026-08-01", "2026-08-01")

        self.assertEqual(page["total"], 1)
        self.assertEqual(page["campaigns"][0]["position_count"], 2)
        self.assertEqual(analysis["metrics"]["net_pnl"], 6.0)
        self.assertEqual(analysis["r_metrics"]["complete_count"], 1)
        self.assertEqual(detail["positions"][0]["source_trade"]["review_text"], "按计划执行")
        self.assertEqual(
            detail["positions"][0]["source_trade"]["custom_fields"][str(field["id"])],
            "完整",
        )
        self.assertEqual(
            detail["positions"][0]["source_trade"]["screenshot_path"],
            "screenshots/synthetic.png",
        )
        self.assertEqual(analysis["equity"][-1]["return_rate"], 6.0)

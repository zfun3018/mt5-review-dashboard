from __future__ import annotations

from dataclasses import dataclass
from functools import wraps
from typing import Any

from .application import AnalysisWindow, PageRequest
from .application import dashboard_assembly
from .application.album_service import AlbumService
from .application.campaign_response import CampaignResponseSerializer
from .application.dashboard_service import DashboardService
from .application.orders_service import OrdersService
from .application.settings_service import SettingsService
from .core.config import (
    RuntimePaths,
    get_runtime_paths,
    register_runtime_paths_listener,
    set_runtime_paths,
)
from .data import bootstrap, campaign_commands, catalog_commands, ingestion_repository
from .data import maintenance_repository, trade_commands
from .data.campaign_repository import CampaignRepository
from .data.catalog_repository import CatalogRepository
from .data.database import connect as database_connect
from .data.database import transaction
from .data.migrations import ensure_schema
from .data.trade_repository import TradeRepository
from .presentation.campaign_serializer import (
    _serialize_campaign_record,
    _serialize_position_for_campaign,
    _serialize_position_summary_for_campaign,
)
from .presentation.trade_serializer import _serialize_trade


CLASSIFICATION_DIMENSIONS = catalog_commands.CLASSIFICATION_DIMENSIONS
DEFAULT_CLASSIFICATION_OPTIONS = bootstrap.DEFAULT_CLASSIFICATION_OPTIONS

_synced_runtime_paths = get_runtime_paths()
PROJECT_ROOT = _synced_runtime_paths.root
DATA_DIR = _synced_runtime_paths.data
SCREENSHOT_DIR = _synced_runtime_paths.screenshots
RAW_EVENTS_DIR = _synced_runtime_paths.raw_events
BACKUP_DIR = _synced_runtime_paths.backups
DB_PATH = _synced_runtime_paths.database
CONFIG_FILE = _synced_runtime_paths.config_file


def _legacy_runtime_paths() -> RuntimePaths:
    root = PROJECT_ROOT
    return RuntimePaths(
        root=root,
        data=DATA_DIR,
        database=DB_PATH,
        screenshots=SCREENSHOT_DIR,
        raw_events=RAW_EVENTS_DIR,
        backups=BACKUP_DIR,
        config_file=CONFIG_FILE,
    )


def _mirror_legacy_paths(paths: RuntimePaths) -> None:
    global PROJECT_ROOT, DATA_DIR, SCREENSHOT_DIR, RAW_EVENTS_DIR, BACKUP_DIR, DB_PATH
    global CONFIG_FILE
    PROJECT_ROOT = paths.root
    DATA_DIR = paths.data
    SCREENSHOT_DIR = paths.screenshots
    RAW_EVENTS_DIR = paths.raw_events
    BACKUP_DIR = paths.backups
    DB_PATH = paths.database
    CONFIG_FILE = paths.config_file


def _synchronize_runtime_paths(paths: RuntimePaths) -> None:
    global _synced_runtime_paths
    _mirror_legacy_paths(paths)
    _synced_runtime_paths = paths


register_runtime_paths_listener(_synchronize_runtime_paths)


def runtime_paths() -> RuntimePaths:
    global _synced_runtime_paths
    configured = get_runtime_paths()
    legacy = _legacy_runtime_paths()
    configured_changed = configured != _synced_runtime_paths
    legacy_changed = legacy != _synced_runtime_paths
    if configured_changed and legacy_changed and configured != legacy:
        raise RuntimeError("runtime paths changed through both configuration interfaces")
    if legacy_changed:
        set_runtime_paths(legacy)
        configured = legacy
    elif configured_changed:
        _mirror_legacy_paths(configured)
    _synced_runtime_paths = configured
    return configured


def configure_runtime_paths(paths: RuntimePaths) -> None:
    set_runtime_paths(paths)


def connect():
    return database_connect(runtime_paths())


def db():
    return transaction(runtime_paths())


def _campaign_repository() -> CampaignRepository:
    return CampaignRepository(
        runtime_paths(),
        review_formatter=lambda trade_id, review: f"来源 {trade_id}\n{review}",
    )


class _LocalStatusProvider:
    def get_status(self) -> dict[str, Any]:
        runtime_paths()
        return maintenance_repository._read_local_status()


class _BackupReadRepository:
    def list_backups(self) -> list[dict[str, Any]]:
        runtime_paths()
        return maintenance_repository._read_backups()


@dataclass(frozen=True)
class _ApplicationServices:
    dashboard: DashboardService
    orders: OrdersService
    album: AlbumService
    settings: SettingsService


def _application_services() -> _ApplicationServices:
    paths = runtime_paths()
    trades = TradeRepository(paths)
    campaigns = _campaign_repository()
    catalogs = CatalogRepository(paths)

    def serialize_source_trade(row: dict[str, Any]) -> dict[str, Any]:
        trade_id = str(row["id"])
        return _serialize_trade(row, {trade_id: row.get("custom_fields", {})})

    return _ApplicationServices(
        dashboard=DashboardService(trades, campaigns, catalogs, catalogs, paths),
        orders=OrdersService(campaigns, serialize_source_trade),
        album=AlbumService(trades, catalogs, serialize_source_trade),
        settings=SettingsService(
            catalogs,
            catalogs,
            _LocalStatusProvider(),
            _BackupReadRepository(),
        ),
    )


def _synchronized_owner(owner):
    @wraps(owner)
    def adapter(*args, **kwargs):
        runtime_paths()
        return owner(*args, **kwargs)

    return adapter


def init_db(seed: bool = True) -> None:
    ensure_schema(
        runtime_paths(),
        seed=seed_demo_data if seed else False,
        migrate=_ensure_schema,
    )


def _ensure_schema(conn, previous_version: int = 0) -> None:
    bootstrap._ensure_schema(conn, previous_version)


def seed_demo_data() -> None:
    runtime_paths()
    bootstrap.seed_demo_data()


def get_dashboard(year: int | None = None, month: int | None = None) -> dict[str, Any]:
    runtime_paths()
    return dashboard_assembly.get_dashboard(
        year,
        month,
        trade_serializer=_serialize_trade_row,
        campaign_serializer=CampaignResponseSerializer(_serialize_trade_row),
    )


def get_analysis(
    start_date: str | None = None,
    end_date: str | None = None,
    equity_days: int = 30,
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    days = max(1, min(int(equity_days), 366))
    return _application_services().dashboard.get_analysis(
        AnalysisWindow(start_date, end_date, days),
        year=year,
        month=month,
    )


build_summary = dashboard_assembly.build_summary
build_period_summaries = dashboard_assembly.build_period_summaries


def query_trades(
    query: str = "",
    symbol: str = "",
    side: str = "all",
    trade_type: str = "all",
    strategy: str = "all",
    start_date: str | None = None,
    end_date: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    result = TradeRepository(runtime_paths()).query(
        {
            "query": query,
            "symbol": symbol,
            "side": side,
            "trade_type": trade_type,
            "strategy": strategy,
            "start_date": start_date,
            "end_date": end_date,
        },
        page,
        page_size,
    )
    trades = [
        _serialize_trade(row, {str(row["id"]): row.get("custom_fields", {})})
        for row in result.items
    ]
    return {
        "trades": trades,
        "total": result.total,
        "page": result.page,
        "page_size": result.page_size,
    }


def _query_review_album_adapter(
    start_date: str | None = None,
    end_date: str | None = None,
    symbols: list[str] | str | None = None,
    tags: list[str] | str | None = None,
    sort: str = "desc",
    archived: bool = False,
    page: int = 1,
    page_size: int = 24,
) -> dict[str, Any]:
    return _application_services().album.query(
        {
            "start_date": start_date,
            "end_date": end_date,
            "symbols": symbols,
            "tags": tags,
            "sort": sort,
            "archived": archived,
        },
        PageRequest(max(1, int(page)), max(1, min(int(page_size), 100))),
    )


query_review_album = _query_review_album_adapter


def get_random_review_album() -> dict[str, Any]:
    return _application_services().album.random()


def list_campaigns(
    query: str = "",
    symbol: str = "",
    side: str = "all",
    trade_type: str = "all",
    strategy: str = "all",
    start_date: str | None = None,
    end_date: str | None = None,
    r_missing_only: bool = False,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    return _application_services().orders.list_campaigns(
        {
            "query": query,
            "symbol": symbol,
            "side": side,
            "trade_type": trade_type,
            "strategy": strategy,
            "start_date": start_date,
            "end_date": end_date,
            "r_missing_only": r_missing_only,
        },
        PageRequest(max(1, int(page)), max(1, min(int(page_size), 200))),
    )


def get_campaign(campaign_id: str) -> dict[str, Any] | None:
    return _application_services().orders.get_campaign(campaign_id)


def list_classification_options(
    dimension: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    return _application_services().settings.get_classifications(dimension, active_only)


def list_custom_fields(active_only: bool = False) -> list[dict[str, Any]]:
    service = _application_services().settings
    if active_only:
        return service.get_custom_fields(active_only=True)
    return service.get_custom_fields()


def get_analysis_settings() -> dict[str, Any]:
    return _application_services().settings.get_analysis_settings()


def get_local_status() -> dict[str, Any]:
    return _application_services().settings.get_status()


def list_backups() -> list[dict[str, Any]]:
    return _application_services().settings.list_backups()


def _serialize_trade_row(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    trade_id = str(row["id"])
    return _serialize_trade(row, {trade_id: row.get("custom_fields", {})})


def list_trades(include_deleted: bool = False) -> list[dict[str, Any]]:
    runtime_paths()
    return [
        _serialize_trade_row(row)
        for row in trade_commands.list_trades(include_deleted)
    ]


def get_trade(
    trade_id: str,
    include_deleted: bool = False,
) -> dict[str, Any] | None:
    runtime_paths()
    return _serialize_trade_row(trade_commands.get_trade(trade_id, include_deleted))


def replace_trade_screenshot(trade_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(trade_commands.replace_trade_screenshot(trade_id, payload))


def delete_trade_screenshot(trade_id: str) -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(trade_commands.delete_trade_screenshot(trade_id))


def update_trade_review(trade_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(trade_commands.update_trade_review(trade_id, payload))


def update_trade_archived(trade_id: str, archived: bool) -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(trade_commands.update_trade_archived(trade_id, archived))


delete_trade = _synchronized_owner(trade_commands.delete_trade)


def restore_trade(trade_id: str) -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(trade_commands.restore_trade(trade_id))


upsert_trade = _synchronized_owner(trade_commands.upsert_trade)
_upsert_trade_conn = trade_commands._upsert_trade_conn

create_classification_option = _synchronized_owner(catalog_commands.create_classification_option)
update_classification_option = _synchronized_owner(catalog_commands.update_classification_option)
delete_classification_option = _synchronized_owner(catalog_commands.delete_classification_option)
restore_classification_option = _synchronized_owner(catalog_commands.restore_classification_option)
list_trends = _synchronized_owner(catalog_commands.list_trends)
create_trend = _synchronized_owner(catalog_commands.create_trend)
update_trend = _synchronized_owner(catalog_commands.update_trend)
delete_trend = _synchronized_owner(catalog_commands.delete_trend)
create_custom_field = _synchronized_owner(catalog_commands.create_custom_field)
update_custom_field = _synchronized_owner(catalog_commands.update_custom_field)
delete_custom_field = _synchronized_owner(catalog_commands.delete_custom_field)
purge_custom_field = _synchronized_owner(catalog_commands.purge_custom_field)
restore_custom_field = _synchronized_owner(catalog_commands.restore_custom_field)
update_trade_custom_value = _synchronized_owner(catalog_commands.update_trade_custom_value)

list_equity_snapshots = _synchronized_owner(ingestion_repository.list_equity_snapshots)
get_ingest_cursor = _synchronized_owner(ingestion_repository.get_ingest_cursor)
update_ingest_cursor = _synchronized_owner(ingestion_repository.update_ingest_cursor)


def ingest_mt5_event(
    payload: dict[str, Any],
    raw_event: str | None = None,
    event_hash: str | None = None,
    *,
    rebuild: bool = True,
    _conn=None,
) -> dict[str, Any]:
    runtime_paths()
    return ingestion_repository.ingest_mt5_event(
        payload,
        raw_event,
        event_hash,
        rebuild=rebuild,
        _conn=_conn,
        _upsert_trade=_upsert_trade_conn,
    )


upsert_equity_snapshot = _synchronized_owner(ingestion_repository.upsert_equity_snapshot)
upsert_deal_event = _synchronized_owner(ingestion_repository.upsert_deal_event)

create_backup = _synchronized_owner(maintenance_repository.create_backup)


def update_position_initial_stop(position_id: str, value: Any) -> dict[str, Any]:
    runtime_paths()
    result = campaign_commands.update_position_initial_stop(position_id, value)
    serializer = CampaignResponseSerializer(_serialize_trade_row)
    campaign = serializer.serialize_campaign(result["campaign"], include_positions=True)
    position = next(
        item for item in campaign["positions"] if item["id"] == result["position_id"]
    )
    return {
        "position": position,
        "campaign": serializer.serialize_campaign(result["campaign"], include_positions=False),
    }


update_analysis_settings = _synchronized_owner(campaign_commands.update_analysis_settings)


def update_campaign_review(campaign_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    runtime_paths()
    record = campaign_commands.update_campaign_review(campaign_id, payload)
    return CampaignResponseSerializer(_serialize_trade_row).serialize_campaign(
        record, include_positions=True
    )


def rebuild_campaign_models(*, conn=None) -> None:
    _campaign_repository().rebuild(conn=conn)


def _rebuild_campaign_models_conn(conn) -> None:
    rebuild_campaign_models(conn=conn)


def _campaign_records_conn(conn) -> list[dict[str, Any]]:
    return _campaign_repository().records(conn=conn)

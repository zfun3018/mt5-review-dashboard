from __future__ import annotations
from dataclasses import dataclass
from functools import partial, wraps
import inspect
from typing import Any
from .application import AnalysisWindow, PageRequest
from .application import dashboard_assembly
from .application.album_service import AlbumService
from .application.campaign_response import CampaignResponseSerializer
from .application.dashboard_service import DashboardService
from .application.orders_service import OrdersService
from .application.settings_service import SettingsService
from .core.config import RuntimePaths, get_runtime_paths, register_runtime_paths_listener, set_runtime_paths
from .data import bootstrap, campaign_commands, catalog_commands, ingestion_repository
from .data import maintenance_repository, trade_commands
from .data.data_cleanup_repository import cleanup_data, list_accounts as list_data_accounts, preview_cleanup as preview_data_cleanup
from .data.campaign_repository import CampaignRepository
from .data.catalog_repository import CatalogRepository
from .data.database import connect as database_connect
from .data.database import transaction
from .data.migrations import ensure_schema
from .data.trade_repository import TradeRepository
from .platform_importer import import_platform_file
from .platform_facade import (
    get_import_batch,
    get_import_calendar,
    latest_import_summary,
    import_csv,
    import_file,
    list_unmatched_import_executions, match_import_executions,
    list_import_batches, revert_import_batch, list_platforms,
)
from .platforms import normalize_platform
from .review_facade import (
    cancel_review_trade,
    checkin_review_trade,
    set_review_daily_goal,
)
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
get_campaign_checkins = _synchronized_owner(campaign_commands.campaign_checkin_overview)
get_random_featured_campaign = _synchronized_owner(campaign_commands.random_featured_campaign)
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


def get_dashboard(year: int | None = None, month: int | None = None, platform: str = "mt5") -> dict[str, Any]:
    runtime_paths()
    return dashboard_assembly.get_dashboard(
        year,
        month,
        normalize_platform(platform),
        trade_serializer=_serialize_trade_row,
        campaign_serializer=CampaignResponseSerializer(_serialize_trade_row),
    )


def get_analysis(
    start_date: str | None = None,
    end_date: str | None = None,
    equity_days: int | None = None,
    year: int | None = None,
    month: int | None = None,
    platform: str = "mt5",
) -> dict[str, Any]:
    days = None if equity_days is None else max(1, min(int(equity_days), 366))
    kwargs = {"year": year, "month": month}
    if platform != "mt5":
        kwargs["platform"] = normalize_platform(platform)
    return _application_services().dashboard.get_analysis(
        AnalysisWindow(start_date, end_date, days), **kwargs
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
    platform: str = "mt5",
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
            "platform": normalize_platform(platform),
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
    platform: str = "mt5",
) -> dict[str, Any]:
    return _application_services().album.query(
        {
            "start_date": start_date,
            "end_date": end_date,
            "symbols": symbols,
            "tags": tags,
            "sort": sort,
            "archived": archived,
            "platform": normalize_platform(platform),
        },
        PageRequest(max(1, int(page)), max(1, min(int(page_size), 100))),
    )


query_review_album = _query_review_album_adapter


def get_random_review_album(platform: str = "mt5") -> dict[str, Any]:
    return _application_services().album.random(normalize_platform(platform))


def get_review_checkins(days: int = 90, today=None, platform: str = "mt5") -> dict[str, Any]:
    return _application_services().album.checkins(days=days, today=today, platform=normalize_platform(platform))


update_campaign_featured = campaign_commands.update_campaign_featured; checkin_review_campaign = campaign_commands.checkin_campaign; cancel_review_campaign = campaign_commands.cancel_campaign_checkin
def list_campaigns(
    query: str = "", symbol: str = "", side: str = "all",
    trade_type: str = "all", strategy: str = "all",
    start_date: str | None = None, end_date: str | None = None,
    r_missing_only: bool = False,
    page: int = 1,
    page_size: int = 50,
    platform: str = "mt5",
    deleted: str = "active",
    featured: bool = False,
    close_hour: int | None = None,
    session: str | None = None,
) -> dict[str, Any]:
    return _application_services().orders.list_campaigns(
        {
            "query": query, "symbol": symbol, "side": side,
            "trade_type": trade_type, "strategy": strategy,
            "start_date": start_date, "end_date": end_date,
            "r_missing_only": r_missing_only, "platform": normalize_platform(platform),
            "deleted": deleted, "close_hour": close_hour, "session": session,
            **({"featured": True} if featured else {}),
        },
        PageRequest(max(1, int(page)), max(1, min(int(page_size), 200))),
    )


def get_campaign(
    campaign_id: str,
    platform: str = "mt5",
    deleted: str = "active",
) -> dict[str, Any] | None:
    getter = _application_services().orders.get_campaign
    record = (
        getter(campaign_id, deleted=deleted)
        if "deleted" in inspect.signature(getter).parameters
        else getter(campaign_id)
    )
    return record if record and record.get("platform", "mt5") == normalize_platform(platform) else None


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


def list_trades(include_deleted: bool = False, platform: str = "mt5") -> list[dict[str, Any]]:
    runtime_paths()
    return [
        _serialize_trade_row(row)
        for row in trade_commands.list_trades(include_deleted, normalize_platform(platform))
    ]


def get_trade(
    trade_id: str,
    include_deleted: bool = False,
    platform: str = "mt5",
) -> dict[str, Any] | None:
    runtime_paths()
    trade = trade_commands.get_trade(trade_id, include_deleted, normalize_platform(platform))
    return _serialize_trade_row(trade)


def _serialized_trade_command(command, *args, **kwargs):
    runtime_paths()
    return _serialize_trade_row(command(*args, **kwargs))


def _serialized_campaign_command(command, *args, **kwargs): runtime_paths(); return CampaignResponseSerializer(_serialize_trade_row).serialize_campaign(command(*args, **kwargs), include_positions=True)


replace_trade_screenshot = partial(_serialized_trade_command, trade_commands.replace_trade_screenshot)
delete_trade_screenshot = partial(_serialized_trade_command, trade_commands.delete_trade_screenshot)
replace_campaign_screenshot = partial(_serialized_campaign_command, campaign_commands.replace_campaign_screenshot)
delete_campaign_screenshot = partial(_serialized_campaign_command, campaign_commands.delete_campaign_screenshot)
update_trade_review = partial(_serialized_trade_command, trade_commands.update_trade_review)
update_trade_archived = partial(_serialized_trade_command, trade_commands.update_trade_archived)


def delete_trade(
    trade_id: str,
    platform: str = "mt5",
    reason: str = "",
) -> None:
    runtime_paths()
    return trade_commands.delete_trade(trade_id, normalize_platform(platform), reason)


def restore_trade(trade_id: str, platform: str = "mt5") -> dict[str, Any]:
    runtime_paths()
    return _serialize_trade_row(
        trade_commands.restore_trade(trade_id, normalize_platform(platform))
    )


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


def update_position_initial_stop(position_id: str, value: Any, platform: str = "mt5") -> dict[str, Any]:
    runtime_paths()
    result = campaign_commands.update_position_initial_stop(
        position_id, value, normalize_platform(platform)
    )
    serializer = CampaignResponseSerializer(_serialize_trade_row)
    campaign = serializer.serialize_campaign(result["campaign"], include_positions=True)
    position = next(
        item for item in campaign["positions"] if item["id"] == result["position_id"]
    )
    return {
        "position": position,
        "campaign": serializer.serialize_campaign(result["campaign"], include_positions=False),
    }


def update_campaign_initial_stop(campaign_id: str, value: Any, platform: str = "mt5") -> dict[str, Any]:
    runtime_paths()
    record = campaign_commands.update_campaign_initial_stop(
        campaign_id, value, normalize_platform(platform)
    )
    return CampaignResponseSerializer(_serialize_trade_row).serialize_campaign(
        record, include_positions=True
    )


update_analysis_settings = _synchronized_owner(campaign_commands.update_analysis_settings)


def update_campaign_review(campaign_id: str, payload: dict[str, Any], platform: str = "mt5") -> dict[str, Any]:
    runtime_paths()
    record = campaign_commands.update_campaign_review(
        campaign_id, payload, normalize_platform(platform)
    )
    return CampaignResponseSerializer(_serialize_trade_row).serialize_campaign(
        record, include_positions=True
    )


def rebuild_campaign_models(*, conn=None) -> None:
    _campaign_repository().rebuild(conn=conn)


def _rebuild_campaign_models_conn(conn) -> None:
    rebuild_campaign_models(conn=conn)


def _campaign_records_conn(conn) -> list[dict[str, Any]]:
    return _campaign_repository().records(conn=conn)

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping


PROJECT_ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class RuntimePaths:
    root: Path
    data: Path
    database: Path
    screenshots: Path
    raw_events: Path
    backups: Path
    config_file: Path

    @classmethod
    def from_root(
        cls,
        root: Path,
        *,
        data_dir: Path | str | None = None,
        config_file: Path | str | None = None,
    ) -> "RuntimePaths":
        resolved_root = Path(root).resolve()
        if data_dir is not None:
            data = Path(data_dir).resolve()
        else:
            data = resolved_root / "data"
        database = data / "journal.sqlite"
        screenshots = data / "screenshots"
        raw_events = data / "raw-events"
        if data_dir is not None:
            backups = data / "backups"
        else:
            backups = resolved_root / "backups"
        if config_file is not None:
            resolved_config = Path(config_file).resolve()
        elif data_dir is not None:
            resolved_config = data / "config.local.json"
        else:
            resolved_config = resolved_root / "config.local.json"
        return cls(
            root=resolved_root,
            data=data,
            database=database,
            screenshots=screenshots,
            raw_events=raw_events,
            backups=backups,
            config_file=resolved_config,
        )


@dataclass(frozen=True)
class RuntimeConfig:
    host: str
    port: int
    paths: RuntimePaths

    @classmethod
    def from_environment(
        cls,
        env: Mapping[str, str],
        project_root: Path = PROJECT_ROOT,
    ) -> "RuntimeConfig":
        host = env.get("MT5_REVIEW_HOST", "127.0.0.1")
        port = int(env.get("MT5_REVIEW_PORT", "8787"))
        if not 0 <= port <= 65535:
            raise ValueError("MT5_REVIEW_PORT must be between 0 and 65535")
        return cls(
            host=host,
            port=port,
            paths=RuntimePaths.from_root(
                project_root,
                data_dir=env.get("MT5_REVIEW_DATA_DIR"),
                config_file=env.get("MT5_REVIEW_CONFIG_FILE"),
            ),
        )


_runtime_paths = RuntimePaths.from_root(PROJECT_ROOT)
_runtime_path_listeners: list[Callable[[RuntimePaths], None]] = []


def get_runtime_paths() -> RuntimePaths:
    return _runtime_paths


def set_runtime_paths(paths: RuntimePaths) -> None:
    if not isinstance(paths, RuntimePaths):
        raise TypeError("paths must be a RuntimePaths instance")
    global _runtime_paths
    _runtime_paths = paths
    for listener in tuple(_runtime_path_listeners):
        listener(paths)


def register_runtime_paths_listener(listener: Callable[[RuntimePaths], None]) -> None:
    if listener not in _runtime_path_listeners:
        _runtime_path_listeners.append(listener)

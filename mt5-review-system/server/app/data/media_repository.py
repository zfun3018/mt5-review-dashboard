from __future__ import annotations

from pathlib import Path

from ..core.config import RuntimePaths


class MediaRepository:
    def __init__(self, paths: RuntimePaths) -> None:
        self.paths = paths

    def normalize_relative_path(self, value: str) -> str:
        """Return a safe, forward-slash path relative to the data directory."""
        raw = str(value or "").replace("\\", "/").strip()
        if not raw or raw.lower().startswith("file:"):
            return ""

        data_root = self.paths.data.resolve()
        candidate_input = Path(raw)
        if candidate_input.is_absolute():
            candidate = candidate_input.resolve()
        else:
            data_prefix = f"{data_root.as_posix().rstrip('/')}/"
            if raw.casefold().startswith(data_prefix.casefold()):
                raw = raw[len(data_prefix):]
            elif raw.casefold() == data_root.as_posix().casefold():
                return ""
            elif raw.casefold().startswith(f"{data_root.name.casefold()}/"):
                raw = raw[len(data_root.name) + 1:]
            candidate = (data_root / raw).resolve()

        if not candidate.is_relative_to(data_root):
            return ""
        return candidate.relative_to(data_root).as_posix()

    def resolve(self, relative_path: str) -> Path | None:
        normalized = self.normalize_relative_path(relative_path)
        if not normalized:
            return None
        return (self.paths.data / normalized).resolve()

    def exists(self, relative_path: str) -> bool:
        candidate = self.resolve(relative_path)
        return bool(candidate and candidate.is_file())

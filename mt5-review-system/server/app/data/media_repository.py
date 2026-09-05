from __future__ import annotations

from pathlib import Path

from ..core.config import RuntimePaths


class MediaRepository:
    def __init__(self, paths: RuntimePaths) -> None:
        self.paths = paths

    def resolve(self, relative_path: str) -> Path | None:
        value = str(relative_path or "").strip()
        if not value:
            return None
        candidate = (self.paths.data / value).resolve()
        if not candidate.is_relative_to(self.paths.data.resolve()):
            return None
        return candidate

    def exists(self, relative_path: str) -> bool:
        candidate = self.resolve(relative_path)
        return bool(candidate and candidate.is_file())

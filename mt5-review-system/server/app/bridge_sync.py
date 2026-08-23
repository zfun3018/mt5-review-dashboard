from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import storage
from .importer import import_bridge_dir


def auto_import_from_config() -> dict[str, Any]:
    config_path = storage.PROJECT_ROOT / "config.local.json"
    if not config_path.exists():
        return {"skipped": True, "reason": "config.local.json not found"}

    config = json.loads(config_path.read_text(encoding="utf-8"))
    bridge_dir = config.get("mql5_files_bridge_dir")
    if not bridge_dir:
        return {"skipped": True, "reason": "mql5_files_bridge_dir not configured"}

    bridge = Path(str(bridge_dir)).expanduser()
    if not bridge.exists() or not bridge.is_dir():
        return {"skipped": True, "reason": f"bridge directory not found: {bridge}"}

    result = import_bridge_dir(bridge)
    result["skipped"] = False
    return result

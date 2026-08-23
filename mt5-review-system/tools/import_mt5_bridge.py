from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "server"))

from app import storage
from app.importer import import_bridge_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="Import MT5ReviewBridge JSONL files into the local journal.")
    parser.add_argument("bridge_dir", help="Path to the MT5ReviewBridge folder inside MQL5/Files.")
    args = parser.parse_args()

    storage.init_db(seed=True)
    result = import_bridge_dir(args.bridge_dir)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

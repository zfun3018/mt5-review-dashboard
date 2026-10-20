from __future__ import annotations

from typing import Any

from .biff8_xls import parse_biff8_workbook
from .tonghuashun_csv import parse_tonghuashun_workbook


def parse_tonghuashun_xls(data: bytes, filename: str = "") -> dict[str, Any]:
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise ValueError("Excel 文件内容不能为空")
    workbook = parse_biff8_workbook(bytes(data))
    result = parse_tonghuashun_workbook(workbook, filename)
    result["source_format"] = "xls"
    return result

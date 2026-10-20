from __future__ import annotations

import struct
from datetime import datetime, timedelta
from typing import Any, Iterable


OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
END_OF_CHAIN = 0xFFFFFFFE
FREE_SECTOR = 0xFFFFFFFF
NO_STREAM = 0xFFFFFFFF
SECTOR_SIZE = 512
MINI_SECTOR_SIZE = 64
MINI_STREAM_CUTOFF = 4096


def parse_biff8_workbook(data: bytes) -> dict[str, list[list[Any]]]:
    """Read the BIFF8 worksheet values needed by tabular reports."""
    compound = _CompoundFile(data)
    stream = compound.stream("Workbook") or compound.stream("Book")
    if stream is None:
        raise ValueError("Excel 工作簿中未找到 Workbook 流")

    records = list(_records(stream))
    encoding = _encoding_for_codepage(
        next((_u16(payload, 0) for _, code, payload in records if code == 0x0042 and len(payload) >= 2), 1252)
    )
    shared_strings = _parse_shared_strings(records, encoding)
    boundsheets = [
        (_u32(payload, 0), _read_boundsheet_name(payload, encoding))
        for _, code, payload in records
        if code == 0x0085 and len(payload) >= 8
    ]
    if not boundsheets:
        raise ValueError("Excel 工作簿中未找到工作表")

    workbook: dict[str, list[list[Any]]] = {}
    for stream_position, sheet_name in boundsheets:
        sheet_records = _records_from(stream, stream_position)
        workbook[sheet_name] = _parse_sheet(sheet_records, shared_strings, encoding)
    return workbook


def _parse_shared_strings(records: list[tuple[int, int, bytes]], encoding: str) -> list[str]:
    sst_index = next((index for index, (_, code, _) in enumerate(records) if code == 0x00FC), None)
    if sst_index is None:
        return []
    payloads = [records[sst_index][2]]
    index = sst_index + 1
    while index < len(records) and records[index][1] == 0x003C:
        payloads.append(records[index][2])
        index += 1
    reader = _RecordReader(payloads)
    if reader.remaining() < 8:
        return []
    _total = reader.u32()
    unique = reader.u32()
    values: list[str] = []
    for _ in range(unique):
        if reader.remaining() < 3:
            break
        count = reader.u16()
        options = reader.u8()
        rich_count = reader.u16() if options & 0x08 else 0
        extension_size = reader.u32() if options & 0x04 else 0
        text = reader.characters(count, bool(options & 0x01), encoding)
        if rich_count:
            reader.read(rich_count * 4)
        if extension_size:
            reader.read(extension_size)
        values.append(text)
    return values


def _parse_sheet(
    records: Iterable[tuple[int, int, bytes]],
    shared_strings: list[str],
    encoding: str,
) -> list[list[Any]]:
    cells: dict[int, dict[int, Any]] = {}
    for _, code, payload in records:
        if len(payload) < 6:
            continue
        if code == 0x00FD and len(payload) >= 10:
            row, column = _u16(payload, 0), _u16(payload, 2)
            shared_index = _u32(payload, 6)
            value = shared_strings[shared_index] if shared_index < len(shared_strings) else ""
            _set_cell(cells, row, column, value)
        elif code == 0x0204 and len(payload) >= 8:
            row, column = _u16(payload, 0), _u16(payload, 2)
            value, _ = _read_unicode_string(payload, 6, encoding)
            _set_cell(cells, row, column, value)
        elif code == 0x0203 and len(payload) >= 14:
            row, column = _u16(payload, 0), _u16(payload, 2)
            _set_cell(cells, row, column, struct.unpack_from("<d", payload, 6)[0])
        elif code == 0x027E and len(payload) >= 10:
            row, column = _u16(payload, 0), _u16(payload, 2)
            _set_cell(cells, row, column, _decode_rk(payload, 6))
        elif code == 0x00BD and len(payload) >= 12:
            row, first_column = _u16(payload, 0), _u16(payload, 2)
            last_column = _u16(payload, len(payload) - 2)
            offset = 4
            for column in range(first_column, last_column + 1):
                if offset + 6 > len(payload):
                    break
                _set_cell(cells, row, column, _decode_rk(payload, offset + 2))
                offset += 6
        elif code == 0x0205 and len(payload) >= 8:
            row, column = _u16(payload, 0), _u16(payload, 2)
            _set_cell(cells, row, column, bool(payload[6]) if payload[7] == 0 else "")
        elif code == 0x0006 and len(payload) >= 14:
            row, column = _u16(payload, 0), _u16(payload, 2)
            result = payload[6:14]
            if result[6:8] == b"\xff\xff":
                continue
            _set_cell(cells, row, column, struct.unpack("<d", result)[0])
    if not cells:
        return []
    max_row = max(cells)
    max_column = max(max(row) for row in cells.values())
    return [
        [cells.get(row, {}).get(column, "") for column in range(max_column + 1)]
        for row in range(max_row + 1)
    ]


def _set_cell(cells: dict[int, dict[int, Any]], row: int, column: int, value: Any) -> None:
    cells.setdefault(row, {})[column] = value


def _decode_rk(payload: bytes, offset: int) -> float:
    value = _u32(payload, offset)
    divided = bool(value & 0x01)
    is_integer = bool(value & 0x02)
    if is_integer:
        number = value >> 2
        if number & (1 << 29):
            number -= 1 << 30
        result = float(number)
    else:
        result = struct.unpack("<d", struct.pack("<II", 0, value & 0xFFFFFFFC))[0]
    return result / 100 if divided else result


def _records(data: bytes, offset: int = 0) -> Iterable[tuple[int, int, bytes]]:
    while offset + 4 <= len(data):
        code, size = struct.unpack_from("<HH", data, offset)
        payload_start = offset + 4
        payload_end = payload_start + size
        if payload_end > len(data):
            break
        yield offset, code, data[payload_start:payload_end]
        offset = payload_end


def _records_from(data: bytes, offset: int) -> Iterable[tuple[int, int, bytes]]:
    for record in _records(data, offset):
        yield record
        if record[1] == 0x000A:
            break


def _read_unicode_string(payload: bytes, offset: int, encoding: str = "cp1252") -> tuple[str, int]:
    if offset + 3 > len(payload):
        return "", len(payload)
    count = _u16(payload, offset)
    options = payload[offset + 2]
    cursor = offset + 3
    rich_count = _u16(payload, cursor) if options & 0x08 and cursor + 2 <= len(payload) else 0
    if options & 0x08:
        cursor += 2
    extension_size = _u32(payload, cursor) if options & 0x04 and cursor + 4 <= len(payload) else 0
    if options & 0x04:
        cursor += 4
    width = 2 if options & 0x01 else 1
    byte_count = count * width
    raw = payload[cursor:cursor + byte_count]
    text = raw.decode("utf-16le" if width == 2 else encoding, errors="replace")
    cursor += byte_count + rich_count * 4 + extension_size
    return text, cursor


def _read_boundsheet_name(payload: bytes, encoding: str) -> str:
    if len(payload) < 8:
        return ""
    count = payload[6]
    options = payload[7]
    width = 2 if options & 0x01 else 1
    raw = payload[8:8 + count * width]
    return raw.decode("utf-16le" if width == 2 else encoding, errors="replace")


def _u16(data: bytes, offset: int) -> int:
    return struct.unpack_from("<H", data, offset)[0]


def _u32(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


class _RecordReader:
    def __init__(self, payloads: list[bytes]) -> None:
        self.payloads = payloads
        self.record_index = 0
        self.offset = 0

    def remaining(self) -> int:
        return sum(len(payload) for payload in self.payloads[self.record_index:]) - self.offset

    def _advance(self) -> None:
        while self.record_index < len(self.payloads) and self.offset >= len(self.payloads[self.record_index]):
            self.record_index += 1
            self.offset = 0

    def read(self, size: int) -> bytes:
        chunks: list[bytes] = []
        while size > 0:
            self._advance()
            if self.record_index >= len(self.payloads):
                raise ValueError("Excel 共享字符串记录不完整")
            available = len(self.payloads[self.record_index]) - self.offset
            take = min(size, available)
            chunks.append(self.payloads[self.record_index][self.offset:self.offset + take])
            self.offset += take
            size -= take
        return b"".join(chunks)

    def u8(self) -> int:
        return self.read(1)[0]

    def u16(self) -> int:
        return _u16(self.read(2), 0)

    def u32(self) -> int:
        return _u32(self.read(4), 0)

    def characters(self, count: int, high_byte: bool, encoding: str) -> str:
        remaining = count
        chunks: list[str] = []
        while remaining:
            self._advance()
            if self.record_index >= len(self.payloads):
                raise ValueError("Excel 共享字符串记录不完整")
            width = 2 if high_byte else 1
            available = len(self.payloads[self.record_index]) - self.offset
            count_here = min(remaining, available // width)
            if count_here == 0:
                self._advance()
                if self.record_index >= len(self.payloads):
                    raise ValueError("Excel 共享字符串记录不完整")
                high_byte = bool(self.u8() & 0x01)
                continue
            raw = self.read(count_here * width)
            chunks.append(raw.decode("utf-16le" if high_byte else encoding, errors="replace"))
            remaining -= count_here
            if remaining:
                self._advance()
                if self.record_index >= len(self.payloads):
                    raise ValueError("Excel 共享字符串记录不完整")
                high_byte = bool(self.u8() & 0x01)
        return "".join(chunks)


class _CompoundFile:
    def __init__(self, data: bytes) -> None:
        if not data.startswith(OLE_MAGIC):
            raise ValueError("不是有效的 Excel OLE 工作簿")
        self.data = data
        self.sector_size = 1 << _u16(data, 30)
        self.mini_sector_size = 1 << _u16(data, 32)
        self.fat = self._read_fat()
        directory = self._read_chain(_u32(data, 48), self.fat)
        self.entries = self._read_directory(directory)
        root = next((entry for entry in self.entries if entry["type"] == 5), None)
        if root is None:
            raise ValueError("Excel OLE 工作簿缺少根目录")
        self.mini_stream = self._read_chain(root["start"], self.fat, root["size"])
        mini_fat_data = self._read_chain(_u32(data, 60), self.fat)
        self.mini_fat = [
            _u32(mini_fat_data, offset)
            for offset in range(0, len(mini_fat_data) - 3, 4)
        ]
        self.mini_cutoff = _u32(data, 56)

    def stream(self, name: str) -> bytes | None:
        wanted = name.casefold()
        entry = next((item for item in self.entries if item["type"] == 2 and item["name"].casefold() == wanted), None)
        if entry is None:
            return None
        if entry["size"] < self.mini_cutoff and self.mini_fat:
            return self._read_mini_chain(entry["start"], entry["size"])
        return self._read_chain(entry["start"], self.fat, entry["size"])

    def _read_fat(self) -> list[int]:
        difat = [
            _u32(self.data, 76 + offset)
            for offset in range(0, 109 * 4, 4)
            if _u32(self.data, 76 + offset) != FREE_SECTOR
        ]
        next_difat = _u32(self.data, 68)
        for _ in range(_u32(self.data, 72)):
            sector = self._sector(next_difat)
            slots = len(sector) // 4 - 1
            difat.extend(
                _u32(sector, offset)
                for offset in range(0, slots * 4, 4)
                if _u32(sector, offset) != FREE_SECTOR
            )
            next_difat = _u32(sector, slots * 4)
        fat: list[int] = []
        for sector_id in difat[:_u32(self.data, 44)]:
            sector = self._sector(sector_id)
            fat.extend(_u32(sector, offset) for offset in range(0, len(sector), 4))
        return fat

    def _read_directory(self, data: bytes) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        for offset in range(0, len(data) - 127, 128):
            name_size = _u16(data, offset + 64)
            name = data[offset:offset + max(0, name_size - 2)].decode("utf-16le", errors="ignore")
            entries.append({
                "name": name,
                "type": data[offset + 66],
                "start": _u32(data, offset + 116),
                "size": int.from_bytes(data[offset + 120:offset + 128], "little"),
            })
        return entries

    def _read_mini_chain(self, start: int, size: int) -> bytes:
        chunks: list[bytes] = []
        current = start
        seen: set[int] = set()
        while current not in {END_OF_CHAIN, FREE_SECTOR, NO_STREAM} and current not in seen and len(b"".join(chunks)) < size:
            seen.add(current)
            offset = current * self.mini_sector_size
            chunks.append(self.mini_stream[offset:offset + self.mini_sector_size])
            if current >= len(self.mini_fat):
                break
            current = self.mini_fat[current]
        return b"".join(chunks)[:size]

    def _read_chain(self, start: int, fat: list[int], size: int | None = None) -> bytes:
        chunks: list[bytes] = []
        current = start
        seen: set[int] = set()
        while current not in {END_OF_CHAIN, FREE_SECTOR, NO_STREAM} and current not in seen:
            seen.add(current)
            chunks.append(self._sector(current))
            if current >= len(fat):
                break
            current = fat[current]
        value = b"".join(chunks)
        return value if size is None else value[:size]

    def _sector(self, sector_id: int) -> bytes:
        offset = self.sector_size + sector_id * self.sector_size
        return self.data[offset:offset + self.sector_size]


def _encoding_for_codepage(codepage: int) -> str:
    return {
        932: "shift_jis",
        936: "gb18030",
        950: "big5",
        1200: "gb18030",
        1252: "cp1252",
    }.get(codepage, "cp1252")

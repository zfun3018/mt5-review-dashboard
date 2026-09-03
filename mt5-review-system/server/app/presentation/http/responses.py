from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus
from types import MappingProxyType
from typing import Any, Mapping


def _json_headers() -> Mapping[str, str]:
    return MappingProxyType({"Content-Type": "application/json; charset=utf-8"})


@dataclass(frozen=True)
class ApiResponse:
    status: HTTPStatus
    payload: dict[str, Any]
    headers: Mapping[str, str] = field(default_factory=_json_headers)


def ok(payload: dict[str, Any]) -> ApiResponse:
    return ApiResponse(HTTPStatus.OK, payload)


def created(payload: dict[str, Any]) -> ApiResponse:
    return ApiResponse(HTTPStatus.CREATED, payload)


def bad_request(message: str) -> ApiResponse:
    return ApiResponse(HTTPStatus.BAD_REQUEST, {"error": message})


def not_found(message: str = "Not found") -> ApiResponse:
    return ApiResponse(HTTPStatus.NOT_FOUND, {"error": message})


def internal_error() -> ApiResponse:
    return ApiResponse(
        HTTPStatus.INTERNAL_SERVER_ERROR,
        {"error": "Internal server error"},
    )

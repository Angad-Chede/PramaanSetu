"""Cursor pagination (PRD 9.1). No offset pagination on large tables."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from app.core.errors import ValidationFailed

T = TypeVar("T")

MAX_LIMIT = 100
DEFAULT_LIMIT = 50


def encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor: str | None) -> dict[str, Any] | None:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        return json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except Exception:
        raise ValidationFailed(
            "The page cursor is not valid.",
            errors=[
                {
                    "field": "cursor",
                    "detail": "The cursor could not be read.",
                    "fix": "Reload the list from the first page.",
                }
            ],
        ) from None


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


@dataclass
class Page(Generic[T]):
    items: list[T]
    next_cursor: str | None
    total_estimate: int | None = None


class PageResponse(BaseModel):
    items: list[Any]
    next_cursor: str | None = None
    total_estimate: int | None = None


def build_page(rows: list[Any], limit: int, cursor_fields: tuple[str, ...]) -> tuple[list[Any], str | None]:
    """Trim the over-fetched row and build the cursor from the last item returned."""
    has_more = len(rows) > limit
    items = rows[:limit]
    if not has_more or not items:
        return items, None
    last = items[-1]
    cursor = encode_cursor({field: getattr(last, field) for field in cursor_fields})
    return items, cursor

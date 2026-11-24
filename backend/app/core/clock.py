"""Time handling. Stored in UTC, displayed in IST (PRD 8.3)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

UTC = UTC
IST = timezone(timedelta(hours=5, minutes=30), name="IST")

_offset = timedelta(0)


def utcnow() -> datetime:
    """Current UTC time, shifted by any active demo offset."""
    return datetime.now(UTC) + _offset


def set_demo_offset(delta: timedelta) -> None:
    """Fast-forward the clock for demo and test purposes (PRD 5.9 acceptance criterion)."""
    global _offset
    _offset = delta


def get_demo_offset() -> timedelta:
    return _offset


def reset_demo_offset() -> None:
    set_demo_offset(timedelta(0))


def to_ist(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(IST)


def format_ist(value: datetime) -> str:
    return to_ist(value).strftime("%d %b %Y, %H:%M IST")


def ensure_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def days(n: float) -> timedelta:
    return timedelta(days=n)

"""Declarative base and the column conventions every business table follows.

Conventions from PRD section 8: UUID v7 string primary key, an integer version for
optimistic locking, created_at and updated_at in UTC, and soft delete via archived_at.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, String, TypeDecorator
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.clock import utcnow
from app.core.ids import uuid7str


class JsonDoc(TypeDecorator):
    """JSONB on PostgreSQL, JSON on SQLite. Same Python interface either way."""

    impl = postgresql.JSONB
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[no-untyped-def]
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.JSONB())
        from sqlalchemy import JSON

        return dialect.type_descriptor(JSON())


class UtcDateTime(TypeDecorator):
    """Timestamps always come back timezone-aware in UTC, on every engine."""

    impl = DateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):  # type: ignore[no-untyped-def]
        return dialect.type_descriptor(DateTime(timezone=True))

    def process_result_value(self, value, dialect):  # type: ignore[no-untyped-def]
        if value is None:
            return None
        if value.tzinfo is None:
            from app.core.clock import UTC

            return value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    # JSON columns are declared as plain list or dict; both map to JSONB on PostgreSQL.
    type_annotation_map = {
        dict[str, Any]: JsonDoc,
        list[Any]: JsonDoc,
        dict: JsonDoc,
        list: JsonDoc,
        datetime: UtcDateTime,
    }

    def as_dict(self, exclude: set[str] | None = None) -> dict[str, Any]:
        exclude = exclude or set()
        out: dict[str, Any] = {}
        for column in self.__table__.columns:
            if column.name in exclude:
                continue
            value = getattr(self, column.name)
            out[column.name] = value.isoformat() if isinstance(value, datetime) else value
        return out


class PkMixin:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid7str)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    archived_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


class VersionMixin:
    """Optimistic locking column. Every mutable resource exposes this as an ETag."""

    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class BusinessBase(Base, PkMixin, TimestampMixin, VersionMixin):
    __abstract__ = True

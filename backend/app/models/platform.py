"""Platform tables: audit chain, outbox, notifications, jobs, files, templates.

These carry the correctness guarantees in PRD sections 10.3 to 10.5 and 11.4.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.states import JobStatus
from app.models.base import Base, PkMixin, TimestampMixin, UtcDateTime


class AuditLog(Base):
    """Append-only, hash-chained record of every consequential action (PRD 11.4).

    The application database role is granted INSERT and SELECT on this table only; the
    grant is in infra/postgres/roles.sql. The chain is verified nightly and on demand.
    """

    __tablename__ = "audit_log"

    # BigInteger on PostgreSQL; SQLite only auto-increments a plain INTEGER primary key.
    seq: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(4), nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    department_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, index=True)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)

    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id", "seq"),)


class OutboxEvent(Base, PkMixin):
    """Written in the same transaction as the business change (PRD 10.4)."""

    __tablename__ = "outbox_event"

    aggregate_type: Mapped[str] = mapped_column(String(60), nullable=False)
    aggregate_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_outbox_unpublished", "published_at", "created_at"),)


class Job(Base, PkMixin, TimestampMixin):
    """Every asynchronous unit of work. Idempotent, retried with backoff (PRD 10.5)."""

    __tablename__ = "job"

    type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    queue: Mapped[str] = mapped_column(String(20), default="default", nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        String(20), default=JobStatus.QUEUED, nullable=False, index=True
    )
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    not_before: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True, unique=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)

    __table_args__ = (Index("ix_job_claim", "status", "queue", "not_before"),)


class Notification(Base, PkMixin):
    """Plain text, no emojis, no marketing language (FR-NT-04)."""

    __tablename__ = "notification"

    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    link: Mapped[str | None] = mapped_column(String(400), nullable=True)
    action_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    event_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    channel_email_sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    channel_sms_sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    __table_args__ = (
        # Consumers are idempotent on event id (PRD 10.4)
        UniqueConstraint("user_id", "event_id", name="uq_notification_event"),
        Index("ix_notification_inbox", "user_id", "read_at", "created_at"),
    )


class IdempotencyKey(Base):
    """A repeat within 24 hours returns the original response (PRD 9.1)."""

    __tablename__ = "idempotency_key"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    route: Mapped[str] = mapped_column(String(200), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(default=dict)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False, index=True)


class FileObject(Base, PkMixin, TimestampMixin):
    """Uploaded through pre-signed URLs, scanned before it becomes usable (PRD 9.2, 11.1)."""

    __tablename__ = "file_object"

    bucket: Mapped[str] = mapped_column(String(80), nullable=False)
    key: Mapped[str] = mapped_column(String(400), nullable=False)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    mime: Mapped[str] = mapped_column(String(120), nullable=False)
    scanned_status: Mapped[str] = mapped_column(String(20), default="Pending", nullable=False)
    purpose: Mapped[str] = mapped_column(String(40), default="attachment", nullable=False)
    owner_scope_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    owner_scope_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    uploaded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


class Template(Base, PkMixin):
    """Immutable versioned templates. A challenge records the versions it used (FR-CB-04)."""

    __tablename__ = "template"

    kind: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), default="en", nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[dict[str, Any]] = mapped_column(default=dict)
    source_note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    published_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    superseded_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    __table_args__ = (UniqueConstraint("kind", "version", "locale", name="uq_template_version"),)


class LeaderLock(Base):
    """Single-leader election for the scheduler; a standby takes over on expiry (PRD 7.3)."""

    __tablename__ = "leader_lock"

    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    holder: Mapped[str] = mapped_column(String(80), nullable=False)
    acquired_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    last_run_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

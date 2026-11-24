"""Transactional outbox (PRD 10.4).

Side effects are never triggered from request code. The request writes an outbox_event
row in the same transaction as the business change; the relay reads unpublished rows
with a batch claim, enqueues the corresponding jobs and marks them published.

An event is therefore emitted if and only if the change committed, and a relay crash
only delays events, never loses them.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.db import claim_rows
from app.core.logging import get_logger
from app.models.platform import OutboxEvent

log = get_logger(__name__)

# Every event type the platform emits. Consumers are idempotent on event id.
EVENT_TYPES = (
    "challenge.submitted",
    "challenge.returned",
    "challenge.published",
    "challenge.cancelled",
    "challenge.corrigendum",
    "challenge.clarification_answered",
    "challenge.applications_closed",
    "challenge.screened",
    "challenge.panel_assigned",
    "challenge.scores_locked",
    "challenge.shortlist_confirmed",
    "startup.registered",
    "startup.dpiit_checked",
    "startup.profile_changed",
    "application.submitted",
    "application.eligibility_decided",
    "application.eligibility_overridden",
    "pilot.created",
    "pilot.agreement_drafted",
    "pilot.agreement_approved",
    "pilot.agreement_accepted",
    "pilot.changes_requested",
    "pilot.paused",
    "pilot.resumed",
    "pilot.completed",
    "pilot.terminated",
    "pilot.metrics_ingested",
    "milestone.submitted",
    "milestone.accepted",
    "milestone.rejected",
    "milestone.payment_approved",
    "milestone.paid",
    "milestone.sla_reminder",
    "milestone.sla_breached",
    "evidence.generated",
    "evidence.signed_off",
    "scale.decided",
    "passport.issued",
    "passport.adoption_requested",
    "simulation.completed",
)


def emit(
    session: AsyncSession,
    *,
    aggregate_type: str,
    aggregate_id: str,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> OutboxEvent:
    """Add an event to the caller's transaction. Never awaits a network call."""
    event = OutboxEvent(
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        event_type=event_type,
        payload=payload or {},
        created_at=utcnow(),
    )
    session.add(event)
    return event


async def claim_unpublished(session: AsyncSession, limit: int = 100) -> list[OutboxEvent]:
    """Batch-claim with SKIP LOCKED so two relays never take the same row."""
    stmt = (
        select(OutboxEvent)
        .where(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at.asc())
    )
    return await claim_rows(session, stmt, limit=limit)


def mark_published(event: OutboxEvent) -> None:
    event.published_at = utcnow()


def mark_failed(event: OutboxEvent, error: str) -> None:
    event.attempts += 1
    event.last_error = error[:1000]


async def pending_count(session: AsyncSession) -> int:
    rows = await session.execute(
        select(OutboxEvent.id).where(OutboxEvent.published_at.is_(None)).limit(1000)
    )
    return len(list(rows.scalars().all()))


async def oldest_pending_age_seconds(session: AsyncSession) -> float:
    row = await session.execute(
        select(OutboxEvent.created_at)
        .where(OutboxEvent.published_at.is_(None))
        .order_by(OutboxEvent.created_at.asc())
        .limit(1)
    )
    created = row.scalar_one_or_none()
    if created is None:
        return 0.0
    return (utcnow() - created).total_seconds()

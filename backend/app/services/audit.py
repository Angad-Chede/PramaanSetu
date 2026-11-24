"""Hash-chained audit log (PRD 11.4).

record() is always called inside the same transaction as the business change, so the
audit entry exists if and only if the change committed. An advisory lock serialises
inserts, so the chain has no forks even under concurrent writes.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.db import advisory_lock
from app.core.logging import get_logger
from app.domain.hashchain import (
    GENESIS_HASH,
    ChainVerification,
    chain_payload,
    entry_digest,
    verify_chain,
)
from app.models.platform import AuditLog

log = get_logger(__name__)

AUDIT_LOCK_KEY = 917_324_501


async def record(
    session: AsyncSession,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    actor_id: str | None = None,
    actor_role: str | None = None,
    department_id: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    reason: str | None = None,
    request_id: str | None = None,
) -> AuditLog:
    """Append one entry to the chain. Must run inside the caller's transaction."""
    await advisory_lock(session, AUDIT_LOCK_KEY)

    result = await session.execute(
        select(AuditLog.hash).order_by(AuditLog.seq.desc()).limit(1)
    )
    prev_hash = result.scalar_one_or_none() or GENESIS_HASH

    at = utcnow()
    payload = chain_payload(
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        department_id=department_id,
        before=before,
        after=after,
        reason=reason,
        at=at.isoformat(),
    )
    digest = entry_digest(prev_hash, payload)

    entry = AuditLog(
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        department_id=department_id,
        before=before,
        after=after,
        reason=reason,
        request_id=request_id,
        at=at,
        prev_hash=prev_hash,
        hash=digest,
    )
    session.add(entry)
    await session.flush()
    return entry


async def head_hash(session: AsyncSession) -> str:
    result = await session.execute(select(AuditLog.hash).order_by(AuditLog.seq.desc()).limit(1))
    return result.scalar_one_or_none() or GENESIS_HASH


async def verify(session: AsyncSession, limit: int | None = None) -> ChainVerification:
    """Recompute the whole chain and report the first broken link (FR-AD-02)."""
    stmt = select(AuditLog).order_by(AuditLog.seq.asc())
    if limit:
        stmt = stmt.limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())
    payloads = [
        {
            "seq": row.seq,
            "actor_id": row.actor_id,
            "actor_role": row.actor_role,
            "action": row.action,
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "department_id": row.department_id,
            "before": row.before,
            "after": row.after,
            "reason": row.reason,
            "at": row.at.isoformat(),
            "prev_hash": row.prev_hash,
            "hash": row.hash,
        }
        for row in rows
    ]
    verification = verify_chain(payloads)
    if not verification.verified:
        log.error(
            "Audit chain verification failed",
            first_broken_seq=verification.first_broken_seq,
            entries_checked=verification.entries_checked,
        )
    return verification


async def count(session: AsyncSession) -> int:
    result = await session.execute(select(func.count()).select_from(AuditLog))
    return int(result.scalar_one())


async def entries_for(
    session: AsyncSession,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
    department_id: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    before_seq: int | None = None,
) -> list[AuditLog]:
    stmt = select(AuditLog).order_by(AuditLog.seq.desc()).limit(limit)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if department_id:
        stmt = stmt.where(AuditLog.department_id == department_id)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if before_seq:
        stmt = stmt.where(AuditLog.seq < before_seq)
    return list((await session.execute(stmt)).scalars().all())


def snapshot(entity: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    """Small before or after image. Full rows are not stored; only what changed matters."""
    out: dict[str, Any] = {}
    for field in fields:
        value = getattr(entity, field, None)
        isoformat = getattr(value, "isoformat", None)
        out[field] = isoformat() if callable(isoformat) else value
    return out

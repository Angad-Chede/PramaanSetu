"""Idempotency keys (PRD 9.1, 9.3).

A repeat of the same POST within 24 hours returns the original response. The same key
with a different body is a client bug and returns 422 rather than silently doing
something different from what the caller asked for.
"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import ValidationFailed
from app.core.hash import canonical
from app.models.platform import IdempotencyKey

RETENTION = timedelta(hours=24)


def request_fingerprint(route: str, payload: Any) -> str:
    return hashlib.sha256((route + "|" + canonical(payload)).encode("utf-8")).hexdigest()


async def replay(
    session: AsyncSession, key: str | None, user_id: str, route: str, payload: Any
) -> dict[str, Any] | None:
    """Return the stored response for a repeated key, or None if this is the first call."""
    if not key:
        return None
    row = await session.get(IdempotencyKey, {"key": key, "user_id": user_id})
    if row is None:
        return None
    if row.expires_at <= utcnow():
        await session.delete(row)
        await session.flush()
        return None
    fingerprint = request_fingerprint(route, payload)
    if row.request_hash != fingerprint:
        raise ValidationFailed(
            "This idempotency key was already used for a different request.",
            errors=[
                {
                    "field": "Idempotency-Key",
                    "detail": "The key " + key + " is already bound to another request body.",
                    "fix": "Use a new idempotency key for a new request.",
                }
            ],
        )
    return {"status_code": row.status_code, "response": row.response}


async def remember(
    session: AsyncSession,
    key: str | None,
    user_id: str,
    route: str,
    payload: Any,
    status_code: int,
    response: Any,
) -> None:
    if not key:
        return
    now = utcnow()
    record = IdempotencyKey(
        key=key,
        user_id=user_id,
        route=route,
        request_hash=request_fingerprint(route, payload),
        status_code=status_code,
        response=json.loads(json.dumps(response, default=str)),
        created_at=now,
        expires_at=now + RETENTION,
    )
    session.add(record)
    try:
        await session.flush()
    except IntegrityError:
        # Two identical requests raced; the first one wins and this one is a no-op.
        await session.rollback()


async def purge_expired(session: AsyncSession) -> int:
    result = await session.execute(
        delete(IdempotencyKey).where(IdempotencyKey.expires_at <= utcnow())
    )
    return int(result.rowcount or 0)


async def count_active(session: AsyncSession) -> int:
    rows = await session.execute(select(IdempotencyKey.key).where(IdempotencyKey.expires_at > utcnow()))
    return len(list(rows.scalars().all()))

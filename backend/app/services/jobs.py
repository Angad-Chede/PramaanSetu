"""Asynchronous job framework (PRD 7.5, 10.5).

Queues mirror the Celery topology in the PRD: critical, default, ai, compute, docs.
Running under Celery with Redis swaps the runner, not these semantics:

- a task is acknowledged only after it finishes, so a crashed worker's task is redelivered
- every task is idempotent: it checks the job row and the target entity before acting
- retries use exponential backoff with jitter, transient errors only
- after the last attempt the job moves to a dead-letter state, visible in the admin console
- each queue has a hard time limit so a stuck worker cannot hold a slot for ever
"""

from __future__ import annotations

import random
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import claim_rows
from app.domain.states import JobStatus
from app.models.platform import Job

QUEUES = ("critical", "default", "ai", "compute", "docs")

BACKOFF_SECONDS = (2, 4, 8, 16, 32)


async def enqueue(
    session: AsyncSession,
    *,
    job_type: str,
    payload: dict[str, Any] | None = None,
    queue: str = "default",
    created_by: str | None = None,
    dedupe_key: str | None = None,
    delay_seconds: int = 0,
    max_attempts: int | None = None,
) -> Job:
    """Create a job row. Called inside the caller's transaction, never over the network."""
    if dedupe_key:
        existing = await session.execute(select(Job).where(Job.dedupe_key == dedupe_key))
        found = existing.scalar_one_or_none()
        if found is not None:
            return found

    job = Job(
        type=job_type,
        queue=queue if queue in QUEUES else "default",
        status=JobStatus.QUEUED,
        payload=payload or {},
        created_by=created_by,
        dedupe_key=dedupe_key,
        max_attempts=max_attempts or settings.job_max_attempts,
        not_before=utcnow() + timedelta(seconds=delay_seconds) if delay_seconds else None,
    )
    session.add(job)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await session.execute(select(Job).where(Job.dedupe_key == dedupe_key))
        found = existing.scalar_one_or_none()
        if found is not None:
            return found
        raise
    return job


async def claim(session: AsyncSession, queues: tuple[str, ...], limit: int = 1) -> list[Job]:
    """Claim runnable jobs without two runners taking the same row."""
    now = utcnow()
    stmt = (
        select(Job)
        .where(Job.status == JobStatus.QUEUED)
        .where(Job.queue.in_(queues))
        .where((Job.not_before.is_(None)) | (Job.not_before <= now))
        .order_by(Job.created_at.asc())
    )
    jobs = await claim_rows(session, stmt, limit=limit)
    for job in jobs:
        job.status = JobStatus.RUNNING
        job.started_at = now
        job.attempts += 1
    await session.flush()
    return jobs


def succeed(job: Job, result: dict[str, Any] | None = None) -> None:
    job.status = JobStatus.SUCCEEDED
    job.result = result or {}
    job.progress = 100
    job.finished_at = utcnow()
    job.error = None


def fail(job: Job, error: str, *, retryable: bool = True) -> None:
    """Retry transient errors with exponential backoff and jitter; fail validation at once."""
    job.error = error[:2000]
    if not retryable or job.attempts >= job.max_attempts:
        job.status = JobStatus.DEAD_LETTER if retryable else JobStatus.FAILED
        job.finished_at = utcnow()
        return
    index = min(job.attempts - 1, len(BACKOFF_SECONDS) - 1)
    delay = BACKOFF_SECONDS[index] * (0.75 + random.random() * 0.5)
    job.status = JobStatus.QUEUED
    job.not_before = utcnow() + timedelta(seconds=delay)


def progress(job: Job, percent: int) -> None:
    job.progress = max(0, min(100, int(percent)))


async def get(session: AsyncSession, job_id: str) -> Job | None:
    return await session.get(Job, job_id)


async def queue_depth(session: AsyncSession) -> dict[str, int]:
    rows = await session.execute(
        select(Job.queue, func.count())
        .where(Job.status == JobStatus.QUEUED)
        .group_by(Job.queue)
    )
    depths = {queue: 0 for queue in QUEUES}
    for queue, count in rows.all():
        depths[queue] = int(count)
    return depths


async def oldest_job_age_seconds(session: AsyncSession, queue: str) -> float:
    row = await session.execute(
        select(Job.created_at)
        .where(Job.status == JobStatus.QUEUED, Job.queue == queue)
        .order_by(Job.created_at.asc())
        .limit(1)
    )
    created = row.scalar_one_or_none()
    return 0.0 if created is None else (utcnow() - created).total_seconds()


async def dead_letters(session: AsyncSession, limit: int = 50) -> list[Job]:
    rows = await session.execute(
        select(Job)
        .where(Job.status.in_((JobStatus.DEAD_LETTER, JobStatus.FAILED)))
        .order_by(Job.updated_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def retry_job(session: AsyncSession, job_id: str) -> Job | None:
    """Manual replay from the admin console (PRD 13.5 runbook)."""
    job = await session.get(Job, job_id)
    if job is None:
        return None
    job.status = JobStatus.QUEUED
    job.attempts = 0
    job.error = None
    job.not_before = None
    job.finished_at = None
    await session.flush()
    return job


def time_limit_for(queue: str) -> int:
    return settings.queue_time_limits.get(queue, 60)

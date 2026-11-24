"""Scheduler (PRD 7.3, 10.4, 10.5).

Exactly one instance is active at a time. Leadership is a row in leader_lock with an
expiry; a standby takes over when the lease lapses. Combined with the batch claim and
the escalation-level check inside each transaction, this is what makes NFR-11 hold:
every service-level escalation fires exactly once.

    python -m app.workers.scheduler
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import session_scope
from app.core.logging import configure_logging, get_logger
from app.models.platform import LeaderLock
from app.services import jobs as jobs_service

log = get_logger(__name__)

LOCK_NAME = "scheduler"
LEASE_SECONDS = 45


class Scheduler:
    def __init__(self) -> None:
        self.identity = os.environ.get("HOSTNAME", "local") + ":" + str(os.getpid())
        self._stopping = asyncio.Event()
        self._task: asyncio.Task[Any] | None = None
        self._last_sla_scan = utcnow() - timedelta(seconds=settings.sla_scan_seconds)
        self._last_daily = utcnow() - timedelta(days=1)
        self.is_leader = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="scheduler")
        log.info("Scheduler started", identity=self.identity)

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self._release()
        log.info("Scheduler stopped", identity=self.identity)

    async def _loop(self) -> None:
        while not self._stopping.is_set():
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("Scheduler tick failed", error=str(exc))
            await asyncio.sleep(settings.outbox_relay_seconds)

    async def tick(self) -> dict[str, Any]:
        """One scheduler cycle. Safe to call directly from tests."""
        if not await self._acquire():
            self.is_leader = False
            return {"leader": False}
        self.is_leader = True
        now = utcnow()
        result: dict[str, Any] = {"leader": True}

        # The outbox relay runs every cycle; it is on the critical queue.
        async with session_scope() as session:
            await jobs_service.enqueue(
                session,
                job_type="platform.relay_outbox",
                queue="critical",
                payload={"limit": 200},
                dedupe_key="relay:" + now.strftime("%Y%m%d%H%M%S"),
            )
        result["relay_queued"] = True

        if (now - self._last_sla_scan).total_seconds() >= settings.sla_scan_seconds:
            self._last_sla_scan = now
            async with session_scope() as session:
                await jobs_service.enqueue(
                    session,
                    job_type="platform.scan_slas",
                    queue="critical",
                    payload={},
                    dedupe_key="sla:" + now.strftime("%Y%m%d%H%M"),
                )
                await jobs_service.enqueue(
                    session,
                    job_type="platform.close_deadlines",
                    queue="critical",
                    payload={},
                    dedupe_key="deadlines:" + now.strftime("%Y%m%d%H%M"),
                )
            result["sla_scan_queued"] = True

        if (now - self._last_daily).total_seconds() >= 86400:
            self._last_daily = now
            async with session_scope() as session:
                await jobs_service.enqueue(
                    session,
                    job_type="platform.verify_audit_chain",
                    queue="default",
                    payload={},
                    dedupe_key="chain:" + now.date().isoformat(),
                )
                await jobs_service.enqueue(
                    session,
                    job_type="platform.purge_idempotency",
                    queue="default",
                    payload={},
                    dedupe_key="purge:" + now.date().isoformat(),
                )
                if settings.feature_daily_digest:
                    await jobs_service.enqueue(
                        session,
                        job_type="notify.digest",
                        queue="default",
                        payload={},
                        dedupe_key="digest:" + now.date().isoformat(),
                    )
            result["daily_queued"] = True

        return result

    async def _acquire(self) -> bool:
        """Take or renew the lease. A standby wins only after the holder's lease lapses."""
        now = utcnow()
        async with session_scope() as session:
            row = await session.get(LeaderLock, LOCK_NAME, with_for_update=True) if not settings.is_sqlite else await session.get(LeaderLock, LOCK_NAME)
            if row is None:
                session.add(
                    LeaderLock(
                        name=LOCK_NAME,
                        holder=self.identity,
                        acquired_at=now,
                        expires_at=now + timedelta(seconds=LEASE_SECONDS),
                        last_run_at=now,
                    )
                )
                return True
            if row.holder == self.identity or row.expires_at <= now:
                if row.holder != self.identity:
                    log.info("Scheduler leadership taken over", from_holder=row.holder, to=self.identity)
                row.holder = self.identity
                row.expires_at = now + timedelta(seconds=LEASE_SECONDS)
                row.last_run_at = now
                return True
            return False

    async def _release(self) -> None:
        async with session_scope() as session:
            row = await session.get(LeaderLock, LOCK_NAME)
            if row is not None and row.holder == self.identity:
                row.expires_at = utcnow()


async def leadership_status() -> dict[str, Any]:
    async with session_scope() as session:
        result = await session.execute(select(LeaderLock).where(LeaderLock.name == LOCK_NAME))
        row = result.scalar_one_or_none()
        if row is None:
            return {"holder": None, "healthy": False, "detail": "No scheduler has ever run."}
        age = (utcnow() - (row.last_run_at or row.acquired_at)).total_seconds()
        return {
            "holder": row.holder,
            "acquired_at": row.acquired_at.isoformat(),
            "expires_at": row.expires_at.isoformat(),
            "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
            "seconds_since_last_run": round(age, 1),
            # Alert fires when no scan has completed in 15 minutes (PRD 13.2).
            "healthy": age < 900,
        }


async def _main() -> None:
    configure_logging()
    scheduler = Scheduler()
    await scheduler.start()

    stop = asyncio.Event()

    def _handle_signal(*_: Any) -> None:
        stop.set()

    with contextlib.suppress(NotImplementedError, AttributeError):
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _handle_signal)

    await stop.wait()
    await scheduler.stop()


if __name__ == "__main__":
    asyncio.run(_main())

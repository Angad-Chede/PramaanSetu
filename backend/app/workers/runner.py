"""Job runner (PRD 7.3, 10.5).

Claims jobs per queue with a hard time limit each, acknowledges only after the handler
finishes, and retries transient failures with exponential backoff and jitter.

Run in-process with the API for local development, or as its own process, one per queue
group, for the deployment topology in PRD 7.6:

    python -m app.workers.runner --queues compute,ai
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import os
import signal
from typing import Any

from app.core.config import settings
from app.core.db import session_scope
from app.core.errors import AppError
from app.core.logging import configure_logging, get_logger
from app.domain.states import JobStatus
from app.services import jobs as jobs_service
from app.workers import tasks

log = get_logger(__name__)

# Periodic housekeeping jobs. When these report that they did nothing, that is the
# expected case and is logged at debug rather than info.
QUIET_WHEN_IDLE = frozenset(
    {
        "platform.relay_outbox",
        "platform.scan_slas",
        "platform.close_deadlines",
        "platform.purge_idempotency",
    }
)

DEFAULT_QUEUE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("critical",),
    ("default",),
    ("ai",),
    ("compute",),
    ("docs",),
)


class JobRunner:
    """One asynchronous worker loop per queue group, with a per-queue concurrency cap."""

    def __init__(self, queue_groups: tuple[tuple[str, ...], ...] | None = None) -> None:
        self.queue_groups = queue_groups or DEFAULT_QUEUE_GROUPS
        self._stopping = asyncio.Event()
        self._loops: list[asyncio.Task[Any]] = []
        self.worker_id = os.environ.get("HOSTNAME", "local") + ":" + str(os.getpid())

    async def start(self) -> None:
        for group in self.queue_groups:
            self._loops.append(asyncio.create_task(self._loop(group), name="runner-" + group[0]))
        log.info("Job runner started", queues=[g[0] for g in self.queue_groups], worker=self.worker_id)

    async def stop(self) -> None:
        self._stopping.set()
        for task in self._loops:
            task.cancel()
        for task in self._loops:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._loops.clear()
        log.info("Job runner stopped", worker=self.worker_id)

    async def _loop(self, queues: tuple[str, ...]) -> None:
        idle_delay = 0.4
        while not self._stopping.is_set():
            try:
                processed = await self.run_once(queues)
                if processed == 0:
                    await asyncio.sleep(idle_delay)
                    idle_delay = min(idle_delay * 1.5, 3.0)
                else:
                    idle_delay = 0.2
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("Job loop error", queues=list(queues), error=str(exc))
                await asyncio.sleep(2.0)

    async def run_once(self, queues: tuple[str, ...], limit: int = 1) -> int:
        """Claim and execute up to `limit` jobs. Returns how many ran."""
        claimed: list[str] = []
        async with session_scope() as session:
            jobs_claimed = await jobs_service.claim(session, queues, limit=limit)
            claimed = [job.id for job in jobs_claimed]
        if not claimed:
            return 0

        for job_id in claimed:
            await self._execute(job_id)
        return len(claimed)

    async def _execute(self, job_id: str) -> None:
        async with session_scope() as session:
            job = await jobs_service.get(session, job_id)
            if job is None or job.status != JobStatus.RUNNING:
                return
            handler = tasks.get_handler(job.type)
            if handler is None:
                jobs_service.fail(job, "No handler registered for " + job.type, retryable=False)
                log.error("Unknown job type", job_id=job.id, job_type=job.type)
                return

            limit = jobs_service.time_limit_for(job.queue)
            try:
                result = await asyncio.wait_for(handler(session, job.payload or {}), timeout=limit)
                payload_out = result if isinstance(result, dict) else {"result": result}
                jobs_service.succeed(job, payload_out)
                # A periodic sweep that found nothing is not news. Logging every pass of
                # the outbox relay writes about thirty lines a minute saying nothing
                # happened, which buries the lines that do matter.
                if job.type in QUIET_WHEN_IDLE and not any(payload_out.values()):
                    log.debug("Job completed with nothing to do", job_id=job.id, job_type=job.type)
                else:
                    log.info(
                        "Job completed",
                        job_id=job.id,
                        job_type=job.type,
                        queue=job.queue,
                        attempts=job.attempts,
                    )
            except TimeoutError:
                jobs_service.fail(
                    job, "Exceeded the " + str(limit) + " second time limit for queue " + job.queue
                )
                log.warning("Job timed out", job_id=job.id, job_type=job.type, limit_seconds=limit)
            except AppError as exc:
                # Validation and permission failures are not transient; do not retry.
                jobs_service.fail(job, str(exc), retryable=False)
                log.warning("Job failed permanently", job_id=job.id, job_type=job.type, error=str(exc))
            except Exception as exc:
                jobs_service.fail(job, repr(exc))
                log.exception("Job failed", job_id=job.id, job_type=job.type)


async def drain(
    queues: tuple[str, ...] = ("critical", "default", "ai", "compute", "docs"),
    max_jobs: int = 500,
    relay: bool = True,
) -> int:
    """Run the system to quiescence: relay the outbox, run every job, repeat.

    A job can emit further events, and an event can enqueue further jobs, so this loops
    until neither is left. Used by the seed script, the demo script and the tests, where
    waiting on the background loops would be slower and less deterministic.
    """
    from app.services import jobs as jobs_service
    from app.services import outbox

    runner = JobRunner()
    processed = 0
    for _ in range(max_jobs):
        if relay:
            async with session_scope() as session:
                pending = await outbox.pending_count(session)
                if pending:
                    await jobs_service.enqueue(
                        session,
                        job_type="platform.relay_outbox",
                        queue="critical",
                        payload={"limit": 200},
                    )
        count = await runner.run_once(queues, limit=1)
        if count == 0:
            if not relay:
                break
            async with session_scope() as session:
                if await outbox.pending_count(session) == 0:
                    break
            continue
        processed += count
    return processed


async def _main() -> None:
    parser = argparse.ArgumentParser(description="PramaanSetu job runner")
    parser.add_argument(
        "--queues",
        default="critical,default,ai,compute,docs",
        help="Comma-separated queue names this worker serves.",
    )
    args = parser.parse_args()
    configure_logging()

    groups = tuple((name.strip(),) for name in args.queues.split(",") if name.strip())
    runner = JobRunner(groups)
    await runner.start()

    stop = asyncio.Event()

    def _handle_signal(*_: Any) -> None:
        stop.set()

    with contextlib.suppress(NotImplementedError, AttributeError):
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _handle_signal)

    await stop.wait()
    await runner.stop()


if __name__ == "__main__":
    if not settings.job_runner_enabled:
        raise SystemExit("Job runner is disabled by configuration.")
    asyncio.run(_main())

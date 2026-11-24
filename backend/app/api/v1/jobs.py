"""Asynchronous job status (PRD 7.5).

The browser polls this endpoint every two seconds, or subscribes to the server-sent
event stream. Users keep working while jobs run.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.api.common import iso
from app.core.db import session_scope
from app.core.deps import PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound
from app.domain.states import JobStatus
from app.services import jobs as jobs_service
from app.services import simulation as simulation_service

router = APIRouter(tags=["jobs"])


def _job_view(job: Any) -> dict[str, Any]:
    return {
        "id": job.id,
        "type": job.type,
        "queue": job.queue,
        "status": job.status,
        "progress": job.progress,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "result": job.result,
        "error": job.error,
        "created_at": iso(job.created_at),
        "started_at": iso(job.started_at),
        "finished_at": iso(job.finished_at),
        "done": job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.DEAD_LETTER),
    }


@router.get("/jobs/{job_id}", summary="Job status")
async def get_job(job_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    job = await jobs_service.get(session, job_id)
    if job is None:
        raise NotFound("This job was not found. Jobs are retained while they are relevant.")
    if job.created_by and job.created_by != principal.user_id and not principal.is_admin():
        raise Forbidden("This job was started by another user.")
    return _job_view(job)


@router.get("/jobs/{job_id}/events", summary="Server-sent events for a job")
async def job_events(job_id: str, principal: PrincipalDep) -> StreamingResponse:
    async def stream() -> AsyncIterator[bytes]:
        for _ in range(120):  # at most two minutes
            async with session_scope() as session:
                job = await jobs_service.get(session, job_id)
                if job is None:
                    yield b'event: error\ndata: {"detail":"Job not found."}\n\n'
                    return
                payload = _job_view(job)
            yield ("data: " + json.dumps(payload, default=str) + "\n\n").encode("utf-8")
            if payload["done"]:
                return
            await asyncio.sleep(1.0)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/simulations/{run_id}", summary="Simulation run and its results")
async def get_simulation(
    run_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    run = await simulation_service.get_run(session, run_id)
    from app.core.policy import require
    from app.services import pilots as pilots_service

    pilot = await pilots_service.get(session, run.pilot_id)
    require(
        principal,
        "simulation:read",
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )

    body: dict[str, Any] = {
        "id": run.id,
        "pilot_id": run.pilot_id,
        "status": run.status,
        "seed": run.seed,
        "iterations": run.iterations,
        "engine_version": run.engine_version,
        "runtime_ms": run.runtime_ms,
        "inputs": run.inputs,
        "results": run.results,
        "error": run.error,
        "created_at": iso(run.created_at),
    }

    if run.status == "Succeeded" and run.results:
        from app.models.challenge import Kpi

        design_kpi_id = (run.inputs or {}).get("primary_kpi_id")
        kpi = await session.get(Kpi, design_kpi_id) if design_kpi_id else None
        if kpi is None:
            challenge = pilot.challenge
            kpi = challenge.primary_kpi if challenge else None
        body["explanation"] = simulation_service.explain(
            run.results, kpi.name if kpi else "the primary measure", kpi.unit if kpi else ""
        )
    return body

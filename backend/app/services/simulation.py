"""Pilot Flight Simulator service (PRD 5.6).

Simulation runs are asynchronous jobs: the API creates the run and returns immediately,
the worker computes it, and the browser polls the job. Inputs and the seed are stored
with every run, so any result can be reproduced exactly.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import NotFound, ValidationFailed
from app.core.policy import Principal
from app.domain.simulator import SimulationInputs, run_simulation
from app.models.application import Application
from app.models.challenge import Challenge, Kpi
from app.models.pilot import MetricSubmission, Pilot
from app.models.simulation import SimulationRun
from app.services import audit, jobs, outbox

ANALYSIS_METHOD_FOR_KIND = {"proportion": "two_proportion", "continuous": "paired_t"}


async def prepare_inputs(
    session: AsyncSession,
    pilot: Pilot,
    *,
    overrides: dict[str, Any] | None = None,
) -> tuple[SimulationInputs, Kpi, Challenge, int]:
    """Assemble the simulator inputs from the challenge, the proposal and any overrides."""
    challenge = await session.get(Challenge, pilot.challenge_id)
    if challenge is None:
        raise NotFound("The challenge for this pilot was not found.")
    primary = challenge.primary_kpi
    if primary is None:
        raise ValidationFailed(
            "This challenge has no primary measure, so a pilot cannot be designed.",
            errors=[
                {
                    "field": "kpis",
                    "detail": "No measure is marked as primary.",
                    "fix": "Mark one measure as primary on the challenge.",
                }
            ],
        )

    application = await session.get(Application, pilot.application_id)
    claimed_value = None
    for commitment in (application.kpi_commitments if application else []) or []:
        if str(commitment.get("kpi_id")) == primary.id:
            try:
                claimed_value = float(commitment.get("committed_value"))
            except (TypeError, ValueError):
                claimed_value = None

    measured_baseline = await _measured_baseline(session, pilot.id, primary.id)
    baseline_mean = (
        measured_baseline[0]
        if measured_baseline
        else (float(primary.baseline_value) if primary.baseline_value is not None else 0.0)
    )
    baseline_sd = (
        measured_baseline[1]
        if measured_baseline and measured_baseline[1] > 0
        else (float(primary.baseline_sd) if primary.baseline_sd is not None else max(abs(baseline_mean) * 0.25, 1.0))
    )
    baseline_confidence = "measured" if measured_baseline else "estimated_low"

    if claimed_value is None and primary.target_value is not None:
        claimed_value = float(primary.target_value)
    claimed_effect = (claimed_value - baseline_mean) if claimed_value is not None else 0.0

    duration = challenge.pilot_duration_weeks or 8
    cost_per_unit_week = 0
    if application is not None and application.pilot_cost_paise and duration:
        cost_per_unit_week = int(application.pilot_cost_paise / max(duration * 20, 1))

    base = {
        "baseline_mean": baseline_mean,
        "baseline_sd": baseline_sd,
        "claimed_effect": claimed_effect,
        "direction": primary.direction,
        "kpi_kind": primary.kind,
        "duration_weeks": duration,
        "units": 20,
        "comparison_units": 0,
        "measurements_per_week": 1,
        "cost_per_unit_week_paise": cost_per_unit_week,
        "fixed_cost_paise": 0,
        "within_unit_share": 0.5,
        "realism_factor": settings.simulation_realism_factor,
        "effect_uncertainty": 0.25,
        "alpha": settings.simulation_alpha,
        "baseline_confidence": baseline_confidence,
        "min_duration_weeks": 4,
        "iterations": settings.simulation_iterations,
        "seed": settings.default_seed,
    }
    base.update({k: v for k, v in (overrides or {}).items() if k in base})

    if not base["claimed_effect"]:
        raise ValidationFailed(
            "No improvement has been claimed for the primary measure, so there is nothing to "
            "test for.",
            errors=[
                {
                    "field": "claimed_effect",
                    "detail": "The proposal carries no committed value for the primary measure, "
                    "and the challenge has no target.",
                    "fix": "Set a target on the challenge, or enter the expected improvement "
                    "directly in the simulator.",
                }
            ],
        )

    return SimulationInputs(**base), primary, challenge, challenge.budget_ceiling_paise


async def _measured_baseline(
    session: AsyncSession, pilot_id: str, kpi_id: str
) -> tuple[float, float] | None:
    import numpy as np

    rows = await session.execute(
        select(MetricSubmission.unit_ref, MetricSubmission.value).where(
            MetricSubmission.pilot_id == pilot_id,
            MetricSubmission.kpi_id == kpi_id,
            MetricSubmission.phase == "baseline",
            MetricSubmission.status == "Accepted",
        )
    )
    buckets: dict[str, list[float]] = {}
    for unit_ref, value in rows.all():
        buckets.setdefault(unit_ref, []).append(float(value))
    if len(buckets) < 2:
        return None
    means = [float(np.mean(values)) for values in buckets.values()]
    return (float(np.mean(means)), float(np.std(means, ddof=1)))


async def queue_run(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    inputs: SimulationInputs,
    what_if: list[tuple[int, int]] | None = None,
    budget_ceiling_paise: int = 0,
) -> tuple[SimulationRun, Any]:
    """Create the run row and the job. Results appear within seconds (FR-PS-06)."""
    run = SimulationRun(
        pilot_id=pilot.id,
        kind="pilot",
        inputs={
            **inputs.to_dict(),
            "what_if": [list(pair) for pair in (what_if or [])],
            "budget_ceiling_paise": budget_ceiling_paise,
            "target_power": settings.simulation_target_power,
        },
        seed=inputs.seed,
        iterations=inputs.iterations,
        status="Queued",
        engine_version=settings.engine_version,
        created_by=principal.user_id,
    )
    session.add(run)
    await session.flush()

    job = await jobs.enqueue(
        session,
        job_type="simulation.run",
        queue="compute",
        payload={"run_id": run.id, "pilot_id": pilot.id},
        created_by=principal.user_id,
    )
    await audit.record(
        session,
        action="simulation.queued",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role="DO",
        department_id=pilot.department_id,
        after={"run_id": run.id, "seed": run.seed, "iterations": run.iterations},
    )
    return run, job


async def execute_run(session: AsyncSession, run_id: str) -> SimulationRun:
    """Idempotent worker body: a completed run is returned as it stands."""
    run = await session.get(SimulationRun, run_id)
    if run is None:
        raise NotFound("Simulation run " + run_id + " was not found.")
    if run.status == "Succeeded":
        return run

    run.status = "Running"
    await session.flush()

    payload = dict(run.inputs or {})
    what_if_raw = payload.pop("what_if", [])
    budget = int(payload.pop("budget_ceiling_paise", 0) or 0)
    target_power = float(payload.pop("target_power", settings.simulation_target_power))
    inputs = SimulationInputs(**{k: v for k, v in payload.items() if k in SimulationInputs.__annotations__})

    output = run_simulation(
        inputs,
        budget_ceiling_paise=budget,
        target_power=target_power,
        what_if=[(int(a), int(b)) for a, b in what_if_raw],
    )
    run.results = output.to_dict()
    run.runtime_ms = output.runtime_ms
    run.status = "Succeeded"
    await session.flush()

    outbox.emit(
        session,
        aggregate_type="pilot",
        aggregate_id=run.pilot_id,
        event_type="simulation.completed",
        payload={
            "run_id": run.id,
            "power": output.proposed.get("power"),
            "recommendation_found": output.recommendation_found,
        },
    )
    return run


async def get_run(session: AsyncSession, run_id: str) -> SimulationRun:
    run = await session.get(SimulationRun, run_id)
    if run is None:
        raise NotFound("This simulation run was not found.")
    return run


async def runs_for_pilot(session: AsyncSession, pilot_id: str, limit: int = 20) -> list[SimulationRun]:
    rows = await session.execute(
        select(SimulationRun)
        .where(SimulationRun.pilot_id == pilot_id)
        .order_by(SimulationRun.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


def explain(output: dict[str, Any], kpi_name: str, unit: str) -> list[str]:
    """Plain-language reading of the numbers, for an officer with no statistics background."""
    proposed = output.get("proposed", {})
    power = float(proposed.get("power", 0.0))
    lines = [
        "If the solution really delivers the improvement it claims, this design would detect it "
        "in about " + str(round(power * 100)) + " of every 100 pilots.",
        "The smallest improvement this design can reliably detect is "
        + str(proposed.get("minimum_detectable_effect"))
        + " " + unit + " on " + kpi_name + ". Anything smaller would be lost in normal variation.",
    ]
    if power < 0.5:
        lines.append(
            "At this power, a pilot that misses the target tells you almost nothing: you would "
            "not know whether the solution failed or the pilot was too small to see the change."
        )
    elif power < 0.8:
        lines.append(
            "At this power, there is a real chance of a genuine improvement going undetected. "
            "Compare the recommended design before freezing."
        )
    else:
        lines.append("This design is strong enough to support a defensible decision.")
    return lines

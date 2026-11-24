"""Pilot endpoints: simulator, design freeze, agreement, lifecycle and metric capture."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query, Request, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.common import iso, money, run_action, set_etag
from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import lock_row
from app.core.deps import CsrfDep, IdempotencyDep, IfMatchDep, PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.money import rupees_to_paise
from app.core.policy import require
from app.core.security import hash_token
from app.domain.states import PilotState, Role, available_actions
from app.models.challenge import Kpi
from app.models.pilot import Pilot
from app.services import payments as payments_service
from app.services import pilots as pilots_service
from app.services import simulation as simulation_service
from app.services import templates as templates_service

router = APIRouter(prefix="/pilots", tags=["pilots"])


# --- Request models --------------------------------------------------------


class SimulationIn(BaseModel):
    duration_weeks: int | None = Field(default=None, ge=1, le=52)
    units: int | None = Field(default=None, ge=2, le=500)
    comparison_units: int | None = Field(default=None, ge=0, le=500)
    measurements_per_week: int | None = Field(default=None, ge=1, le=7)
    baseline_mean: float | None = None
    baseline_sd: float | None = Field(default=None, gt=0)
    claimed_effect: float | None = None
    cost_per_unit_week_rupees: float | None = Field(default=None, ge=0)
    fixed_cost_rupees: float | None = Field(default=None, ge=0)
    within_unit_share: float | None = Field(default=None, gt=0, lt=1)
    realism_factor: float | None = Field(default=None, gt=0, le=1)
    effect_uncertainty: float | None = Field(default=None, ge=0, le=1)
    baseline_confidence: str | None = Field(default=None, pattern="^(measured|estimated_high|estimated_low)$")
    min_duration_weeks: int | None = Field(default=None, ge=1, le=52)
    alpha: float | None = Field(default=None, gt=0, lt=0.2)
    iterations: int | None = Field(default=None, ge=1000, le=100000)
    seed: int | None = None
    what_if: list[list[int]] = Field(default_factory=list, max_length=3)


class DesignFreezeIn(BaseModel):
    simulation_run_id: str | None = None
    duration_weeks: int = Field(ge=1, le=52)
    units: int = Field(ge=2, le=500)
    comparison_units: int = Field(default=0, ge=0, le=500)
    measurements_per_week: int = Field(default=1, ge=1, le=7)
    pass_mark: float
    analysis_method: str = Field(pattern="^(paired_t|wilcoxon|welch_did|two_proportion)$")
    alpha: float = Field(default=0.05, gt=0, lt=0.2)
    acknowledge: bool = Field(
        default=False,
        description="The officer confirms the design is frozen before data collection starts.",
    )


class MilestoneIn(BaseModel):
    seq: int = Field(ge=1, le=6)
    title: str = Field(max_length=200)
    deliverable: str
    evidence_required: str
    amount_rupees: float = Field(ge=0)
    due_date: datetime


class AgreementIn(BaseModel):
    ip_option: str = Field(pattern="^(startup_retains|joint|government_owned)$")
    data_terms: dict[str, Any] = Field(default_factory=dict)
    milestones: list[MilestoneIn]
    change_note: str | None = None


class TransitionIn(BaseModel):
    reason: str | None = None


class CyberChecklistIn(BaseModel):
    answers: dict[str, bool]


class MetricRowIn(BaseModel):
    kpi_id: str | None = None
    kpi_name: str | None = None
    unit_ref: str
    period_start: datetime
    period_end: datetime
    phase: str = Field(default="pilot", pattern="^(baseline|pilot)$")
    arm: str = Field(default="treatment", pattern="^(treatment|comparison)$")
    value: float


class MetricsIn(BaseModel):
    rows: list[MetricRowIn]


class DisputeIn(BaseModel):
    submission_id: str
    reason: str = Field(min_length=10)


class AmendmentIn(BaseModel):
    description: str = Field(min_length=20)
    approved: bool = False


# --- Serialisation ---------------------------------------------------------


def pilot_view(pilot: Pilot, *, roles: set[str] | None = None) -> dict[str, Any]:
    return {
        "id": pilot.id,
        "reference": pilot.reference,
        "state": pilot.state,
        "challenge_id": pilot.challenge_id,
        "challenge_title": pilot.challenge.title if pilot.challenge else None,
        "startup_id": pilot.startup_id,
        "startup_name": pilot.startup.legal_name if pilot.startup else None,
        "department_id": pilot.department_id,
        "application_id": pilot.application_id,
        "design_id": pilot.design_id,
        "started_at": iso(pilot.started_at),
        "ended_at": iso(pilot.ended_at),
        "paused_at": iso(pilot.paused_at),
        "pause_reason": pilot.pause_reason,
        "termination_reason": pilot.termination_reason,
        "cyber_completed_at": iso(pilot.cyber_completed_at),
        "cyber_checklist": pilot.cyber_checklist,
        "total_value": money(pilot.total_value_paise),
        "version": pilot.version,
        "available_actions": available_actions("pilot", pilot.state, roles or set()),
    }


def design_view(design: Any, primary_name: str = "", unit: str = "") -> dict[str, Any] | None:
    if design is None:
        return None
    return {
        "id": design.id,
        "primary_kpi_id": design.primary_kpi_id,
        "primary_kpi_name": primary_name,
        "unit": unit,
        "duration_weeks": design.duration_weeks,
        "units": design.units,
        "comparison_units": design.comparison_units,
        "measurements_per_week": design.measurements_per_week,
        "planned_unit_periods": design.planned_unit_periods,
        "pass_mark": design.pass_mark,
        "analysis_method": design.analysis_method,
        "alpha": design.alpha,
        "expected_power": design.expected_power,
        "expected_cost": money(design.expected_cost_paise),
        "minimum_detectable_effect": design.minimum_detectable_effect,
        "baseline_mean": design.baseline_mean,
        "baseline_sd": design.baseline_sd,
        "claimed_effect": design.claimed_effect,
        "frozen_at": iso(design.frozen_at),
        "frozen": design.frozen_at is not None,
        "amendments": design.amendments,
        "simulation_run_id": design.simulation_run_id,
    }


async def _load(session, pilot_id: str, principal, action: str = "pilot:read") -> Pilot:  # type: ignore[no-untyped-def]
    pilot = await pilots_service.get(session, pilot_id)
    require(
        principal,
        action,
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
            "state": pilot.state,
        },
    )
    return pilot


# --- Pilot ----------------------------------------------------------------


@router.get("", summary="Pilots visible to the caller")
async def list_pilots(
    principal: PrincipalDep,
    session: SessionDep,
    state: str | None = Query(None),
    limit: int = Query(100, ge=1, le=200),
) -> dict[str, Any]:
    """A department sees its own pilots; a startup sees the pilots it is running."""
    stmt = select(Pilot).order_by(Pilot.created_at.desc()).limit(limit)
    if principal.is_admin():
        pass
    elif principal.startup_id and Role.STARTUP_USER in principal.roles:
        stmt = stmt.where(Pilot.startup_id == principal.startup_id)
    elif principal.department_id:
        stmt = stmt.where(Pilot.department_id == principal.department_id)
    else:
        return {"items": [], "count": 0}
    if state:
        stmt = stmt.where(Pilot.state == state)

    rows = list((await session.execute(stmt)).scalars().all())
    items: list[dict[str, Any]] = []
    for pilot in rows:
        design = await pilots_service.design_for(session, pilot.id)
        milestones = await payments_service.for_pilot(session, pilot.id)
        paid = sum(m.amount_paise for m in milestones if m.state == "Paid")
        overdue = sum(1 for m in milestones if m.escalation_level > 0 and m.state != "Paid")
        items.append(
            {
                **pilot_view(pilot, roles=principal.roles),
                "design_frozen": bool(design and design.frozen_at),
                "milestone_count": len(milestones),
                "paid_value": money(paid),
                "overdue_milestones": overdue,
            }
        )
    return {"items": items, "count": len(items)}


@router.get("/{pilot_id}", summary="One pilot")
async def get_pilot(
    pilot_id: str, principal: PrincipalDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal)
    set_etag(response, pilot)
    design = await pilots_service.design_for(session, pilot.id)
    primary = await session.get(Kpi, design.primary_kpi_id) if design else None
    agreement = await pilots_service.latest_agreement(session, pilot.id)
    milestones = await payments_service.for_pilot(session, pilot.id)

    body = pilot_view(pilot, roles=principal.roles)
    body["design"] = design_view(design, primary.name if primary else "", primary.unit if primary else "")
    body["agreement"] = (
        {
            "id": agreement.id,
            "number": agreement.number,
            "ip_option": agreement.ip_option,
            "sha256": agreement.sha256,
            "pdf_file_id": agreement.pdf_file_id,
            "approved_at": iso(agreement.approved_at),
            "accepted_at": iso(agreement.accepted_at),
            "esign_reference": agreement.esign_reference,
            "change_request": agreement.change_request,
            "template_versions": agreement.template_versions,
        }
        if agreement
        else None
    )
    body["milestones"] = [payments_service.view(m) for m in milestones]
    return body


@router.get("/{pilot_id}/dashboard", summary="Progress against the pre-registered plan")
async def dashboard(pilot_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal)
    return await pilots_service.dashboard(session, pilot)


# --- Simulator -------------------------------------------------------------


@router.get("/{pilot_id}/simulations/defaults", summary="Prefilled simulator inputs")
async def simulation_defaults(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "simulation:read")
    inputs, primary, challenge, ceiling = await simulation_service.prepare_inputs(session, pilot)
    return {
        "inputs": inputs.to_dict(),
        "primary_kpi": {
            "id": primary.id,
            "name": primary.name,
            "unit": primary.unit,
            "kind": primary.kind,
            "direction": primary.direction,
            "baseline_value": float(primary.baseline_value) if primary.baseline_value is not None else None,
            "target_value": float(primary.target_value) if primary.target_value is not None else None,
        },
        "budget_ceiling": money(ceiling),
        "target_power": settings.simulation_target_power,
        "guidance": [
            "Baseline variability is the spread of the measure across units, not its average.",
            "Claimed effects are shrunk by a realism factor because they are usually optimistic. "
            "Set the factor to 1 only if you have independent evidence for the claim.",
            "Both a longer pilot and more units raise the chance of detecting a real change.",
            "The recommendation never proposes a pilot shorter than the operational minimum "
            "you set, because a design can be statistically adequate and still too short to "
            "say anything useful about the solution in service.",
        ],
    }


@router.post("/{pilot_id}/simulations", status_code=status.HTTP_202_ACCEPTED,
             summary="Queue a simulation run")
async def run_simulation(
    pilot_id: str,
    body: SimulationIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "simulation:create")

    overrides = body.model_dump(exclude_unset=True, mode="python")
    what_if = [tuple(pair) for pair in overrides.pop("what_if", []) if len(pair) == 2]
    for source, target in (
        ("cost_per_unit_week_rupees", "cost_per_unit_week_paise"),
        ("fixed_cost_rupees", "fixed_cost_paise"),
    ):
        if overrides.get(source) is not None:
            overrides[target] = rupees_to_paise(overrides.pop(source))
        else:
            overrides.pop(source, None)
    overrides = {k: v for k, v in overrides.items() if v is not None}

    inputs, _primary, _challenge, ceiling = await simulation_service.prepare_inputs(
        session, pilot, overrides=overrides
    )
    run, job = await simulation_service.queue_run(
        session,
        pilot,
        principal,
        inputs=inputs,
        what_if=what_if,
        budget_ceiling_paise=ceiling,
    )
    await session.commit()
    response.headers["Location"] = "/api/v1/jobs/" + job.id
    return {
        "run_id": run.id,
        "job_id": job.id,
        "status": run.status,
        "poll": "/api/v1/simulations/" + run.id,
        "detail": "The simulation is running. Results for the default configuration appear "
        "within a few seconds.",
    }


@router.get("/{pilot_id}/simulations", summary="Simulation runs for this pilot")
async def list_simulations(
    pilot_id: str, principal: PrincipalDep, session: SessionDep, limit: int = Query(20, ge=1, le=50)
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "simulation:read")
    rows = await simulation_service.runs_for_pilot(session, pilot.id, limit=limit)
    return {
        "items": [
            {
                "id": r.id,
                "status": r.status,
                "seed": r.seed,
                "iterations": r.iterations,
                "engine_version": r.engine_version,
                "runtime_ms": r.runtime_ms,
                "created_at": iso(r.created_at),
                "power": ((r.results or {}).get("proposed") or {}).get("power"),
                "recommendation_found": (r.results or {}).get("recommendation_found"),
            }
            for r in rows
        ]
    }


@router.post("/{pilot_id}/design/freeze", summary="Freeze the pre-registered plan")
async def freeze_design(
    pilot_id: str,
    body: DesignFreezeIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "design:freeze")
    if not body.acknowledge:
        raise ValidationFailed(
            "Freezing the design is a one-way step, so it must be confirmed.",
            errors=[
                {
                    "field": "acknowledge",
                    "detail": "The confirmation was not given.",
                    "fix": "Confirm that the primary measure, pass mark, duration and unit count "
                    "are final. After freezing they can only change by an approved amendment.",
                }
            ],
        )

    inputs, primary, challenge, _ceiling = await simulation_service.prepare_inputs(
        session,
        pilot,
        overrides={
            "duration_weeks": body.duration_weeks,
            "units": body.units,
            "comparison_units": body.comparison_units,
            "measurements_per_week": body.measurements_per_week,
        },
    )

    expected_power = None
    expected_cost = None
    mde = None
    if body.simulation_run_id:
        run = await simulation_service.get_run(session, body.simulation_run_id)
        if run.pilot_id != pilot.id:
            raise ValidationFailed("That simulation run belongs to a different pilot.")
        results = run.results or {}
        chosen = None
        for candidate in results.get("comparison", []):
            if (
                candidate.get("duration_weeks") == body.duration_weeks
                and candidate.get("units") == body.units
            ):
                chosen = candidate
                break
        if chosen:
            expected_power = chosen.get("power")
            expected_cost = chosen.get("expected_cost_paise")
            mde = chosen.get("minimum_detectable_effect")

    async def _do() -> dict[str, Any]:
        design = await pilots_service.freeze_design(
            session,
            pilot,
            principal,
            simulation_run_id=body.simulation_run_id,
            primary_kpi_id=primary.id,
            duration_weeks=body.duration_weeks,
            units=body.units,
            measurements_per_week=body.measurements_per_week,
            pass_mark=body.pass_mark,
            analysis_method=body.analysis_method,
            alpha=body.alpha,
            baseline_mean=inputs.baseline_mean,
            baseline_sd=inputs.baseline_sd,
            claimed_effect=inputs.claimed_effect,
            comparison_units=body.comparison_units,
            expected_power=expected_power,
            expected_cost_paise=expected_cost,
            minimum_detectable_effect=mde,
        )
        return {
            "design": design_view(design, primary.name, primary.unit),
            "detail": "The plan is pre-registered and locked. The success bar cannot move after "
            "the results are seen.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/design/freeze",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.post("/{pilot_id}/design/amend", summary="Record an amendment to a frozen design")
async def amend_design(
    pilot_id: str,
    body: AmendmentIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "design:freeze")
    if body.approved and Role.DEPARTMENT_APPROVER not in principal.roles:
        raise Forbidden("Only the department approver can mark an amendment as approved.")
    design = await pilots_service.record_amendment(
        session, pilot, principal, description=body.description, approved=body.approved
    )
    await session.commit()
    return {
        "amendments": design.amendments,
        "detail": "Recorded. Each approved amendment costs 2 points and each unapproved "
        "deviation costs 5 points of protocol adherence in the Evidence Confidence Score.",
    }


# --- Agreements ------------------------------------------------------------


@router.get("/{pilot_id}/agreement/defaults", summary="Prefilled agreement and milestone plan")
async def agreement_defaults(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:create-agreement")
    design = await pilots_service.design_for(session, pilot.id)
    duration = design.duration_weeks if design else 8
    start = utcnow() + timedelta(days=7)

    data_template = await templates_service.latest(session, "data_sharing")
    ip_template = await templates_service.latest(session, "ip_clause")
    cyber_template = await templates_service.latest(session, "cyber_checklist")
    exit_template = await templates_service.latest(session, "exit_plan")

    return {
        "milestones": [
            {**m, "amount_rupees": m["amount_paise"] / 100}
            for m in pilots_service.default_milestones(
                pilot.total_value_paise or 0, start, duration, count=4
            )
        ],
        "data_terms_fields": data_template.body["fields"],
        "data_terms_defaults": data_template.body["defaults"],
        "ip_options": ip_template.body["options"],
        "cyber_checklist": cyber_template.body["items"],
        "exit_plan_fields": exit_template.body["fields"],
        "sla": {
            "accept_days": settings.sla_accept_days,
            "approve_days": settings.sla_approve_days,
            "release_days": settings.sla_release_days,
        },
        "note": "At least one milestone must fall due before pilot completion, so the startup is "
        "paid during the pilot and not only after it.",
    }


@router.post("/{pilot_id}/agreements", status_code=status.HTTP_201_CREATED,
             summary="Draft or revise the pilot agreement")
async def draft_agreement(
    pilot_id: str,
    body: AgreementIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:create-agreement")

    milestones = [
        {
            "seq": m.seq,
            "title": m.title,
            "deliverable": m.deliverable,
            "evidence_required": m.evidence_required,
            "amount_paise": rupees_to_paise(m.amount_rupees),
            "due_date": m.due_date.isoformat(),
        }
        for m in body.milestones
    ]

    async def _do() -> dict[str, Any]:
        version = await pilots_service.draft_agreement(
            session,
            pilot,
            principal,
            ip_option=body.ip_option,
            data_terms=body.data_terms,
            milestones=milestones,
            change_note=body.change_note,
        )
        return {
            "agreement_id": version.id,
            "number": version.number,
            "sha256": version.sha256,
            "pdf_file_id": version.pdf_file_id,
            "template_versions": version.template_versions,
            "detail": "The agreement PDF is in the document vault and its hash is recorded in "
            "the audit log. It is now with the approver.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/agreements",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("/{pilot_id}/agreements", summary="Every agreement version, with diffs")
async def list_agreements(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal)
    versions = await pilots_service.agreement_versions(session, pilot.id)
    items = []
    for index, version in enumerate(versions):
        diff = (
            pilots_service.diff_agreements(versions[index - 1], version) if index > 0 else []
        )
        items.append(
            {
                "id": version.id,
                "number": version.number,
                "ip_option": version.ip_option,
                "data_terms": version.data_terms,
                "milestones": (version.body or {}).get("milestones", []),
                "sha256": version.sha256,
                "pdf_file_id": version.pdf_file_id,
                "drafted_by": version.drafted_by,
                "approved_by": version.approved_by,
                "approved_at": iso(version.approved_at),
                "accepted_by": version.accepted_by,
                "accepted_at": iso(version.accepted_at),
                "esign_reference": version.esign_reference,
                "change_request": version.change_request,
                "template_versions": version.template_versions,
                "changes_from_previous": diff,
            }
        )
    return {"items": items}


@router.post("/{pilot_id}/cyber-checklist", summary="Complete the cybersecurity checklist")
async def cyber_checklist(
    pilot_id: str,
    body: CyberChecklistIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:cyber-checklist")
    updated = await pilots_service.complete_cyber_checklist(session, pilot, principal, body.answers)
    await session.commit()
    return {
        "completed_at": iso(updated.cyber_completed_at),
        "checklist": updated.cyber_checklist,
        "detail": "The checklist is recorded as a schedule to the agreement. These controls must "
        "be maintained for the whole pilot period.",
    }


# --- Metric capture --------------------------------------------------------


@router.get("/{pilot_id}/metrics/template.csv", summary="Download the upload template")
async def metrics_template(pilot_id: str, principal: PrincipalDep, session: SessionDep) -> Response:
    await _load(session, pilot_id, principal, "pilot:read-metrics")
    return Response(
        content=pilots_service.csv_template(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="metric-template.csv"'},
    )


@router.get("/{pilot_id}/metrics", summary="Measurements recorded for this pilot")
async def list_metrics(
    pilot_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    kpi_id: str | None = Query(None),
    phase: str | None = Query(None, pattern="^(baseline|pilot)$"),
    include_disputed: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:read-metrics")
    rows = await pilots_service.metrics_for(
        session,
        pilot.id,
        kpi_id=kpi_id,
        phase=phase,
        include_disputed=include_disputed,
        limit=limit,
    )
    return {
        "items": [
            {
                "id": r.id,
                "kpi_id": r.kpi_id,
                "unit_ref": r.unit_ref,
                "period_start": iso(r.period_start),
                "period_end": iso(r.period_end),
                "phase": r.phase,
                "arm": r.arm,
                "value": float(r.value),
                "source": r.source,
                "status": r.status,
                "dispute_reason": r.dispute_reason,
            }
            for r in rows
        ],
        "count": len(rows),
    }


@router.post("/{pilot_id}/metrics", summary="Submit measurements as JSON")
async def submit_metrics(
    pilot_id: str,
    body: MetricsIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:submit-metrics")
    if pilot.state not in (PilotState.ACTIVE, PilotState.AWAITING_STARTUP, PilotState.AGREEMENT_DRAFT):
        raise ValidationFailed(
            "Measurements can only be submitted while the pilot is active, or as baseline data "
            "before it starts.",
            errors=[
                {
                    "field": "pilot",
                    "detail": "The pilot is in state " + pilot.state + ".",
                    "fix": "Resume the pilot, or ask the department to do so.",
                }
            ],
        )

    async def _do() -> dict[str, Any]:
        return await pilots_service.ingest_rows(
            session,
            pilot,
            principal,
            [r.model_dump(mode="python") for r in body.rows],
            source="form",
        )

    return await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/metrics",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.post("/{pilot_id}/metrics/csv", summary="Upload measurements as CSV")
async def upload_metrics_csv(
    pilot_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    file: UploadFile,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:submit-metrics")
    content = await file.read()
    if len(content) > settings.max_upload_bytes:
        raise ValidationFailed("That file is larger than the upload limit.")

    rows, _bad, digest = pilots_service.parse_csv(content)
    result = await pilots_service.ingest_rows(
        session, pilot, principal, rows, source="csv", upload_hash=digest
    )
    await session.commit()
    result["file_hash"] = digest
    result["filename"] = file.filename
    return result


@router.post("/{pilot_id}/metrics/dispute", summary="Mark a measurement as disputed")
async def dispute_metric(
    pilot_id: str,
    body: DisputeIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:dispute-metrics")
    record = await pilots_service.dispute_metric(
        session, pilot, principal, body.submission_id, body.reason
    )
    await session.commit()
    return {
        "submission_id": record.id,
        "status": record.status,
        "detail": "Disputed rows are excluded from interim views and from the Evidence Report "
        "until the dispute is resolved.",
    }


@router.post("/{pilot_id}/api-key", summary="Issue a pilot-scoped API key for machine submission")
async def issue_api_key(
    pilot_id: str, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    pilot = await _load(session, pilot_id, principal, "pilot:submit-metrics")
    raw = await pilots_service.issue_api_key(session, pilot, principal)
    await session.commit()
    return {
        "api_key": raw,
        "detail": "This key is shown once and is scoped to this pilot only. Send it as the "
        "X-Pilot-Key header on POST /api/v1/pilots/" + pilot.id + "/metrics/api.",
        "endpoint": "/api/v1/pilots/" + pilot.id + "/metrics/api",
    }


@router.post("/{pilot_id}/metrics/api", summary="Submit measurements with a pilot API key")
async def submit_metrics_api(
    pilot_id: str, body: MetricsIn, request: Request, session: SessionDep
) -> dict[str, Any]:
    key = request.headers.get("X-Pilot-Key", "")
    pilot = await pilots_service.get(session, pilot_id)
    if not key or not pilot.api_key_hash or hash_token(key) != pilot.api_key_hash:
        raise Forbidden("The pilot API key is missing or not valid for this pilot.")

    from app.core.policy import Principal

    machine = Principal(
        user_id="api:" + pilot.id,
        name="Pilot API client",
        email="",
        startup_id=pilot.startup_id,
    )
    result = await pilots_service.ingest_rows(
        session, pilot, machine, [r.model_dump(mode="python") for r in body.rows], source="api"
    )
    await session.commit()
    return result


# --- Lifecycle -------------------------------------------------------------


@router.post("/{pilot_id}/{action}", summary="Run a pilot lifecycle transition")
async def pilot_transition(
    pilot_id: str,
    action: str,
    body: TransitionIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    permissions = {
        "approve-agreement": ("pilot:approve-agreement", Role.DEPARTMENT_APPROVER),
        "accept-agreement": ("pilot:accept-agreement", Role.STARTUP_USER),
        "request-changes": ("pilot:request-changes", Role.STARTUP_USER),
        "pause": ("pilot:pause", Role.DEPARTMENT_OFFICER),
        "resume": ("pilot:resume", Role.DEPARTMENT_OFFICER),
        "complete": ("pilot:pause", Role.DEPARTMENT_OFFICER),
        "terminate": ("pilot:terminate", Role.DEPARTMENT_APPROVER),
    }
    if action not in permissions:
        raise NotFound("The step " + action + " is not available on a pilot.")

    pilot = await lock_row(session, Pilot, pilot_id)
    if pilot is None:
        raise NotFound("This pilot was not found.")
    permission, actor_role = permissions[action]
    require(
        principal,
        permission,
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
            "state": pilot.state,
        },
    )

    async def _do() -> dict[str, Any]:
        updated = await pilots_service.transition(
            session, pilot, principal, action, actor_role=actor_role, reason=body.reason
        )
        return pilot_view(updated, roles=principal.roles)

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/" + action,
        idempotency_key=idempotency_key,
        request_payload={"action": action, **body.model_dump(mode="json")},
        action=_do,
        entity=pilot,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, pilot)
    return result

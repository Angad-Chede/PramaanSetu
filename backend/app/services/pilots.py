"""Pilots: agreement generation, lifecycle, design freeze and metric capture.

PRD 5.6 (design freeze), 5.7 (agreement and sandbox terms), 5.8 (execution and metrics).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import format_ist, utcnow
from app.core.config import settings
from app.core.errors import NotFound, ValidationFailed
from app.core.hash import sha256_bytes
from app.core.ids import short_ref
from app.core.money import split_evenly
from app.core.policy import Principal
from app.core.security import new_api_key
from app.domain.states import ChallengeState, MilestoneState, PilotState, Role, check_transition
from app.models.application import Application
from app.models.challenge import Challenge, Kpi
from app.models.payment import Milestone
from app.models.pilot import AgreementVersion, MetricSubmission, Pilot
from app.models.simulation import PilotDesign
from app.models.startup import Startup
from app.services import audit, files, outbox, pdf, templates
from app.services.adapters.esign import get_esign_adapter

MIN_MILESTONES = 2
MAX_MILESTONES = 6


async def get(session: AsyncSession, pilot_id: str) -> Pilot:
    pilot = await session.get(Pilot, pilot_id)
    if pilot is None:
        raise NotFound("This pilot was not found.")
    return pilot


async def create_for_application(
    session: AsyncSession, application: Application, challenge: Challenge, principal: Principal
) -> Pilot:
    existing = await session.execute(select(Pilot).where(Pilot.application_id == application.id))
    found = existing.scalar_one_or_none()
    if found is not None:
        return found

    pilot = Pilot(
        reference=short_ref("PL"),
        application_id=application.id,
        challenge_id=challenge.id,
        startup_id=application.startup_id,
        department_id=challenge.department_id,
        state=PilotState.AGREEMENT_DRAFT,
        total_value_paise=application.pilot_cost_paise,
    )
    session.add(pilot)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await session.execute(select(Pilot).where(Pilot.application_id == application.id))
        found = existing.scalar_one_or_none()
        if found is not None:
            return found
        raise

    await session.refresh(pilot)
    await audit.record(
        session,
        action="pilot.created",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={"reference": pilot.reference, "application": application.reference},
    )
    outbox.emit(
        session,
        aggregate_type="pilot",
        aggregate_id=pilot.id,
        event_type="pilot.created",
        payload={"reference": pilot.reference, "challenge_id": challenge.id},
    )
    return pilot


# --- Design freeze ---------------------------------------------------------


async def freeze_design(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    simulation_run_id: str | None,
    primary_kpi_id: str,
    duration_weeks: int,
    units: int,
    measurements_per_week: int,
    pass_mark: float,
    analysis_method: str,
    alpha: float,
    baseline_mean: float,
    baseline_sd: float,
    claimed_effect: float,
    comparison_units: int = 0,
    expected_power: float | None = None,
    expected_cost_paise: int | None = None,
    minimum_detectable_effect: float | None = None,
) -> PilotDesign:
    """Freeze the pre-registered plan. Nothing here can change once the pilot starts."""
    existing = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = existing.scalar_one_or_none()
    if design is not None and design.frozen_at is not None:
        raise ValidationFailed(
            "The pilot design is already frozen and cannot be changed.",
            errors=[
                {
                    "field": "design",
                    "detail": "Frozen on " + format_ist(design.frozen_at) + ".",
                    "fix": "Record an amendment approved by the competent authority instead.",
                }
            ],
        )
    if duration_weeks < 1 or units < 2:
        raise ValidationFailed(
            "A pilot design needs at least one week and two units.",
            errors=[
                {
                    "field": "units",
                    "detail": "A single unit gives no basis for comparison.",
                    "fix": "Use at least two units, or run the simulator for a recommendation.",
                }
            ],
        )

    if design is None:
        design = PilotDesign(pilot_id=pilot.id, primary_kpi_id=primary_kpi_id,
                             duration_weeks=duration_weeks, units=units,
                             measurements_per_week=measurements_per_week, pass_mark=pass_mark,
                             analysis_method=analysis_method, alpha=alpha,
                             baseline_mean=baseline_mean, baseline_sd=baseline_sd,
                             claimed_effect=claimed_effect, comparison_units=comparison_units)
        session.add(design)
    else:
        design.primary_kpi_id = primary_kpi_id
        design.duration_weeks = duration_weeks
        design.units = units
        design.measurements_per_week = measurements_per_week
        design.pass_mark = pass_mark
        design.analysis_method = analysis_method
        design.alpha = alpha
        design.baseline_mean = baseline_mean
        design.baseline_sd = baseline_sd
        design.claimed_effect = claimed_effect
        design.comparison_units = comparison_units

    design.simulation_run_id = simulation_run_id
    design.expected_power = expected_power
    design.expected_cost_paise = expected_cost_paise
    design.minimum_detectable_effect = minimum_detectable_effect
    design.frozen_at = utcnow()
    design.frozen_by = principal.user_id
    design.version = (design.version or 0) + 1
    await session.flush()

    pilot.design_id = design.id
    pilot.version = (pilot.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="pilot.design_frozen",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=pilot.department_id,
        after={
            "duration_weeks": duration_weeks,
            "units": units,
            "pass_mark": pass_mark,
            "analysis_method": analysis_method,
            "expected_power": expected_power,
            "simulation_run_id": simulation_run_id,
        },
        reason="Pre-registered plan frozen before data collection starts.",
    )
    return design


async def design_for(session: AsyncSession, pilot_id: str) -> PilotDesign | None:
    result = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot_id))
    return result.scalar_one_or_none()


async def record_amendment(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    description: str,
    approved: bool,
) -> PilotDesign:
    """Any change after freeze is an amendment, and it costs protocol adherence points."""
    design = await design_for(session, pilot.id)
    if design is None:
        raise NotFound("This pilot has no frozen design.")
    amendments = list(design.amendments or [])
    amendments.append(
        {
            "description": description,
            "approved": approved,
            "at": utcnow().isoformat(),
            "by": principal.user_id,
        }
    )
    design.amendments = amendments
    design.version = (design.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="pilot.design_amended",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_APPROVER if approved else Role.DEPARTMENT_OFFICER,
        department_id=pilot.department_id,
        after={"approved": approved},
        reason=description,
    )
    return design


# --- Agreements ------------------------------------------------------------


def default_milestones(
    total_paise: int, start: datetime, duration_weeks: int, count: int = 4
) -> list[dict[str, Any]]:
    """Sensible defaults the officer can change; at least one pays before completion."""
    count = max(MIN_MILESTONES, min(MAX_MILESTONES, count))
    amounts = split_evenly(total_paise, count)
    plan = [
        ("Mobilisation and baseline confirmation",
         "Deployment plan agreed, access provisioned, baseline data confirmed with the department.",
         "Deployment plan document, signed access register, baseline confirmation note."),
        ("Solution deployed and first measurements received",
         "Solution live on all pilot units with the first full measurement period submitted.",
         "Deployment completion note, first measurement submission accepted by the platform."),
        ("Mid-pilot review",
         "Half the pilot period completed with measurement completeness at or above 90 percent.",
         "Mid-pilot report, data completeness summary from the platform."),
        ("Pilot completion and handover",
         "All measurement periods complete, data exported to the department, operating "
         "documentation handed over.",
         "Final measurement submission, data export in the agreed format, handover note."),
        ("Post-pilot support period",
         "Agreed support window completed with incidents closed.",
         "Incident log and closure note."),
        ("Independent validation support",
         "Raw data and clarifications provided to the independent validator.",
         "Validator acknowledgement."),
    ]
    step = max(1, duration_weeks // count)
    out: list[dict[str, Any]] = []
    for index in range(count):
        title, deliverable, evidence = plan[index]
        weeks = step * (index + 1) if index < count - 1 else duration_weeks
        out.append(
            {
                "seq": index + 1,
                "title": title,
                "deliverable": deliverable,
                "evidence_required": evidence,
                "amount_paise": amounts[index],
                "due_date": (start + timedelta(weeks=weeks)).isoformat(),
            }
        )
    return out


async def draft_agreement(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    ip_option: str,
    data_terms: dict[str, Any],
    milestones: list[dict[str, Any]],
    change_note: str | None = None,
) -> AgreementVersion:
    """Assemble the agreement from the Template Kit and store a rendered PDF."""
    if not (MIN_MILESTONES <= len(milestones) <= MAX_MILESTONES):
        raise ValidationFailed(
            "A pilot needs between " + str(MIN_MILESTONES) + " and " + str(MAX_MILESTONES) + " milestones.",
            errors=[
                {
                    "field": "milestones",
                    "detail": str(len(milestones)) + " were supplied.",
                    "fix": "Group or split deliverables so the schedule has 2 to 6 milestones.",
                }
            ],
        )
    if len(milestones) < 2 or all(index == len(milestones) - 1 for index, _ in enumerate(milestones)):
        pass
    if all(
        datetime.fromisoformat(str(m["due_date"])).date()
        >= datetime.fromisoformat(str(milestones[-1]["due_date"])).date()
        for m in milestones
    ):
        raise ValidationFailed(
            "At least one milestone must fall due before pilot completion.",
            errors=[
                {
                    "field": "milestones",
                    "detail": "Every milestone is due at the end of the pilot.",
                    "fix": "Move at least one milestone earlier so the startup is paid during "
                    "the pilot, not only after it.",
                }
            ],
        )

    ip_template = await templates.latest(session, "ip_clause")
    ip_detail = next(
        (o for o in ip_template.body["options"] if o["code"] == ip_option),
        None,
    )
    if ip_detail is None:
        raise ValidationFailed(
            "That intellectual property option is not recognised.",
            errors=[
                {
                    "field": "ip_option",
                    "detail": "The option " + ip_option + " is not in the template.",
                    "fix": "Choose one of the three published options.",
                }
            ],
        )

    data_template = await templates.latest(session, "data_sharing")
    required_data_fields = [f["key"] for f in data_template.body["fields"] if f.get("required")]
    merged_terms = {**data_template.body.get("defaults", {}), **(data_terms or {})}
    missing = [key for key in required_data_fields if not merged_terms.get(key)]
    if missing:
        raise ValidationFailed(
            "The data-sharing schedule is incomplete.",
            errors=[
                {
                    "field": "data_terms." + key,
                    "detail": "This term is required by the data-sharing template.",
                    "fix": "Complete it before sending the agreement for approval.",
                }
                for key in missing
            ],
        )
    if str(merged_terms.get("storage_location", "")).strip().lower() != "india":
        raise ValidationFailed(
            "Departmental data must be stored in India.",
            errors=[
                {
                    "field": "data_terms.storage_location",
                    "detail": "The storage location given is "
                    + str(merged_terms.get("storage_location"))
                    + ".",
                    "fix": "Set the storage location to India, or change the solution so it can "
                    "host data in India.",
                }
            ],
        )

    agreement_template = await templates.latest(session, "pilot_agreement")
    version_map = await templates.latest_versions(session, templates.AGREEMENT_TEMPLATE_KINDS)

    count_result = await session.execute(
        select(func.count()).select_from(AgreementVersion).where(AgreementVersion.pilot_id == pilot.id)
    )
    number = int(count_result.scalar_one()) + 1

    body = {
        "clauses": agreement_template.body["clauses"],
        "milestones": milestones,
        "ip_option_detail": ip_detail,
        "sla": {
            "accept_days": settings.sla_accept_days,
            "approve_days": settings.sla_approve_days,
            "release_days": settings.sla_release_days,
        },
    }

    version = AgreementVersion(
        pilot_id=pilot.id,
        number=number,
        body=body,
        template_versions=version_map,
        ip_option=ip_option,
        data_terms=merged_terms,
        drafted_by=principal.user_id,
        change_request=change_note,
    )
    session.add(version)
    await session.flush()

    document = await _render_agreement_pdf(session, pilot, version)
    version.pdf_file_id = document.id
    version.sha256 = document.sha256
    await session.flush()

    await _sync_milestones(session, pilot, milestones)

    pilot.state = PilotState.AGREEMENT_DRAFT
    pilot.version = (pilot.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="pilot.agreement_drafted",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=pilot.department_id,
        after={
            "agreement_version": number,
            "sha256": version.sha256,
            "ip_option": ip_option,
            "milestones": len(milestones),
        },
        reason=change_note,
    )
    outbox.emit(
        session,
        aggregate_type="pilot",
        aggregate_id=pilot.id,
        event_type="pilot.agreement_drafted",
        payload={"version": number, "pilot_reference": pilot.reference},
    )
    return version


async def _render_agreement_pdf(session: AsyncSession, pilot: Pilot, version: AgreementVersion):
    challenge = await session.get(Challenge, pilot.challenge_id)
    startup = await session.get(Startup, pilot.startup_id)
    design = await design_for(session, pilot.id)
    primary_kpi = None
    if design is not None:
        primary_kpi = await session.get(Kpi, design.primary_kpi_id)

    payload = {
        "challenge_title": challenge.title if challenge else "",
        "challenge_reference": challenge.reference if challenge else "",
        "pilot_reference": pilot.reference,
        "version_number": version.number,
        "department_name": challenge.department.name if challenge and challenge.department else "",
        "department_address": "",
        "startup_name": startup.legal_name if startup else "",
        "startup_cin": startup.cin if startup else None,
        "startup_dpiit": startup.dpiit_number if startup else None,
        "clauses": version.body.get("clauses", []),
        "milestones": version.body.get("milestones", []),
        "ip_option_detail": version.body.get("ip_option_detail", {}),
        "data_terms": version.data_terms,
        "cyber_checklist": pilot.cyber_checklist,
        "template_versions": version.template_versions,
        "sla_accept_days": settings.sla_accept_days,
        "sla_approve_days": settings.sla_approve_days,
        "sla_release_days": settings.sla_release_days,
        "design": (
            {
                "primary_kpi_name": primary_kpi.name if primary_kpi else "",
                "unit": primary_kpi.unit if primary_kpi else "",
                "pass_mark": design.pass_mark,
                "duration_weeks": design.duration_weeks,
                "units": design.units,
                "measurements_per_week": design.measurements_per_week,
                "analysis_method": design.analysis_method,
                "frozen_at": format_ist(design.frozen_at) if design.frozen_at else "",
            }
            if design
            else {}
        ),
        "approved_by_name": "",
        "approved_at": "",
        "accepted_by_name": "",
        "accepted_at": "",
    }
    rendered = pdf.render_agreement(payload)
    return await files.store_generated(
        session,
        data=rendered.data,
        filename=rendered.filename,
        mime=rendered.mime,
        purpose="agreement",
        uploaded_by=version.drafted_by,
        owner_scope_type="pilot",
        owner_scope_id=pilot.id,
    )


async def _sync_milestones(
    session: AsyncSession, pilot: Pilot, milestones: list[dict[str, Any]]
) -> None:
    existing_rows = await session.execute(select(Milestone).where(Milestone.pilot_id == pilot.id))
    existing = {row.seq: row for row in existing_rows.scalars().all()}
    now = utcnow()
    for item in milestones:
        seq = int(item["seq"])
        due = datetime.fromisoformat(str(item["due_date"]))
        record = existing.get(seq)
        if record is None:
            session.add(
                Milestone(
                    pilot_id=pilot.id,
                    seq=seq,
                    title=item["title"],
                    deliverable=item["deliverable"],
                    evidence_required=item["evidence_required"],
                    amount_paise=int(item["amount_paise"]),
                    due_date=due,
                    state=MilestoneState.PENDING,
                    state_entered_at=now,
                    state_history=[{"state": MilestoneState.PENDING, "at": now.isoformat()}],
                )
            )
        elif record.state == MilestoneState.PENDING:
            record.title = item["title"]
            record.deliverable = item["deliverable"]
            record.evidence_required = item["evidence_required"]
            record.amount_paise = int(item["amount_paise"])
            record.due_date = due
            record.version = (record.version or 0) + 1
    for seq, record in existing.items():
        if seq not in {int(m["seq"]) for m in milestones} and record.state == MilestoneState.PENDING:
            await session.delete(record)
    await session.flush()

    total_rows = await session.execute(
        select(func.coalesce(func.sum(Milestone.amount_paise), 0)).where(Milestone.pilot_id == pilot.id)
    )
    pilot.total_value_paise = int(total_rows.scalar_one())
    await session.flush()


async def latest_agreement(session: AsyncSession, pilot_id: str) -> AgreementVersion | None:
    result = await session.execute(
        select(AgreementVersion)
        .where(AgreementVersion.pilot_id == pilot_id)
        .order_by(AgreementVersion.number.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def agreement_versions(session: AsyncSession, pilot_id: str) -> list[AgreementVersion]:
    result = await session.execute(
        select(AgreementVersion)
        .where(AgreementVersion.pilot_id == pilot_id)
        .order_by(AgreementVersion.number.asc())
    )
    return list(result.scalars().all())


def diff_agreements(older: AgreementVersion, newer: AgreementVersion) -> list[dict[str, Any]]:
    """Every version is stored and diffable (FR-PA-06)."""
    rows: list[dict[str, Any]] = []
    if older.ip_option != newer.ip_option:
        rows.append(
            {"field": "Intellectual property option", "from": older.ip_option, "to": newer.ip_option}
        )
    for key in set(older.data_terms or {}) | set(newer.data_terms or {}):
        before = (older.data_terms or {}).get(key)
        after = (newer.data_terms or {}).get(key)
        if str(before) != str(after):
            rows.append({"field": "Data terms: " + key, "from": before, "to": after})

    old_milestones = {int(m["seq"]): m for m in (older.body or {}).get("milestones", [])}
    new_milestones = {int(m["seq"]): m for m in (newer.body or {}).get("milestones", [])}
    for seq in sorted(set(old_milestones) | set(new_milestones)):
        before = old_milestones.get(seq)
        after = new_milestones.get(seq)
        if before is None:
            added = str((after or {}).get("title", ""))
            rows.append({"field": "Milestone " + str(seq), "from": "not present", "to": added})
        elif after is None:
            removed = str(before.get("title", ""))
            rows.append({"field": "Milestone " + str(seq), "from": removed, "to": "removed"})
        else:
            for key in ("title", "deliverable", "evidence_required", "amount_paise", "due_date"):
                if str(before.get(key)) != str(after.get(key)):
                    rows.append(
                        {
                            "field": "Milestone " + str(seq) + ": " + key.replace("_", " "),
                            "from": before.get(key),
                            "to": after.get(key),
                        }
                    )
    return rows


async def transition(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    action: str,
    *,
    actor_role: str,
    reason: str | None = None,
    request_id: str | None = None,
) -> Pilot:
    transition_def = check_transition("pilot", action, pilot.state, reason)
    before = pilot.state
    now = utcnow()
    agreement = await latest_agreement(session, pilot.id)

    if action == "approve-agreement":
        if agreement is None:
            raise ValidationFailed("There is no agreement version to approve.")
        agreement.approved_by = principal.user_id
        agreement.approved_at = now
    elif action == "accept-agreement":
        if agreement is None:
            raise ValidationFailed("There is no agreement version to accept.")
        if not pilot.cyber_completed_at:
            raise ValidationFailed(
                "The cybersecurity checklist must be completed before the pilot can be activated.",
                errors=[
                    {
                        "field": "cyber_checklist",
                        "detail": "The checklist has not been submitted.",
                        "fix": "Complete every required control on the cybersecurity checklist.",
                    }
                ],
            )
        design = await design_for(session, pilot.id)
        if design is None or design.frozen_at is None:
            raise ValidationFailed(
                "The pre-registered plan must be frozen before the pilot can start.",
                errors=[
                    {
                        "field": "design",
                        "detail": "No frozen design is on record.",
                        "fix": "Run the Pilot Flight Simulator and freeze a design first.",
                    }
                ],
            )
        receipt = await get_esign_adapter().sign(
            document_hash=agreement.sha256 or "",
            signer_name=principal.name,
            signer_id=principal.user_id,
        )
        agreement.accepted_by = principal.user_id
        agreement.accepted_at = now
        agreement.esign_reference = receipt.reference
        pilot.started_at = now
        challenge = await session.get(Challenge, pilot.challenge_id)
        if challenge is not None and challenge.state == ChallengeState.PILOT_DESIGN:
            challenge.state = ChallengeState.PILOT_ACTIVE
            challenge.version = (challenge.version or 0) + 1
    elif action == "request-changes":
        if agreement is not None:
            agreement.change_request = reason
    elif action == "pause":
        pilot.paused_at = now
        pilot.pause_reason = reason
    elif action == "resume":
        pilot.paused_at = None
        pilot.pause_reason = None
    elif action == "complete":
        pilot.ended_at = now
        challenge = await session.get(Challenge, pilot.challenge_id)
        if challenge is not None and challenge.state == ChallengeState.PILOT_ACTIVE:
            challenge.state = ChallengeState.VALIDATION
            challenge.version = (challenge.version or 0) + 1
    elif action == "terminate":
        pilot.ended_at = now
        pilot.termination_reason = reason

    pilot.state = transition_def.target
    pilot.version = (pilot.version or 0) + 1
    await session.flush()

    event_map = {
        "approve-agreement": "pilot.agreement_approved",
        "accept-agreement": "pilot.agreement_accepted",
        "request-changes": "pilot.changes_requested",
        "pause": "pilot.paused",
        "resume": "pilot.resumed",
        "complete": "pilot.completed",
        "terminate": "pilot.terminated",
    }
    await audit.record(
        session,
        action="pilot." + action,
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=actor_role,
        department_id=pilot.department_id,
        before={"state": before},
        after={
            "state": pilot.state,
            "agreement_sha256": agreement.sha256 if agreement else None,
            "esign_reference": agreement.esign_reference if agreement else None,
        },
        reason=reason,
        request_id=request_id,
    )
    if action in event_map:
        outbox.emit(
            session,
            aggregate_type="pilot",
            aggregate_id=pilot.id,
            event_type=event_map[action],
            payload={
                "pilot_reference": pilot.reference,
                "challenge_id": pilot.challenge_id,
                "startup_id": pilot.startup_id,
                "state": pilot.state,
                "reason": reason,
            },
        )
    return pilot


async def complete_cyber_checklist(
    session: AsyncSession, pilot: Pilot, principal: Principal, answers: dict[str, bool]
) -> Pilot:
    template = await templates.latest(session, "cyber_checklist")
    required = [item["key"] for item in template.body["items"] if item.get("required")]
    missing = [key for key in required if not answers.get(key)]
    if missing:
        raise ValidationFailed(
            "Every required control must be confirmed before the pilot can be activated.",
            errors=[
                {
                    "field": "cyber_checklist." + key,
                    "detail": "This control has not been confirmed.",
                    "fix": "Put the control in place and confirm it, or ask the department for a "
                    "written exception.",
                }
                for key in missing
            ],
        )
    pilot.cyber_checklist = {k: bool(v) for k, v in answers.items()}
    pilot.cyber_completed_at = utcnow()
    pilot.version = (pilot.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="pilot.cyber_checklist_completed",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.STARTUP_USER,
        department_id=pilot.department_id,
        after={"controls_confirmed": sum(1 for v in answers.values() if v)},
    )
    return pilot


async def issue_api_key(session: AsyncSession, pilot: Pilot, principal: Principal) -> str:
    """Pilot-scoped API key for machine metric submission (FR-PE-01)."""
    raw, hashed = new_api_key()
    pilot.api_key_hash = hashed
    pilot.version = (pilot.version or 0) + 1
    await session.flush()
    await audit.record(
        session,
        action="pilot.api_key_issued",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.STARTUP_USER,
        department_id=pilot.department_id,
        after={"issued": True},
    )
    return raw


# --- Metric capture --------------------------------------------------------


CSV_COLUMNS = ("kpi_name", "unit_ref", "period_start", "period_end", "phase", "arm", "value")

# Ingest refuses columns that look like direct identifiers (PRD 11.3)
IDENTIFIER_COLUMNS = (
    "phone", "mobile", "email", "aadhaar", "aadhar", "pan", "name", "address",
    "voter", "ration", "account_no", "account_number",
)


def csv_template() -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    writer.writerow(
        [
            "Non-revenue water",
            "DMA-01",
            "2026-01-05",
            "2026-01-11",
            "pilot",
            "treatment",
            "28.4",
        ]
    )
    return buffer.getvalue()


async def ingest_rows(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    rows: list[dict[str, Any]],
    *,
    source: str,
    upload_hash: str | None = None,
) -> dict[str, Any]:
    """Validate and store metric rows. Rejected rows come back with line and reason."""
    kpi_rows = await session.execute(select(Kpi).where(Kpi.challenge_id == pilot.challenge_id))
    kpis = list(kpi_rows.scalars().all())
    by_id = {k.id: k for k in kpis}
    by_name = {k.name.strip().lower(): k for k in kpis}

    design = await design_for(session, pilot.id)
    accepted = 0
    rejected: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=1):
        # A CSV row carries the line number it came from, so a rejection points at the
        # line the person is looking at in their file rather than at a position in a list.
        line = int(row.get("_line", index))
        try:
            kpi = None
            if row.get("kpi_id"):
                kpi = by_id.get(str(row["kpi_id"]))
            if kpi is None and row.get("kpi_name"):
                kpi = by_name.get(str(row["kpi_name"]).strip().lower())
            if kpi is None:
                raise ValueError(
                    "No measure on this challenge matches "
                    + str(row.get("kpi_name") or row.get("kpi_id"))
                    + ". Use one of: "
                    + ", ".join(k.name for k in kpis)
                    + "."
                )

            unit_ref = str(row.get("unit_ref", "")).strip()
            if not unit_ref:
                raise ValueError("unit_ref is empty. Name the site, ward or case this row is for.")

            period_start = _parse_date(row.get("period_start"), "period_start")
            period_end = _parse_date(row.get("period_end"), "period_end")
            if period_end <= period_start:
                raise ValueError("period_end must be after period_start.")

            phase = str(row.get("phase", "pilot")).strip().lower()
            if phase not in ("baseline", "pilot"):
                raise ValueError("phase must be baseline or pilot.")
            arm = str(row.get("arm", "treatment")).strip().lower()
            if arm not in ("treatment", "comparison"):
                raise ValueError("arm must be treatment or comparison.")

            raw_value = row.get("value")
            if raw_value is None or str(raw_value).strip() == "":
                raise ValueError("value must be a number.")
            try:
                value = float(raw_value)
            except (TypeError, ValueError):
                raise ValueError("value must be a number.") from None

            if kpi.kind == "proportion":
                upper = 100.0 if (kpi.baseline_value is None or float(kpi.baseline_value) > 1.0) else 1.0
                if value < 0 or value > upper:
                    raise ValueError(
                        "value " + str(value) + " is outside the range 0 to " + str(upper)
                        + " for a rate measure."
                    )
            if design is not None and design.baseline_sd > 0:
                deviation = abs(value - design.baseline_mean) / design.baseline_sd
                if deviation > 10:
                    raise ValueError(
                        "value " + str(value) + " is more than 10 standard deviations from the "
                        "baseline mean. Check the unit and the decimal point."
                    )

            existing = await session.execute(
                select(MetricSubmission).where(
                    MetricSubmission.pilot_id == pilot.id,
                    MetricSubmission.kpi_id == kpi.id,
                    MetricSubmission.unit_ref == unit_ref,
                    MetricSubmission.period_start == period_start,
                    MetricSubmission.phase == phase,
                )
            )
            record = existing.scalar_one_or_none()
            if record is None:
                session.add(
                    MetricSubmission(
                        pilot_id=pilot.id,
                        kpi_id=kpi.id,
                        unit_ref=unit_ref,
                        period_start=period_start,
                        period_end=period_end,
                        phase=phase,
                        arm=arm,
                        value=value,
                        source=source,
                        status="Accepted",
                        upload_hash=upload_hash,
                        submitted_by=principal.user_id,
                    )
                )
            else:
                # Upsert keeps a retried upload from creating duplicates (PRD 10.3).
                record.value = value
                record.period_end = period_end
                record.arm = arm
                record.source = source
                record.upload_hash = upload_hash
                record.submitted_by = principal.user_id
                record.status = "Accepted"
            accepted += 1
        except ValueError as exc:
            rejected.append(
                {
                    "line": line,
                    "reason": str(exc),
                    "row": {k: v for k, v in row.items() if k != "_line"},
                }
            )

    await session.flush()

    if accepted:
        outbox.emit(
            session,
            aggregate_type="pilot",
            aggregate_id=pilot.id,
            event_type="pilot.metrics_ingested",
            payload={"accepted": accepted, "rejected": len(rejected), "source": source},
        )
        await audit.record(
            session,
            action="pilot.metrics_ingested",
            entity_type="pilot",
            entity_id=pilot.id,
            actor_id=principal.user_id,
            actor_role=Role.STARTUP_USER,
            department_id=pilot.department_id,
            after={"accepted": accepted, "rejected": len(rejected), "source": source,
                   "upload_hash": upload_hash},
        )

    return {
        "accepted": accepted,
        "rejected": rejected,
        "rejected_count": len(rejected),
        "message": (
            str(accepted) + " rows stored."
            + (" " + str(len(rejected)) + " rows were not stored; each is listed with the line "
               "number and the reason." if rejected else "")
        ),
    }


def parse_csv(content: bytes) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    """Parse an uploaded CSV, refusing columns that look like direct identifiers."""
    digest = sha256_bytes(content)
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip().lower() for h in (reader.fieldnames or [])]

    banned = [h for h in headers if any(marker in h for marker in IDENTIFIER_COLUMNS) and h != "kpi_name"]
    if banned:
        raise ValidationFailed(
            "This file contains columns that look like personal identifiers, which cannot be "
            "uploaded to the platform.",
            errors=[
                {
                    "field": "file",
                    "detail": "Columns found: " + ", ".join(banned) + ".",
                    "fix": "Remove or aggregate those columns before uploading. The platform "
                    "stores measurements per unit, never per person.",
                }
            ],
        )

    missing = [c for c in ("unit_ref", "period_start", "value") if c not in headers]
    if missing:
        raise ValidationFailed(
            "The file is missing required columns.",
            errors=[
                {
                    "field": "file",
                    "detail": "Missing: " + ", ".join(missing) + ".",
                    "fix": "Download the template from the pilot page and use its column headings.",
                }
            ],
        )

    rows: list[dict[str, Any]] = []
    bad: list[dict[str, Any]] = []
    for index, raw in enumerate(reader, start=2):
        cleaned = {
            (k or "").strip().lower(): (v.strip() if isinstance(v, str) else v)
            for k, v in raw.items()
        }
        if not any(cleaned.values()):
            continue
        cleaned["_line"] = index
        rows.append(cleaned)
    return rows, bad, digest


def _parse_date(value: Any, field: str) -> datetime:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        raise ValueError(field + " is empty. Use the format YYYY-MM-DD.")
    for pattern in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            parsed = datetime.strptime(text[:19], pattern)
            from app.core.clock import UTC

            return parsed.replace(tzinfo=UTC)
        except ValueError:
            continue
    raise ValueError(field + " could not be read as a date. Use the format YYYY-MM-DD.")


async def metrics_for(
    session: AsyncSession,
    pilot_id: str,
    *,
    kpi_id: str | None = None,
    phase: str | None = None,
    include_disputed: bool = False,
    limit: int = 5000,
) -> list[MetricSubmission]:
    stmt = select(MetricSubmission).where(MetricSubmission.pilot_id == pilot_id)
    if kpi_id:
        stmt = stmt.where(MetricSubmission.kpi_id == kpi_id)
    if phase:
        stmt = stmt.where(MetricSubmission.phase == phase)
    if not include_disputed:
        stmt = stmt.where(MetricSubmission.status == "Accepted")
    stmt = stmt.order_by(MetricSubmission.period_start.asc(), MetricSubmission.unit_ref.asc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def dispute_metric(
    session: AsyncSession, pilot: Pilot, principal: Principal, submission_id: str, reason: str
) -> MetricSubmission:
    record = await session.get(MetricSubmission, submission_id)
    if record is None or record.pilot_id != pilot.id:
        raise NotFound("That measurement was not found on this pilot.")
    if not reason.strip():
        raise ValidationFailed(
            "A dispute must be recorded with a reason.",
            errors=[
                {
                    "field": "reason",
                    "detail": "No reason was given.",
                    "fix": "Say what is wrong with this measurement.",
                }
            ],
        )
    record.status = "Disputed"
    record.dispute_reason = reason.strip()
    await session.flush()

    await audit.record(
        session,
        action="pilot.metric_disputed",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=pilot.department_id,
        after={"submission_id": submission_id},
        reason=reason.strip(),
    )
    return record


async def dashboard(session: AsyncSession, pilot: Pilot) -> dict[str, Any]:
    """Progress against the pre-registered plan (FR-PE-04)."""
    design = await design_for(session, pilot.id)
    challenge = await session.get(Challenge, pilot.challenge_id)
    primary = None
    if design is not None:
        primary = await session.get(Kpi, design.primary_kpi_id)
    elif challenge is not None:
        primary = challenge.primary_kpi

    planned = design.planned_unit_periods if design else 0
    received_row = await session.execute(
        select(func.count())
        .select_from(MetricSubmission)
        .where(
            MetricSubmission.pilot_id == pilot.id,
            MetricSubmission.phase == "pilot",
            MetricSubmission.status == "Accepted",
        )
    )
    received = int(received_row.scalar_one())

    periods_row = await session.execute(
        select(func.count(func.distinct(MetricSubmission.period_start))).where(
            MetricSubmission.pilot_id == pilot.id, MetricSubmission.phase == "pilot"
        )
    )
    periods_done = int(periods_row.scalar_one())

    trend: list[dict[str, Any]] = []
    baseline_mean = None
    if primary is not None:
        rows = await session.execute(
            select(
                MetricSubmission.period_start,
                func.avg(MetricSubmission.value),
                func.count(),
            )
            .where(
                MetricSubmission.pilot_id == pilot.id,
                MetricSubmission.kpi_id == primary.id,
                MetricSubmission.phase == "pilot",
                MetricSubmission.status == "Accepted",
            )
            .group_by(MetricSubmission.period_start)
            .order_by(MetricSubmission.period_start.asc())
        )
        trend = [
            {"period_start": start.isoformat(), "mean": round(float(mean), 4), "units": int(count)}
            for start, mean, count in rows.all()
        ]
        baseline_row = await session.execute(
            select(func.avg(MetricSubmission.value)).where(
                MetricSubmission.pilot_id == pilot.id,
                MetricSubmission.kpi_id == primary.id,
                MetricSubmission.phase == "baseline",
                MetricSubmission.status == "Accepted",
            )
        )
        measured_baseline = baseline_row.scalar_one_or_none()
        baseline_mean = (
            round(float(measured_baseline), 4)
            if measured_baseline is not None
            else (float(primary.baseline_value) if primary.baseline_value is not None else None)
        )

    next_milestone_row = await session.execute(
        select(Milestone)
        .where(
            Milestone.pilot_id == pilot.id,
            Milestone.state.in_((MilestoneState.PENDING, MilestoneState.REJECTED)),
        )
        .order_by(Milestone.due_date.asc())
        .limit(1)
    )
    next_milestone = next_milestone_row.scalar_one_or_none()

    completeness = round(100.0 * received / planned, 1) if planned else 0.0
    return {
        "pilot_id": pilot.id,
        "reference": pilot.reference,
        "state": pilot.state,
        "primary_kpi": (
            {
                "id": primary.id,
                "name": primary.name,
                "unit": primary.unit,
                "direction": primary.direction,
                "baseline_mean": baseline_mean,
                "target_value": float(primary.target_value) if primary and primary.target_value is not None else None,
            }
            if primary
            else None
        ),
        "plan": (
            {
                "duration_weeks": design.duration_weeks,
                "units": design.units,
                "measurements_per_week": design.measurements_per_week,
                "pass_mark": design.pass_mark,
                "planned_unit_periods": planned,
                "frozen_at": design.frozen_at.isoformat() if design.frozen_at else None,
            }
            if design
            else None
        ),
        "periods_completed": periods_done,
        "periods_planned": design.duration_weeks * design.measurements_per_week if design else 0,
        "measurements_received": received,
        "completeness_percent": completeness,
        "trend": trend,
        "next_milestone": (
            {
                "id": next_milestone.id,
                "seq": next_milestone.seq,
                "title": next_milestone.title,
                "due_date": next_milestone.due_date.isoformat(),
                "amount_paise": next_milestone.amount_paise,
                "state": next_milestone.state,
            }
            if next_milestone
            else None
        ),
    }

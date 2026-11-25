"""Procurement pathway, scale decision, Innovation Passport and reuse.

PRD 5.11 and 5.12. A Scale decision cannot be recorded without a signed-off Evidence
Report; that rule is enforced here, not in the interface.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.ids import short_ref
from app.core.policy import Principal
from app.core.security import new_share_token
from app.domain.pathway import (
    PathwayInput,
    context_fit,
    effect_bounds,
    project_scale,
    recommend_pathway,
    vendor_dependency_score,
)
from app.domain.states import AdoptionState, ChallengeState, EvidenceStatus, Role, ScaleDecisionType
from app.models.challenge import Challenge, Kpi
from app.models.evidence import EvidenceReport
from app.models.identity import Department
from app.models.pilot import Pilot
from app.models.scale import AdoptionRequest, InnovationPassport, ScaleDecision
from app.models.simulation import PilotDesign
from app.models.startup import Startup
from app.services import audit, files, outbox
from app.services.adapters.gem import get_gem_adapter


async def pathway_for(
    session: AsyncSession,
    pilot: Pilot,
    *,
    estimated_value_paise: int,
    qualified_vendor_count: int | None = None,
) -> dict[str, Any]:
    """Rule inputs are shown with the recommendation; the authority decides (FR-SC-01)."""
    report = await _report(session, pilot.id)
    challenge = await session.get(Challenge, pilot.challenge_id)
    department = await session.get(Department, pilot.department_id)

    # The challenge is the source of the procurement category. Without it there is no
    # category to look up, and guessing one would put a wrong route in front of an approver.
    if challenge is None:
        raise NotFound(
            "The challenge behind this pilot was not found, so no procurement route can be "
            "recommended."
        )
    category = (challenge.sector or challenge.title or "").strip()
    availability = await get_gem_adapter().category_availability(category, challenge.sector)

    data = PathwayInput(
        estimated_value_paise=estimated_value_paise,
        available_on_gem=availability.listed,
        qualified_vendor_count=(
            qualified_vendor_count
            if qualified_vendor_count is not None
            else availability.qualified_vendor_count
        ),
        is_proprietary=False,
        evidence_band=report.band or "Weak",
        confidence_score=float(report.confidence_score or 0.0),
        department_level=department.level if department else "state",
    )
    recommendation = recommend_pathway(data)
    payload = recommendation.to_dict()
    payload["marketplace"] = {
        "category": availability.category,
        "listed": availability.listed,
        "qualified_vendor_count": availability.qualified_vendor_count,
        "detail": availability.detail,
        "source": availability.source,
    }
    return payload


async def simulate_scale(
    session: AsyncSession,
    pilot: Pilot,
    *,
    units: int,
    cost_per_unit_paise: int,
    value_per_effect_unit_paise: int = 0,
    annual_operating_cost_paise: int = 0,
) -> dict[str, Any]:
    """Low, expected and high cases from the validated interval (FR-SC-02)."""
    report = await _report(session, pilot.id)
    analysis = report.analysis or {}
    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()
    primary = await session.get(Kpi, design.primary_kpi_id) if design else None

    low, expected, high = effect_bounds(
        float(analysis.get("ci_low", 0.0)),
        float(analysis.get("ci_high", 0.0)),
        float(analysis.get("effect", 0.0)),
    )
    projection = project_scale(
        units=units,
        cost_per_unit_paise=cost_per_unit_paise,
        effect_low=low,
        effect_expected=expected,
        effect_high=high,
        benefit_unit=primary.unit if primary else "units",
        value_per_effect_unit_paise=value_per_effect_unit_paise,
        baseline_per_unit=float(analysis.get("baseline_mean", 0.0)),
        annual_operating_cost_paise=annual_operating_cost_paise,
    )
    result = projection.to_dict()
    result["effect_used"] = {"low": low, "expected": expected, "high": high}
    result["measure"] = primary.name if primary else ""
    return result


async def dependency_for(
    session: AsyncSession, pilot: Pilot, flags: dict[str, bool] | None = None
) -> dict[str, Any]:
    """Vendor Dependency Score (FR-SC-03)."""
    from app.services import pilots as pilots_service

    agreement = await pilots_service.latest_agreement(session, pilot.id)
    challenge = await session.get(Challenge, pilot.challenge_id)
    category = (challenge.sector or "").strip() if challenge else ""
    availability = await get_gem_adapter().category_availability(category, category)

    data_terms = (agreement.data_terms if agreement else {}) or {}
    computed = {
        "proprietary_formats": "open" not in str(data_terms.get("export_format", "")).lower()
        and "csv" not in str(data_terms.get("export_format", "")).lower(),
        "no_documented_export": not bool(data_terms.get("deletion_obligation"))
        or not bool(data_terms.get("export_format")),
        "single_vendor": availability.qualified_vendor_count <= 1,
        "missing_exit_plan": not bool((agreement.body if agreement else {}).get("exit_plan")),
    }
    computed.update(flags or {})
    return vendor_dependency_score(computed).to_dict()


async def record_decision(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    decision: str,
    reason: str,
    estimated_value_paise: int,
    pathway: dict[str, Any] | None = None,
    scale_projection: dict[str, Any] | None = None,
    vendor_dependency: dict[str, Any] | None = None,
) -> ScaleDecision:
    """Record Scale, Extend pilot or Close (FR-SC-04)."""
    if decision not in tuple(ScaleDecisionType):
        raise ValidationFailed(
            "That decision is not recognised.",
            errors=[
                {
                    "field": "decision",
                    "detail": "The decision " + decision + " is not one of the three permitted.",
                    "fix": "Choose Scale, ExtendPilot or Close.",
                }
            ],
        )
    if not reason.strip():
        raise ValidationFailed(
            "A decision must be recorded with reasons.",
            errors=[
                {
                    "field": "reason",
                    "detail": "No reasons were given.",
                    "fix": "State what in the evidence led to this decision.",
                }
            ],
        )

    report = await _report(session, pilot.id)

    if decision == ScaleDecisionType.SCALE:
        if not report.is_final:
            raise Forbidden(
                "A Scale decision cannot be recorded without a signed-off Evidence Report. The "
                "report for this pilot is in state " + report.status + "."
            )
        dependency = vendor_dependency or await dependency_for(session, pilot)
        if dependency.get("exit_plan_required") and not (pathway or {}).get("exit_plan_on_record"):
            raise ValidationFailed(
                "The Vendor Dependency Score is above 60, so an exit plan must be on record "
                "before a Scale decision can be approved.",
                errors=[
                    {
                        "field": "exit_plan",
                        "detail": "Dependency score is "
                        + str(dependency.get("score"))
                        + " out of 100.",
                        "fix": "Complete the exit plan template and attach it, then record the "
                        "decision again.",
                    }
                ],
            )
        vendor_dependency = dependency

    existing = await session.execute(select(ScaleDecision).where(ScaleDecision.pilot_id == pilot.id))
    if existing.scalar_one_or_none() is not None:
        raise Forbidden("A decision has already been recorded for this pilot.")

    record = ScaleDecision(
        pilot_id=pilot.id,
        evidence_report_id=report.id,
        decision=decision,
        reason=reason.strip(),
        pathway=pathway or {},
        scale_projection=scale_projection or {},
        vendor_dependency=vendor_dependency or {},
        estimated_value_paise=estimated_value_paise,
        decided_by=principal.user_id,
        decided_at=utcnow(),
    )
    session.add(record)
    await session.flush()

    challenge = await session.get(Challenge, pilot.challenge_id)
    if challenge is not None and challenge.state == ChallengeState.DECISION_PENDING:
        challenge.state = (
            ChallengeState.SCALED if decision == ScaleDecisionType.SCALE else ChallengeState.CLOSED
        )
        challenge.version = (challenge.version or 0) + 1

    if decision == ScaleDecisionType.SCALE:
        document = await _render_handoff(session, pilot, record, report, principal)
        record.handoff_file_id = document.id
    await session.flush()

    await audit.record(
        session,
        action="scale.decided",
        entity_type="pilot",
        entity_id=pilot.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_APPROVER,
        department_id=pilot.department_id,
        after={
            "decision": decision,
            "evidence_report_id": report.id,
            "confidence_score": report.confidence_score,
            "estimated_value_paise": estimated_value_paise,
        },
        reason=reason.strip(),
    )
    outbox.emit(
        session,
        aggregate_type="pilot",
        aggregate_id=pilot.id,
        event_type="scale.decided",
        payload={
            "decision": decision,
            "challenge_id": pilot.challenge_id,
            "startup_id": pilot.startup_id,
            "confidence_score": report.confidence_score,
        },
    )
    return record


async def _render_handoff(
    session: AsyncSession,
    pilot: Pilot,
    decision: ScaleDecision,
    report: EvidenceReport,
    principal: Principal,
):
    from app.services import pdf  # reportlab loads on first use

    challenge = await session.get(Challenge, pilot.challenge_id)
    department = await session.get(Department, pilot.department_id)
    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()
    primary = await session.get(Kpi, design.primary_kpi_id) if design else None
    analysis = report.analysis or {}

    specification = [
        "Outcome required: " + (challenge.outcome_statement if challenge else ""),
        "Primary measure: " + (primary.name + " in " + primary.unit if primary else ""),
        "Validated effect: " + str(analysis.get("effect", ""))
        + " (95 percent interval " + str(analysis.get("ci_low", "")) + " to "
        + str(analysis.get("ci_high", "")) + ")",
        "Measurement method: " + (primary.baseline_method if primary else ""),
        "Data must be hosted in India and exportable in an open format.",
        "The specification is outcome-based; it names no product and no vendor.",
    ]

    payload = {
        "challenge_title": challenge.title if challenge else "",
        "challenge_reference": challenge.reference if challenge else "",
        "department_name": department.name if department else "",
        "decision": decision.decision,
        "decided_by_name": principal.name,
        "decided_at": decision.decided_at.isoformat(),
        "reason": decision.reason,
        "confidence_score": report.confidence_score,
        "band": report.band,
        "estimated_value_paise": decision.estimated_value_paise,
        "pathway": decision.pathway,
        "scale_projection": decision.scale_projection,
        "vendor_dependency": decision.vendor_dependency,
        "specification": specification,
        "attachments": [
            {"name": "Challenge", "reference": challenge.reference if challenge else ""},
            {"name": "Pilot", "reference": pilot.reference},
            {"name": "Evidence Report", "reference": report.reference},
            {"name": "Dataset hash", "reference": report.dataset_hash},
        ],
    }
    rendered = pdf.render_handoff_pack(payload)
    return await files.store_generated(
        session,
        data=rendered.data,
        filename=rendered.filename,
        mime=rendered.mime,
        purpose="handoff",
        uploaded_by=principal.user_id,
        owner_scope_type="pilot",
        owner_scope_id=pilot.id,
    )


async def handoff_json(session: AsyncSession, pilot: Pilot) -> dict[str, Any]:
    """The same pack as machine-readable JSON for the marketplace adapter (FR-SC-05)."""
    report = await _report(session, pilot.id)
    challenge = await session.get(Challenge, pilot.challenge_id)
    startup = await session.get(Startup, pilot.startup_id)
    decision_row = await session.execute(
        select(ScaleDecision).where(ScaleDecision.pilot_id == pilot.id)
    )
    decision = decision_row.scalar_one_or_none()
    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()
    primary = await session.get(Kpi, design.primary_kpi_id) if design else None

    return {
        "schema": "pramaansetu.handoff.v1",
        "generated_at": utcnow().isoformat(),
        "challenge": {
            "reference": challenge.reference if challenge else None,
            "title": challenge.title if challenge else None,
            "outcome_statement": challenge.outcome_statement if challenge else None,
            "sector": challenge.sector if challenge else None,
        },
        "supplier": {
            "legal_name": startup.legal_name if startup else None,
            "cin": startup.cin if startup else None,
            "dpiit_number": startup.dpiit_number if startup else None,
        },
        "specification": {
            "primary_measure": primary.name if primary else None,
            "unit": primary.unit if primary else None,
            "direction": primary.direction if primary else None,
            "measurement_method": primary.baseline_method if primary else None,
        },
        "evidence": {
            "reference": report.reference,
            "confidence_score": report.confidence_score,
            "band": report.band,
            "dataset_hash": report.dataset_hash,
            "effect": (report.analysis or {}).get("effect"),
            "ci_low": (report.analysis or {}).get("ci_low"),
            "ci_high": (report.analysis or {}).get("ci_high"),
            "validated_on": report.signed_at.isoformat() if report.signed_at else None,
        },
        "decision": (
            {
                "decision": decision.decision,
                "reason": decision.reason,
                "estimated_value_paise": decision.estimated_value_paise,
                "pathway": decision.pathway,
            }
            if decision
            else None
        ),
    }


# --- Innovation Passport ---------------------------------------------------


async def issue_passport(
    session: AsyncSession, pilot: Pilot, report: EvidenceReport
) -> InnovationPassport | None:
    """Issued automatically on validator sign-off (FR-IP-01)."""
    if not report.is_final:
        return None
    existing = await session.execute(
        select(InnovationPassport).where(InnovationPassport.evidence_report_id == report.id)
    )
    found = existing.scalar_one_or_none()
    if found is not None:
        return found

    challenge = await session.get(Challenge, pilot.challenge_id)
    startup = await session.get(Startup, pilot.startup_id)
    department = await session.get(Department, pilot.department_id)
    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()
    primary = await session.get(Kpi, design.primary_kpi_id) if design else None
    analysis = report.analysis or {}

    from app.models.identity import AppUser

    validator = await session.get(AppUser, report.validator_id) if report.validator_id else None

    passport = InnovationPassport(
        reference=short_ref("IP"),
        evidence_report_id=report.id,
        pilot_id=pilot.id,
        startup_id=pilot.startup_id,
        department_id=pilot.department_id,
        solution_name=(startup.legal_name if startup else "") + " solution for "
        + (challenge.title if challenge else ""),
        category=(challenge.sector or "Service delivery") if challenge else "Service delivery",
        sector=challenge.sector if challenge else None,
        state_code=challenge.state_code if challenge else None,
        district=challenge.district if challenge else None,
        context={
            "scale_units": design.units if design else None,
            "duration_weeks": design.duration_weeks if design else None,
            "population": (challenge.eligibility_rules or {}).get("population") if challenge else None,
            "environment": challenge.current_situation if challenge else None,
            "state_code": challenge.state_code if challenge else None,
            "district": challenge.district if challenge else None,
            "sector": challenge.sector if challenge else None,
            "department_level": department.level if department else None,
        },
        result_summary={
            "measure": primary.name if primary else None,
            "unit": primary.unit if primary else None,
            "direction": primary.direction if primary else None,
            "baseline_mean": analysis.get("baseline_mean"),
            "pilot_mean": analysis.get("pilot_mean"),
            "effect": analysis.get("effect"),
            "relative_effect_percent": analysis.get("relative_effect_percent"),
            "ci_low": analysis.get("ci_low"),
            "ci_high": analysis.get("ci_high"),
            "p_value": analysis.get("p_value"),
            "method": analysis.get("method_label"),
            "pass_mark_met": analysis.get("pass_mark_met"),
        },
        confidence_score=float(report.confidence_score or 0.0),
        band=report.band or "Weak",
        validator_name=validator.name if validator else "Independent validator",
        validated_on=report.signed_at or utcnow(),
        links={
            "evidence_report_id": report.id,
            "evidence_pdf_file_id": report.pdf_file_id,
            "challenge_reference": challenge.reference if challenge else None,
            "pilot_reference": pilot.reference,
        },
        share_token=new_share_token(),
    )
    session.add(passport)
    await session.flush()

    await audit.record(
        session,
        action="passport.issued",
        entity_type="innovation_passport",
        entity_id=passport.id,
        actor_id=report.validator_id,
        actor_role=Role.INDEPENDENT_VALIDATOR,
        department_id=pilot.department_id,
        after={
            "reference": passport.reference,
            "confidence_score": passport.confidence_score,
            "band": passport.band,
        },
    )
    outbox.emit(
        session,
        aggregate_type="innovation_passport",
        aggregate_id=passport.id,
        event_type="passport.issued",
        payload={
            "reference": passport.reference,
            "startup_id": passport.startup_id,
            "department_id": passport.department_id,
            "confidence_score": passport.confidence_score,
        },
    )
    return passport


async def search_passports(
    session: AsyncSession,
    *,
    category: str | None = None,
    sector: str | None = None,
    query: str | None = None,
    min_score: float | None = None,
    limit: int = 50,
) -> list[InnovationPassport]:
    stmt = select(InnovationPassport).order_by(InnovationPassport.confidence_score.desc())
    if category:
        stmt = stmt.where(InnovationPassport.category == category)
    if sector:
        stmt = stmt.where(InnovationPassport.sector == sector)
    if min_score is not None:
        stmt = stmt.where(InnovationPassport.confidence_score >= min_score)
    if query:
        pattern = "%" + query.strip() + "%"
        stmt = stmt.where(
            or_(
                InnovationPassport.solution_name.ilike(pattern),
                InnovationPassport.category.ilike(pattern),
            )
        )
    stmt = stmt.limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def get_passport(session: AsyncSession, passport_id: str) -> InnovationPassport:
    passport = await session.get(InnovationPassport, passport_id)
    if passport is None:
        raise NotFound("This Innovation Passport was not found.")
    return passport


async def passport_by_token(session: AsyncSession, token: str) -> InnovationPassport:
    result = await session.execute(
        select(InnovationPassport).where(InnovationPassport.share_token == token)
    )
    passport = result.scalar_one_or_none()
    if passport is None:
        raise NotFound("This share link is not valid.")
    return passport


async def raise_adoption_request(
    session: AsyncSession,
    passport: InnovationPassport,
    principal: Principal,
    *,
    department_id: str,
    intent: str,
    note: str,
    adopting_context: dict[str, Any] | None = None,
) -> AdoptionRequest:
    """Another department reuses the evidence instead of repeating the experiment."""
    fit = context_fit(passport.context or {}, adopting_context or {})
    request = AdoptionRequest(
        passport_id=passport.id,
        department_id=department_id,
        raised_by=principal.user_id,
        intent=intent,
        note=note.strip(),
        context_fit={"rows": fit},
        state=AdoptionState.RAISED,
    )
    session.add(request)
    await session.flush()

    if intent == "new_challenge":
        prefilled = await _prefill_challenge(session, passport, principal, department_id)
        request.prefilled_challenge_id = prefilled.id
        await session.flush()

    await audit.record(
        session,
        action="passport.adoption_requested",
        entity_type="innovation_passport",
        entity_id=passport.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=department_id,
        after={"intent": intent, "adoption_request_id": request.id},
        reason=note.strip() or None,
    )
    outbox.emit(
        session,
        aggregate_type="innovation_passport",
        aggregate_id=passport.id,
        event_type="passport.adoption_requested",
        payload={
            "adoption_request_id": request.id,
            "department_id": department_id,
            "intent": intent,
            "passport_reference": passport.reference,
            "original_department_id": passport.department_id,
        },
    )
    return request


async def _prefill_challenge(
    session: AsyncSession,
    passport: InnovationPassport,
    principal: Principal,
    department_id: str,
) -> Challenge:
    """Pre-fill a new challenge from the passport, with the original evidence attached."""
    from app.services import challenges as challenges_service

    source = await session.get(Pilot, passport.pilot_id)
    original = await session.get(Challenge, source.challenge_id) if source else None
    result = passport.result_summary or {}

    challenge = await challenges_service.create_draft(
        session,
        principal,
        department_id=department_id,
        title=(original.title if original else passport.solution_name),
        problem_statement=(original.problem_statement if original else ""),
    )
    challenge.outcome_statement = original.outcome_statement if original else ""
    challenge.current_situation = original.current_situation if original else ""
    challenge.constraints = original.constraints if original else ""
    challenge.pilot_scope = original.pilot_scope if original else ""
    challenge.sector = passport.sector
    challenge.budget_ceiling_paise = original.budget_ceiling_paise if original else 0
    challenge.eligibility_rules = {
        **(original.eligibility_rules if original else {}),
        "prior_evidence": {
            "passport_reference": passport.reference,
            "confidence_score": passport.confidence_score,
            "band": passport.band,
            "validated_on": passport.validated_on.isoformat(),
            "original_department_id": passport.department_id,
            "measured_effect": result.get("effect"),
            "ci_low": result.get("ci_low"),
            "ci_high": result.get("ci_high"),
        },
    }

    if original is not None:
        from app.models.challenge import Kpi as KpiModel
        from app.models.challenge import RubricCriterion as CriterionModel

        for kpi in original.kpis:
            session.add(
                KpiModel(
                    challenge_id=challenge.id,
                    position=kpi.position,
                    name=kpi.name,
                    unit=kpi.unit,
                    kind=kpi.kind,
                    direction=kpi.direction,
                    baseline_value=None,
                    baseline_method=kpi.baseline_method,
                    baseline_source=kpi.baseline_source,
                    baseline_plan="Collect a local baseline before the pilot starts, using the "
                    "method described here.",
                    target_value=kpi.target_value,
                    is_primary=kpi.is_primary,
                )
            )
        for criterion in original.criteria:
            session.add(
                CriterionModel(
                    challenge_id=challenge.id,
                    position=criterion.position,
                    name=criterion.name,
                    description=criterion.description,
                    weight=criterion.weight,
                    anchors=criterion.anchors,
                    round_number=criterion.round_number,
                )
            )
    await session.flush()
    return challenge


async def adoption_requests_for(
    session: AsyncSession, passport_id: str
) -> list[AdoptionRequest]:
    rows = await session.execute(
        select(AdoptionRequest)
        .where(AdoptionRequest.passport_id == passport_id)
        .order_by(AdoptionRequest.created_at.desc())
    )
    return list(rows.scalars().all())


async def _report(session: AsyncSession, pilot_id: str) -> EvidenceReport:
    result = await session.execute(select(EvidenceReport).where(EvidenceReport.pilot_id == pilot_id))
    report = result.scalar_one_or_none()
    if report is None:
        raise NotFound(
            "This pilot has no Evidence Report yet. Run the Evidence Engine before requesting a "
            "pathway or a decision."
        )
    return report


def passport_view(passport: InnovationPassport) -> dict[str, Any]:
    return {
        "id": passport.id,
        "reference": passport.reference,
        "solution_name": passport.solution_name,
        "category": passport.category,
        "sector": passport.sector,
        "state_code": passport.state_code,
        "district": passport.district,
        "context": passport.context,
        "result_summary": passport.result_summary,
        "confidence_score": passport.confidence_score,
        "band": passport.band,
        "validator_name": passport.validator_name,
        "validated_on": passport.validated_on.isoformat(),
        "links": passport.links,
        "passport_version": passport.passport_version,
        "startup_name": passport.startup.legal_name if passport.startup else None,
        "department_name": passport.department.name if passport.department else None,
        "share_token": passport.share_token,
        "status_note": (
            "Evidence validated independently. Read the context before assuming the same result "
            "in a different setting."
        ),
    }


def evidence_status_labels() -> dict[str, str]:
    return {
        EvidenceStatus.DRAFT: "Draft",
        EvidenceStatus.AWAITING_VALIDATION: "Awaiting independent validation",
        EvidenceStatus.SIGNED_OFF: "Validated",
        EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS: "Validated with qualifications",
        EvidenceStatus.REFUSED: "Validation refused",
    }

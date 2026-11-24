"""Applications and eligibility screening (PRD 5.3, 5.4).

The deadline is compared against database time inside the transaction, never against
client or application-server time, and the closure job takes a row lock, so a submission
either commits before closure or is rejected after it (PRD 10.3).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.ids import short_ref
from app.core.policy import Principal
from app.domain.eligibility import ScreeningInput, screen
from app.domain.states import ApplicationState, ChallengeState, EligibilityOutcome, Role
from app.models.application import Application, EligibilityResult
from app.models.challenge import Challenge
from app.models.startup import Startup
from app.services import audit, outbox

CLARIFICATION_WINDOW_DAYS = 3


async def get(session: AsyncSession, application_id: str) -> Application:
    application = await session.get(Application, application_id)
    if application is None:
        raise NotFound("This application was not found.")
    return application


async def start_application(
    session: AsyncSession, challenge: Challenge, startup: Startup, principal: Principal
) -> Application:
    if challenge.state != ChallengeState.PUBLISHED:
        raise ValidationFailed(
            "This challenge is not open for applications.",
            errors=[
                {
                    "field": "challenge",
                    "detail": "The challenge is in state " + challenge.state + ".",
                    "fix": "Open challenges are listed on the challenge board.",
                }
            ],
        )
    missing = startup.missing_fields()
    if missing:
        raise ValidationFailed(
            "Complete the startup profile before applying.",
            errors=[
                {
                    "field": "startup." + field,
                    "detail": "This field is required before applying.",
                    "fix": "Fill it on the startup profile page.",
                }
                for field in missing
            ],
        )

    application = Application(
        reference=short_ref("AP"),
        challenge_id=challenge.id,
        startup_id=startup.id,
        created_by=principal.user_id,
        state=ApplicationState.DRAFT,
    )
    session.add(application)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        existing = await session.execute(
            select(Application).where(
                Application.challenge_id == challenge.id, Application.startup_id == startup.id
            )
        )
        found = existing.scalar_one_or_none()
        if found is not None:
            return found
        raise
    await session.refresh(application)
    return application


async def submit(
    session: AsyncSession,
    application: Application,
    challenge: Challenge,
    principal: Principal,
    *,
    request_id: str | None = None,
) -> Application:
    """Lock the submission against the server clock, to the second (FR-DM-07)."""
    now = utcnow()

    if challenge.state != ChallengeState.PUBLISHED:
        raise Conflict(
            "Applications for this challenge closed before your submission was received. "
            "The challenge is now in state " + challenge.state + ".",
            extra={"challenge_state": challenge.state},
        )
    if challenge.application_deadline is not None and now > challenge.application_deadline:
        late_by = (now - challenge.application_deadline).total_seconds()
        raise Conflict(
            "The application deadline passed "
            + str(int(late_by))
            + " seconds ago, so this submission cannot be accepted. The deadline is compared "
            "against server time.",
            extra={
                "deadline": challenge.application_deadline.isoformat(),
                "server_time": now.isoformat(),
                "late_by_seconds": int(late_by),
            },
        )

    problems = application.blocking_problems()
    if problems:
        raise ValidationFailed(
            "This application is not complete enough to submit.", errors=problems
        )

    if challenge.budget_ceiling_paise > 0 and application.pilot_cost_paise > challenge.budget_ceiling_paise:
        raise ValidationFailed(
            "The quoted pilot cost is above the published ceiling for this challenge.",
            errors=[
                {
                    "field": "pilot_cost_paise",
                    "detail": "The ceiling is "
                    + str(challenge.budget_ceiling_paise // 100)
                    + " rupees and the quote is "
                    + str(application.pilot_cost_paise // 100)
                    + " rupees.",
                    "fix": "Reduce the scope or the quote so it is at or below the ceiling.",
                }
            ],
        )

    previously_submitted = application.state == ApplicationState.SUBMITTED
    application.state = ApplicationState.SUBMITTED
    application.submitted_at = now
    application.version = (application.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="application.submitted",
        entity_type="application",
        entity_id=application.id,
        actor_id=principal.user_id,
        actor_role=Role.STARTUP_USER,
        department_id=challenge.department_id,
        before={"state": ApplicationState.DRAFT if not previously_submitted else ApplicationState.SUBMITTED},
        after={"state": application.state, "submitted_at": now.isoformat()},
        request_id=request_id,
    )
    outbox.emit(
        session,
        aggregate_type="application",
        aggregate_id=application.id,
        event_type="application.submitted",
        payload={
            "challenge_id": challenge.id,
            "startup_id": application.startup_id,
            "reference": application.reference,
            "resubmission": previously_submitted,
        },
    )
    return application


async def lock_for_challenge(session: AsyncSession, challenge: Challenge) -> int:
    """Lock the last submitted version of every application at the deadline."""
    now = utcnow()
    rows = await session.execute(
        select(Application).where(
            Application.challenge_id == challenge.id,
            Application.state == ApplicationState.SUBMITTED,
        )
    )
    locked = 0
    for application in rows.scalars().all():
        application.state = ApplicationState.LOCKED
        application.locked_at = now
        application.version = (application.version or 0) + 1
        locked += 1
    await session.flush()
    return locked


async def screen_challenge(
    session: AsyncSession, challenge: Challenge, principal: Principal
) -> list[EligibilityResult]:
    """Run the rules engine over every locked application (FR-ES-01)."""
    rows = await session.execute(
        select(Application, Startup)
        .join(Startup, Startup.id == Application.startup_id)
        .where(
            Application.challenge_id == challenge.id,
            Application.state.in_(
                (ApplicationState.LOCKED, ApplicationState.SUBMITTED, ApplicationState.SCREENED)
            ),
        )
    )
    required_kpis = len(challenge.kpis)
    results: list[EligibilityResult] = []
    now = utcnow()

    for application, startup in rows.all():
        data = ScreeningInput(
            dpiit_status=startup.dpiit_status,
            sectors=list(startup.sectors or []),
            state_code=startup.state_code,
            district=startup.district,
            annual_turnover_paise=startup.annual_turnover_paise,
            years_of_experience=startup.years_of_experience,
            pilot_cost_paise=application.pilot_cost_paise,
            conflict_declaration=application.conflict_declaration,
            ip_declaration=application.ip_declaration,
            data_declaration=application.data_declaration,
            kpi_commitment_count=len(application.kpi_commitments or []),
            challenge_sector=challenge.sector,
            challenge_state_code=challenge.state_code,
            challenge_district=challenge.district,
            location_required=challenge.location_required,
            budget_ceiling_paise=challenge.budget_ceiling_paise,
            required_kpi_count=required_kpis,
            rules=dict(challenge.eligibility_rules or {}),
        )
        outcome = screen(data)

        existing = await session.execute(
            select(EligibilityResult).where(EligibilityResult.application_id == application.id)
        )
        record = existing.scalar_one_or_none()
        if record is None:
            record = EligibilityResult(
                application_id=application.id,
                outcome=outcome.outcome,
                rule_results=outcome.rule_results,
                relaxations_applied=outcome.relaxations_applied,
                screened_at=now,
            )
            session.add(record)
        else:
            record.outcome = outcome.outcome
            record.rule_results = outcome.rule_results
            record.relaxations_applied = outcome.relaxations_applied
            record.screened_at = now

        if outcome.outcome == EligibilityOutcome.INELIGIBLE:
            record.clarification_window_ends = now + timedelta(days=CLARIFICATION_WINDOW_DAYS)

        application.state = ApplicationState.SCREENED
        application.version = (application.version or 0) + 1
        results.append(record)

        outbox.emit(
            session,
            aggregate_type="application",
            aggregate_id=application.id,
            event_type="application.eligibility_decided",
            payload={
                "outcome": outcome.outcome,
                "summary": outcome.summary,
                "challenge_id": challenge.id,
                "startup_id": application.startup_id,
                "relaxations": outcome.relaxations_applied,
            },
        )

    await session.flush()
    await audit.record(
        session,
        action="challenge.screened",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={
            "screened": len(results),
            "eligible": sum(1 for r in results if r.outcome == EligibilityOutcome.ELIGIBLE),
            "ineligible": sum(1 for r in results if r.outcome == EligibilityOutcome.INELIGIBLE),
            "needs_review": sum(1 for r in results if r.outcome == EligibilityOutcome.NEEDS_REVIEW),
        },
    )
    return results


async def override_eligibility(
    session: AsyncSession,
    application: Application,
    challenge: Challenge,
    principal: Principal,
    *,
    outcome: str,
    justification: str,
) -> EligibilityResult:
    """An override always needs a written justification, logged and visible to the approver."""
    if not justification.strip():
        raise ValidationFailed(
            "An override must be recorded with a written justification.",
            errors=[
                {
                    "field": "justification",
                    "detail": "No justification was given.",
                    "fix": "Explain why the screening result is being changed. The approver and "
                    "any auditor will read this.",
                }
            ],
        )
    existing = await session.execute(
        select(EligibilityResult).where(EligibilityResult.application_id == application.id)
    )
    record = existing.scalar_one_or_none()
    if record is None:
        raise NotFound("This application has not been screened yet.")

    before = record.outcome
    record.original_outcome = record.original_outcome or before
    record.outcome = outcome
    record.overridden_by = principal.user_id
    record.override_reason = justification.strip()
    await session.flush()

    await audit.record(
        session,
        action="application.eligibility_overridden",
        entity_type="application",
        entity_id=application.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        before={"outcome": before},
        after={"outcome": outcome},
        reason=justification.strip(),
    )
    outbox.emit(
        session,
        aggregate_type="application",
        aggregate_id=application.id,
        event_type="application.eligibility_overridden",
        payload={
            "from": before,
            "to": outcome,
            "challenge_id": challenge.id,
            "justification": justification.strip(),
        },
    )
    return record


async def eligible_applications(session: AsyncSession, challenge_id: str) -> list[Application]:
    rows = await session.execute(
        select(Application)
        .join(EligibilityResult, EligibilityResult.application_id == Application.id)
        .where(
            Application.challenge_id == challenge_id,
            EligibilityResult.outcome == EligibilityOutcome.ELIGIBLE,
        )
        .order_by(Application.reference.asc())
    )
    return list(rows.scalars().all())


async def list_for_challenge(session: AsyncSession, challenge_id: str) -> list[Application]:
    rows = await session.execute(
        select(Application)
        .where(Application.challenge_id == challenge_id)
        .order_by(Application.created_at.asc())
    )
    return list(rows.scalars().all())


async def list_for_startup(session: AsyncSession, startup_id: str) -> list[Application]:
    rows = await session.execute(
        select(Application)
        .where(Application.startup_id == startup_id)
        .order_by(Application.created_at.desc())
    )
    return list(rows.scalars().all())


async def count_for_challenge(session: AsyncSession, challenge_id: str) -> int:
    result = await session.execute(
        select(func.count()).select_from(Application).where(Application.challenge_id == challenge_id)
    )
    return int(result.scalar_one())


def application_form_schema(challenge: Challenge) -> dict[str, Any]:
    """The application form is generated from the challenge (FR-DM-06)."""
    return {
        "challenge_reference": challenge.reference,
        "challenge_title": challenge.title,
        "budget_ceiling_paise": challenge.budget_ceiling_paise,
        "pilot_duration_weeks": challenge.pilot_duration_weeks,
        "fields": [
            {
                "key": "proposal_summary",
                "label": "What are you proposing?",
                "help": "Two or three sentences a non-technical officer can understand.",
                "type": "textarea",
                "required": True,
                "min_length": 80,
            },
            {
                "key": "approach",
                "label": "How will it work during the pilot?",
                "help": "Deployment, operation, support and how each measure will be recorded.",
                "type": "textarea",
                "required": True,
                "min_length": 80,
            },
            {
                "key": "kpi_commitments",
                "label": "What do you commit to on each measure?",
                "help": "Enter the value you commit to reach by the end of the pilot.",
                "type": "kpi_table",
                "required": True,
                "kpis": [
                    {
                        "kpi_id": kpi.id,
                        "name": kpi.name,
                        "unit": kpi.unit,
                        "direction": kpi.direction,
                        "baseline_value": float(kpi.baseline_value) if kpi.baseline_value is not None else None,
                        "target_value": float(kpi.target_value) if kpi.target_value is not None else None,
                        "is_primary": kpi.is_primary,
                    }
                    for kpi in challenge.kpis
                ],
            },
            {
                "key": "pilot_cost_paise",
                "label": "Total pilot cost",
                "help": "In rupees, inclusive of all taxes. Must be at or below the ceiling.",
                "type": "money",
                "required": True,
            },
            {
                "key": "timeline_weeks",
                "label": "Weeks needed for the pilot",
                "type": "number",
                "required": True,
            },
            {
                "key": "data_declaration",
                "label": "What data do you need, and where will it be stored?",
                "help": "State the datasets, the storage location, which must be in India, and "
                "the retention period.",
                "type": "textarea",
                "required": True,
            },
            {
                "key": "ip_declaration",
                "label": "Intellectual property option you accept",
                "type": "select",
                "required": True,
                "options": [
                    {"value": "startup_retains", "label": "Startup retains ownership, government gets a licence"},
                    {"value": "joint", "label": "Joint ownership of what is built for this pilot"},
                    {"value": "government_owned", "label": "Government owns the bespoke work"},
                ],
            },
            {
                "key": "conflict_declaration",
                "label": "Conflict of interest declaration",
                "help": "I confirm that no director, employee or adviser of this startup holds a "
                "position in the department publishing this challenge, and that no conflict of "
                "interest exists in relation to this application.",
                "type": "checkbox",
                "required": True,
            },
        ],
    }

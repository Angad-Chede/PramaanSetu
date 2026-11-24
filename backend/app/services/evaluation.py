"""Expert evaluation (PRD 5.5).

Round one is blind, conflict declarations are mandatory before scoring, scores lock when
every evaluator has submitted or at the deadline, and a locked score cannot be edited
without a logged reopening by the approver.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.policy import Principal
from app.domain.scoring import ApplicationScore, aggregate_application, blind_label, rank, validate_score
from app.domain.states import ApplicationState, Role
from app.models.application import Application
from app.models.challenge import Challenge, RubricCriterion
from app.models.evaluation import CoiDeclaration, EvaluationScore, PanelMember
from app.models.identity import AppUser, RoleAssignment
from app.services import applications as applications_service
from app.services import audit, outbox

MINIMUM_PANEL_SIZE = 3


async def assign_panel(
    session: AsyncSession,
    challenge: Challenge,
    principal: Principal,
    *,
    evaluator_ids: list[str],
    validator_ids: list[str],
) -> list[PanelMember]:
    """Assign evaluators and validators, enforcing the conflict rules in PRD 3.1."""
    if len(set(evaluator_ids)) < MINIMUM_PANEL_SIZE:
        raise ValidationFailed(
            "A panel needs at least " + str(MINIMUM_PANEL_SIZE) + " evaluators.",
            errors=[
                {
                    "field": "evaluator_ids",
                    "detail": str(len(set(evaluator_ids))) + " evaluators were named.",
                    "fix": "Add more empanelled evaluators to this challenge.",
                }
            ],
        )
    overlap = set(evaluator_ids) & set(validator_ids)
    if overlap:
        raise ValidationFailed(
            "The same person cannot evaluate and validate the same challenge.",
            errors=[
                {
                    "field": "validator_ids",
                    "detail": str(len(overlap)) + " people appear in both lists.",
                    "fix": "Name a different independent validator with no part in the evaluation.",
                }
            ],
        )

    existing = await session.execute(
        select(PanelMember).where(PanelMember.challenge_id == challenge.id)
    )
    current = {(row.user_id, row.role): row for row in existing.scalars().all()}
    members: list[PanelMember] = []

    for role, user_ids in (
        (Role.EXPERT_EVALUATOR, evaluator_ids),
        (Role.INDEPENDENT_VALIDATOR, validator_ids),
    ):
        for user_id in user_ids:
            user = await session.get(AppUser, user_id)
            if user is None:
                raise NotFound("Panel member " + user_id + " was not found.")
            if role == Role.INDEPENDENT_VALIDATOR and user.department_id == challenge.department_id:
                raise ValidationFailed(
                    "An independent validator cannot belong to the department running the pilot.",
                    errors=[
                        {
                            "field": "validator_ids",
                            "detail": user.name + " belongs to the owning department.",
                            "fix": "Name a validator from another department or an external body.",
                        }
                    ],
                )
            key = (user_id, str(role))
            member = current.get(key)
            if member is None:
                member = PanelMember(
                    challenge_id=challenge.id,
                    user_id=user_id,
                    role=str(role),
                    assigned_by=principal.user_id,
                )
                session.add(member)
            member.active = True
            members.append(member)

            scoped = await session.execute(
                select(RoleAssignment).where(
                    RoleAssignment.user_id == user_id,
                    RoleAssignment.role == str(role),
                    RoleAssignment.scope_type == "challenge",
                    RoleAssignment.scope_id == challenge.id,
                )
            )
            if scoped.scalar_one_or_none() is None:
                session.add(
                    RoleAssignment(
                        user_id=user_id,
                        role=str(role),
                        scope_type="challenge",
                        scope_id=challenge.id,
                    )
                )

    await session.flush()
    for member in members:
        # Load the member relationship so a serialiser can read the name without a
        # lazy load outside the async context.
        await session.refresh(member)
    await audit.record(
        session,
        action="challenge.panel_assigned",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={"evaluators": len(evaluator_ids), "validators": len(validator_ids)},
    )
    outbox.emit(
        session,
        aggregate_type="challenge",
        aggregate_id=challenge.id,
        event_type="challenge.panel_assigned",
        payload={
            "evaluator_ids": evaluator_ids,
            "validator_ids": validator_ids,
            "reference": challenge.reference,
            "title": challenge.title,
        },
    )
    return members


async def panel(session: AsyncSession, challenge_id: str, role: str | None = None) -> list[PanelMember]:
    stmt = select(PanelMember).where(
        PanelMember.challenge_id == challenge_id, PanelMember.active.is_(True)
    )
    if role:
        stmt = stmt.where(PanelMember.role == role)
    return list((await session.execute(stmt)).scalars().all())


async def declare_conflict(
    session: AsyncSession,
    application: Application,
    principal: Principal,
    *,
    has_conflict: bool,
    statement: str,
) -> CoiDeclaration:
    if has_conflict and not statement.strip():
        raise ValidationFailed(
            "A declared conflict must be described.",
            errors=[
                {
                    "field": "statement",
                    "detail": "No description was given.",
                    "fix": "Describe the relationship that creates the conflict.",
                }
            ],
        )
    existing = await session.execute(
        select(CoiDeclaration).where(
            CoiDeclaration.user_id == principal.user_id,
            CoiDeclaration.application_id == application.id,
        )
    )
    record = existing.scalar_one_or_none()
    if record is None:
        record = CoiDeclaration(
            user_id=principal.user_id,
            application_id=application.id,
            has_conflict=has_conflict,
            statement=statement.strip(),
            declared_at=utcnow(),
        )
        session.add(record)
    else:
        record.has_conflict = has_conflict
        record.statement = statement.strip()
        record.declared_at = utcnow()
    await session.flush()

    await audit.record(
        session,
        action="evaluation.coi_declared",
        entity_type="application",
        entity_id=application.id,
        actor_id=principal.user_id,
        actor_role=Role.EXPERT_EVALUATOR,
        after={"has_conflict": has_conflict},
        reason=statement.strip() or None,
    )
    return record


async def conflict_declaration(
    session: AsyncSession, application_id: str, user_id: str
) -> CoiDeclaration | None:
    result = await session.execute(
        select(CoiDeclaration).where(
            CoiDeclaration.user_id == user_id, CoiDeclaration.application_id == application_id
        )
    )
    return result.scalar_one_or_none()


async def submit_scores(
    session: AsyncSession,
    application: Application,
    challenge: Challenge,
    principal: Principal,
    *,
    scores: list[dict[str, Any]],
    round_number: int = 1,
) -> list[EvaluationScore]:
    """Score every criterion, each with a mandatory one-line justification (FR-EV-03)."""
    declaration = await conflict_declaration(session, application.id, principal.user_id)
    if declaration is None:
        raise Forbidden(
            "Declare whether you have a conflict of interest on this application before scoring it."
        )
    if declaration.has_conflict:
        raise Forbidden(
            "You declared a conflict of interest on this application, so you cannot score it."
        )

    criteria = {c.id: c for c in challenge.criteria if c.round_number == round_number}
    if not criteria:
        raise ValidationFailed("This challenge has no rubric criteria for round " + str(round_number) + ".")

    provided = {str(item.get("criterion_id")) for item in scores}
    missing = set(criteria) - provided
    if missing:
        raise ValidationFailed(
            "Every criterion must be scored before the sheet can be submitted.",
            errors=[
                {
                    "field": "scores",
                    "detail": criteria[cid].name + " has not been scored.",
                    "fix": "Give a score from 1 to 5 and a one-line justification.",
                }
                for cid in missing
            ],
        )

    saved: list[EvaluationScore] = []
    for item in scores:
        criterion_id = str(item.get("criterion_id"))
        if criterion_id not in criteria:
            continue
        value = int(item.get("score", 0))
        validate_score(value)
        justification = str(item.get("justification", "")).strip()
        if len(justification) < 10:
            raise ValidationFailed(
                "Each score needs a written justification.",
                errors=[
                    {
                        "field": "scores." + criteria[criterion_id].name,
                        "detail": "The justification is missing or too short.",
                        "fix": "Write one line saying why this score, referring to the proposal.",
                    }
                ],
            )

        existing = await session.execute(
            select(EvaluationScore).where(
                EvaluationScore.application_id == application.id,
                EvaluationScore.evaluator_id == principal.user_id,
                EvaluationScore.criterion_id == criterion_id,
                EvaluationScore.round_number == round_number,
            )
        )
        record = existing.scalar_one_or_none()
        if record is not None and record.locked:
            raise Forbidden(
                "Scores for this challenge are locked. Ask the approver to reopen scoring if a "
                "correction is needed; the reopening is recorded."
            )
        if record is None:
            record = EvaluationScore(
                application_id=application.id,
                evaluator_id=principal.user_id,
                criterion_id=criterion_id,
                round_number=round_number,
                score=value,
                justification=justification,
                submitted_at=utcnow(),
            )
            session.add(record)
        else:
            record.score = value
            record.justification = justification
            record.submitted_at = utcnow()
        saved.append(record)

    if application.state != ApplicationState.UNDER_EVALUATION:
        application.state = ApplicationState.UNDER_EVALUATION
        application.version = (application.version or 0) + 1

    await session.flush()
    await audit.record(
        session,
        action="evaluation.scores_submitted",
        entity_type="application",
        entity_id=application.id,
        actor_id=principal.user_id,
        actor_role=Role.EXPERT_EVALUATOR,
        department_id=challenge.department_id,
        after={"round": round_number, "criteria_scored": len(saved)},
    )
    return saved


async def lock_scores(
    session: AsyncSession, challenge: Challenge, principal: Principal, *, reason: str | None = None
) -> int:
    rows = await session.execute(
        select(EvaluationScore)
        .join(Application, Application.id == EvaluationScore.application_id)
        .where(Application.challenge_id == challenge.id, EvaluationScore.locked.is_(False))
    )
    locked = 0
    for record in rows.scalars().all():
        record.locked = True
        locked += 1
    await session.flush()

    await audit.record(
        session,
        action="challenge.lock-scores",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={"scores_locked": locked},
        reason=reason,
    )
    return locked


async def reopen_scores(
    session: AsyncSession, challenge: Challenge, principal: Principal, reason: str
) -> int:
    """Only the approver may reopen, and only with a logged reason (FR-EV-05)."""
    if not reason.strip():
        raise ValidationFailed(
            "Reopening scoring must be recorded with a reason.",
            errors=[
                {
                    "field": "reason",
                    "detail": "No reason was given.",
                    "fix": "Explain why the locked scores must be reopened.",
                }
            ],
        )
    rows = await session.execute(
        select(EvaluationScore)
        .join(Application, Application.id == EvaluationScore.application_id)
        .where(Application.challenge_id == challenge.id, EvaluationScore.locked.is_(True))
    )
    reopened = 0
    for record in rows.scalars().all():
        record.locked = False
        reopened += 1
    await session.flush()

    await audit.record(
        session,
        action="challenge.scores_reopened",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_APPROVER,
        department_id=challenge.department_id,
        after={"scores_reopened": reopened},
        reason=reason.strip(),
    )
    return reopened


async def ranking(session: AsyncSession, challenge: Challenge) -> list[dict[str, Any]]:
    """Weighted scores, variance flags and the proposed order (FR-EV-04, FR-EV-07)."""
    eligible = await applications_service.eligible_applications(session, challenge.id)
    evaluators = await panel(session, challenge.id, Role.EXPERT_EVALUATOR)
    expected = max(1, len(evaluators))

    criteria_rows = await session.execute(
        select(RubricCriterion)
        .where(RubricCriterion.challenge_id == challenge.id, RubricCriterion.round_number == 1)
        .order_by(RubricCriterion.position.asc())
    )
    criteria = [(c.id, c.name, c.weight) for c in criteria_rows.scalars().all()]

    aggregates: list[ApplicationScore] = []
    for application in eligible:
        score_rows = await session.execute(
            select(EvaluationScore).where(
                EvaluationScore.application_id == application.id, EvaluationScore.round_number == 1
            )
        )
        scores = [(s.criterion_id, s.evaluator_id, float(s.score)) for s in score_rows.scalars().all()]
        aggregates.append(aggregate_application(application.id, criteria, scores, expected))

    ordered = rank(aggregates)
    by_id = {a.id: a for a in eligible}
    for index, row in enumerate(ordered):
        application = by_id[row["application_id"]]
        row["reference"] = application.reference
        row["blind_label"] = blind_label(index)
        row["startup_id"] = application.startup_id
        row["pilot_cost_paise"] = application.pilot_cost_paise
    return ordered


async def confirm_shortlist(
    session: AsyncSession,
    challenge: Challenge,
    principal: Principal,
    *,
    application_ids: list[str],
) -> list[Application]:
    if not application_ids:
        raise ValidationFailed(
            "A shortlist must name at least one application.",
            errors=[
                {
                    "field": "application_ids",
                    "detail": "No applications were selected.",
                    "fix": "Select the applications to take forward to pilot design.",
                }
            ],
        )
    all_applications = await applications_service.list_for_challenge(session, challenge.id)
    selected: list[Application] = []
    for position, application_id in enumerate(application_ids, start=1):
        application = next((a for a in all_applications if a.id == application_id), None)
        if application is None:
            raise NotFound("Application " + application_id + " is not on this challenge.")
        application.state = ApplicationState.SHORTLISTED
        application.shortlist_rank = position
        application.version = (application.version or 0) + 1
        selected.append(application)

    for application in all_applications:
        if application.id not in application_ids and application.state in (
            ApplicationState.UNDER_EVALUATION,
            ApplicationState.SCREENED,
            ApplicationState.LOCKED,
        ):
            application.state = ApplicationState.NOT_SHORTLISTED
            application.version = (application.version or 0) + 1

    await session.flush()
    await audit.record(
        session,
        action="challenge.confirm-shortlist",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_APPROVER,
        department_id=challenge.department_id,
        after={"shortlisted": [a.reference for a in selected]},
    )
    outbox.emit(
        session,
        aggregate_type="challenge",
        aggregate_id=challenge.id,
        event_type="challenge.shortlist_confirmed",
        payload={
            "challenge_id": challenge.id,
            "shortlisted_application_ids": application_ids,
            "reference": challenge.reference,
        },
    )
    return selected


def blind_view(application: Application, index: int) -> dict[str, Any]:
    """Round one hides identity: name, founders, logo and case-reference names (FR-EV-02)."""
    return {
        "id": application.id,
        "blind_label": blind_label(index),
        "proposal_summary": application.proposal_summary,
        "approach": application.approach,
        "kpi_commitments": application.kpi_commitments,
        "pilot_cost_paise": application.pilot_cost_paise,
        "timeline_weeks": application.timeline_weeks,
        "data_declaration": application.data_declaration,
        "ip_declaration": application.ip_declaration,
        "submitted_at": application.submitted_at.isoformat() if application.submitted_at else None,
    }


async def evaluator_progress(
    session: AsyncSession, challenge_id: str, evaluator_id: str
) -> dict[str, Any]:
    eligible = await applications_service.eligible_applications(session, challenge_id)
    scored = await session.execute(
        select(EvaluationScore.application_id)
        .where(EvaluationScore.evaluator_id == evaluator_id)
        .where(EvaluationScore.application_id.in_([a.id for a in eligible] or [""]))
    )
    scored_ids = {row for row in scored.scalars().all()}
    declared = await session.execute(
        select(CoiDeclaration.application_id)
        .where(CoiDeclaration.user_id == evaluator_id)
        .where(CoiDeclaration.application_id.in_([a.id for a in eligible] or [""]))
    )
    declared_ids = {row for row in declared.scalars().all()}
    return {
        "total": len(eligible),
        "declared": len(declared_ids),
        "scored": len(scored_ids),
        "pending": len(eligible) - len(scored_ids),
    }

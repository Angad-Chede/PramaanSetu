"""Challenge Builder service (PRD 5.1).

Owns the challenge aggregate: drafting, the quality checklist, the publication workflow,
corrigenda and clarifications. Every state change writes an audit entry and an outbox
event in the same transaction as the change itself.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.errors import NotFound, ValidationFailed
from app.core.ids import short_ref
from app.core.policy import Principal
from app.domain.states import ChallengeState, Role, check_transition
from app.models.challenge import Challenge, Clarification, Corrigendum, Kpi, RubricCriterion
from app.services import audit, outbox, templates

VAGUE_TERMS = (
    "improve", "optimise", "optimize", "enhance", "streamline", "modernise", "modernize",
    "better", "efficient", "efficiency", "leverage", "robust", "state of the art",
    "world class", "seamless", "cutting edge",
)

IP_OPTION_LABELS = {
    "startup_retains": "Startup retains ownership, government gets a licence to use",
    "joint": "Joint ownership of what is built for this pilot",
    "government_owned": "Government owns the bespoke work",
}


async def create_draft(
    session: AsyncSession,
    principal: Principal,
    *,
    department_id: str,
    title: str = "",
    problem_statement: str = "",
) -> Challenge:
    version_map = await templates.latest_versions(session, templates.CHALLENGE_TEMPLATE_KINDS)
    challenge = Challenge(
        reference=short_ref("CH"),
        department_id=department_id,
        created_by=principal.user_id,
        state=ChallengeState.DRAFT,
        title=title,
        problem_statement=problem_statement,
        template_versions=version_map,
    )
    session.add(challenge)
    await session.flush()
    # Load the relationships eagerly: a serialiser reading challenge.department or
    # challenge.kpis on a freshly flushed object would otherwise trigger a lazy load.
    await session.refresh(challenge)
    await audit.record(
        session,
        action="challenge.draft_created",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=department_id,
        after={"reference": challenge.reference, "state": challenge.state},
    )
    return challenge


async def get(session: AsyncSession, challenge_id: str) -> Challenge:
    challenge = await session.get(Challenge, challenge_id)
    if challenge is None:
        raise NotFound("This challenge was not found. It may have been removed.")
    return challenge


async def apply_draft(
    session: AsyncSession, challenge: Challenge, draft: dict[str, Any], *, overwrite: bool = True
) -> None:
    """Apply an AI or template draft. Everything stays fully editable (FR-CB-02)."""
    mapping = {
        "title": "title",
        "outcome_statement": "outcome_statement",
        "current_situation": "current_situation",
        "constraints": "constraints",
        "pilot_scope": "pilot_scope",
    }
    for source, target in mapping.items():
        value = draft.get(source)
        if value and (overwrite or not getattr(challenge, target)):
            setattr(challenge, target, value)
    if draft.get("sector") and (overwrite or not challenge.sector):
        challenge.sector = draft["sector"]

    if draft.get("kpis"):
        for existing in list(challenge.kpis):
            await session.delete(existing)
        await session.flush()
        for position, item in enumerate(draft["kpis"]):
            session.add(
                Kpi(
                    challenge_id=challenge.id,
                    position=position,
                    name=item.get("name", ""),
                    unit=item.get("unit", ""),
                    kind=item.get("kind", "continuous"),
                    direction=item.get("direction", "lower"),
                    baseline_value=item.get("baseline_value"),
                    baseline_source=item.get("baseline_source", ""),
                    baseline_method=item.get("baseline_method", ""),
                    baseline_plan=item.get("baseline_plan", ""),
                    target_value=item.get("target_value"),
                    is_primary=bool(item.get("is_primary", position == 0)),
                )
            )

    if draft.get("rubric"):
        for existing in list(challenge.criteria):
            await session.delete(existing)
        await session.flush()
        for position, item in enumerate(draft["rubric"]):
            session.add(
                RubricCriterion(
                    challenge_id=challenge.id,
                    position=position,
                    name=item.get("name", ""),
                    description=item.get("description", ""),
                    weight=int(item.get("weight", 0)),
                    anchors=item.get("anchors", {}),
                    round_number=1,
                )
            )

    if draft.get("eligibility_notes"):
        rules = dict(challenge.eligibility_rules or {})
        rules["notes"] = draft["eligibility_notes"]
        rules.setdefault("require_dpiit", True)
        rules.setdefault("min_turnover_paise", 0)
        rules.setdefault("min_experience_years", 0)
        challenge.eligibility_rules = rules

    challenge.version = (challenge.version or 0) + 1
    await session.flush()


async def quality_checklist(session: AsyncSession, challenge: Challenge) -> list[dict[str, Any]]:
    """Flags raised before submission (FR-CB-06). Advisory, not blocking."""
    flags: list[dict[str, Any]] = []

    outcome = (challenge.outcome_statement or "").lower()
    if outcome:
        vague = [term for term in VAGUE_TERMS if term in outcome]
        has_number = any(character.isdigit() for character in outcome)
        if vague and not has_number:
            flags.append(
                {
                    "code": "vague_outcome",
                    "severity": "warning",
                    "field": "outcome_statement",
                    "message": "The outcome uses words such as "
                    + ", ".join(sorted(set(vague))[:3])
                    + " without a number. State the change you expect in the measure.",
                }
            )

    if challenge.budget_ceiling_paise <= 0:
        flags.append(
            {
                "code": "no_budget_ceiling",
                "severity": "warning",
                "field": "budget_ceiling_paise",
                "message": "No budget ceiling is published. Startups cannot size their proposals "
                "without one, and eligibility screening cannot check cost against a ceiling.",
            }
        )

    since = utcnow() - timedelta(days=365)
    duplicates = await session.execute(
        select(Challenge.reference, Challenge.title)
        .where(
            Challenge.department_id == challenge.department_id,
            Challenge.id != challenge.id,
            Challenge.created_at >= since,
            Challenge.state.notin_((ChallengeState.CANCELLED, ChallengeState.CLOSED)),
        )
        .limit(50)
    )
    title_terms = {t for t in (challenge.title or "").lower().split() if len(t) > 4}
    for reference, other_title in duplicates.all():
        other_terms = {t for t in (other_title or "").lower().split() if len(t) > 4}
        if title_terms and len(title_terms & other_terms) >= max(2, len(title_terms) // 2):
            flags.append(
                {
                    "code": "possible_duplicate",
                    "severity": "warning",
                    "field": "title",
                    "message": "This department published a similar challenge in the last 12 "
                    "months: " + reference + " (" + str(other_title) + "). Check whether this is "
                    "a repeat before publishing.",
                }
            )
            break

    if challenge.kpis and not any(k.is_primary for k in challenge.kpis):
        flags.append(
            {
                "code": "no_primary_kpi",
                "severity": "error",
                "field": "kpis",
                "message": "Mark one measure as the primary measure. The pilot design and the "
                "Evidence Report are built around it.",
            }
        )

    return flags


def blocking_problems(challenge: Challenge) -> list[dict[str, str]]:
    """Gaps that stop submission (FR-CB-03). Each names the field, the problem and the fix."""
    problems: list[dict[str, str]] = []

    if len((challenge.title or "").strip()) < 10:
        problems.append(
            {
                "field": "title",
                "detail": "The title is missing or too short.",
                "fix": "Write a title of at least 10 characters naming the outcome and the place.",
            }
        )
    if len((challenge.outcome_statement or "").strip()) < 40:
        problems.append(
            {
                "field": "outcome_statement",
                "detail": "The outcome statement is missing or too short.",
                "fix": "State the change you want in the primary measure, and by when.",
            }
        )
    if len((challenge.problem_statement or "").strip()) < 40:
        problems.append(
            {
                "field": "problem_statement",
                "detail": "The problem description is missing or too short.",
                "fix": "Describe what is going wrong, who is affected and how often.",
            }
        )
    if not (challenge.pilot_scope or "").strip():
        problems.append(
            {
                "field": "pilot_scope",
                "detail": "The pilot scope is empty.",
                "fix": "Name the area, the units and what the startup will do during the pilot.",
            }
        )
    if challenge.application_deadline is None:
        problems.append(
            {
                "field": "application_deadline",
                "detail": "No application deadline is set.",
                "fix": "Set a deadline at least 7 days from publication.",
            }
        )
    elif challenge.application_deadline <= utcnow():
        problems.append(
            {
                "field": "application_deadline",
                "detail": "The application deadline is in the past.",
                "fix": "Set a deadline in the future.",
            }
        )

    if not challenge.kpis:
        problems.append(
            {
                "field": "kpis",
                "detail": "No measures have been defined.",
                "fix": "Add between 2 and 5 measures, one of them marked as primary.",
            }
        )
    else:
        primaries = [k for k in challenge.kpis if k.is_primary]
        if len(primaries) != 1:
            problems.append(
                {
                    "field": "kpis",
                    "detail": "Exactly one measure must be marked as primary; "
                    + str(len(primaries))
                    + " are marked.",
                    "fix": "Mark one measure as primary. The pilot design is built around it.",
                }
            )
        for kpi in challenge.kpis:
            for problem in kpi.completeness_problems():
                problems.append(
                    {
                        "field": "kpis." + kpi.name,
                        "detail": problem,
                        "fix": "Complete this measure before submitting.",
                    }
                )

    if not challenge.criteria:
        problems.append(
            {
                "field": "criteria",
                "detail": "No evaluation criteria have been defined.",
                "fix": "Add at least 3 weighted criteria with anchors.",
            }
        )
    else:
        total = sum(c.weight for c in challenge.criteria)
        if total != 100:
            problems.append(
                {
                    "field": "criteria",
                    "detail": "Rubric weights sum to " + str(total) + " instead of 100.",
                    "fix": "Adjust the weights so they sum to exactly 100.",
                }
            )
        for criterion in challenge.criteria:
            if not criterion.anchors:
                problems.append(
                    {
                        "field": "criteria." + criterion.name,
                        "detail": "This criterion has no anchor descriptions.",
                        "fix": "Describe what a score of 1 and a score of 5 look like, so "
                        "evaluators score consistently.",
                    }
                )

    if challenge.budget_ceiling_paise < 0:
        problems.append(
            {
                "field": "budget_ceiling_paise",
                "detail": "The budget ceiling cannot be negative.",
                "fix": "Enter the ceiling in rupees, or zero for no published ceiling.",
            }
        )

    return problems


async def transition(
    session: AsyncSession,
    challenge: Challenge,
    principal: Principal,
    action: str,
    *,
    actor_role: str,
    reason: str | None = None,
    request_id: str | None = None,
) -> Challenge:
    """Run one guarded transition and emit its audit entry and outbox event."""
    check_transition("challenge", action, challenge.state, reason)
    before_state = challenge.state
    transition_def = check_transition("challenge", action, challenge.state, reason)
    now = utcnow()

    if action == "submit":
        problems = blocking_problems(challenge)
        if problems:
            raise ValidationFailed(
                "This challenge cannot be submitted until every measure and criterion is complete.",
                errors=problems,
            )
        challenge.submitted_at = now
        challenge.quality_flags = await quality_checklist(session, challenge)
    elif action == "return":
        challenge.return_comments = reason
        challenge.submitted_at = None
    elif action == "approve":
        challenge.approved_by = principal.user_id
        challenge.approved_at = now
        challenge.published_at = now
    elif action == "cancel":
        challenge.cancel_reason = reason

    challenge.state = transition_def.target
    challenge.version = (challenge.version or 0) + 1
    await session.flush()

    event_map = {
        "submit": "challenge.submitted",
        "return": "challenge.returned",
        "approve": "challenge.published",
        "cancel": "challenge.cancelled",
        "close-applications": "challenge.applications_closed",
        "screen": "challenge.screened",
        "start-evaluation": "challenge.panel_assigned",
        "lock-scores": "challenge.scores_locked",
        "confirm-shortlist": "challenge.shortlist_confirmed",
    }
    await audit.record(
        session,
        action="challenge." + action,
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=actor_role,
        department_id=challenge.department_id,
        before={"state": before_state},
        after={"state": challenge.state},
        reason=reason,
        request_id=request_id,
    )
    if action in event_map:
        outbox.emit(
            session,
            aggregate_type="challenge",
            aggregate_id=challenge.id,
            event_type=event_map[action],
            payload={
                "reference": challenge.reference,
                "title": challenge.title,
                "department_id": challenge.department_id,
                "state": challenge.state,
                "actor_id": principal.user_id,
                "reason": reason,
            },
        )
    return challenge


async def issue_corrigendum(
    session: AsyncSession,
    challenge: Challenge,
    principal: Principal,
    *,
    summary: str,
    changes: dict[str, Any],
) -> Corrigendum:
    """The only permitted change to a published challenge (FR-CB-08)."""
    if challenge.state not in (
        ChallengeState.PUBLISHED,
        ChallengeState.APPLICATIONS_CLOSED,
        ChallengeState.SCREENING,
    ):
        raise ValidationFailed(
            "A corrigendum can only be issued on a published challenge.",
            errors=[
                {
                    "field": "state",
                    "detail": "The challenge is in state " + challenge.state + ".",
                    "fix": "Edit the draft directly while the challenge is still in draft.",
                }
            ],
        )
    count_result = await session.execute(
        select(func.count()).select_from(Corrigendum).where(Corrigendum.challenge_id == challenge.id)
    )
    number = int(count_result.scalar_one()) + 1

    allowed_fields = {
        "application_deadline",
        "clarification_cutoff",
        "budget_ceiling_paise",
        "pilot_scope",
        "constraints",
        "commercial_terms",
    }
    applied: dict[str, Any] = {}
    for key, value in (changes or {}).items():
        if key not in allowed_fields:
            raise ValidationFailed(
                "The field " + key + " cannot be changed by corrigendum.",
                errors=[
                    {
                        "field": key,
                        "detail": "Only deadlines, budget ceiling, scope, constraints and "
                        "commercial terms can be corrected after publication.",
                        "fix": "Cancel and republish the challenge if the outcome or the measures "
                        "must change.",
                    }
                ],
            )
        applied[key] = {"from": str(getattr(challenge, key, None)), "to": str(value)}
        setattr(challenge, key, value)

    record = Corrigendum(
        challenge_id=challenge.id,
        number=number,
        summary=summary,
        changes=applied,
        issued_by=principal.user_id,
    )
    session.add(record)
    challenge.version = (challenge.version or 0) + 1
    await session.flush()

    await audit.record(
        session,
        action="challenge.corrigendum",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={"number": number, "changes": applied},
        reason=summary,
    )
    outbox.emit(
        session,
        aggregate_type="challenge",
        aggregate_id=challenge.id,
        event_type="challenge.corrigendum",
        payload={"number": number, "summary": summary, "reference": challenge.reference},
    )
    return record


async def ask_clarification(
    session: AsyncSession, challenge: Challenge, principal: Principal, question: str
) -> Clarification:
    if challenge.clarification_cutoff and utcnow() > challenge.clarification_cutoff:
        raise ValidationFailed(
            "The clarification window for this challenge has closed.",
            errors=[
                {
                    "field": "question",
                    "detail": "Questions closed on " + challenge.clarification_cutoff.isoformat() + ".",
                    "fix": "Published answers to earlier questions are on the challenge page.",
                }
            ],
        )
    record = Clarification(
        challenge_id=challenge.id, asked_by=principal.user_id, question=question.strip()
    )
    session.add(record)
    await session.flush()
    return record


async def answer_clarification(
    session: AsyncSession,
    challenge: Challenge,
    principal: Principal,
    clarification_id: str,
    answer: str,
) -> Clarification:
    record = await session.get(Clarification, clarification_id)
    if record is None or record.challenge_id != challenge.id:
        raise NotFound("That question was not found on this challenge.")
    record.answer = answer.strip()
    record.answered_by = principal.user_id
    record.published_at = utcnow()
    await session.flush()

    await audit.record(
        session,
        action="challenge.clarification_answered",
        entity_type="challenge",
        entity_id=challenge.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=challenge.department_id,
        after={"clarification_id": record.id},
    )
    outbox.emit(
        session,
        aggregate_type="challenge",
        aggregate_id=challenge.id,
        event_type="challenge.clarification_answered",
        payload={"clarification_id": record.id, "reference": challenge.reference},
    )
    return record


async def clarifications(session: AsyncSession, challenge_id: str, published_only: bool = True):
    stmt = select(Clarification).where(Clarification.challenge_id == challenge_id)
    if published_only:
        stmt = stmt.where(Clarification.published_at.isnot(None))
    stmt = stmt.order_by(Clarification.created_at.asc())
    return list((await session.execute(stmt)).scalars().all())


async def corrigenda(session: AsyncSession, challenge_id: str):
    stmt = (
        select(Corrigendum)
        .where(Corrigendum.challenge_id == challenge_id)
        .order_by(Corrigendum.number.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


async def close_due_deadlines(session: AsyncSession) -> list[Challenge]:
    """Scheduler entry point. Takes a row lock so a submission either commits before
    closure or is rejected after it (PRD 10.3)."""
    from app.core.db import claim_rows

    now = utcnow()
    stmt = (
        select(Challenge)
        .where(
            Challenge.state == ChallengeState.PUBLISHED,
            Challenge.application_deadline.isnot(None),
            Challenge.application_deadline <= now,
        )
        .order_by(Challenge.application_deadline.asc())
    )
    due = await claim_rows(session, stmt, limit=100)
    closed: list[Challenge] = []
    for challenge in due:
        if challenge.state != ChallengeState.PUBLISHED:
            continue
        challenge.state = ChallengeState.APPLICATIONS_CLOSED
        challenge.version = (challenge.version or 0) + 1
        closed.append(challenge)
        await audit.record(
            session,
            action="challenge.close-applications",
            entity_type="challenge",
            entity_id=challenge.id,
            actor_id=None,
            actor_role=Role.PLATFORM_ADMIN,
            department_id=challenge.department_id,
            before={"state": ChallengeState.PUBLISHED},
            after={"state": challenge.state},
            reason="Application deadline reached.",
        )
        outbox.emit(
            session,
            aggregate_type="challenge",
            aggregate_id=challenge.id,
            event_type="challenge.applications_closed",
            payload={"reference": challenge.reference, "title": challenge.title},
        )
    await session.flush()
    return closed


def challenge_text(challenge: Challenge) -> str:
    """The text used for embedding and keyword matching."""
    parts = [
        challenge.title,
        challenge.problem_statement,
        challenge.outcome_statement,
        challenge.current_situation,
        challenge.pilot_scope,
        challenge.sector or "",
    ]
    parts.extend(kpi.name + " " + kpi.unit for kpi in challenge.kpis)
    return "\n".join(p for p in parts if p)

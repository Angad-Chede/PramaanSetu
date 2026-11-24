"""Challenge endpoints: drafting, workflow, clarifications, matching and screening."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.common import iso, money, run_action, set_etag
from app.core.deps import CsrfDep, IdempotencyDep, IfMatchDep, PrincipalDep, SessionDep
from app.core.errors import NotFound, ValidationFailed
from app.core.pagination import build_page, clamp_limit, decode_cursor
from app.core.policy import require
from app.domain.states import ChallengeState, Role, available_actions
from app.models.application import Application
from app.models.challenge import Challenge, Kpi, RubricCriterion
from app.models.identity import Department
from app.services import applications as applications_service
from app.services import audit
from app.services import challenges as challenges_service
from app.services import evaluation as evaluation_service
from app.services import jobs as jobs_service
from app.services import startups as startups_service
from app.services import templates as templates_service

router = APIRouter(prefix="/challenges", tags=["challenges"])

DRAFT_STATES = (ChallengeState.DRAFT, ChallengeState.IN_REVIEW)


# --- Request models --------------------------------------------------------


class KpiIn(BaseModel):
    id: str | None = None
    name: str = Field(max_length=160)
    unit: str = Field(default="", max_length=40)
    kind: str = Field(default="continuous", pattern="^(continuous|proportion)$")
    direction: str = Field(default="lower", pattern="^(lower|higher)$")
    baseline_value: float | None = None
    baseline_sd: float | None = None
    baseline_source: str = ""
    baseline_method: str = ""
    baseline_plan: str = ""
    target_value: float | None = None
    is_primary: bool = False


class CriterionIn(BaseModel):
    id: str | None = None
    name: str = Field(max_length=160)
    description: str = ""
    weight: int = Field(ge=0, le=100)
    anchors: dict[str, str] = Field(default_factory=dict)
    round_number: int = 1


class ChallengeCreate(BaseModel):
    department_id: str | None = None
    title: str = ""
    problem_statement: str = ""


class ChallengeUpdate(BaseModel):
    title: str | None = None
    problem_statement: str | None = None
    current_situation: str | None = None
    outcome_statement: str | None = None
    constraints: str | None = None
    pilot_scope: str | None = None
    commercial_terms: str | None = None
    sector: str | None = None
    state_code: str | None = None
    district: str | None = None
    location_required: bool | None = None
    budget_ceiling_rupees: float | None = Field(default=None, ge=0)
    pilot_duration_weeks: int | None = Field(default=None, ge=1, le=52)
    application_deadline: datetime | None = None
    clarification_cutoff: datetime | None = None
    evaluation_deadline: datetime | None = None
    ip_option: str | None = Field(default=None, pattern="^(startup_retains|joint|government_owned)$")
    eligibility_rules: dict[str, Any] | None = None
    kpis: list[KpiIn] | None = None
    criteria: list[CriterionIn] | None = None


class AiDraftRequest(BaseModel):
    problem_statement: str = Field(min_length=40)
    current_situation: str = ""
    constraints: str = ""


class TransitionRequest(BaseModel):
    reason: str | None = None


class CorrigendumIn(BaseModel):
    summary: str = Field(min_length=10)
    changes: dict[str, Any] = Field(default_factory=dict)


class QuestionIn(BaseModel):
    question: str = Field(min_length=10, max_length=2000)


class AnswerIn(BaseModel):
    answer: str = Field(min_length=5, max_length=4000)


class PanelIn(BaseModel):
    evaluator_ids: list[str]
    validator_ids: list[str] = Field(default_factory=list)


class ShortlistIn(BaseModel):
    application_ids: list[str]


class EligibilityOverrideIn(BaseModel):
    outcome: str = Field(pattern="^(Eligible|Ineligible|NeedsReview)$")
    justification: str = Field(min_length=20)


# --- Serialisation ---------------------------------------------------------


def kpi_view(kpi: Kpi) -> dict[str, Any]:
    return {
        "id": kpi.id,
        "name": kpi.name,
        "unit": kpi.unit,
        "kind": kpi.kind,
        "direction": kpi.direction,
        "direction_label": "Lower is better" if kpi.direction == "lower" else "Higher is better",
        "baseline_value": float(kpi.baseline_value) if kpi.baseline_value is not None else None,
        "baseline_sd": float(kpi.baseline_sd) if kpi.baseline_sd is not None else None,
        "baseline_source": kpi.baseline_source,
        "baseline_method": kpi.baseline_method,
        "baseline_plan": kpi.baseline_plan,
        "target_value": float(kpi.target_value) if kpi.target_value is not None else None,
        "is_primary": kpi.is_primary,
        "problems": kpi.completeness_problems(),
    }


def criterion_view(criterion: RubricCriterion) -> dict[str, Any]:
    return {
        "id": criterion.id,
        "name": criterion.name,
        "description": criterion.description,
        "weight": criterion.weight,
        "anchors": criterion.anchors,
        "round_number": criterion.round_number,
    }


def challenge_view(
    challenge: Challenge, *, roles: set[str] | None = None, detail: bool = True
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": challenge.id,
        "reference": challenge.reference,
        "state": challenge.state,
        "title": challenge.title,
        "outcome_statement": challenge.outcome_statement,
        "sector": challenge.sector,
        "state_code": challenge.state_code,
        "district": challenge.district,
        "department_id": challenge.department_id,
        "department_name": challenge.department.name if challenge.department else None,
        "budget_ceiling": money(challenge.budget_ceiling_paise),
        "pilot_duration_weeks": challenge.pilot_duration_weeks,
        "application_deadline": iso(challenge.application_deadline),
        "clarification_cutoff": iso(challenge.clarification_cutoff),
        "evaluation_deadline": iso(challenge.evaluation_deadline),
        "published_at": iso(challenge.published_at),
        "version": challenge.version,
    }
    if detail:
        body.update(
            {
                "problem_statement": challenge.problem_statement,
                "current_situation": challenge.current_situation,
                "constraints": challenge.constraints,
                "pilot_scope": challenge.pilot_scope,
                "commercial_terms": challenge.commercial_terms,
                "location_required": challenge.location_required,
                "ip_option": challenge.ip_option,
                "eligibility_rules": challenge.eligibility_rules,
                "template_versions": challenge.template_versions,
                "ai_draft_meta": challenge.ai_draft_meta,
                "quality_flags": challenge.quality_flags,
                "kpis": [kpi_view(k) for k in challenge.kpis],
                "criteria": [criterion_view(c) for c in challenge.criteria],
                "created_by": challenge.created_by,
                "approved_by": challenge.approved_by,
                "approved_at": iso(challenge.approved_at),
                "return_comments": challenge.return_comments,
                "cancel_reason": challenge.cancel_reason,
                "blocking_problems": challenges_service.blocking_problems(challenge),
                "available_actions": available_actions("challenge", challenge.state, roles or set()),
            }
        )
    return body


async def _load(session, challenge_id: str) -> Challenge:  # type: ignore[no-untyped-def]
    return await challenges_service.get(session, challenge_id)


def _resource(challenge: Challenge) -> dict[str, Any]:
    return {
        "department_id": challenge.department_id,
        "challenge_id": challenge.id,
        "state": challenge.state,
        "created_by": challenge.created_by,
    }


# --- Endpoints -------------------------------------------------------------


@router.post("", status_code=status.HTTP_201_CREATED, summary="Start a challenge draft")
async def create_challenge(
    body: ChallengeCreate,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    department_id = body.department_id or principal.department_id
    if not department_id:
        raise ValidationFailed(
            "A challenge must belong to a department.",
            errors=[
                {
                    "field": "department_id",
                    "detail": "Your account is not attached to a department.",
                    "fix": "Ask the platform administrator to attach your account to a department.",
                }
            ],
        )
    require(principal, "challenge:create", {"department_id": department_id})

    async def _do() -> dict[str, Any]:
        challenge = await challenges_service.create_draft(
            session,
            principal,
            department_id=department_id,
            title=body.title,
            problem_statement=body.problem_statement,
        )
        return challenge_view(challenge, roles=principal.roles)

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("", summary="List challenges visible to the caller")
async def list_challenges(
    principal: PrincipalDep,
    session: SessionDep,
    state: str | None = Query(None),
    sector: str | None = Query(None),
    department_id: str | None = Query(None),
    mine: bool = Query(False),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    limit = clamp_limit(limit)
    position = decode_cursor(cursor)

    stmt = select(Challenge).order_by(Challenge.created_at.desc(), Challenge.id.desc())
    if state:
        stmt = stmt.where(Challenge.state == state)
    if sector:
        stmt = stmt.where(Challenge.sector == sector)
    if department_id:
        stmt = stmt.where(Challenge.department_id == department_id)
    if mine and principal.department_id:
        stmt = stmt.where(Challenge.department_id == principal.department_id)
    elif not principal.is_admin():
        # Drafts and in-review challenges are visible only inside the owning department.
        if principal.department_id:
            stmt = stmt.where(
                (Challenge.state.notin_(DRAFT_STATES))
                | (Challenge.department_id == principal.department_id)
            )
        else:
            stmt = stmt.where(Challenge.state.notin_(DRAFT_STATES))
    if position:
        stmt = stmt.where(Challenge.created_at < datetime.fromisoformat(position["created_at"]))

    rows = list((await session.execute(stmt.limit(limit + 1))).scalars().all())
    items, next_cursor = build_page(rows, limit, ("created_at",))
    return {
        "items": [challenge_view(c, roles=principal.roles, detail=False) for c in items],
        "next_cursor": next_cursor,
    }


@router.get("/{challenge_id}", summary="One challenge")
async def get_challenge(
    challenge_id: str, principal: PrincipalDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))
    set_etag(response, challenge)
    body = challenge_view(challenge, roles=principal.roles)
    body["application_count"] = await applications_service.count_for_challenge(session, challenge.id)
    body["clarifications"] = [
        {
            "id": c.id,
            "question": c.question,
            "answer": c.answer,
            "published_at": iso(c.published_at),
        }
        for c in await challenges_service.clarifications(
            session, challenge.id, published_only=not principal.in_department(challenge.department_id)
        )
    ]
    body["corrigenda"] = [
        {"number": c.number, "summary": c.summary, "changes": c.changes, "issued_at": iso(c.created_at)}
        for c in await challenges_service.corrigenda(session, challenge.id)
    ]
    return body


@router.put("/{challenge_id}", summary="Update a draft")
async def update_challenge(
    challenge_id: str,
    body: ChallengeUpdate,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:update", _resource(challenge))

    from app.core.deps import check_version

    check_version(challenge, if_match, required=False)

    data = body.model_dump(exclude_unset=True, mode="python")
    kpis = data.pop("kpis", None)
    criteria = data.pop("criteria", None)
    budget = data.pop("budget_ceiling_rupees", None)

    for key, value in data.items():
        if value is not None:
            setattr(challenge, key, value)
    if budget is not None:
        from app.core.money import rupees_to_paise

        challenge.budget_ceiling_paise = rupees_to_paise(budget)

    if kpis is not None:
        if not 1 <= len(kpis) <= 5:
            raise ValidationFailed(
                "A challenge carries between 1 and 5 measures.",
                errors=[
                    {
                        "field": "kpis",
                        "detail": str(len(kpis)) + " were supplied.",
                        "fix": "Keep the measures that decide the pilot and remove the rest.",
                    }
                ],
            )
        if sum(1 for k in kpis if k["is_primary"]) != 1:
            raise ValidationFailed(
                "Exactly one measure must be marked as primary.",
                errors=[
                    {
                        "field": "kpis",
                        "detail": "The primary measure decides the pilot design and the analysis.",
                        "fix": "Mark exactly one measure as primary.",
                    }
                ],
            )
        for existing in list(challenge.kpis):
            await session.delete(existing)
        await session.flush()
        for position, item in enumerate(kpis):
            item.pop("id", None)
            session.add(Kpi(challenge_id=challenge.id, position=position, **item))

    if criteria is not None:
        total = sum(int(c["weight"]) for c in criteria)
        if criteria and total != 100:
            raise ValidationFailed(
                "Rubric weights must sum to 100.",
                errors=[
                    {
                        "field": "criteria",
                        "detail": "They currently sum to " + str(total) + ".",
                        "fix": "Adjust the weights so they sum to exactly 100.",
                    }
                ],
            )
        for existing in list(challenge.criteria):
            await session.delete(existing)
        await session.flush()
        for position, item in enumerate(criteria):
            item.pop("id", None)
            session.add(RubricCriterion(challenge_id=challenge.id, position=position, **item))

    challenge.version = (challenge.version or 0) + 1
    await session.flush()
    await session.refresh(challenge)
    await session.commit()
    set_etag(response, challenge)
    return challenge_view(challenge, roles=principal.roles)


@router.post("/{challenge_id}/ai-draft", status_code=status.HTTP_202_ACCEPTED,
             summary="Queue an AI draft of this challenge")
async def ai_draft(
    challenge_id: str,
    body: AiDraftRequest,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:ai-draft", _resource(challenge))
    if challenge.state != ChallengeState.DRAFT:
        raise ValidationFailed("Only a draft can be redrafted.")

    challenge.problem_statement = body.problem_statement
    if body.current_situation:
        challenge.current_situation = body.current_situation
    if body.constraints:
        challenge.constraints = body.constraints
    await session.flush()

    job = await jobs_service.enqueue(
        session,
        job_type="challenge.ai_draft",
        queue="ai",
        payload={
            "challenge_id": challenge.id,
            "actor_id": principal.user_id,
            "problem_statement": body.problem_statement,
            "current_situation": body.current_situation,
            "constraints": body.constraints,
        },
        created_by=principal.user_id,
    )
    await session.commit()
    response.headers["Location"] = "/api/v1/jobs/" + job.id
    return {
        "job_id": job.id,
        "status": job.status,
        "detail": "The draft is being prepared. You can keep editing; the draft will replace the "
        "structured fields when it is ready. If the AI service is unavailable the manual form "
        "and the Template Kit remain available.",
        "poll": "/api/v1/jobs/" + job.id,
    }


@router.get("/{challenge_id}/checklist", summary="Quality checklist before submission")
async def checklist(challenge_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))
    flags = await challenges_service.quality_checklist(session, challenge)
    problems = challenges_service.blocking_problems(challenge)
    return {
        "blocking_problems": problems,
        "quality_flags": flags,
        "ready_to_submit": not problems,
        "summary": (
            "This challenge is ready to submit for approval."
            if not problems
            else str(len(problems)) + " item(s) must be completed before you can submit."
        ),
    }


@router.post("/{challenge_id}/corrigenda", status_code=status.HTTP_201_CREATED,
             summary="Issue a corrigendum on a published challenge")
async def issue_corrigendum(
    challenge_id: str,
    body: CorrigendumIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:corrigendum", _resource(challenge))

    async def _do() -> dict[str, Any]:
        record = await challenges_service.issue_corrigendum(
            session, challenge, principal, summary=body.summary, changes=body.changes
        )
        return {
            "number": record.number,
            "summary": record.summary,
            "changes": record.changes,
            "detail": "Every startup that viewed or applied to this challenge has been notified.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/corrigenda",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("/{challenge_id}/clarifications", summary="Questions and published answers")
async def list_clarifications(
    challenge_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))
    internal = principal.in_department(challenge.department_id)
    rows = await challenges_service.clarifications(session, challenge.id, published_only=not internal)
    return {
        "items": [
            {
                "id": c.id,
                "question": c.question,
                "answer": c.answer,
                "published_at": iso(c.published_at),
                "answered": c.answer is not None,
            }
            for c in rows
        ],
        "cutoff": iso(challenge.clarification_cutoff),
        "note": "Questions are anonymised. Answers are published to all applicants at once.",
    }


@router.post("/{challenge_id}/clarifications", status_code=status.HTTP_201_CREATED,
             summary="Ask a question")
async def ask_clarification(
    challenge_id: str,
    body: QuestionIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:clarify-ask", _resource(challenge))
    record = await challenges_service.ask_clarification(session, challenge, principal, body.question)
    await session.commit()
    return {
        "id": record.id,
        "detail": "Your question was recorded. The answer will be published to all applicants at "
        "once, without naming who asked.",
    }


@router.put("/{challenge_id}/clarifications/{clarification_id}", summary="Publish an answer")
async def answer_clarification(
    challenge_id: str,
    clarification_id: str,
    body: AnswerIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:clarify-answer", _resource(challenge))
    record = await challenges_service.answer_clarification(
        session, challenge, principal, clarification_id, body.answer
    )
    await session.commit()
    return {"id": record.id, "published_at": iso(record.published_at), "answer": record.answer}


@router.get("/{challenge_id}/matches", summary="Ranked startup matches with reasons")
async def matches(
    challenge_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    limit: int = Query(20, ge=1, le=50),
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:matches", _resource(challenge))
    rows = await startups_service.matches_for(session, challenge.id, limit=limit)

    from app.domain.matching import explain_weights

    return {
        "items": [
            {
                "rank": m.rank,
                "startup_id": m.startup_id,
                "startup_name": m.startup.legal_name if m.startup else None,
                "sectors": list(m.startup.sectors or []) if m.startup else [],
                "dpiit_status": m.startup.dpiit_status if m.startup else None,
                "score": round(m.score, 4),
                "components": m.components,
                "reasons": m.reasons,
                "invited_at": iso(m.invited_at),
            }
            for m in rows
        ],
        "weights": explain_weights(),
        "note": "Matching decides who is invited, never who may apply. Any eligible startup can "
        "apply whether or not it appears here.",
    }


@router.get("/{challenge_id}/applications", summary="Applications on this challenge")
async def list_applications(
    challenge_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "application:read", _resource(challenge))
    rows = await applications_service.list_for_challenge(session, challenge.id)
    return {
        "items": [
            {
                "id": a.id,
                "reference": a.reference,
                "startup_id": a.startup_id,
                "startup_name": a.startup.legal_name if a.startup else None,
                "state": a.state,
                "pilot_cost": money(a.pilot_cost_paise),
                "submitted_at": iso(a.submitted_at),
                "locked_at": iso(a.locked_at),
                "eligibility": (
                    {
                        "outcome": a.eligibility.outcome,
                        "rule_results": a.eligibility.rule_results,
                        "relaxations_applied": a.eligibility.relaxations_applied,
                        "overridden_by": a.eligibility.overridden_by,
                        "override_reason": a.eligibility.override_reason,
                    }
                    if a.eligibility
                    else None
                ),
            }
            for a in rows
        ],
        "count": len(rows),
    }


@router.post("/{challenge_id}/panel", summary="Assign the evaluation panel and the validator")
async def assign_panel(
    challenge_id: str,
    body: PanelIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:panel", _resource(challenge))

    async def _do() -> dict[str, Any]:
        members = await evaluation_service.assign_panel(
            session,
            challenge,
            principal,
            evaluator_ids=body.evaluator_ids,
            validator_ids=body.validator_ids,
        )
        return {
            "members": [
                {"user_id": m.user_id, "role": m.role, "name": m.user.name if m.user else None}
                for m in members
            ],
            "detail": "Panel members have been notified. Each must declare any conflict of "
            "interest before scoring.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/panel",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.get("/{challenge_id}/panel", summary="Who is on the panel")
async def get_panel(challenge_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))
    members = await evaluation_service.panel(session, challenge.id)
    return {
        "items": [
            {
                "user_id": m.user_id,
                "name": m.user.name if m.user else None,
                "role": m.role,
                "assigned_at": iso(m.created_at),
            }
            for m in members
        ]
    }


@router.get("/{challenge_id}/ranking", summary="Weighted scores, variance flags and the order")
async def ranking(challenge_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:ranking", _resource(challenge))
    rows = await evaluation_service.ranking(session, challenge)
    blinded = challenge.state in (ChallengeState.EVALUATION,)
    for row in rows:
        if blinded:
            row.pop("startup_id", None)
    return {
        "items": rows,
        "blinded": blinded,
        "flags": [flag for row in rows for flag in row.get("flags", [])],
        "note": "Applications where evaluators differ by more than 1.5 points on any criterion "
        "are flagged. Read the written justifications before confirming the shortlist.",
    }


@router.post("/{challenge_id}/shortlist", summary="Confirm the shortlist")
async def confirm_shortlist(
    challenge_id: str,
    body: ShortlistIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    from app.core.db import lock_row

    challenge = await lock_row(session, Challenge, challenge_id)
    if challenge is None:
        raise NotFound("This challenge was not found.")
    require(principal, "challenge:shortlist", _resource(challenge))

    async def _do() -> dict[str, Any]:
        selected = await evaluation_service.confirm_shortlist(
            session, challenge, principal, application_ids=body.application_ids
        )
        await challenges_service.transition(
            session,
            challenge,
            principal,
            "confirm-shortlist",
            actor_role=Role.DEPARTMENT_APPROVER,
        )
        from app.services import pilots as pilots_service

        pilots = []
        for application in selected:
            pilot = await pilots_service.create_for_application(
                session, application, challenge, principal
            )
            pilots.append({"pilot_id": pilot.id, "reference": pilot.reference,
                           "application_id": application.id})
        return {
            "shortlisted": [a.reference for a in selected],
            "pilots": pilots,
            "detail": "A pilot record was created for each shortlisted application. Run the "
            "Pilot Flight Simulator before drafting the agreement.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/shortlist",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.post("/{challenge_id}/applications/{application_id}/eligibility/override",
             summary="Override a screening result with a written justification")
async def override_eligibility(
    challenge_id: str,
    application_id: str,
    body: EligibilityOverrideIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "application:override-eligibility", _resource(challenge))
    application = await session.get(Application, application_id)
    if application is None or application.challenge_id != challenge.id:
        raise NotFound("That application is not on this challenge.")

    async def _do() -> dict[str, Any]:
        record = await applications_service.override_eligibility(
            session,
            application,
            challenge,
            principal,
            outcome=body.outcome,
            justification=body.justification,
        )
        return {
            "application_id": application.id,
            "outcome": record.outcome,
            "original_outcome": record.original_outcome,
            "justification": record.override_reason,
            "detail": "The override is recorded in the audit log and is visible to the approver.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/applications/{aid}/eligibility/override",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.get("/{challenge_id}/audit", summary="Audit trail for this challenge")
async def challenge_audit(
    challenge_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "audit:read", _resource(challenge))
    rows = await audit.entries_for(
        session, department_id=challenge.department_id, limit=limit
    )
    relevant = [
        r for r in rows
        if r.entity_id == challenge.id or (r.after or {}).get("challenge_id") == challenge.id
    ]
    return {
        "items": [
            {
                "seq": r.seq,
                "at": iso(r.at),
                "actor_id": r.actor_id,
                "actor_role": r.actor_role,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "before": r.before,
                "after": r.after,
                "reason": r.reason,
                "hash": r.hash,
            }
            for r in relevant
        ]
    }


@router.get("/{challenge_id}/summary.pdf", summary="One-page summary for the approver")
async def summary_pdf(challenge_id: str, principal: PrincipalDep, session: SessionDep) -> Response:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))

    from app.services.challenges import IP_OPTION_LABELS
    from app.services.pdf import render_challenge_summary

    department = await session.get(Department, challenge.department_id)
    rendered = render_challenge_summary(
        {
            "title": challenge.title or "Untitled challenge",
            "reference": challenge.reference,
            "state": challenge.state,
            "department_name": department.name if department else "",
            "outcome_statement": challenge.outcome_statement,
            "kpis": [kpi_view(k) for k in challenge.kpis],
            "criteria": [criterion_view(c) for c in challenge.criteria],
            "budget_ceiling_paise": challenge.budget_ceiling_paise,
            "application_deadline": iso(challenge.application_deadline),
            "pilot_duration_weeks": challenge.pilot_duration_weeks,
            "ip_option_label": IP_OPTION_LABELS.get(challenge.ip_option, challenge.ip_option),
            "quality_flags": challenge.quality_flags,
            "template_versions": challenge.template_versions,
        }
    )
    return Response(
        content=rendered.data,
        media_type=rendered.mime,
        headers={"Content-Disposition": 'attachment; filename="' + rendered.filename + '"'},
    )


@router.get("/{challenge_id}/templates", summary="Template versions used by this challenge")
async def challenge_templates(
    challenge_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    challenge = await _load(session, challenge_id)
    require(principal, "challenge:read", _resource(challenge))
    rows = await templates_service.all_templates(session)
    used = challenge.template_versions or {}
    return {
        "used": used,
        "available": [
            {
                "kind": t.kind,
                "version": t.version,
                "title": t.title,
                "published_at": iso(t.published_at),
                "source_note": t.source_note,
                "in_use": used.get(t.kind) == t.version,
            }
            for t in rows
        ],
    }


@router.post("/{challenge_id}/{action}", summary="Run a workflow transition")
async def transition(
    challenge_id: str,
    action: str,
    body: TransitionRequest,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    allowed = {
        "submit": "challenge:submit",
        "approve": "challenge:approve",
        "return": "challenge:approve",
        "cancel": "challenge:cancel",
        "close-applications": "challenge:screen",
        "screen": "challenge:screen",
        "start-evaluation": "challenge:panel",
        "lock-scores": "challenge:lock-scores",
        "confirm-shortlist": "challenge:shortlist",
    }
    if action not in allowed:
        raise NotFound("The step " + action + " is not available on a challenge.")

    from app.core.db import lock_row

    challenge = await lock_row(session, Challenge, challenge_id)
    if challenge is None:
        raise NotFound("This challenge was not found.")
    require(principal, allowed[action], _resource(challenge))

    actor_role = {
        "submit": Role.DEPARTMENT_OFFICER,
        "approve": Role.DEPARTMENT_APPROVER,
        "return": Role.DEPARTMENT_APPROVER,
        "cancel": Role.DEPARTMENT_APPROVER,
        "close-applications": Role.DEPARTMENT_OFFICER,
        "screen": Role.DEPARTMENT_OFFICER,
        "start-evaluation": Role.DEPARTMENT_OFFICER,
        "lock-scores": Role.DEPARTMENT_OFFICER,
        "confirm-shortlist": Role.DEPARTMENT_APPROVER,
    }[action]

    async def _do() -> dict[str, Any]:
        if action == "close-applications":
            await applications_service.lock_for_challenge(session, challenge)
        if action == "screen":
            await applications_service.screen_challenge(session, challenge, principal)
        if action == "lock-scores":
            await evaluation_service.lock_scores(session, challenge, principal, reason=body.reason)
        updated = await challenges_service.transition(
            session,
            challenge,
            principal,
            action,
            actor_role=actor_role,
            reason=body.reason,
        )
        return challenge_view(updated, roles=principal.roles)

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/" + action,
        idempotency_key=idempotency_key,
        request_payload={"action": action, **body.model_dump(mode="json")},
        action=_do,
        entity=challenge,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, challenge)
    return result

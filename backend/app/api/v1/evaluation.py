"""Evaluator endpoints (PRD 5.5). Round one is blind and conflicts are declared first."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.common import iso, money, run_action
from app.core.deps import CsrfDep, IdempotencyDep, PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound
from app.core.policy import require
from app.domain.states import Role
from app.models.application import Application
from app.models.challenge import Challenge
from app.services import applications as applications_service
from app.services import challenges as challenges_service
from app.services import evaluation as evaluation_service

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


class CoiIn(BaseModel):
    has_conflict: bool
    statement: str = Field(default="", max_length=2000)


class ScoreItem(BaseModel):
    criterion_id: str
    score: int = Field(ge=1, le=5)
    justification: str = Field(min_length=10, max_length=1000)


class ScoreSheetIn(BaseModel):
    round_number: int = Field(default=1, ge=1, le=2)
    scores: list[ScoreItem]


class ReopenIn(BaseModel):
    reason: str = Field(min_length=20)


@router.get("/assignments", summary="Challenges this evaluator or validator is assigned to")
async def assignments(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    from sqlalchemy import select

    from app.models.evaluation import PanelMember

    rows = await session.execute(
        select(PanelMember, Challenge)
        .join(Challenge, Challenge.id == PanelMember.challenge_id)
        .where(PanelMember.user_id == principal.user_id, PanelMember.active.is_(True))
        .order_by(Challenge.evaluation_deadline.asc().nulls_last())
    )
    items = []
    for member, challenge in rows.all():
        progress = (
            await evaluation_service.evaluator_progress(session, challenge.id, principal.user_id)
            if member.role == Role.EXPERT_EVALUATOR
            else None
        )
        items.append(
            {
                "challenge_id": challenge.id,
                "reference": challenge.reference,
                "title": challenge.title,
                "state": challenge.state,
                "role": member.role,
                "evaluation_deadline": iso(challenge.evaluation_deadline),
                "progress": progress,
            }
        )
    return {"items": items}


@router.get("/{challenge_id}", summary="The blinded applications this evaluator must score")
async def evaluation_workspace(
    challenge_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    challenge = await challenges_service.get(session, challenge_id)
    require(
        principal,
        "application:read-blinded",
        {"challenge_id": challenge.id, "department_id": challenge.department_id},
    )

    eligible = await applications_service.eligible_applications(session, challenge.id)
    items: list[dict[str, Any]] = []
    for index, application in enumerate(eligible):
        declaration = await evaluation_service.conflict_declaration(
            session, application.id, principal.user_id
        )
        from sqlalchemy import select

        from app.models.evaluation import EvaluationScore

        scored = await session.execute(
            select(EvaluationScore).where(
                EvaluationScore.application_id == application.id,
                EvaluationScore.evaluator_id == principal.user_id,
                EvaluationScore.round_number == 1,
            )
        )
        my_scores = list(scored.scalars().all())
        items.append(
            {
                **evaluation_service.blind_view(application, index),
                "pilot_cost": money(application.pilot_cost_paise),
                "conflict_declared": declaration is not None,
                "has_conflict": declaration.has_conflict if declaration else None,
                "scored": bool(my_scores),
                "locked": any(s.locked for s in my_scores),
                "my_scores": [
                    {
                        "criterion_id": s.criterion_id,
                        "score": s.score,
                        "justification": s.justification,
                    }
                    for s in my_scores
                ],
            }
        )

    return {
        "challenge": {
            "id": challenge.id,
            "reference": challenge.reference,
            "title": challenge.title,
            "outcome_statement": challenge.outcome_statement,
            "state": challenge.state,
            "evaluation_deadline": iso(challenge.evaluation_deadline),
        },
        "criteria": [
            {
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "weight": c.weight,
                "anchors": c.anchors,
            }
            for c in challenge.criteria
            if c.round_number == 1
        ],
        "kpis": [
            {"id": k.id, "name": k.name, "unit": k.unit, "direction": k.direction,
             "baseline_value": float(k.baseline_value) if k.baseline_value is not None else None,
             "target_value": float(k.target_value) if k.target_value is not None else None,
             "is_primary": k.is_primary}
            for k in challenge.kpis
        ],
        "applications": items,
        "blinded": True,
        "note": "Applicant names, founders and case-reference names are hidden in round one. "
        "Score every criterion from 1 to 5 against the anchors, with one line of reasoning.",
    }


@router.post("/applications/{application_id}/coi", summary="Declare a conflict of interest")
async def declare_coi(
    application_id: str,
    body: CoiIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    application = await applications_service.get(session, application_id)
    challenge = await session.get(Challenge, application.challenge_id)
    require(
        principal,
        "evaluation:declare-coi",
        {"challenge_id": application.challenge_id,
         "department_id": challenge.department_id if challenge else None},
    )
    record = await evaluation_service.declare_conflict(
        session, application, principal, has_conflict=body.has_conflict, statement=body.statement
    )
    await session.commit()
    return {
        "declared": True,
        "has_conflict": record.has_conflict,
        "detail": (
            "You declared a conflict on this application, so it has been removed from your "
            "scoring list."
            if record.has_conflict
            else "No conflict declared. You may now score this application."
        ),
    }


@router.put("/applications/{application_id}/scores", summary="Submit a score sheet")
async def submit_scores(
    application_id: str,
    body: ScoreSheetIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    from app.core.db import lock_row

    application = await lock_row(session, Application, application_id)
    if application is None:
        raise NotFound("This application was not found.")
    challenge = await session.get(Challenge, application.challenge_id)
    if challenge is None:
        raise NotFound("The challenge this application belongs to was not found.")
    require(
        principal,
        "evaluation:score",
        {"challenge_id": application.challenge_id, "department_id": challenge.department_id},
    )

    async def _do() -> dict[str, Any]:
        saved = await evaluation_service.submit_scores(
            session,
            application,
            challenge,
            principal,
            scores=[item.model_dump() for item in body.scores],
            round_number=body.round_number,
        )
        return {
            "application_id": application.id,
            "criteria_scored": len(saved),
            "round": body.round_number,
            "detail": "Your scores are saved. They lock when every evaluator has submitted, or "
            "at the evaluation deadline.",
        }

    return await run_action(
        session=session,
        principal=principal,
        route="PUT /evaluation/applications/{id}/scores",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
    )


@router.post("/{challenge_id}/reopen", summary="Reopen locked scores with a recorded reason")
async def reopen(
    challenge_id: str,
    body: ReopenIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    challenge = await challenges_service.get(session, challenge_id)
    if Role.DEPARTMENT_APPROVER not in principal.roles or not principal.in_department(
        challenge.department_id
    ):
        raise Forbidden("Only the department approver can reopen locked scores.")
    count = await evaluation_service.reopen_scores(session, challenge, principal, body.reason)
    await session.commit()
    return {
        "reopened": count,
        "detail": "Scores are unlocked. The reopening and its reason are recorded in the audit log.",
    }


@router.get("/{challenge_id}/progress", summary="How far the panel has got")
async def progress(
    challenge_id: str, principal: PrincipalDep, session: SessionDep, evaluator_id: str | None = Query(None)
) -> dict[str, Any]:
    challenge = await challenges_service.get(session, challenge_id)
    require(principal, "evaluation:read-scores",
            {"challenge_id": challenge.id, "department_id": challenge.department_id})
    members = await evaluation_service.panel(session, challenge.id, Role.EXPERT_EVALUATOR)
    rows = []
    for member in members:
        if evaluator_id and member.user_id != evaluator_id:
            continue
        rows.append(
            {
                "evaluator_id": member.user_id,
                "name": member.user.name if member.user else None,
                **await evaluation_service.evaluator_progress(session, challenge.id, member.user_id),
            }
        )
    return {"items": rows, "panel_size": len(members)}

"""Application endpoints (PRD 5.3).

The deadline is enforced against server time inside the submitting transaction, so a
submission one second late is rejected with a message that says exactly how late it was.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from app.api.common import iso, money, run_action, set_etag
from app.core.deps import CsrfDep, IdempotencyDep, IfMatchDep, PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound
from app.core.money import rupees_to_paise
from app.core.policy import require
from app.domain.states import ApplicationState
from app.models.application import Application
from app.models.challenge import Challenge
from app.services import applications as applications_service
from app.services import challenges as challenges_service
from app.services import evaluation as evaluation_service
from app.services import startups as startups_service

router = APIRouter(tags=["applications"])


class KpiCommitment(BaseModel):
    kpi_id: str
    committed_value: float
    note: str = Field(default="", max_length=500)


class ApplicationUpdate(BaseModel):
    proposal_summary: str | None = None
    approach: str | None = None
    kpi_commitments: list[KpiCommitment] | None = None
    pilot_cost_rupees: float | None = Field(default=None, ge=0)
    timeline_weeks: int | None = Field(default=None, ge=1, le=104)
    data_declaration: str | None = None
    ip_declaration: str | None = Field(
        default=None, pattern="^(startup_retains|joint|government_owned)$"
    )
    conflict_declaration: bool | None = None
    attachments: list[str] | None = None


def application_view(
    application: Application, *, include_scores: bool = False
) -> dict[str, Any]:
    return {
        "id": application.id,
        "reference": application.reference,
        "challenge_id": application.challenge_id,
        "challenge_title": application.challenge.title if application.challenge else None,
        "startup_id": application.startup_id,
        "startup_name": application.startup.legal_name if application.startup else None,
        "state": application.state,
        "proposal_summary": application.proposal_summary,
        "approach": application.approach,
        "kpi_commitments": application.kpi_commitments,
        "pilot_cost": money(application.pilot_cost_paise),
        "timeline_weeks": application.timeline_weeks,
        "data_declaration": application.data_declaration,
        "ip_declaration": application.ip_declaration,
        "conflict_declaration": application.conflict_declaration,
        "attachments": application.attachments,
        "submitted_at": iso(application.submitted_at),
        "locked_at": iso(application.locked_at),
        "shortlist_rank": application.shortlist_rank,
        "version": application.version,
        "blocking_problems": application.blocking_problems(),
        "eligibility": (
            {
                "outcome": application.eligibility.outcome,
                "rule_results": application.eligibility.rule_results,
                "relaxations_applied": application.eligibility.relaxations_applied,
                "screened_at": iso(application.eligibility.screened_at),
                "overridden_by": application.eligibility.overridden_by,
                "override_reason": application.eligibility.override_reason,
                "clarification_window_ends": iso(application.eligibility.clarification_window_ends),
            }
            if application.eligibility
            else None
        ),
    }


def _resource(application: Application, challenge: Challenge | None) -> dict[str, Any]:
    return {
        "startup_id": application.startup_id,
        "challenge_id": application.challenge_id,
        "department_id": challenge.department_id if challenge else None,
        "state": application.state,
    }


@router.get("/challenges/{challenge_id}/application-form", summary="The form for this challenge")
async def application_form(
    challenge_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    challenge = await challenges_service.get(session, challenge_id)
    require(principal, "challenge:read", {"department_id": challenge.department_id, "state": challenge.state})
    return applications_service.application_form_schema(challenge)


@router.post("/challenges/{challenge_id}/applications", status_code=status.HTTP_201_CREATED,
             summary="Start an application")
async def start_application(
    challenge_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    if not principal.startup_id:
        raise Forbidden("Only a startup user with a profile can apply.")
    challenge = await challenges_service.get(session, challenge_id)
    require(principal, "application:create", {"startup_id": principal.startup_id})
    startup = await startups_service.get(session, principal.startup_id)

    async def _do() -> dict[str, Any]:
        application = await applications_service.start_application(
            session, challenge, startup, principal
        )
        return application_view(application)

    return await run_action(
        session=session,
        principal=principal,
        route="POST /challenges/{id}/applications",
        idempotency_key=idempotency_key,
        request_payload={"challenge_id": challenge_id, "startup_id": principal.startup_id},
        action=_do,
        status_code=201,
    )


@router.get("/applications/{application_id}", summary="One application")
async def get_application(
    application_id: str, principal: PrincipalDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    application = await applications_service.get(session, application_id)
    challenge = await session.get(Challenge, application.challenge_id)
    require(principal, "application:read", _resource(application, challenge))
    set_etag(response, application)

    body = application_view(application)
    results_published = challenge is not None and challenge.state in (
        "Shortlisted", "PilotDesign", "PilotActive", "Validation", "DecisionPending",
        "Scaled", "Closed",
    )
    if challenge is not None and results_published and principal.owns_startup(application.startup_id):
        ranking = await evaluation_service.ranking(session, challenge)
        mine = next((r for r in ranking if r["application_id"] == application.id), None)
        if mine:
            body["my_result"] = {
                "rank": mine["rank"],
                "weighted_score": mine["weighted_score"],
                "criteria": [
                    {"name": c["name"], "weight": c["weight"], "mean": c["mean"]}
                    for c in mine["criteria"]
                ],
                "note": "Scores are shown with anonymised evaluator comments once results are "
                "published.",
            }
    return body


@router.put("/applications/{application_id}", summary="Edit an application before the deadline")
async def update_application(
    application_id: str,
    body: ApplicationUpdate,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    application = await applications_service.get(session, application_id)
    challenge = await session.get(Challenge, application.challenge_id)
    require(principal, "application:update", _resource(application, challenge))

    from app.core.clock import utcnow
    from app.core.deps import check_version
    from app.core.errors import Conflict

    check_version(application, if_match, required=False)

    if challenge and challenge.application_deadline and utcnow() > challenge.application_deadline:
        raise Conflict(
            "The application deadline has passed, so this application can no longer be edited."
        )
    if application.state in (ApplicationState.LOCKED, ApplicationState.SCREENED):
        raise Conflict("This application is locked and can no longer be edited.")

    changes = body.model_dump(exclude_unset=True, mode="python")
    cost = changes.pop("pilot_cost_rupees", None)
    if cost is not None:
        application.pilot_cost_paise = rupees_to_paise(cost)
    if "kpi_commitments" in changes and changes["kpi_commitments"] is not None:
        application.kpi_commitments = [
            c if isinstance(c, dict) else c.model_dump() for c in changes.pop("kpi_commitments")
        ]
    for key, value in changes.items():
        if value is not None:
            setattr(application, key, value)

    application.version = (application.version or 0) + 1
    await session.commit()
    set_etag(response, application)
    return application_view(application)


@router.post("/applications/{application_id}/submit", summary="Submit or resubmit before the deadline")
async def submit_application(
    application_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    from app.core.db import lock_row

    application = await lock_row(session, Application, application_id)
    if application is None:
        raise NotFound("This application was not found.")
    challenge = await lock_row(session, Challenge, application.challenge_id)
    if challenge is None:
        raise NotFound("The challenge this application belongs to was not found.")
    require(principal, "application:submit", _resource(application, challenge))

    async def _do() -> dict[str, Any]:
        updated = await applications_service.submit(session, application, challenge, principal)
        body = application_view(updated)
        body["detail"] = (
            "Your application was received at " + str(iso(updated.submitted_at))
            + ". You can keep editing until the deadline; the last submitted version is the one "
            "that counts."
        )
        return body

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /applications/{id}/submit",
        idempotency_key=idempotency_key,
        request_payload={"application_id": application_id},
        action=_do,
        entity=application,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, application)
    return result


@router.post("/applications/{application_id}/withdraw", summary="Withdraw an application")
async def withdraw_application(
    application_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    application = await applications_service.get(session, application_id)
    challenge = await session.get(Challenge, application.challenge_id)
    require(principal, "application:update", _resource(application, challenge))
    if application.state in (ApplicationState.SHORTLISTED,):
        raise Forbidden("A shortlisted application cannot be withdrawn on the platform. Contact "
                        "the department directly.")
    application.state = ApplicationState.WITHDRAWN
    application.version = (application.version or 0) + 1
    await session.commit()
    return {"withdrawn": True, "state": application.state}

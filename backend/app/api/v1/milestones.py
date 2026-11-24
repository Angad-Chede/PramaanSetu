"""Payment Pulse endpoints (PRD 5.9).

Every transition takes a row lock and checks the current state inside the transaction,
so two approvers clicking at the same moment are serialised: exactly one succeeds and
the other gets a 409 carrying the current record.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from app.api.common import iso, money, run_action, set_etag
from app.core.db import lock_row
from app.core.deps import CsrfDep, IdempotencyDep, IfMatchDep, PrincipalDep, SessionDep
from app.core.errors import NotFound
from app.core.money import rupees_to_paise
from app.core.policy import require
from app.domain.states import Role
from app.models.payment import Milestone, PaymentRelease
from app.models.pilot import Pilot
from app.services import payments as payments_service

router = APIRouter(tags=["milestones"])


class SubmitIn(BaseModel):
    note: str = Field(min_length=10, max_length=4000)
    file_ids: list[str] = Field(default_factory=list)


class AcceptIn(BaseModel):
    remarks: str | None = None


class RejectIn(BaseModel):
    reason: str = Field(min_length=10)
    unmet_requirement: str = Field(min_length=5)


class ApproveIn(BaseModel):
    remarks: str | None = None


class ReleaseIn(BaseModel):
    reference_no: str = Field(min_length=3, max_length=80)
    amount_rupees: float = Field(ge=0)
    released_on: datetime | None = None
    mode: str = Field(default="Bank transfer", max_length=40)
    remarks: str | None = None


async def _load(session, milestone_id: str) -> tuple[Milestone, Pilot]:  # type: ignore[no-untyped-def]
    milestone = await lock_row(session, Milestone, milestone_id)
    if milestone is None:
        raise NotFound("This milestone was not found.")
    pilot = await session.get(Pilot, milestone.pilot_id)
    if pilot is None:
        raise NotFound("The pilot for this milestone was not found.")
    return milestone, pilot


def _resource(pilot: Pilot, milestone: Milestone) -> dict[str, Any]:
    return {
        "department_id": pilot.department_id,
        "startup_id": pilot.startup_id,
        "challenge_id": pilot.challenge_id,
        "state": milestone.state,
    }


@router.get("/pilots/{pilot_id}/milestones", summary="Milestones on a pilot")
async def list_milestones(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    pilot = await session.get(Pilot, pilot_id)
    if pilot is None:
        raise NotFound("This pilot was not found.")
    require(
        principal,
        "milestone:read",
        {"department_id": pilot.department_id, "startup_id": pilot.startup_id},
    )
    rows = await payments_service.for_pilot(session, pilot_id)
    total = sum(m.amount_paise for m in rows)
    paid = sum(m.amount_paise for m in rows if m.state == "Paid")
    return {
        "items": [payments_service.view(m) for m in rows],
        "total_value": money(total),
        "paid_value": money(paid),
        "outstanding_value": money(total - paid),
        "note": "Each state carries a service level. The holder is shown against every milestone, "
        "with the days remaining.",
    }


@router.get("/milestones/{milestone_id}", summary="One milestone")
async def get_milestone(
    milestone_id: str, principal: PrincipalDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    milestone = await session.get(Milestone, milestone_id)
    if milestone is None:
        raise NotFound("This milestone was not found.")
    pilot = await session.get(Pilot, milestone.pilot_id)
    if pilot is None:
        raise NotFound("The pilot this milestone belongs to was not found.")
    require(principal, "milestone:read", _resource(pilot, milestone))
    set_etag(response, milestone)
    body = payments_service.view(milestone)
    from sqlalchemy import select

    release = await session.execute(
        select(PaymentRelease).where(PaymentRelease.milestone_id == milestone.id)
    )
    record = release.scalar_one_or_none()
    body["release"] = (
        {
            "reference_no": record.reference_no,
            "amount": money(record.amount_paise),
            "released_on": iso(record.released_on),
            "mode": record.mode,
            "remarks": record.remarks,
        }
        if record
        else None
    )
    return body


@router.post("/milestones/{milestone_id}/submit", summary="Startup submits milestone evidence")
async def submit(
    milestone_id: str,
    body: SubmitIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    milestone, pilot = await _load(session, milestone_id)
    require(principal, "milestone:submit", _resource(pilot, milestone))

    async def _do() -> dict[str, Any]:
        updated = await payments_service.transition(
            session,
            milestone,
            principal,
            "submit",
            actor_role=Role.STARTUP_USER,
            payload={"note": body.note, "file_ids": body.file_ids},
        )
        result = payments_service.view(updated)
        result["detail"] = (
            "Evidence submitted. The department has "
            + str(result["days_remaining"])
            + " days to accept or reject it, and the clock is now running."
        )
        return result

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /milestones/{id}/submit",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        entity=milestone,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, milestone)
    return result


@router.post("/milestones/{milestone_id}/accept", summary="Officer accepts the evidence")
async def accept(
    milestone_id: str,
    body: AcceptIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    milestone, pilot = await _load(session, milestone_id)
    require(principal, "milestone:accept", _resource(pilot, milestone))

    async def _do() -> dict[str, Any]:
        updated = await payments_service.transition(
            session,
            milestone,
            principal,
            "accept",
            actor_role=Role.DEPARTMENT_OFFICER,
            reason=body.remarks,
        )
        return payments_service.view(updated)

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /milestones/{id}/accept",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        entity=milestone,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, milestone)
    return result


@router.post("/milestones/{milestone_id}/reject", summary="Officer rejects, citing the requirement")
async def reject(
    milestone_id: str,
    body: RejectIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    milestone, pilot = await _load(session, milestone_id)
    require(principal, "milestone:reject", _resource(pilot, milestone))

    async def _do() -> dict[str, Any]:
        updated = await payments_service.transition(
            session,
            milestone,
            principal,
            "reject",
            actor_role=Role.DEPARTMENT_OFFICER,
            reason=body.reason,
            payload={"unmet_requirement": body.unmet_requirement},
        )
        result = payments_service.view(updated)
        result["detail"] = (
            "Returned to the startup. The service level clock stops only for the time the "
            "startup takes to resubmit."
        )
        return result

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /milestones/{id}/reject",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        entity=milestone,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, milestone)
    return result


@router.post("/milestones/{milestone_id}/approve-payment", summary="Approver clears the payment")
async def approve_payment(
    milestone_id: str,
    body: ApproveIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    milestone, pilot = await _load(session, milestone_id)
    require(principal, "milestone:approve-payment", _resource(pilot, milestone))

    async def _do() -> dict[str, Any]:
        updated = await payments_service.transition(
            session,
            milestone,
            principal,
            "approve-payment",
            actor_role=Role.DEPARTMENT_APPROVER,
            reason=body.remarks,
        )
        result = payments_service.view(updated)
        result["detail"] = (
            "Payment approved. It is now in the finance queue, sorted by service level deadline."
        )
        return result

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /milestones/{id}/approve-payment",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        entity=milestone,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, milestone)
    return result


@router.post("/milestones/{milestone_id}/record-release", summary="Finance records the release")
async def record_release(
    milestone_id: str,
    body: ReleaseIn,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    milestone, pilot = await _load(session, milestone_id)
    resource = _resource(pilot, milestone)
    from sqlalchemy import select

    from app.models.platform import AuditLog

    approver = await session.execute(
        select(AuditLog.actor_id)
        .where(
            AuditLog.entity_type == "milestone",
            AuditLog.entity_id == milestone.id,
            AuditLog.action == "milestone.approve-payment",
        )
        .order_by(AuditLog.seq.desc())
        .limit(1)
    )
    resource["approved_by"] = approver.scalar_one_or_none()
    require(principal, "milestone:record-release", resource)

    async def _do() -> dict[str, Any]:
        updated = await payments_service.transition(
            session,
            milestone,
            principal,
            "record-release",
            actor_role=Role.FINANCE_OFFICER,
            reason=body.remarks,
            payload={
                "reference_no": body.reference_no,
                "amount_paise": rupees_to_paise(body.amount_rupees),
                "released_on": body.released_on,
                "mode": body.mode,
                "remarks": body.remarks,
            },
        )
        result = payments_service.view(updated)
        result["detail"] = "Release recorded. The startup has been notified with the reference."
        return result

    result = await run_action(
        session=session,
        principal=principal,
        route="POST /milestones/{id}/record-release",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        entity=milestone,
        expected_version=if_match,
        version_required=False,
    )
    set_etag(response, milestone)
    return result


@router.get("/finance/queue", summary="Approved milestones sorted by deadline")
async def finance_queue(
    principal: PrincipalDep, session: SessionDep, limit: int = Query(100, ge=1, le=200)
) -> dict[str, Any]:
    if Role.FINANCE_OFFICER not in principal.roles and not principal.is_admin():
        from app.core.errors import Forbidden

        raise Forbidden("This queue is for the department finance office.")
    department_id = principal.department_id or ""
    rows = await payments_service.finance_queue(session, department_id, limit=limit)
    items = []
    for milestone in rows:
        pilot = await session.get(Pilot, milestone.pilot_id)
        view = payments_service.view(milestone)
        view["pilot_reference"] = pilot.reference if pilot else None
        view["startup_name"] = pilot.startup.legal_name if pilot and pilot.startup else None
        view["amount"] = money(milestone.amount_paise)
        items.append(view)
    return {
        "items": items,
        "count": len(items),
        "note": "Sorted by service level deadline. Overdue items are shown first and are already "
        "escalated.",
    }


@router.get("/departments/{department_id}/payment-report", summary="Payment performance report")
async def payment_report(
    department_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    days: int = Query(90, ge=7, le=365),
) -> dict[str, Any]:
    require(principal, "milestone:read", {"department_id": department_id})
    report = await payments_service.department_report(session, department_id, days=days)
    report["open_breaches"] = await payments_service.open_breaches(session, department_id)
    report["service_levels"] = {
        "officer_acceptance_days": await payments_service.sla_days_for(session, department_id, "accept"),
        "approver_payment_days": await payments_service.sla_days_for(session, department_id, "approve"),
        "finance_release_days": await payments_service.sla_days_for(session, department_id, "release"),
    }
    return report

"""Procurement pathway, scale decision, handoff pack and Innovation Passports."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, Field

from app.api.common import iso, money, run_action
from app.core.config import settings
from app.core.deps import CsrfDep, IdempotencyDep, OptionalPrincipalDep, PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound
from app.core.money import rupees_to_paise
from app.core.policy import require
from app.models.pilot import Pilot
from app.services import files as files_service
from app.services import pilots as pilots_service
from app.services import scale as scale_service

router = APIRouter(tags=["scale"])


class ScaleSimIn(BaseModel):
    units: int = Field(ge=1, le=100000)
    cost_per_unit_rupees: float = Field(ge=0)
    value_per_effect_unit_rupees: float = Field(default=0, ge=0)
    annual_operating_cost_rupees: float = Field(default=0, ge=0)


class DecisionIn(BaseModel):
    decision: str = Field(pattern="^(Scale|ExtendPilot|Close)$")
    reason: str = Field(min_length=20, max_length=8000)
    estimated_value_rupees: float = Field(default=0, ge=0)
    qualified_vendor_count: int | None = Field(default=None, ge=0)
    exit_plan_on_record: bool = False
    scale_projection: dict[str, Any] = Field(default_factory=dict)


class AdoptionIn(BaseModel):
    department_id: str | None = None
    intent: str = Field(default="new_challenge", pattern="^(new_challenge|pilot_extension)$")
    note: str = Field(default="", max_length=4000)
    context: dict[str, Any] = Field(default_factory=dict)


async def _pilot(session, pilot_id: str, principal, action: str) -> Pilot:  # type: ignore[no-untyped-def]
    pilot = await pilots_service.get(session, pilot_id)
    require(
        principal,
        action,
        {
            "department_id": pilot.department_id,
            "startup_id": pilot.startup_id,
            "challenge_id": pilot.challenge_id,
        },
    )
    return pilot


@router.get("/pilots/{pilot_id}/pathway", summary="Recommended procurement route")
async def pathway(
    pilot_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    estimated_value_rupees: float = Query(0, ge=0),
    qualified_vendor_count: int | None = Query(None, ge=0),
) -> dict[str, Any]:
    pilot = await _pilot(session, pilot_id, principal, "scale:pathway")
    return await scale_service.pathway_for(
        session,
        pilot,
        estimated_value_paise=rupees_to_paise(estimated_value_rupees),
        qualified_vendor_count=qualified_vendor_count,
    )


@router.post("/pilots/{pilot_id}/scale-simulations", summary="Project rollout cost and benefit")
async def scale_simulation(
    pilot_id: str,
    body: ScaleSimIn,
    principal: PrincipalDep,
    session: SessionDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    pilot = await _pilot(session, pilot_id, principal, "scale:simulate")
    result = await scale_service.simulate_scale(
        session,
        pilot,
        units=body.units,
        cost_per_unit_paise=rupees_to_paise(body.cost_per_unit_rupees),
        value_per_effect_unit_paise=rupees_to_paise(body.value_per_effect_unit_rupees),
        annual_operating_cost_paise=rupees_to_paise(body.annual_operating_cost_rupees),
    )
    result["total_cost"] = money(result["total_cost_paise"])
    result["note"] = (
        "The conservative case uses the cautious end of the validated confidence interval. "
        "Plan against that case, not against the optimistic one."
    )
    return result


@router.get("/pilots/{pilot_id}/vendor-dependency", summary="Vendor Dependency Score")
async def vendor_dependency(
    pilot_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    if not settings.feature_vendor_dependency_score:
        raise NotFound("The Vendor Dependency Score is not enabled in this environment.")
    pilot = await _pilot(session, pilot_id, principal, "scale:pathway")
    return await scale_service.dependency_for(session, pilot)


@router.post("/pilots/{pilot_id}/decision", status_code=status.HTTP_201_CREATED,
             summary="Record the scale decision")
async def record_decision(
    pilot_id: str,
    body: DecisionIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    from app.core.db import lock_row

    pilot = await lock_row(session, Pilot, pilot_id)
    if pilot is None:
        raise NotFound("This pilot was not found.")
    require(
        principal,
        "scale:decide",
        {"department_id": pilot.department_id, "challenge_id": pilot.challenge_id},
    )

    estimated = rupees_to_paise(body.estimated_value_rupees)

    async def _do() -> dict[str, Any]:
        pathway_block: dict[str, Any] = {}
        dependency: dict[str, Any] = {}
        if body.decision == "Scale":
            pathway_block = await scale_service.pathway_for(
                session,
                pilot,
                estimated_value_paise=estimated,
                qualified_vendor_count=body.qualified_vendor_count,
            )
            pathway_block["exit_plan_on_record"] = body.exit_plan_on_record
            dependency = await scale_service.dependency_for(session, pilot)

        record = await scale_service.record_decision(
            session,
            pilot,
            principal,
            decision=body.decision,
            reason=body.reason,
            estimated_value_paise=estimated,
            pathway=pathway_block,
            scale_projection=body.scale_projection,
            vendor_dependency=dependency,
        )
        return {
            "decision_id": record.id,
            "decision": record.decision,
            "reason": record.reason,
            "estimated_value": money(record.estimated_value_paise),
            "pathway": record.pathway,
            "vendor_dependency": record.vendor_dependency,
            "handoff_file_id": record.handoff_file_id,
            "decided_at": iso(record.decided_at),
            "detail": (
                "Decision recorded. The procurement handoff pack is ready to download as PDF, "
                "and the same pack is available as JSON for the marketplace adapter."
                if record.decision == "Scale"
                else "Decision recorded with reasons."
            ),
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /pilots/{id}/decision",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("/pilots/{pilot_id}/decision", summary="The recorded decision")
async def get_decision(pilot_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    from sqlalchemy import select

    from app.models.scale import ScaleDecision

    pilot = await _pilot(session, pilot_id, principal, "pilot:read")
    result = await session.execute(select(ScaleDecision).where(ScaleDecision.pilot_id == pilot.id))
    record = result.scalar_one_or_none()
    if record is None:
        raise NotFound("No decision has been recorded for this pilot yet.")
    return {
        "decision_id": record.id,
        "decision": record.decision,
        "reason": record.reason,
        "estimated_value": money(record.estimated_value_paise),
        "pathway": record.pathway,
        "scale_projection": record.scale_projection,
        "vendor_dependency": record.vendor_dependency,
        "handoff_file_id": record.handoff_file_id,
        "decided_by": record.decided_by,
        "decided_at": iso(record.decided_at),
    }


@router.get("/pilots/{pilot_id}/handoff.json", summary="Machine-readable procurement handoff pack")
async def handoff_json(pilot_id: str, principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    pilot = await _pilot(session, pilot_id, principal, "scale:pathway")
    return await scale_service.handoff_json(session, pilot)


@router.get("/pilots/{pilot_id}/handoff.pdf", summary="Procurement handoff pack as PDF")
async def handoff_pdf(pilot_id: str, principal: PrincipalDep, session: SessionDep) -> Response:
    from sqlalchemy import select

    from app.models.scale import ScaleDecision

    pilot = await _pilot(session, pilot_id, principal, "scale:pathway")
    result = await session.execute(select(ScaleDecision).where(ScaleDecision.pilot_id == pilot.id))
    record = result.scalar_one_or_none()
    if record is None or not record.handoff_file_id:
        raise NotFound("No handoff pack exists. It is produced when a Scale decision is recorded.")
    file_record, data = await files_service.read_bytes(session, record.handoff_file_id)
    return Response(
        content=data,
        media_type=file_record.mime,
        headers={"Content-Disposition": 'attachment; filename="' + file_record.filename + '"'},
    )


# --- Innovation Passports --------------------------------------------------


passports = APIRouter(prefix="/passports", tags=["passports"])


@passports.get("", summary="Search validated pilot evidence")
async def search(
    principal: PrincipalDep,
    session: SessionDep,
    category: str | None = Query(None),
    sector: str | None = Query(None),
    query: str | None = Query(None),
    min_score: float | None = Query(None, ge=0, le=100),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    rows = await scale_service.search_passports(
        session, category=category, sector=sector, query=query, min_score=min_score, limit=limit
    )
    return {
        "items": [scale_service.passport_view(p) for p in rows],
        "count": len(rows),
        "note": "Every passport here rests on an independently validated pilot. Check the "
        "context before assuming the same result in a different setting.",
    }


@passports.get("/{passport_id}", summary="One Innovation Passport")
async def get_passport(
    passport_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    passport = await scale_service.get_passport(session, passport_id)
    require(principal, "passport:read", {})
    body = scale_service.passport_view(passport)
    body["adoption_requests"] = [
        {
            "id": r.id,
            "department_id": r.department_id,
            "intent": r.intent,
            "state": r.state,
            "created_at": iso(r.created_at),
        }
        for r in await scale_service.adoption_requests_for(session, passport.id)
    ]
    return body


@passports.get("/shared/{token}", summary="Read-only passport view from a share link")
async def shared_passport(
    token: str, principal: OptionalPrincipalDep, session: SessionDep
) -> dict[str, Any]:
    passport = await scale_service.passport_by_token(session, token)
    body = scale_service.passport_view(passport)
    body.pop("share_token", None)
    body["read_only"] = True
    return body


@passports.post("/{passport_id}/adoption-requests", status_code=status.HTTP_201_CREATED,
                summary="Reuse this evidence in another department")
async def raise_adoption(
    passport_id: str,
    body: AdoptionIn,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    passport = await scale_service.get_passport(session, passport_id)
    require(principal, "passport:adopt", {})
    department_id = body.department_id or principal.department_id
    if not department_id:
        raise Forbidden("Your account is not attached to a department.")

    async def _do() -> dict[str, Any]:
        request = await scale_service.raise_adoption_request(
            session,
            passport,
            principal,
            department_id=department_id,
            intent=body.intent,
            note=body.note,
            adopting_context=body.context,
        )
        return {
            "adoption_request_id": request.id,
            "state": request.state,
            "intent": request.intent,
            "prefilled_challenge_id": request.prefilled_challenge_id,
            "context_fit": request.context_fit,
            "detail": (
                "A challenge draft has been pre-filled from the original, with the validated "
                "evidence attached. Collect a local baseline before the pilot starts: the "
                "original baseline belongs to a different context."
                if request.prefilled_challenge_id
                else "The request has been recorded and the original department notified."
            ),
        }

    return await run_action(
        session=session,
        principal=principal,
        route="POST /passports/{id}/adoption-requests",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@passports.get("/{passport_id}/context-fit", summary="Differences between the two contexts")
async def context_fit(
    passport_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    scale_units: int | None = Query(None),
    population: int | None = Query(None),
    environment: str | None = Query(None),
    state_code: str | None = Query(None),
    sector: str | None = Query(None),
) -> dict[str, Any]:
    if not settings.feature_context_fit_check:
        raise NotFound("The context fit check is not enabled in this environment.")
    passport = await scale_service.get_passport(session, passport_id)
    require(principal, "passport:read", {})

    from app.domain.pathway import context_fit as compute_fit

    adopting = {
        "scale_units": scale_units,
        "population": population,
        "environment": environment,
        "state_code": state_code,
        "sector": sector,
    }
    rows = compute_fit(passport.context or {}, {k: v for k, v in adopting.items() if v is not None})
    comparable = all(r["comparable"] for r in rows) if rows else True
    return {
        "rows": rows,
        "comparable": comparable,
        "summary": (
            "The two contexts are broadly comparable on the factors checked."
            if comparable
            else "The contexts differ on at least one factor. Read the notes before assuming the "
            "same result, and plan to collect a local baseline."
        ),
    }

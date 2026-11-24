"""Startup registry and profile endpoints (PRD 5.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, select

from app.api.common import iso, money, run_action, set_etag
from app.core.deps import CsrfDep, IdempotencyDep, IfMatchDep, PrincipalDep, SessionDep
from app.core.errors import NotFound
from app.core.money import rupees_to_paise
from app.core.policy import require
from app.models.identity import AppUser, RoleAssignment
from app.models.startup import Startup
from app.services import applications as applications_service
from app.services import scale as scale_service
from app.services import startups as startups_service

router = APIRouter(prefix="/startups", tags=["startups"])


class CaseReference(BaseModel):
    title: str = Field(max_length=160)
    client: str = Field(default="", max_length=160)
    summary: str = Field(default="", max_length=2000)
    year: int | None = None
    outcome: str = Field(default="", max_length=500)


class StartupCreate(BaseModel):
    legal_name: str = Field(min_length=3, max_length=240)
    cin: str | None = Field(default=None, max_length=30)
    dpiit_number: str | None = Field(default=None, max_length=40)
    incorporation_date: datetime | None = None
    sectors: list[str] = Field(default_factory=list)
    state_code: str | None = None
    district: str | None = None
    product_description: str = Field(default="", max_length=4000)
    capability_text: str = Field(default="", max_length=8000)
    team_size: int = Field(default=1, ge=1)
    website: str | None = None
    contact_name: str = Field(default="", max_length=160)
    contact_email: EmailStr | None = None
    contact_phone: str | None = None
    annual_turnover_rupees: float = Field(default=0, ge=0)
    years_of_experience: int = Field(default=0, ge=0)


class StartupUpdate(BaseModel):
    legal_name: str | None = None
    cin: str | None = None
    dpiit_number: str | None = None
    incorporation_date: datetime | None = None
    sectors: list[str] | None = None
    state_code: str | None = None
    district: str | None = None
    product_description: str | None = None
    capability_text: str | None = None
    team_size: int | None = Field(default=None, ge=1)
    website: str | None = None
    contact_name: str | None = None
    contact_email: EmailStr | None = None
    contact_phone: str | None = None
    case_references: list[CaseReference] | None = None
    annual_turnover_rupees: float | None = Field(default=None, ge=0)
    years_of_experience: int | None = Field(default=None, ge=0)


def startup_view(startup: Startup, *, detail: bool = True) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": startup.id,
        "legal_name": startup.legal_name,
        "sectors": list(startup.sectors or []),
        "state_code": startup.state_code,
        "district": startup.district,
        "dpiit_status": startup.dpiit_status,
        "dpiit_checked_at": iso(startup.dpiit_checked_at),
        "product_description": startup.product_description,
        "version": startup.version,
    }
    if detail:
        body.update(
            {
                "cin": startup.cin,
                "dpiit_number": startup.dpiit_number,
                "incorporation_date": iso(startup.incorporation_date),
                "capability_text": startup.capability_text,
                "team_size": startup.team_size,
                "website": startup.website,
                "contact_name": startup.contact_name,
                "contact_email": startup.contact_email,
                "contact_phone": startup.contact_phone,
                "case_references": list(startup.case_references or []),
                "annual_turnover": money(startup.annual_turnover_paise),
                "years_of_experience": startup.years_of_experience,
                "profile_completeness_percent": startup.completeness_percent(),
                "missing_fields": startup.missing_fields(),
                "can_apply": not startup.missing_fields(),
            }
        )
    return body


@router.post("", status_code=status.HTTP_201_CREATED, summary="Register a startup")
async def register(
    body: StartupCreate,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    require(principal, "startup:create", {})

    async def _do() -> dict[str, Any]:
        data = body.model_dump(mode="python")
        turnover = data.pop("annual_turnover_rupees", 0)
        startup = await startups_service.register(
            session,
            principal,
            legal_name=data.pop("legal_name"),
            cin=data.pop("cin"),
            dpiit_number=data.pop("dpiit_number"),
            sectors=data.pop("sectors"),
            product_description=data.pop("product_description"),
            capability_text=data.pop("capability_text"),
            contact_name=data.pop("contact_name"),
            contact_email=str(data.pop("contact_email") or ""),
            annual_turnover_paise=rupees_to_paise(turnover),
            **data,
        )
        user = await session.get(AppUser, principal.user_id)
        if user is not None and not user.startup_id:
            user.startup_id = startup.id
            session.add(
                RoleAssignment(
                    user_id=user.id, role="SU", scope_type="startup", scope_id=startup.id
                )
            )
        return startup_view(startup)

    return await run_action(
        session=session,
        principal=principal,
        route="POST /startups",
        idempotency_key=idempotency_key,
        request_payload=body.model_dump(mode="json"),
        action=_do,
        status_code=201,
    )


@router.get("", summary="Search the registry")
async def list_startups(
    principal: PrincipalDep,
    session: SessionDep,
    query: str | None = Query(None),
    sector: str | None = Query(None),
    state_code: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    stmt = select(Startup).where(Startup.archived_at.is_(None)).order_by(Startup.legal_name.asc())
    if query:
        pattern = "%" + query.strip() + "%"
        stmt = stmt.where(
            or_(
                Startup.legal_name.ilike(pattern),
                Startup.product_description.ilike(pattern),
                Startup.capability_text.ilike(pattern),
            )
        )
    if state_code:
        stmt = stmt.where(Startup.state_code == state_code)
    rows = list((await session.execute(stmt.limit(limit))).scalars().all())
    if sector:
        needle = sector.strip().lower()
        rows = [r for r in rows if needle in {str(s).lower() for s in (r.sectors or [])}]
    return {"items": [startup_view(r, detail=False) for r in rows], "count": len(rows)}


@router.get("/{startup_id}", summary="One startup profile")
async def get_startup(
    startup_id: str, principal: PrincipalDep, session: SessionDep, response: Response
) -> dict[str, Any]:
    startup = await startups_service.get(session, startup_id)
    require(principal, "startup:read", {"startup_id": startup.id})
    set_etag(response, startup)
    return startup_view(startup)


@router.put("/{startup_id}", summary="Update the profile")
async def update_startup(
    startup_id: str,
    body: StartupUpdate,
    principal: PrincipalDep,
    session: SessionDep,
    response: Response,
    if_match: IfMatchDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    startup = await startups_service.get(session, startup_id)
    require(principal, "startup:update", {"startup_id": startup.id})

    from app.core.deps import check_version

    check_version(startup, if_match, required=False)

    changes = body.model_dump(exclude_unset=True, mode="python")
    turnover = changes.pop("annual_turnover_rupees", None)
    if turnover is not None:
        changes["annual_turnover_paise"] = rupees_to_paise(turnover)
    if "contact_email" in changes and changes["contact_email"] is not None:
        changes["contact_email"] = str(changes["contact_email"])
    if "case_references" in changes and changes["case_references"] is not None:
        changes["case_references"] = [
            c if isinstance(c, dict) else c.model_dump() for c in changes["case_references"]
        ]

    updated = await startups_service.update_profile(session, startup, principal, changes)
    await session.commit()
    set_etag(response, updated)
    return startup_view(updated)


@router.post("/{startup_id}/verify-dpiit", summary="Run the recognition check")
async def verify_dpiit(
    startup_id: str,
    principal: PrincipalDep,
    session: SessionDep,
    idempotency_key: IdempotencyDep,
    _csrf: CsrfDep = None,
) -> dict[str, Any]:
    startup = await startups_service.get(session, startup_id)
    require(principal, "startup:verify", {"startup_id": startup.id})

    async def _do() -> dict[str, Any]:
        return await startups_service.verify_dpiit(session, startup, principal)

    return await run_action(
        session=session,
        principal=principal,
        route="POST /startups/{id}/verify-dpiit",
        idempotency_key=idempotency_key,
        request_payload={"startup_id": startup_id},
        action=_do,
    )


@router.get("/{startup_id}/applications", summary="Applications by this startup")
async def startup_applications(
    startup_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    startup = await startups_service.get(session, startup_id)
    require(principal, "application:read", {"startup_id": startup.id})
    rows = await applications_service.list_for_startup(session, startup.id)
    return {
        "items": [
            {
                "id": a.id,
                "reference": a.reference,
                "challenge_id": a.challenge_id,
                "challenge_title": a.challenge.title if a.challenge else None,
                "state": a.state,
                "pilot_cost": money(a.pilot_cost_paise),
                "submitted_at": iso(a.submitted_at),
                "eligibility_outcome": a.eligibility.outcome if a.eligibility else None,
            }
            for a in rows
        ]
    }


@router.get("/{startup_id}/passports", summary="Innovation Passports held by this startup")
async def startup_passports(
    startup_id: str, principal: PrincipalDep, session: SessionDep
) -> dict[str, Any]:
    startup = await startups_service.get(session, startup_id)
    require(principal, "startup:read", {"startup_id": startup.id})
    from app.models.scale import InnovationPassport

    rows = await session.execute(
        select(InnovationPassport)
        .where(InnovationPassport.startup_id == startup.id)
        .order_by(InnovationPassport.validated_on.desc())
    )
    items = list(rows.scalars().all())
    return {
        "items": [scale_service.passport_view(p) for p in items],
        "note": "Each passport carries a read-only share link you can send to any department.",
    }


@router.get("/me/profile", summary="The profile of the signed-in startup user")
async def my_startup(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    if not principal.startup_id:
        raise NotFound("Your account is not attached to a startup profile.")
    startup = await startups_service.get(session, principal.startup_id)
    return startup_view(startup)

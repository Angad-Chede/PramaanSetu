"""Administration, audit and reporting (PRD 5.14)."""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select

from app.api.common import iso
from app.core.clock import format_ist, set_demo_offset, utcnow
from app.core.config import settings
from app.core.deps import CsrfDep, PrincipalDep, SessionDep
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.policy import require
from app.core.security import hash_password
from app.domain.states import ROLE_LABELS, MilestoneState, Role
from app.models.challenge import Challenge
from app.models.evidence import EvidenceReport
from app.models.identity import AppUser, Department, RoleAssignment
from app.models.payment import Milestone
from app.models.pilot import Pilot
from app.models.scale import InnovationPassport
from app.services import audit as audit_service
from app.services import jobs as jobs_service
from app.services import payments as payments_service
from app.services import templates as templates_service

router = APIRouter(prefix="/admin", tags=["admin"])


class DepartmentIn(BaseModel):
    name: str = Field(max_length=200)
    code: str = Field(max_length=40)
    level: str = Field(pattern="^(central|state|district)$")
    parent_id: str | None = None
    state_code: str | None = None
    district: str | None = None
    sectors: list[str] = Field(default_factory=list)
    sla_accept_days: int | None = Field(default=None, ge=1, le=10)
    sla_approve_days: int | None = Field(default=None, ge=1, le=7)
    sla_release_days: int | None = Field(default=None, ge=1, le=10)


class UserIn(BaseModel):
    name: str = Field(max_length=160)
    email: EmailStr
    phone: str | None = None
    designation: str | None = None
    department_id: str | None = None
    startup_id: str | None = None
    password: str | None = Field(default=None, min_length=10, max_length=200)
    locale: str = Field(default="en", pattern="^(en|hi)$")


class RoleIn(BaseModel):
    user_id: str
    role: str = Field(pattern="^(DO|DA|SU|EE|IV|FO|PA)$")
    scope_type: str = Field(default="department", pattern="^(global|department|challenge|startup)$")
    scope_id: str | None = None


class ClockIn(BaseModel):
    days: float = Field(ge=0, le=365, description="Fast-forward the clock for demonstrations.")
    confirm: bool = False


def _require_admin(principal: Any) -> None:
    if not principal.is_admin():
        raise Forbidden("This action is restricted to the platform administrator.")


# --- Departments and users -------------------------------------------------


@router.get("/departments", summary="All departments")
async def list_departments(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    rows = await session.execute(select(Department).order_by(Department.name.asc()))
    return {
        "items": [
            {
                "id": d.id,
                "name": d.name,
                "code": d.code,
                "level": d.level,
                "parent_id": d.parent_id,
                "state_code": d.state_code,
                "district": d.district,
                "sectors": list(d.sectors or []),
                "service_levels": {
                    "accept_days": d.sla_accept_days or settings.sla_accept_days,
                    "approve_days": d.sla_approve_days or settings.sla_approve_days,
                    "release_days": d.sla_release_days or settings.sla_release_days,
                },
            }
            for d in rows.scalars().all()
        ]
    }


@router.post("/departments", status_code=status.HTTP_201_CREATED, summary="Create a department")
async def create_department(
    body: DepartmentIn, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    department = Department(**body.model_dump())
    session.add(department)
    await session.flush()
    await audit_service.record(
        session,
        action="admin.department_created",
        entity_type="department",
        entity_id=department.id,
        actor_id=principal.user_id,
        actor_role=Role.PLATFORM_ADMIN,
        after={"name": department.name, "code": department.code},
    )
    await session.commit()
    return {"id": department.id, "name": department.name, "code": department.code}


@router.get("/users", summary="Users and their roles")
async def list_users(
    principal: PrincipalDep,
    session: SessionDep,
    role: str | None = Query(None),
    department_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    require(principal, "admin:manage", {})
    stmt = select(AppUser).order_by(AppUser.name.asc()).limit(limit)
    if department_id:
        stmt = stmt.where(AppUser.department_id == department_id)
    rows = list((await session.execute(stmt)).scalars().all())
    if role:
        rows = [u for u in rows if role in u.role_codes]
    return {
        "items": [
            {
                "id": u.id,
                "name": u.name,
                "email": u.email,
                "phone": u.phone,
                "designation": u.designation,
                "department_id": u.department_id,
                "startup_id": u.startup_id,
                "status": u.status,
                "locale": u.locale,
                "roles": sorted(u.role_codes),
                "role_labels": [ROLE_LABELS.get(r, r) for r in sorted(u.role_codes)],
                "last_login_at": iso(u.last_login_at),
            }
            for u in rows
        ]
    }


@router.post("/users", status_code=status.HTTP_201_CREATED, summary="Create a user")
async def create_user(
    body: UserIn, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    existing = await session.execute(select(AppUser).where(AppUser.email == body.email.lower()))
    if existing.scalar_one_or_none() is not None:
        raise ValidationFailed(
            "A user with this email address already exists.",
            errors=[
                {
                    "field": "email",
                    "detail": "The address is already registered.",
                    "fix": "Add a role to the existing account instead of creating a new one.",
                }
            ],
        )
    user = AppUser(
        name=body.name,
        email=str(body.email).lower(),
        phone=body.phone,
        designation=body.designation,
        department_id=body.department_id,
        startup_id=body.startup_id,
        locale=body.locale,
        password_hash=hash_password(body.password) if body.password else None,
    )
    session.add(user)
    await session.flush()
    await audit_service.record(
        session,
        action="admin.user_created",
        entity_type="app_user",
        entity_id=user.id,
        actor_id=principal.user_id,
        actor_role=Role.PLATFORM_ADMIN,
        department_id=user.department_id,
        after={"email": user.email, "name": user.name},
    )
    await session.commit()
    return {"id": user.id, "email": user.email, "name": user.name}


@router.post("/roles", status_code=status.HTTP_201_CREATED, summary="Grant a scoped role")
async def grant_role(
    body: RoleIn, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    user = await session.get(AppUser, body.user_id)
    if user is None:
        raise NotFound("That user was not found.")

    if body.role in (Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR) and body.scope_type != "challenge":
        raise ValidationFailed(
            "Evaluator and validator roles are always bound to a specific challenge.",
            errors=[
                {
                    "field": "scope_type",
                    "detail": "The scope given was " + body.scope_type + ".",
                    "fix": "Assign the panel from the challenge page instead.",
                }
            ],
        )

    existing = await session.execute(
        select(RoleAssignment).where(
            RoleAssignment.user_id == body.user_id,
            RoleAssignment.role == body.role,
            RoleAssignment.scope_type == body.scope_type,
            RoleAssignment.scope_id == body.scope_id,
        )
    )
    if existing.scalar_one_or_none() is not None:
        return {"granted": False, "detail": "This role is already held with the same scope."}

    session.add(RoleAssignment(**body.model_dump()))
    await audit_service.record(
        session,
        action="admin.role_granted",
        entity_type="app_user",
        entity_id=body.user_id,
        actor_id=principal.user_id,
        actor_role=Role.PLATFORM_ADMIN,
        after=body.model_dump(),
    )
    await session.commit()
    return {"granted": True, "role": body.role, "scope_type": body.scope_type}


@router.delete("/roles/{assignment_id}", summary="Revoke a role")
async def revoke_role(
    assignment_id: str, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    record = await session.get(RoleAssignment, assignment_id)
    if record is None:
        raise NotFound("That role assignment was not found.")
    revoked_user_id = record.user_id
    snapshot = {"user_id": revoked_user_id, "role": record.role, "scope_id": record.scope_id}
    await session.delete(record)
    await audit_service.record(
        session,
        action="admin.role_revoked",
        entity_type="app_user",
        entity_id=revoked_user_id,
        actor_id=principal.user_id,
        actor_role=Role.PLATFORM_ADMIN,
        before=snapshot,
    )
    await session.commit()
    return {"revoked": True}


# --- Templates -------------------------------------------------------------


@router.get("/templates", summary="Template Kit")
async def list_templates(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    require(principal, "template:read", {})
    rows = await templates_service.all_templates(session)
    return {
        "items": [
            {
                "id": t.id,
                "kind": t.kind,
                "version": t.version,
                "locale": t.locale,
                "title": t.title,
                "published_at": iso(t.published_at),
                "superseded_at": iso(t.superseded_at),
                "source_note": t.source_note,
                "body": t.body,
            }
            for t in rows
        ],
        "note": "Template versions are immutable. A challenge or agreement records the exact "
        "versions it used.",
    }


@router.post("/templates/install", summary="Install any missing Template Kit versions")
async def install_templates(
    principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    installed = await templates_service.install_template_kit(session)
    await session.commit()
    return {"installed": installed}


# --- Audit -----------------------------------------------------------------


@router.get("/audit", summary="Audit log")
async def audit_log(
    principal: PrincipalDep,
    session: SessionDep,
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
    actor_id: str | None = Query(None),
    action: str | None = Query(None),
    department_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    before_seq: int | None = Query(None),
) -> dict[str, Any]:
    scope = department_id
    if not principal.is_admin():
        scope = principal.department_id
        require(principal, "audit:read", {"department_id": scope})

    rows = await audit_service.entries_for(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        department_id=scope,
        actor_id=actor_id,
        action=action,
        limit=limit,
        before_seq=before_seq,
    )
    return {
        "items": [
            {
                "seq": r.seq,
                "at": iso(r.at),
                "at_ist": format_ist(r.at),
                "actor_id": r.actor_id,
                "actor_role": r.actor_role,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "department_id": r.department_id,
                "before": r.before,
                "after": r.after,
                "reason": r.reason,
                "prev_hash": r.prev_hash,
                "hash": r.hash,
            }
            for r in rows
        ],
        "count": len(rows),
        "next_before_seq": rows[-1].seq if rows else None,
    }


@router.post("/audit/verify", summary="Recompute the hash chain")
async def verify_audit(principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None) -> dict[str, Any]:
    _require_admin(principal)
    verification = await audit_service.verify(session)
    total = await audit_service.count(session)
    return {
        "verified": verification.verified,
        "entries_checked": verification.entries_checked,
        "entries_total": total,
        "first_broken_seq": verification.first_broken_seq,
        "head_hash": verification.head_hash,
        "detail": verification.detail,
        "note": "The head hash is also written daily to separate write-once storage, so an "
        "attacker with database access cannot silently rewrite the whole chain.",
    }


@router.get("/audit/export.csv", summary="Export the audit log")
async def export_audit(
    principal: PrincipalDep,
    session: SessionDep,
    limit: int = Query(5000, ge=1, le=50000),
) -> Response:
    scope = None if principal.is_admin() else principal.department_id
    if not principal.is_admin():
        require(principal, "audit:read", {"department_id": scope})
    rows = await audit_service.entries_for(session, department_id=scope, limit=limit)

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        ["seq", "at_utc", "at_ist", "actor_id", "actor_role", "action", "entity_type",
         "entity_id", "reason", "prev_hash", "hash"]
    )
    for r in reversed(rows):
        writer.writerow(
            [r.seq, r.at.isoformat(), format_ist(r.at), r.actor_id or "", r.actor_role or "",
             r.action, r.entity_type, r.entity_id, (r.reason or "").replace("\n", " "),
             r.prev_hash, r.hash]
        )
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )


# --- Dashboards and jobs ---------------------------------------------------


@router.get("/dashboard", summary="Department dashboard")
async def dashboard(
    principal: PrincipalDep, session: SessionDep, department_id: str | None = Query(None)
) -> dict[str, Any]:
    scope = department_id or principal.department_id
    if not scope and not principal.is_admin():
        raise Forbidden("Your account is not attached to a department.")

    stmt = select(Challenge.state, func.count()).group_by(Challenge.state)
    if scope:
        stmt = stmt.where(Challenge.department_id == scope)
    by_stage = {state: int(count) for state, count in (await session.execute(stmt)).all()}

    pilot_stmt = select(Pilot.state, func.count()).group_by(Pilot.state)
    if scope:
        pilot_stmt = pilot_stmt.where(Pilot.department_id == scope)
    pilots_by_state = {state: int(count) for state, count in (await session.execute(pilot_stmt)).all()}

    breach_stmt = (
        select(func.count())
        .select_from(Milestone)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(Milestone.escalation_level > 0, Milestone.state != MilestoneState.PAID)
    )
    if scope:
        breach_stmt = breach_stmt.where(Pilot.department_id == scope)
    breaches = int((await session.execute(breach_stmt)).scalar_one())

    evidence_stmt = (
        select(EvidenceReport.band, func.count(), func.avg(EvidenceReport.confidence_score))
        .join(Pilot, Pilot.id == EvidenceReport.pilot_id)
        .group_by(EvidenceReport.band)
    )
    if scope:
        evidence_stmt = evidence_stmt.where(Pilot.department_id == scope)
    evidence_rows = (await session.execute(evidence_stmt)).all()

    passport_stmt = select(func.count()).select_from(InnovationPassport)
    if scope:
        passport_stmt = passport_stmt.where(InnovationPassport.department_id == scope)
    passports = int((await session.execute(passport_stmt)).scalar_one())

    payment = await payments_service.department_report(session, scope) if scope else {}

    return {
        "department_id": scope,
        "challenges_by_stage": by_stage,
        "challenges_total": sum(by_stage.values()),
        "pilots_by_state": pilots_by_state,
        "pilots_active": pilots_by_state.get("Active", 0),
        "open_sla_breaches": breaches,
        "evidence": [
            {"band": band, "count": int(count), "average_score": round(float(avg or 0), 1)}
            for band, count, avg in evidence_rows
        ],
        "passports_issued": passports,
        "payment": payment,
    }


@router.get("/jobs", summary="Job queues and dead letters")
async def jobs_overview(principal: PrincipalDep, session: SessionDep) -> dict[str, Any]:
    _require_admin(principal)
    depths = await jobs_service.queue_depth(session)
    dead = await jobs_service.dead_letters(session)
    return {
        "queue_depth": depths,
        "dead_letters": [
            {
                "id": j.id,
                "type": j.type,
                "queue": j.queue,
                "status": j.status,
                "attempts": j.attempts,
                "error": j.error,
                "created_at": iso(j.created_at),
            }
            for j in dead
        ],
    }


@router.post("/jobs/{job_id}/retry", summary="Replay a dead-letter job")
async def retry_job(
    job_id: str, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    _require_admin(principal)
    job = await jobs_service.retry_job(session, job_id)
    if job is None:
        raise NotFound("That job was not found.")
    await session.commit()
    return {"retried": True, "job_id": job.id, "status": job.status}


@router.get("/notifications/outbox", summary="Messages the mock adapters captured")
async def mock_outbox(principal: PrincipalDep) -> dict[str, Any]:
    _require_admin(principal)
    from app.services.adapters.email import MockEmailAdapter, get_email_adapter
    from app.services.adapters.sms import MockSmsAdapter, get_sms_adapter

    email = get_email_adapter()
    sms = get_sms_adapter()
    return {
        "email": [
            {"to": m.to_email, "subject": m.subject, "at": m.at, "body": m.body}
            for m in (email.recent(50) if isinstance(email, MockEmailAdapter) else [])
        ],
        "sms": [
            {"to": m.to_phone, "text": m.text, "at": m.at}
            for m in (list(reversed(sms.outbox[-50:])) if isinstance(sms, MockSmsAdapter) else [])
        ],
        "note": "Adapters are in mock mode. Switching to live is a configuration change.",
    }


@router.post("/clock", summary="Fast-forward the clock for a demonstration")
async def set_clock(
    body: ClockIn, principal: PrincipalDep, session: SessionDep, _csrf: CsrfDep = None
) -> dict[str, Any]:
    """Moves the platform clock forward so a service level breach can be demonstrated.

    Restricted to the local and demo environments, and recorded in the audit log.
    """
    _require_admin(principal)
    if settings.environment not in ("local", "demo", "staging"):
        raise Forbidden("The clock cannot be moved in this environment.")
    if not body.confirm:
        raise ValidationFailed(
            "Moving the clock affects every service level timer and must be confirmed.",
            errors=[
                {
                    "field": "confirm",
                    "detail": "Confirmation was not given.",
                    "fix": "Set confirm to true if you intend to fast-forward the demonstration "
                    "clock.",
                }
            ],
        )
    from datetime import timedelta

    set_demo_offset(timedelta(days=body.days))
    await audit_service.record(
        session,
        action="admin.clock_moved",
        entity_type="platform",
        entity_id="clock",
        actor_id=principal.user_id,
        actor_role=Role.PLATFORM_ADMIN,
        after={"offset_days": body.days},
        reason="Demonstration of service level escalation.",
    )
    await session.commit()
    return {
        "offset_days": body.days,
        "now": utcnow().isoformat(),
        "now_ist": format_ist(utcnow()),
        "detail": "The platform clock is fast-forwarded. The next scheduler cycle will escalate "
        "any milestone whose service level has now passed.",
    }


@router.post("/scheduler/run", summary="Run one scheduler cycle now")
async def run_scheduler(principal: PrincipalDep, _csrf: CsrfDep = None) -> dict[str, Any]:
    _require_admin(principal)
    from app.workers.runner import drain
    from app.workers.scheduler import Scheduler

    scheduler = Scheduler()
    tick = await scheduler.tick()
    processed = await drain()
    return {"scheduler": tick, "jobs_processed": processed}

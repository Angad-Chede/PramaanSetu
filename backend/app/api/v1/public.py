"""Public endpoints: the challenge board, demand visibility and the transparency page.

These serve unauthenticated readers, so they carry no personal data and are cached for
a short period, invalidated on publication or corrigendum events (PRD 10.7).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, or_, select

from app.api.common import iso, money
from app.core.clock import utcnow
from app.core.config import settings
from app.core.deps import SessionDep
from app.core.errors import NotFound
from app.domain.states import ChallengeState, MilestoneState
from app.models.challenge import Challenge, Clarification
from app.models.evidence import EvidenceReport
from app.models.identity import Department
from app.models.payment import Milestone
from app.models.pilot import Pilot
from app.models.scale import InnovationPassport
from app.models.startup import Startup

router = APIRouter(prefix="/public", tags=["public"])

OPEN_STATES = (ChallengeState.PUBLISHED,)
CACHE_SECONDS = 60


def _board_item(challenge: Challenge, department_name: str | None, now) -> dict[str, Any]:
    days_left = None
    if challenge.application_deadline:
        days_left = round((challenge.application_deadline - now).total_seconds() / 86400.0, 1)
    return {
        "id": challenge.id,
        "reference": challenge.reference,
        "title": challenge.title,
        "outcome_statement": challenge.outcome_statement,
        "sector": challenge.sector,
        "state_code": challenge.state_code,
        "district": challenge.district,
        "department_name": department_name,
        "budget_ceiling": money(challenge.budget_ceiling_paise),
        "pilot_duration_weeks": challenge.pilot_duration_weeks,
        "application_deadline": iso(challenge.application_deadline),
        "days_remaining": days_left,
        "closing_soon": days_left is not None and 0 <= days_left <= 7,
        "published_at": iso(challenge.published_at),
        "state": challenge.state,
    }


@router.get("/challenges", summary="Public challenge board")
async def board(
    session: SessionDep,
    response: Response,
    query: str | None = Query(None),
    sector: str | None = Query(None),
    state_code: str | None = Query(None),
    district: str | None = Query(None),
    department_id: str | None = Query(None),
    budget_band: str | None = Query(None, pattern="^(under_10l|10l_50l|50l_2cr|above_2cr)$"),
    closing_within_days: int | None = Query(None, ge=1, le=90),
    include_closed: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "public, max-age=" + str(CACHE_SECONDS)
    now = utcnow()

    states = list(OPEN_STATES)
    if include_closed:
        states.extend(
            [
                ChallengeState.APPLICATIONS_CLOSED,
                ChallengeState.SCREENING,
                ChallengeState.EVALUATION,
                ChallengeState.SHORTLISTED,
                ChallengeState.PILOT_DESIGN,
                ChallengeState.PILOT_ACTIVE,
                ChallengeState.VALIDATION,
                ChallengeState.DECISION_PENDING,
                ChallengeState.SCALED,
            ]
        )

    stmt = (
        select(Challenge, Department.name)
        .join(Department, Department.id == Challenge.department_id)
        .where(Challenge.state.in_(states))
        .order_by(Challenge.application_deadline.asc().nulls_last())
        .limit(limit)
    )
    if query:
        pattern = "%" + query.strip() + "%"
        stmt = stmt.where(
            or_(
                Challenge.title.ilike(pattern),
                Challenge.outcome_statement.ilike(pattern),
                Challenge.problem_statement.ilike(pattern),
            )
        )
    if sector:
        stmt = stmt.where(Challenge.sector == sector)
    if state_code:
        stmt = stmt.where(Challenge.state_code == state_code)
    if district:
        stmt = stmt.where(Challenge.district == district)
    if department_id:
        stmt = stmt.where(Challenge.department_id == department_id)
    if closing_within_days:
        stmt = stmt.where(Challenge.application_deadline <= now + timedelta(days=closing_within_days))

    bands = {
        "under_10l": (0, 10_00_000 * 100),
        "10l_50l": (10_00_000 * 100, 50_00_000 * 100),
        "50l_2cr": (50_00_000 * 100, 2_00_00_000 * 100),
        "above_2cr": (2_00_00_000 * 100, 10**15),
    }
    if budget_band:
        low, high = bands[budget_band]
        stmt = stmt.where(Challenge.budget_ceiling_paise >= low, Challenge.budget_ceiling_paise < high)

    rows = (await session.execute(stmt)).all()
    return {
        "items": [_board_item(c, name, now) for c, name in rows],
        "count": len(rows),
        "filters": {
            "budget_bands": [
                {"value": "under_10l", "label": "Under 10 lakh"},
                {"value": "10l_50l", "label": "10 lakh to 50 lakh"},
                {"value": "50l_2cr", "label": "50 lakh to 2 crore"},
                {"value": "above_2cr", "label": "Above 2 crore"},
            ]
        },
    }


@router.get("/challenges/{challenge_id}", summary="One published challenge, without internal fields")
async def public_challenge(challenge_id: str, session: SessionDep, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "public, max-age=" + str(CACHE_SECONDS)
    challenge = await session.get(Challenge, challenge_id)
    if challenge is None or challenge.state in (
        ChallengeState.DRAFT,
        ChallengeState.IN_REVIEW,
    ):
        raise NotFound("This challenge is not published.")

    clarifications = await session.execute(
        select(Clarification)
        .where(
            Clarification.challenge_id == challenge.id, Clarification.published_at.isnot(None)
        )
        .order_by(Clarification.published_at.asc())
    )
    return {
        **_board_item(challenge, challenge.department.name if challenge.department else None, utcnow()),
        "problem_statement": challenge.problem_statement,
        "current_situation": challenge.current_situation,
        "constraints": challenge.constraints,
        "pilot_scope": challenge.pilot_scope,
        "commercial_terms": challenge.commercial_terms,
        "location_required": challenge.location_required,
        "ip_option": challenge.ip_option,
        "eligibility_notes": (challenge.eligibility_rules or {}).get("notes", ""),
        "clarification_cutoff": iso(challenge.clarification_cutoff),
        "kpis": [
            {
                "name": k.name,
                "unit": k.unit,
                "direction": k.direction,
                "direction_label": "Lower is better" if k.direction == "lower" else "Higher is better",
                "baseline_value": float(k.baseline_value) if k.baseline_value is not None else None,
                "target_value": float(k.target_value) if k.target_value is not None else None,
                "baseline_method": k.baseline_method,
                "is_primary": k.is_primary,
            }
            for k in challenge.kpis
        ],
        "criteria": [
            {"name": c.name, "weight": c.weight, "description": c.description, "anchors": c.anchors}
            for c in challenge.criteria
        ],
        "clarifications": [
            {"question": c.question, "answer": c.answer, "published_at": iso(c.published_at)}
            for c in clarifications.scalars().all()
        ],
    }


@router.get("/demand/summary", summary="Where departmental demand is, by sector and department")
async def demand_summary(session: SessionDep, response: Response) -> dict[str, Any]:
    response.headers["Cache-Control"] = "public, max-age=" + str(CACHE_SECONDS)
    now = utcnow()

    by_sector = await session.execute(
        select(
            Challenge.sector,
            func.count(),
            func.sum(Challenge.budget_ceiling_paise),
        )
        .where(Challenge.state.in_(OPEN_STATES))
        .group_by(Challenge.sector)
        .order_by(func.count().desc())
    )
    by_department = await session.execute(
        select(Department.name, Department.state_code, func.count(), func.sum(Challenge.budget_ceiling_paise))
        .join(Challenge, Challenge.department_id == Department.id)
        .where(Challenge.state.in_(OPEN_STATES))
        .group_by(Department.name, Department.state_code)
        .order_by(func.count().desc())
    )
    upcoming = await session.execute(
        select(func.count())
        .select_from(Challenge)
        .where(Challenge.state == ChallengeState.IN_REVIEW)
    )

    return {
        "open_by_sector": [
            {
                "sector": sector or "Not stated",
                "open_challenges": int(count),
                "total_budget": money(int(total or 0)),
            }
            for sector, count, total in by_sector.all()
        ],
        "open_by_department": [
            {
                "department": name,
                "state_code": state_code,
                "open_challenges": int(count),
                "total_budget": money(int(total or 0)),
            }
            for name, state_code, count, total in by_department.all()
        ],
        "upcoming_in_review": int(upcoming.scalar_one()),
        "generated_at": now.isoformat(),
        "note": "Demand visibility lets a startup plan its product and its bids instead of "
        "discovering opportunities by chance.",
    }


@router.get("/passports", summary="Publicly listed validated evidence")
async def public_passports(
    session: SessionDep,
    response: Response,
    category: str | None = Query(None),
    min_score: float | None = Query(None, ge=0, le=100),
    limit: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    response.headers["Cache-Control"] = "public, max-age=" + str(CACHE_SECONDS)
    stmt = (
        select(InnovationPassport, Startup.legal_name, Department.name)
        .join(Startup, Startup.id == InnovationPassport.startup_id)
        .join(Department, Department.id == InnovationPassport.department_id)
        .order_by(InnovationPassport.confidence_score.desc())
        .limit(limit)
    )
    if category:
        stmt = stmt.where(InnovationPassport.category == category)
    if min_score is not None:
        stmt = stmt.where(InnovationPassport.confidence_score >= min_score)

    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "reference": p.reference,
                "solution_name": p.solution_name,
                "startup_name": startup_name,
                "department_name": department_name,
                "category": p.category,
                "sector": p.sector,
                "state_code": p.state_code,
                "confidence_score": p.confidence_score,
                "band": p.band,
                "result_summary": p.result_summary,
                "validated_on": iso(p.validated_on),
            }
            for p, startup_name, department_name in rows
        ]
    }


@router.get("/transparency", summary="Public transparency page")
async def transparency(session: SessionDep, response: Response) -> dict[str, Any]:
    if not settings.feature_public_transparency:
        raise NotFound("The transparency page is not enabled in this environment.")
    response.headers["Cache-Control"] = "public, max-age=300"

    challenges = await session.execute(
        select(Challenge.state, func.count()).group_by(Challenge.state)
    )
    by_state = {state: int(count) for state, count in challenges.all()}

    pilots = await session.execute(select(func.count()).select_from(Pilot))
    passports = await session.execute(select(func.count()).select_from(InnovationPassport))
    reports = await session.execute(
        select(func.count(), func.avg(EvidenceReport.confidence_score)).where(
            EvidenceReport.confidence_score.isnot(None)
        )
    )
    report_count, average_score = reports.one()

    paid = await session.execute(
        select(Milestone).where(Milestone.state == MilestoneState.PAID).limit(2000)
    )
    durations: list[float] = []
    for milestone in paid.scalars().all():
        history = {h.get("state"): h.get("at") for h in (milestone.state_history or [])}
        start, end = history.get(MilestoneState.SUBMITTED), history.get(MilestoneState.PAID)
        if start and end:
            from datetime import datetime

            try:
                durations.append(
                    (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() / 86400.0
                )
            except ValueError:
                continue

    startups = await session.execute(select(func.count()).select_from(Startup))

    return {
        "challenges_published": sum(
            count for state, count in by_state.items()
            if state not in (ChallengeState.DRAFT, ChallengeState.IN_REVIEW)
        ),
        "challenges_by_stage": by_state,
        "pilots_run": int(pilots.scalar_one()),
        "validated_passports": int(passports.scalar_one()),
        "evidence_reports": int(report_count or 0),
        "average_confidence_score": round(float(average_score or 0), 1),
        "registered_startups": int(startups.scalar_one()),
        "average_days_submission_to_payment": (
            round(sum(durations) / len(durations), 1) if durations else None
        ),
        "note": "These figures contain no personal data. They are recomputed from the platform's "
        "own event records.",
        "generated_at": utcnow().isoformat(),
    }

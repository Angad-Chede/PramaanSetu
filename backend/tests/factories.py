"""Small builders shared by the test modules."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from httpx import AsyncClient

from app.core.clock import utcnow
from app.core.money import rupees_to_paise
from app.core.policy import Principal, ScopedRole
from app.core.security import hash_password
from app.models.challenge import Challenge, Kpi, RubricCriterion
from app.models.identity import AppUser, Department, RoleAssignment
from app.models.startup import Startup


async def make_department(session, code: str = "TEST-DEPT", **kwargs) -> Department:  # type: ignore[no-untyped-def]
    department = Department(
        name=kwargs.pop("name", "Test Department"),
        code=code,
        level=kwargs.pop("level", "district"),
        state_code=kwargs.pop("state_code", "MH"),
        district=kwargs.pop("district", "Pune"),
        sectors=kwargs.pop("sectors", ["Water"]),
        **kwargs,
    )
    session.add(department)
    await session.flush()
    return department


async def make_user(
    session,  # type: ignore[no-untyped-def]
    *,
    email: str,
    name: str = "Test User",
    roles: list[tuple[str, str, str | None]] | None = None,
    department_id: str | None = None,
    startup_id: str | None = None,
    password: str | None = None,
) -> AppUser:
    user = AppUser(
        name=name,
        email=email,
        department_id=department_id,
        startup_id=startup_id,
        password_hash=hash_password(password) if password else None,
        privacy_notice_accepted_at=utcnow(),
    )
    session.add(user)
    await session.flush()
    for role, scope_type, scope_id in roles or []:
        session.add(
            RoleAssignment(user_id=user.id, role=role, scope_type=scope_type, scope_id=scope_id)
        )
    await session.flush()
    await session.refresh(user)
    return user


async def make_startup(session, index: int = 1, **kwargs) -> Startup:  # type: ignore[no-untyped-def]
    startup = Startup(
        legal_name=kwargs.pop("legal_name", "Test Startup " + str(index) + " Private Limited"),
        cin=kwargs.pop("cin", "U72200MH2020PTC" + str(100000 + index)),
        dpiit_number=kwargs.pop("dpiit_number", "DIPP" + str(200000 + index)),
        dpiit_status=kwargs.pop("dpiit_status", "Verified"),
        sectors=kwargs.pop("sectors", ["Water"]),
        state_code=kwargs.pop("state_code", "MH"),
        district=kwargs.pop("district", "Pune"),
        product_description=kwargs.pop(
            "product_description", "Acoustic leak detection for district metering areas."
        ),
        capability_text=kwargs.pop(
            "capability_text",
            "Acoustic and pressure sensor network for continuous leak detection across district "
            "metering areas, with a hydraulic model that localises leaks.",
        ),
        contact_name=kwargs.pop("contact_name", "Founder " + str(index)),
        contact_email=kwargs.pop("contact_email", "founder" + str(index) + "@test.invalid"),
        annual_turnover_paise=kwargs.pop("annual_turnover_paise", 0),
        years_of_experience=kwargs.pop("years_of_experience", 1),
        **kwargs,
    )
    session.add(startup)
    await session.flush()
    return startup


DEFAULT_KPIS: list[dict[str, Any]] = [
    {
        "name": "Non-revenue water",
        "unit": "percent of water supplied",
        "kind": "proportion",
        "direction": "lower",
        "baseline_value": 32.0,
        "baseline_sd": 8.0,
        "baseline_source": "Monthly district metering area water balance",
        "baseline_method": "Water supplied minus billed authorised consumption, computed weekly.",
        "target_value": 24.0,
        "is_primary": True,
    },
    {
        "name": "Average leak detection to repair time",
        "unit": "hours",
        "kind": "continuous",
        "direction": "lower",
        "baseline_value": 96.0,
        "baseline_sd": 30.0,
        "baseline_source": "Works management register",
        "baseline_method": "Time from detection to repair completion, averaged weekly.",
        "target_value": 36.0,
        "is_primary": False,
    },
]

DEFAULT_CRITERIA: list[dict[str, Any]] = [
    {"name": "Fit to the stated outcome", "weight": 40,
     "description": "How directly the solution addresses the outcome.",
     "anchors": {"1": "Addresses a different problem.", "5": "Moves the primary measure directly."}},
    {"name": "Technical soundness", "weight": 35,
     "description": "Whether the approach would work in the operating conditions.",
     "anchors": {"1": "Not workable.", "5": "Workable with risks mitigated."}},
    {"name": "Value for money", "weight": 25,
     "description": "Pilot cost against the outcome promised.",
     "anchors": {"1": "Not justified.", "5": "Well justified and itemised."}},
]


async def make_challenge(
    session,  # type: ignore[no-untyped-def]
    *,
    department: Department,
    officer: AppUser,
    state: str = "Draft",
    title: str = "Reducing water loss in the eastern zone",
    deadline_days: int = 14,
    budget_rupees: int = 4500000,
    complete: bool = True,
) -> Challenge:
    from app.core.ids import short_ref

    now = utcnow()
    challenge = Challenge(
        reference=short_ref("CH"),
        department_id=department.id,
        created_by=officer.id,
        state=state,
        title=title,
        problem_statement=(
            "Treated water is lost between the service reservoir and household connections. "
            "Leaks are found only when residents complain, usually several days later."
        ),
        current_situation="Bulk meters are read manually once a month.",
        outcome_statement=(
            "Reduce non-revenue water in the eastern zone from 32 percent to 24 percent within "
            "the pilot period, measured weekly from the district metering area water balance."
        ),
        constraints="Data hosted in India. No personal identifiers shared.",
        pilot_scope="A controlled pilot across the nominated district metering areas.",
        commercial_terms="Payment against four milestones.",
        sector="Water",
        state_code=department.state_code,
        district=department.district,
        budget_ceiling_paise=rupees_to_paise(budget_rupees),
        pilot_duration_weeks=8,
        application_deadline=now + timedelta(days=deadline_days),
        clarification_cutoff=now + timedelta(days=max(deadline_days - 3, 1)),
        evaluation_deadline=now + timedelta(days=deadline_days + 14),
        eligibility_rules={
            "require_dpiit": True,
            "min_turnover_paise": rupees_to_paise(5000000),
            "min_experience_years": 3,
            "notes": "Prior turnover and experience criteria are relaxed for recognised startups.",
        },
        template_versions={"problem_statement": "1.0.0", "evaluation_rubric": "1.0.0"},
        published_at=now if state not in ("Draft", "InReview") else None,
    )
    session.add(challenge)
    await session.flush()

    if complete:
        for position, item in enumerate(DEFAULT_KPIS):
            session.add(Kpi(challenge_id=challenge.id, position=position, **item))
        for position, item in enumerate(DEFAULT_CRITERIA):
            session.add(
                RubricCriterion(
                    challenge_id=challenge.id, position=position, round_number=1, **item
                )
            )
        await session.flush()
    await session.refresh(challenge)
    return challenge


def principal_of(user: AppUser) -> Principal:
    return Principal(
        user_id=user.id,
        name=user.name,
        email=user.email,
        department_id=user.department_id,
        startup_id=user.startup_id,
        scoped_roles=[
            ScopedRole(role=r.role, scope_type=r.scope_type, scope_id=r.scope_id) for r in user.roles
        ],
    )


async def sign_in(http: AsyncClient, email: str) -> dict[str, str]:
    """Sign in through the local impersonation endpoint and return the CSRF header."""
    response = await http.post("/api/v1/auth/dev/impersonate", json={"identifier": email})
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}


async def sign_out(http: AsyncClient) -> None:
    http.cookies.clear()

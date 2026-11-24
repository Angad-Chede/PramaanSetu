"""Deterministic seed data (PRD 14.2).

Creates realistic synthetic data with a fixed seed: departments across three states, 200
startups with capability text, challenges at every lifecycle stage, and one complete
pilot, water loss reduction, carried through baseline, pilot, evidence, validation,
scale decision and Innovation Passport, producing a known Evidence Confidence Score.

No real personal data. No emojis.

    python -m app.seed            create the data
    python -m app.seed --reset    drop everything first
"""

from __future__ import annotations

import argparse
import asyncio
import random
from datetime import timedelta
from typing import Any

import numpy as np
from sqlalchemy import select

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import engine, session_scope
from app.core.money import rupees_to_paise
from app.core.policy import Principal, ScopedRole
from app.core.security import hash_password
from app.domain.states import ChallengeState, DpiitStatus, MilestoneState, Role
from app.models import Base
from app.models.application import Application
from app.models.challenge import Challenge, Clarification, Kpi, RubricCriterion
from app.models.identity import AppUser, Department, RoleAssignment
from app.models.payment import Milestone
from app.models.pilot import MetricSubmission, Pilot
from app.models.startup import Startup
from app.services import applications as applications_service
from app.services import challenges as challenges_service
from app.services import evaluation as evaluation_service
from app.services import evidence as evidence_service
from app.services import payments as payments_service
from app.services import pilots as pilots_service
from app.services import scale as scale_service
from app.services import startups as startups_service
from app.services import templates as templates_service
from app.services.adapters.dpiit import MockDpiitAdapter, get_dpiit_adapter

SEED = 20260924
DEMO_PASSWORD = "PramaanSetu@2026"

rng = random.Random(SEED)
nprng = np.random.default_rng(SEED)


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

DEPARTMENTS: list[dict[str, Any]] = [
    {
        "code": "NITI-NODAL",
        "name": "Innovation Procurement Nodal Agency",
        "level": "central",
        "state_code": None,
        "district": None,
        "sectors": ["Cross-sector"],
    },
    {
        "code": "MH-WATER",
        "name": "Water Supply and Sanitation Department, Maharashtra",
        "level": "state",
        "state_code": "MH",
        "district": None,
        "sectors": ["Water"],
    },
    {
        "code": "MH-PUNE-WATER",
        "name": "Pune Municipal Corporation Water Supply Department",
        "level": "district",
        "state_code": "MH",
        "district": "Pune",
        "sectors": ["Water", "Urban solid waste"],
        "parent": "MH-WATER",
    },
    {
        "code": "RJ-UD",
        "name": "Urban Development and Housing Department, Rajasthan",
        "level": "state",
        "state_code": "RJ",
        "district": None,
        "sectors": ["Urban solid waste", "Urban mobility"],
    },
    {
        "code": "RJ-JAIPUR",
        "name": "Jaipur Municipal Corporation Greater",
        "level": "district",
        "state_code": "RJ",
        "district": "Jaipur",
        "sectors": ["Urban solid waste", "Urban mobility"],
        "parent": "RJ-UD",
    },
    {
        "code": "TN-HEALTH",
        "name": "Health and Family Welfare Department, Tamil Nadu",
        "level": "state",
        "state_code": "TN",
        "district": None,
        "sectors": ["Public health"],
    },
    {
        "code": "TN-CBE",
        "name": "Coimbatore District Health Administration",
        "level": "district",
        "state_code": "TN",
        "district": "Coimbatore",
        "sectors": ["Public health"],
        "parent": "TN-HEALTH",
    },
]

USERS: list[dict[str, Any]] = [
    # Nodal agency
    {"name": "Nodal Platform Administrator", "email": "admin@pramaansetu.gov.in",
     "designation": "Deputy Director, Innovation Procurement", "department": "NITI-NODAL",
     "roles": [(Role.PLATFORM_ADMIN, "global", None)]},
    # Pune water, the department that runs the flagship challenge
    {"name": "Anita Deshmukh", "email": "anita.deshmukh@pmc.gov.in",
     "designation": "Executive Engineer, Water Supply", "department": "MH-PUNE-WATER",
     "roles": [(Role.DEPARTMENT_OFFICER, "department", "MH-PUNE-WATER")]},
    {"name": "Ramesh Kulkarni", "email": "ramesh.kulkarni@pmc.gov.in",
     "designation": "Additional City Engineer", "department": "MH-PUNE-WATER",
     "roles": [(Role.DEPARTMENT_APPROVER, "department", "MH-PUNE-WATER")]},
    {"name": "Sunita Pawar", "email": "sunita.pawar@pmc.gov.in",
     "designation": "Chief Accounts Officer", "department": "MH-PUNE-WATER",
     "roles": [(Role.FINANCE_OFFICER, "department", "MH-PUNE-WATER")]},
    # Maharashtra state water
    {"name": "Vikram Joshi", "email": "vikram.joshi@mahawater.gov.in",
     "designation": "Superintending Engineer", "department": "MH-WATER",
     "roles": [(Role.DEPARTMENT_OFFICER, "department", "MH-WATER")]},
    {"name": "Meera Sathe", "email": "meera.sathe@mahawater.gov.in",
     "designation": "Chief Engineer", "department": "MH-WATER",
     "roles": [(Role.DEPARTMENT_APPROVER, "department", "MH-WATER")]},
    # Jaipur
    {"name": "Praveen Sharma", "email": "praveen.sharma@jmcg.gov.in",
     "designation": "Additional Commissioner, Health and Sanitation", "department": "RJ-JAIPUR",
     "roles": [(Role.DEPARTMENT_OFFICER, "department", "RJ-JAIPUR")]},
    {"name": "Kavita Meena", "email": "kavita.meena@jmcg.gov.in",
     "designation": "Commissioner", "department": "RJ-JAIPUR",
     "roles": [(Role.DEPARTMENT_APPROVER, "department", "RJ-JAIPUR")]},
    {"name": "Dinesh Yadav", "email": "dinesh.yadav@jmcg.gov.in",
     "designation": "Accounts Officer", "department": "RJ-JAIPUR",
     "roles": [(Role.FINANCE_OFFICER, "department", "RJ-JAIPUR")]},
    # Coimbatore
    {"name": "Lakshmi Narayanan", "email": "lakshmi.n@tnhealth.gov.in",
     "designation": "Deputy Director of Health Services", "department": "TN-CBE",
     "roles": [(Role.DEPARTMENT_OFFICER, "department", "TN-CBE")]},
    {"name": "Arun Prakash", "email": "arun.prakash@tnhealth.gov.in",
     "designation": "Joint Director of Health Services", "department": "TN-CBE",
     "roles": [(Role.DEPARTMENT_APPROVER, "department", "TN-CBE")]},
    {"name": "Geetha Subramanian", "email": "geetha.s@tnhealth.gov.in",
     "designation": "District Accounts Officer", "department": "TN-CBE",
     "roles": [(Role.FINANCE_OFFICER, "department", "TN-CBE")]},
]

EVALUATORS = [
    ("Professor Sanjay Rane", "sanjay.rane@iitb.ac.in", "Professor, Civil Engineering"),
    ("Dr Fatima Sheikh", "fatima.sheikh@cwprs.gov.in", "Principal Scientist, Water Resources"),
    ("Dr Harish Nair", "harish.nair@nitie.ac.in", "Associate Professor, Operations"),
    ("Neelam Bhatt", "neelam.bhatt@cddindia.org", "Lead, Urban Water Practice"),
    ("Dr Suresh Iyer", "suresh.iyer@iisc.ac.in", "Professor, Sensor Systems"),
]

VALIDATORS = [
    ("Dr Anjali Rao", "anjali.rao@nabl.gov.in", "Senior Assessor, Testing and Calibration"),
    ("Mohan Krishnan", "mohan.krishnan@cag.gov.in", "Director, Performance Audit"),
    ("Dr Preeti Verma", "preeti.verma@nitiaayog.gov.in", "Adviser, Evaluation"),
]

SECTORS = [
    "Water", "Urban solid waste", "Urban mobility", "Public health", "Agriculture",
    "Energy", "Education", "Disaster management",
]

CAPABILITY_TEMPLATES: dict[str, list[str]] = {
    "Water": [
        "Acoustic and pressure sensor network for continuous leak detection across district "
        "metering areas, with a hydraulic model that localises leaks to a 30 metre segment and "
        "raises a work order in the utility system. Deployed on cast iron and ductile iron mains.",
        "Non-revenue water analytics platform that reconciles bulk meter inflow against billed "
        "consumption, detects meter under-registration and unauthorised connections, and "
        "produces a weekly water balance for each zone.",
        "Smart bulk metering and pressure management retrofit with remote data logging, used to "
        "cut burst frequency and raise supply hours without replacing existing pipe.",
    ],
    "Urban solid waste": [
        "Vehicle tracking and bin fill-level sensing for door to door collection, with route "
        "optimisation that reduces missed collections and idle running.",
        "Image-based waste segregation audit at the collection point, scoring household "
        "compliance and directing field staff to wards with falling segregation rates.",
        "Weighbridge integration and material recovery analytics that track diversion from "
        "landfill by material stream.",
    ],
    "Urban mobility": [
        "Adaptive signal control using existing camera feeds, retiming junction phases in real "
        "time to cut average delay per vehicle at peak hours.",
        "Bus operations analytics combining automatic vehicle location with ticketing data to "
        "cut headway variation and waiting time.",
        "Junction queue measurement from roadside cameras with automatic reporting of queue "
        "length and signal compliance.",
    ],
    "Public health": [
        "Point of care screening workflow with a handheld analyser and a register application "
        "that cuts the time from sample collection to result reaching the patient.",
        "Referral tracking system for district health facilities that closes the loop on "
        "follow-up visits and flags patients lost to follow-up.",
        "Non-invasive anaemia screening with a mobile application for community health workers, "
        "raising screening coverage in the catchment population.",
    ],
    "Agriculture": [
        "Soil moisture and weather sensing with an irrigation advisory in local languages, "
        "reducing water applied per hectare without reducing yield.",
        "Pest and disease detection from field photographs, with advisory delivered through the "
        "extension officer network.",
        "Crop yield estimation from satellite imagery, validated against crop cutting experiments.",
    ],
    "Energy": [
        "Street lighting control and metering retrofit that cuts consumption per pole and "
        "reports faults automatically.",
        "Rooftop solar monitoring for government buildings with generation shortfall alerts.",
        "Energy audit analytics for pumping stations, identifying inefficient pumps from meter "
        "data alone.",
    ],
    "Education": [
        "Learning assessment application for primary classrooms with teacher dashboards and "
        "district level reporting.",
        "School attendance and mid-day meal reporting with offline capture for low connectivity "
        "areas.",
        "Remedial teaching content aligned to state curriculum with adaptive practice.",
    ],
    "Disaster management": [
        "Flood early warning using river gauge telemetry and rainfall forecasts, with alerting "
        "to ward officials.",
        "Damage assessment from drone imagery with automatic tagging of affected structures.",
        "Emergency resource tracking across relief camps with offline synchronisation.",
    ],
}

NAME_PARTS_A = [
    "Aqua", "Neer", "Jal", "Urja", "Kisan", "Arogya", "Nagar", "Setu", "Drishti", "Prakash",
    "Sankalp", "Tarang", "Vayu", "Bhoomi", "Chakra", "Kshetra", "Netra", "Pravah", "Sanchar",
    "Udaan",
]
NAME_PARTS_B = [
    "Tech", "Systems", "Labs", "Analytics", "Innovations", "Solutions", "Sensors", "Dynamics",
    "Networks", "Works",
]

STATES = [("MH", "Pune"), ("RJ", "Jaipur"), ("TN", "Coimbatore"), ("KA", "Bengaluru"),
          ("GJ", "Ahmedabad"), ("UP", "Lucknow"), ("WB", "Kolkata"), ("DL", "New Delhi")]


def principal_for(user: AppUser) -> Principal:
    return Principal(
        user_id=user.id,
        name=user.name,
        email=user.email,
        locale=user.locale,
        department_id=user.department_id,
        startup_id=user.startup_id,
        scoped_roles=[
            ScopedRole(role=r.role, scope_type=r.scope_type, scope_id=r.scope_id) for r in user.roles
        ],
    )


# ---------------------------------------------------------------------------
# Seeding steps
# ---------------------------------------------------------------------------


async def reset_database() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
        await connection.run_sync(Base.metadata.create_all)


async def ensure_schema() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def seed_departments(session) -> dict[str, Department]:  # type: ignore[no-untyped-def]
    out: dict[str, Department] = {}
    for entry in DEPARTMENTS:
        existing = await session.execute(select(Department).where(Department.code == entry["code"]))
        department = existing.scalar_one_or_none()
        if department is None:
            department = Department(
                name=entry["name"],
                code=entry["code"],
                level=entry["level"],
                state_code=entry["state_code"],
                district=entry["district"],
                sectors=entry["sectors"],
            )
            session.add(department)
            await session.flush()
        out[entry["code"]] = department
    for entry in DEPARTMENTS:
        parent_code = entry.get("parent")
        if parent_code:
            out[entry["code"]].parent_id = out[parent_code].id
    await session.flush()
    return out


async def seed_users(session, departments: dict[str, Department]) -> dict[str, AppUser]:  # type: ignore[no-untyped-def]
    out: dict[str, AppUser] = {}
    password_hash = hash_password(DEMO_PASSWORD)

    for entry in USERS:
        existing = await session.execute(select(AppUser).where(AppUser.email == entry["email"]))
        user = existing.scalar_one_or_none()
        if user is None:
            user = AppUser(
                name=entry["name"],
                email=entry["email"],
                designation=entry["designation"],
                department_id=departments[entry["department"]].id,
                password_hash=password_hash,
                privacy_notice_accepted_at=utcnow(),
            )
            session.add(user)
            await session.flush()
            for role, scope_type, scope_code in entry["roles"]:
                session.add(
                    RoleAssignment(
                        user_id=user.id,
                        role=str(role),
                        scope_type=scope_type,
                        scope_id=departments[scope_code].id if scope_code else None,
                    )
                )
            await session.flush()
        out[entry["email"]] = user

    for name, email, designation in EVALUATORS + VALIDATORS:
        existing = await session.execute(select(AppUser).where(AppUser.email == email))
        user = existing.scalar_one_or_none()
        if user is None:
            user = AppUser(
                name=name,
                email=email,
                designation=designation,
                password_hash=password_hash,
                privacy_notice_accepted_at=utcnow(),
            )
            session.add(user)
            await session.flush()
        out[email] = user

    await session.flush()
    return out


def startup_payload(index: int) -> dict[str, Any]:
    sector = SECTORS[index % len(SECTORS)]
    name = (
        NAME_PARTS_A[index % len(NAME_PARTS_A)]
        + NAME_PARTS_B[(index // len(NAME_PARTS_A)) % len(NAME_PARTS_B)]
        + (" Private Limited" if index % 3 else " Technologies Private Limited")
    )
    capability = CAPABILITY_TEMPLATES[sector][index % len(CAPABILITY_TEMPLATES[sector])]
    state_code, district = STATES[index % len(STATES)]
    extra_sector = SECTORS[(index + 3) % len(SECTORS)]
    return {
        "legal_name": name + " " + str(1000 + index),
        "cin": "U" + str(72200 + index % 900) + state_code + "2019PTC" + str(100000 + index),
        "dpiit_number": "DIPP" + str(140000 + index),
        "sectors": [sector] if index % 4 else [sector, extra_sector],
        "state_code": state_code,
        "district": district,
        "product_description": capability.split(".")[0] + ".",
        "capability_text": capability,
        "team_size": 4 + (index % 40),
        "website": "https://example.invalid/" + str(index),
        "contact_name": "Founder " + str(index),
        "contact_email": "contact" + str(index) + "@example.invalid",
        "contact_phone": "9" + str(700000000 + index * 7)[:9],
        "annual_turnover_paise": rupees_to_paise((index % 25) * 400000),
        "years_of_experience": 1 + index % 6,
        "case_references": [
            {
                "title": "Deployment in a municipal body",
                "client": "Municipal corporation",
                "year": 2023 + index % 3,
                "summary": capability.split(".")[0] + " deployed across "
                + str(5 + index % 20) + " sites.",
                "outcome": "Measured improvement recorded by the client.",
            }
        ],
    }


async def seed_startups(session, count: int = 200) -> list[Startup]:  # type: ignore[no-untyped-def]
    existing = await session.execute(select(Startup))
    if len(list(existing.scalars().all())) >= count:
        rows = await session.execute(select(Startup).order_by(Startup.created_at.asc()))
        return list(rows.scalars().all())

    adapter = get_dpiit_adapter()
    registry_entries: list[dict[str, Any]] = []
    created: list[Startup] = []

    for index in range(count):
        payload = startup_payload(index)
        startup = Startup(
            **payload,
            dpiit_status=DpiitStatus.PENDING,
        )
        session.add(startup)
        created.append(startup)
        # Nine in ten are recognised, so the relaxation path and the not-found path both appear.
        if index % 10 != 7:
            registry_entries.append(
                {
                    "recognition_number": payload["dpiit_number"],
                    "legal_name": payload["legal_name"],
                    "recognised_on": "2022-0" + str(1 + index % 9) + "-15",
                }
            )
    await session.flush()

    if isinstance(adapter, MockDpiitAdapter):
        adapter.seed(registry_entries)

    for startup in created:
        result = await adapter.verify(
            recognition_number=startup.dpiit_number, legal_name=startup.legal_name
        )
        startup.dpiit_status = result.status
        startup.dpiit_checked_at = utcnow()
        await startups_service.refresh_embedding(session, startup)

    await session.flush()
    return created


async def seed_startup_users(session, startups: list[Startup]) -> dict[str, AppUser]:  # type: ignore[no-untyped-def]
    out: dict[str, AppUser] = {}
    password_hash = hash_password(DEMO_PASSWORD)
    for startup in startups[:25]:
        email = "founder@" + startup.legal_name.split()[0].lower() + str(startup.cin or "")[-4:] + ".invalid"
        existing = await session.execute(select(AppUser).where(AppUser.email == email))
        user = existing.scalar_one_or_none()
        if user is None:
            user = AppUser(
                name=startup.contact_name,
                email=email,
                designation="Founder",
                startup_id=startup.id,
                password_hash=password_hash,
                privacy_notice_accepted_at=utcnow(),
            )
            session.add(user)
            await session.flush()
            session.add(
                RoleAssignment(
                    user_id=user.id, role=str(Role.STARTUP_USER), scope_type="startup",
                    scope_id=startup.id,
                )
            )
            await session.flush()
        out[startup.id] = user
    return out


FLAGSHIP_KPIS = [
    {
        "name": "Non-revenue water",
        "unit": "percent of water supplied",
        "kind": "proportion",
        "direction": "lower",
        "baseline_value": 32.0,
        "baseline_sd": 8.0,
        "baseline_source": "Monthly district metering area water balance",
        "baseline_method": "Water supplied into the district metering area minus billed "
        "authorised consumption, expressed as a percentage of water supplied, computed weekly "
        "from bulk meter readings and the billing extract.",
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
        "baseline_source": "Complaint and works management register",
        "baseline_method": "Time from leak first reported or detected to repair completion, "
        "averaged across all repairs closed in the week.",
        "target_value": 36.0,
        "is_primary": False,
    },
    {
        "name": "Supply hours per day",
        "unit": "hours per day",
        "kind": "continuous",
        "direction": "higher",
        "baseline_value": 4.5,
        "baseline_sd": 1.2,
        "baseline_source": "Pump house operation log",
        "baseline_method": "Hours of pressurised supply per zone per day, averaged weekly.",
        "target_value": 6.0,
        "is_primary": False,
    },
]

OTHER_CHALLENGES: list[dict[str, Any]] = [
    {
        "department": "RJ-JAIPUR",
        "sector": "Urban solid waste",
        "title": "Raising source segregation compliance in Jaipur ward clusters",
        "problem": "Household waste arrives mixed at the transfer station in most wards of the "
        "greater municipal area, so the material recovery facility cannot recover dry "
        "recyclables at any useful rate. Collection staff report segregation ward by ward but "
        "the reports are not verified and do not match what arrives at the station.",
        "outcome": "Raise verified source segregation compliance in the pilot ward cluster and "
        "raise the share of waste diverted from landfill, measured weekly at the weighbridge.",
        "budget": 2800000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "TN-CBE",
        "sector": "Public health",
        "title": "Cutting time from test to result in district screening camps",
        "problem": "Screening camps in the district collect samples that are sent to the "
        "district laboratory. Patients wait several days for a result and many never return for "
        "it. Staff have no way to see which results are pending or which patients have been lost.",
        "outcome": "Cut the average time from sample collection to result reaching the patient, "
        "and raise the share of referred patients completing follow-up within the protocol window.",
        "budget": 4200000,
        "state": ChallengeState.EVALUATION,
    },
    {
        "department": "MH-WATER",
        "sector": "Water",
        "title": "Reducing pumping energy per megalitre in regional water schemes",
        "problem": "Regional water supply schemes run pumps on fixed schedules regardless of "
        "demand or tank levels. Energy is the largest recurring cost and there is no measurement "
        "of energy per unit of water delivered at scheme level.",
        "outcome": "Cut energy consumed per megalitre delivered across the pilot schemes without "
        "reducing supply hours.",
        "budget": 6500000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "RJ-JAIPUR",
        "sector": "Urban mobility",
        "title": "Cutting peak hour delay at high-volume junctions",
        "problem": "Signal timings at the busiest junctions were set years ago and are not "
        "adjusted for current flows. Delay at peak hours is high and there is no measurement "
        "beyond occasional manual counts.",
        "outcome": "Cut average delay per vehicle at the pilot junctions during the morning and "
        "evening peak, measured from the signal controller and validated by manual counts.",
        "budget": 3500000,
        "state": ChallengeState.APPLICATIONS_CLOSED,
    },
    {
        "department": "TN-CBE",
        "sector": "Public health",
        "title": "Raising anaemia screening coverage among adolescent girls",
        "problem": "Screening coverage in the district is well below the target and the current "
        "method requires a venous sample, which limits how many camps can be run.",
        "outcome": "Raise the share of the eligible adolescent population screened, without "
        "reducing the accuracy of the screening result.",
        "budget": 2200000,
        "state": ChallengeState.DRAFT,
    },
    {
        "department": "MH-PUNE-WATER",
        "sector": "Urban solid waste",
        "title": "Reducing missed collections in the Pune western wards",
        "problem": "Missed collection complaints cluster in a small number of routes but the "
        "department cannot tell whether the cause is vehicle breakdown, staff absence or route "
        "length.",
        "outcome": "Cut missed collection complaints per thousand households per week in the "
        "pilot wards.",
        "budget": 1800000,
        "state": ChallengeState.IN_REVIEW,
    },
    {
        "department": "MH-WATER",
        "sector": "Water",
        "title": "Detecting unauthorised connections on rural trunk mains",
        "problem": "Trunk mains between headworks and village storage lose a significant share "
        "of flow and unauthorised connections are suspected, but there is no measurement between "
        "the two ends.",
        "outcome": "Cut the unmeasured loss between headworks and village storage in the pilot "
        "corridors.",
        "budget": 5200000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "RJ-UD",
        "sector": "Energy",
        "title": "Cutting street lighting energy per pole in Jaipur",
        "problem": "Street lighting runs on fixed timers across the city. Faults are reported by "
        "residents rather than detected, and consumption is billed at a flat assessed rate with "
        "no metering at feeder level.",
        "outcome": "Cut metered energy consumption per pole per week in the pilot feeders while "
        "maintaining illumination levels.",
        "budget": 4800000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "TN-HEALTH",
        "sector": "Public health",
        "title": "Closing the referral loop between primary and secondary care",
        "problem": "Patients referred from primary health centres to district hospitals are not "
        "tracked. Neither facility knows whether the referral was completed.",
        "outcome": "Raise the share of referrals completed within the protocol window across the "
        "pilot facilities.",
        "budget": 3100000,
        "state": ChallengeState.SCREENING,
    },
    {
        "department": "MH-PUNE-WATER",
        "sector": "Water",
        "title": "Improving bulk meter data reliability across zones",
        "problem": "Bulk meter readings are taken manually once a month and transcription errors "
        "are common, so the zonal water balance cannot be trusted.",
        "outcome": "Raise the share of bulk meter readings captured without manual transcription, "
        "and cut the variance between successive monthly balances.",
        "budget": 2600000,
        "state": ChallengeState.DRAFT,
    },
    {
        "department": "RJ-JAIPUR",
        "sector": "Urban solid waste",
        "title": "Tracking construction and demolition waste to authorised sites",
        "problem": "Construction and demolition waste is dumped on vacant land rather than taken "
        "to the authorised processing site. Enforcement is complaint driven.",
        "outcome": "Raise the share of construction and demolition waste reaching the authorised "
        "processing site, measured at the weighbridge.",
        "budget": 3900000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "TN-CBE",
        "sector": "Agriculture",
        "title": "Cutting irrigation water use in the district canal command",
        "problem": "Water applied per hectare varies widely across the canal command and there "
        "is no measurement at the plot level, so advisories cannot be targeted.",
        "outcome": "Cut water applied per hectare in the pilot plots without reducing yield.",
        "budget": 2900000,
        "state": ChallengeState.PUBLISHED,
    },
    {
        "department": "MH-WATER",
        "sector": "Disaster management",
        "title": "Early warning for flash flooding in western ghat catchments",
        "problem": "Flash floods in small catchments give little warning. River gauges report at "
        "intervals too long to be useful and there is no automatic alerting.",
        "outcome": "Increase the median warning time before the flood peak reaches the first "
        "inhabited settlement in the pilot catchments.",
        "budget": 7500000,
        "state": ChallengeState.IN_REVIEW,
    },
    {
        "department": "RJ-UD",
        "sector": "Urban mobility",
        "title": "Reducing waiting time variance on high-frequency bus routes",
        "problem": "Buses on the busiest routes bunch, so waiting time is unpredictable even "
        "though the headway on paper is short.",
        "outcome": "Cut the variance in actual headway on the pilot routes during peak hours.",
        "budget": 3300000,
        "state": ChallengeState.DRAFT,
    },
]


async def build_challenge(
    session,  # type: ignore[no-untyped-def]
    *,
    department: Department,
    officer: AppUser,
    approver: AppUser,
    title: str,
    problem: str,
    outcome: str,
    sector: str,
    budget_rupees: int,
    kpis: list[dict[str, Any]],
    deadline_days: int = 21,
) -> Challenge:
    principal = principal_for(officer)
    challenge = await challenges_service.create_draft(
        session, principal, department_id=department.id, title=title, problem_statement=problem
    )
    now = utcnow()
    challenge.outcome_statement = outcome
    challenge.current_situation = (
        "The department currently relies on manual reporting for this service. The baseline for "
        "each measure will be collected before the pilot starts, using the method recorded "
        "against that measure."
    )
    challenge.constraints = (
        "Data must be hosted in India. No personal identifiers may be shared with the startup; "
        "the department will anonymise or aggregate any data before transfer. The solution must "
        "work with existing field equipment and must not require write access to departmental "
        "systems of record during the pilot."
    )
    challenge.pilot_scope = (
        "A controlled pilot in a defined area for the duration set by the Pilot Flight Simulator, "
        "with weekly measurement of every measure listed. The department will nominate the pilot "
        "units and provide read access to the data sources named in the measurement methods."
    )
    challenge.commercial_terms = (
        "Payment against four milestones, at least one payable before pilot completion. The "
        "startup retains ownership of its product and grants the department a perpetual licence "
        "to use it for its own functions."
    )
    challenge.sector = sector
    challenge.state_code = department.state_code
    challenge.district = department.district
    challenge.budget_ceiling_paise = rupees_to_paise(budget_rupees)
    challenge.pilot_duration_weeks = 8
    challenge.application_deadline = now + timedelta(days=deadline_days)
    challenge.clarification_cutoff = now + timedelta(days=max(deadline_days - 7, 1))
    challenge.evaluation_deadline = now + timedelta(days=deadline_days + 14)
    challenge.eligibility_rules = {
        "require_dpiit": True,
        "min_turnover_paise": rupees_to_paise(5000000),
        "min_experience_years": 3,
        "notes": "Open to startups recognised by the Department for Promotion of Industry and "
        "Internal Trade. Prior turnover and prior experience criteria are relaxed for recognised "
        "startups; quality and technical criteria are not relaxed.",
    }

    for position, item in enumerate(kpis):
        session.add(Kpi(challenge_id=challenge.id, position=position, **item))

    from app.services.llm import DEFAULT_RUBRIC

    for position, criterion in enumerate(DEFAULT_RUBRIC):
        session.add(
            RubricCriterion(
                challenge_id=challenge.id,
                position=position,
                name=criterion["name"],
                description=criterion["description"],
                weight=criterion["weight"],
                anchors=criterion["anchors"],
                round_number=1,
            )
        )
    await session.flush()
    await session.refresh(challenge)
    return challenge


async def advance_to_state(
    session,  # type: ignore[no-untyped-def]
    challenge: Challenge,
    officer: AppUser,
    approver: AppUser,
    target: str,
) -> None:
    """Drive a challenge through real transitions until it reaches the target state."""
    officer_principal = principal_for(officer)
    approver_principal = principal_for(approver)

    # Each step names the state it starts from, so a challenge already part way along
    # the path picks up where it is rather than replaying steps it has passed.
    path = [
        (ChallengeState.DRAFT, "submit", officer_principal, Role.DEPARTMENT_OFFICER),
        (ChallengeState.IN_REVIEW, "approve", approver_principal, Role.DEPARTMENT_APPROVER),
        (ChallengeState.PUBLISHED, "close-applications", officer_principal, Role.DEPARTMENT_OFFICER),
        (ChallengeState.APPLICATIONS_CLOSED, "screen", officer_principal, Role.DEPARTMENT_OFFICER),
        (ChallengeState.SCREENING, "start-evaluation", officer_principal, Role.DEPARTMENT_OFFICER),
    ]
    for _ in range(len(path)):
        if challenge.state == target:
            return
        step = next((s for s in path if s[0] == challenge.state), None)
        if step is None:
            return
        _source, action, principal, role = step
        if action == "close-applications":
            challenge.application_deadline = utcnow() - timedelta(minutes=1)
            await applications_service.lock_for_challenge(session, challenge)
        if action == "screen":
            await applications_service.screen_challenge(session, challenge, principal)
        await challenges_service.transition(
            session, challenge, principal, action, actor_role=role
        )


async def seed_applications(
    session,  # type: ignore[no-untyped-def]
    challenge: Challenge,
    startups: list[Startup],
    startup_users: dict[str, AppUser],
    count: int,
) -> list[Application]:
    """Create submitted applications from startups whose sector matches the challenge."""
    candidates = [
        s for s in startups
        if challenge.sector in {str(x) for x in (s.sectors or [])} and s.id in startup_users
    ]
    if len(candidates) < count:
        candidates += [s for s in startups if s.id in startup_users and s not in candidates]
    chosen = candidates[:count]

    created: list[Application] = []
    for index, startup in enumerate(chosen):
        user = startup_users[startup.id]
        principal = principal_for(user)
        application = await applications_service.start_application(
            session, challenge, startup, principal
        )
        primary = challenge.primary_kpi
        commitments = []
        for kpi in challenge.kpis:
            if kpi.target_value is None or kpi.baseline_value is None:
                continue
            base = float(kpi.baseline_value)
            target = float(kpi.target_value)
            # Bids vary around the published target so evaluation has something to rank.
            factor = 0.85 + 0.30 * ((index * 37) % 100) / 100.0
            committed = base + (target - base) * factor
            commitments.append(
                {
                    "kpi_id": kpi.id,
                    "committed_value": round(committed, 2),
                    "note": "Committed value at the end of the pilot period.",
                }
            )
        application.proposal_summary = (
            startup.legal_name + " proposes to deploy its "
            + startup.product_description.rstrip(".").lower()
            + " across the pilot units named in this challenge, operate it for the pilot period "
            "and hand over a full data export at the end. The approach targets "
            + (primary.name.lower() if primary else "the primary measure")
            + " directly."
        )
        application.approach = (
            "Week 1 to 2: site survey, installation planning and access provisioning. Week 3: "
            "deployment on all pilot units and confirmation of the measurement pipeline against "
            "the department's own records. Week 4 onwards: weekly measurement submitted through "
            "the platform, with a named engineer on call and a fortnightly review with the "
            "department. Every measure is recorded by the method stated in the challenge, and the "
            "raw records are retained for the independent validator."
        )
        application.kpi_commitments = commitments
        application.pilot_cost_paise = int(
            challenge.budget_ceiling_paise * (0.55 + 0.35 * ((index * 53) % 100) / 100.0)
        )
        application.timeline_weeks = 8 + index % 5
        application.data_declaration = (
            "Access required: bulk meter readings and the billing extract for the pilot zone, "
            "aggregated to zone level with no customer identifiers. Stored in India on a managed "
            "cloud service, encrypted at rest and in transit, retained for 12 months and deleted "
            "within 30 days of pilot closure with written certification."
        )
        application.ip_declaration = "startup_retains"
        application.conflict_declaration = True
        await session.flush()

        await applications_service.submit(session, application, challenge, principal)
        created.append(application)
    return created


async def score_applications(
    session,  # type: ignore[no-untyped-def]
    challenge: Challenge,
    evaluators: list[AppUser],
    applications: list[Application],
) -> None:
    """Three evaluators score every eligible application, with one deliberate variance flag."""
    criteria = [c for c in challenge.criteria if c.round_number == 1]
    for evaluator_index, evaluator in enumerate(evaluators):
        principal = principal_for(evaluator)
        for application_index, application in enumerate(applications):
            await evaluation_service.declare_conflict(
                session,
                application,
                principal,
                has_conflict=False,
                statement="",
            )
            scores = []
            for criterion_index, criterion in enumerate(criteria):
                base = 3 + ((application_index * 7 + criterion_index * 3) % 3)
                shift = (evaluator_index - 1) * (1 if criterion_index == 1 else 0)
                # One criterion on the first application gets a deliberate spread of 2 points,
                # so the variance flag is visible in the demonstration.
                if application_index == 0 and criterion_index == 1:
                    shift = {0: -1, 1: 0, 2: 1}[evaluator_index % 3]
                value = max(1, min(5, base + shift))
                scores.append(
                    {
                        "criterion_id": criterion.id,
                        "score": value,
                        "justification": (
                            "Scored " + str(value) + " against the anchor for this criterion. "
                            "The proposal is specific on deployment and measurement but the "
                            "support model is described only in outline."
                        ),
                    }
                )
            await evaluation_service.submit_scores(
                session, application, challenge, principal, scores=scores, round_number=1
            )


async def seed_flagship(
    session,  # type: ignore[no-untyped-def]
    departments: dict[str, Department],
    users: dict[str, AppUser],
    startups: list[Startup],
    startup_users: dict[str, AppUser],
) -> dict[str, Any]:
    """The complete lifecycle: define, discover, screen, evaluate, simulate, pilot, validate, scale."""
    department = departments["MH-PUNE-WATER"]
    officer = users["anita.deshmukh@pmc.gov.in"]
    approver = users["ramesh.kulkarni@pmc.gov.in"]
    finance = users["sunita.pawar@pmc.gov.in"]
    officer_principal = principal_for(officer)
    approver_principal = principal_for(approver)

    challenge = await build_challenge(
        session,
        department=department,
        officer=officer,
        approver=approver,
        title="Reducing water loss in the Pune eastern zone",
        problem=(
            "In the 14 wards of the eastern zone, treated water is lost between the service "
            "reservoir and household connections. Leaks are found only when residents complain, "
            "usually several days after they start, and the ward plumber locates them by digging "
            "along the suspected line. Bulk meters are read manually once a month, so the zonal "
            "water balance is available weeks after the period it describes and cannot be used "
            "to direct crews. Supply in the affected wards is 4 to 5 hours a day against a "
            "planned 6."
        ),
        outcome=(
            "Reduce non-revenue water in the eastern zone from the measured baseline of 32 "
            "percent to 24 percent within the pilot period, and cut the average time from leak "
            "occurrence to repair, measured weekly from the district metering area water balance "
            "and the works management register."
        ),
        sector="Water",
        budget_rupees=4500000,
        kpis=FLAGSHIP_KPIS,
        deadline_days=14,
    )
    challenge.ai_draft_meta = {
        "provider": "mock",
        "model": settings.llm_model,
        "prompt_version": "challenge-draft-v1.3",
        "prompt_tokens": 138,
        "completion_tokens": 512,
        "latency_ms": 42,
        "generated_at": utcnow().isoformat(),
        "warnings": [],
        "numbers_removed": [],
    }
    await session.flush()

    # Define: submit and approve.
    await challenges_service.transition(
        session, challenge, officer_principal, "submit", actor_role=Role.DEPARTMENT_OFFICER
    )
    await challenges_service.transition(
        session, challenge, approver_principal, "approve", actor_role=Role.DEPARTMENT_APPROVER
    )

    # Discover: embeddings, matching, and a published clarification.
    text_corpus = challenges_service.challenge_text(challenge)
    await startups_service.refresh_challenge_embedding(session, challenge, text_corpus)
    await startups_service.compute_matches(session, challenge, text_corpus, limit=25)

    applications = await seed_applications(session, challenge, startups, startup_users, count=6)

    asker = startup_users[applications[0].startup_id]
    clarification = Clarification(
        challenge_id=challenge.id,
        asked_by=asker.id,
        question="Will the department provide the billing extract at zone level, or must the "
        "startup derive consumption from meter readings?",
    )
    session.add(clarification)
    await session.flush()
    await challenges_service.answer_clarification(
        session,
        challenge,
        officer_principal,
        clarification.id,
        "The department will provide the billing extract aggregated to zone level, with no "
        "customer identifiers, refreshed weekly for the pilot period.",
    )

    # Screen.
    challenge.application_deadline = utcnow() - timedelta(minutes=1)
    await applications_service.lock_for_challenge(session, challenge)
    await challenges_service.transition(
        session, challenge, officer_principal, "close-applications",
        actor_role=Role.DEPARTMENT_OFFICER,
    )
    await applications_service.screen_challenge(session, challenge, officer_principal)
    await challenges_service.transition(
        session, challenge, officer_principal, "screen", actor_role=Role.DEPARTMENT_OFFICER
    )

    # Evaluate.
    evaluators = [users[email] for _name, email, _d in EVALUATORS[:3]]
    validators = [users[email] for _name, email, _d in VALIDATORS[:1]]
    await evaluation_service.assign_panel(
        session,
        challenge,
        officer_principal,
        evaluator_ids=[e.id for e in evaluators],
        validator_ids=[v.id for v in validators],
    )
    await challenges_service.transition(
        session, challenge, officer_principal, "start-evaluation",
        actor_role=Role.DEPARTMENT_OFFICER,
    )

    eligible = await applications_service.eligible_applications(session, challenge.id)
    for evaluator in evaluators:
        await session.refresh(evaluator)
    await score_applications(session, challenge, evaluators, eligible)

    await evaluation_service.lock_scores(session, challenge, officer_principal)
    await challenges_service.transition(
        session, challenge, officer_principal, "lock-scores", actor_role=Role.DEPARTMENT_OFFICER
    )

    ranking = await evaluation_service.ranking(session, challenge)
    winner_id = ranking[0]["application_id"]
    winner = next(a for a in eligible if a.id == winner_id)

    await evaluation_service.confirm_shortlist(
        session, challenge, approver_principal, application_ids=[winner_id]
    )
    await challenges_service.transition(
        session, challenge, approver_principal, "confirm-shortlist",
        actor_role=Role.DEPARTMENT_APPROVER,
    )

    # Simulate and freeze the design.
    pilot = await pilots_service.create_for_application(
        session, winner, challenge, officer_principal
    )
    primary = challenge.primary_kpi
    assert primary is not None

    baseline_start = utcnow() - timedelta(weeks=14)
    units = [f"DMA-{i:02d}" for i in range(1, 25)]
    await write_metrics(
        session,
        pilot=pilot,
        kpi=primary,
        units=units,
        weeks=6,
        start=baseline_start,
        phase="baseline",
        mean=32.0,
        unit_sd=5.7,
        noise_sd=5.7,
        submitter=startup_users[winner.startup_id],
    )

    from app.services import simulation as simulation_service

    inputs, _kpi, _challenge, ceiling = await simulation_service.prepare_inputs(
        session,
        pilot,
        overrides={"duration_weeks": 8, "units": 24, "measurements_per_week": 1},
    )
    run, _job = await simulation_service.queue_run(
        session, pilot, officer_principal, inputs=inputs, what_if=[(4, 24), (12, 24)],
        budget_ceiling_paise=ceiling,
    )
    await simulation_service.execute_run(session, run.id)
    await session.refresh(run)
    results = run.results or {}
    proposed = results.get("proposed", {})

    design = await pilots_service.freeze_design(
        session,
        pilot,
        officer_principal,
        simulation_run_id=run.id,
        primary_kpi_id=primary.id,
        duration_weeks=8,
        units=24,
        measurements_per_week=1,
        pass_mark=26.0,
        analysis_method="paired_t",
        alpha=0.05,
        baseline_mean=inputs.baseline_mean,
        baseline_sd=inputs.baseline_sd,
        claimed_effect=inputs.claimed_effect,
        expected_power=proposed.get("power"),
        expected_cost_paise=proposed.get("expected_cost_paise"),
        minimum_detectable_effect=proposed.get("minimum_detectable_effect"),
    )

    # Agreement, cybersecurity checklist, activation.
    pilot_start = utcnow() - timedelta(weeks=9)
    milestones = pilots_service.default_milestones(
        winner.pilot_cost_paise, pilot_start, 8, count=4
    )
    await pilots_service.draft_agreement(
        session,
        pilot,
        officer_principal,
        ip_option="startup_retains",
        data_terms={
            "datasets": "Bulk meter readings and the zone-level billing extract for the eastern "
            "zone, with no customer identifiers.",
            "identifiers_removed": "Names, connection numbers, addresses and phone numbers are "
            "removed by the department before transfer.",
            "storage_location": "India",
            "processing_purpose": "Water balance computation and leak localisation for this pilot "
            "only.",
            "retention_months": 12,
            "deletion_obligation": "All departmental data deleted within 30 days of pilot closure "
            "with written certification of deletion.",
            "access_log": "All access to departmental data is logged and the log is available to "
            "the department and the independent validator on request.",
            "export_format": "CSV with a documented schema, plus raw records in open JSON.",
        },
        milestones=milestones,
    )

    startup_user = startup_users[winner.startup_id]
    startup_principal = principal_for(startup_user)

    await pilots_service.transition(
        session, pilot, approver_principal, "approve-agreement",
        actor_role=Role.DEPARTMENT_APPROVER,
    )
    await pilots_service.complete_cyber_checklist(
        session,
        pilot,
        startup_principal,
        {
            "hosting_in_india": True,
            "encryption_at_rest": True,
            "encryption_in_transit": True,
            "access_control": True,
            "access_logging": True,
            "mfa_admin": True,
            "backup_restore": True,
            "vulnerability_contact": True,
            "patching": True,
            "incident_response": True,
            "pen_test": True,
            "data_export": True,
        },
    )
    await pilots_service.transition(
        session, pilot, startup_principal, "accept-agreement", actor_role=Role.STARTUP_USER
    )
    pilot.started_at = pilot_start
    await session.flush()

    # Pilot data: the solution delivers 6.5 of the 8 points promised.
    await write_metrics(
        session,
        pilot=pilot,
        kpi=primary,
        units=units,
        weeks=8,
        start=pilot_start,
        phase="pilot",
        mean=32.0 - 6.5,
        unit_sd=5.7,
        noise_sd=4.9,
        submitter=startup_user,
        drop_fraction=0.03,
    )
    for secondary in challenge.kpis:
        if secondary.id == primary.id:
            continue
        base = float(secondary.baseline_value or 0)
        target = float(secondary.target_value or base)
        delivered = base + (target - base) * 0.72
        sd = float(secondary.baseline_sd or max(abs(base) * 0.2, 0.5))
        await write_metrics(
            session, pilot=pilot, kpi=secondary, units=units[:12], weeks=6,
            start=baseline_start, phase="baseline", mean=base, unit_sd=sd * 0.7,
            noise_sd=sd * 0.7, submitter=startup_user,
        )
        await write_metrics(
            session, pilot=pilot, kpi=secondary, units=units[:12], weeks=8,
            start=pilot_start, phase="pilot", mean=delivered, unit_sd=sd * 0.7,
            noise_sd=sd * 0.6, submitter=startup_user,
        )

    # Milestones through the full payment path, with one rejection and resubmission.
    milestone_rows = await payments_service.for_pilot(session, pilot.id)
    for index, milestone in enumerate(milestone_rows):
        await payments_service.transition(
            session, milestone, startup_principal, "submit", actor_role=Role.STARTUP_USER,
            payload={
                "note": "Evidence for milestone " + str(milestone.seq) + " attached: "
                + milestone.evidence_required.split(".")[0] + ".",
                "file_ids": [],
            },
        )
        if index == 1:
            await payments_service.transition(
                session, milestone, officer_principal, "reject",
                actor_role=Role.DEPARTMENT_OFFICER,
                reason="The deployment completion note does not cover four of the twenty-four "
                "district metering areas.",
                payload={"unmet_requirement": "Deployment completion note covering every pilot unit"},
            )
            await payments_service.transition(
                session, milestone, startup_principal, "submit", actor_role=Role.STARTUP_USER,
                payload={
                    "note": "Revised deployment completion note covering all 24 district metering "
                    "areas, with installation photographs and commissioning records.",
                    "file_ids": [],
                },
            )
        await payments_service.transition(
            session, milestone, officer_principal, "accept", actor_role=Role.DEPARTMENT_OFFICER
        )
        if index < 3:
            await payments_service.transition(
                session, milestone, approver_principal, "approve-payment",
                actor_role=Role.DEPARTMENT_APPROVER,
            )
        if index < 2:
            await payments_service.transition(
                session, milestone, principal_for(finance), "record-release",
                actor_role=Role.FINANCE_OFFICER,
                payload={
                    "reference_no": "PMC/WS/2026/" + str(4100 + index),
                    "amount_paise": milestone.amount_paise,
                    "mode": "Bank transfer",
                },
            )

    # Spread the milestone history across the pilot period. The transitions above all ran
    # within the same second, which is an artefact of seeding, not of how a pilot behaves.
    # Rewriting the recorded history gives the demonstration realistic elapsed times; the
    # audit log still carries the true seeding timestamps.
    await backdate_milestones(session, milestone_rows, pilot_start)

    # The third milestone is left with the finance office and its clock is pushed past the
    # service level, so the demonstration has a real breach to escalate.
    third = milestone_rows[2]
    third.state_entered_at = utcnow() - timedelta(days=9)
    third.sla_due_at = utcnow() - timedelta(days=2)
    third.state_history = list(third.state_history or [])
    if third.state_history:
        third.state_history[-1] = {
            **third.state_history[-1],
            "at": third.state_entered_at.isoformat(),
            "sla_due_at": third.sla_due_at.isoformat(),
        }
    await session.flush()

    # Complete the pilot and run the Evidence Engine.
    await pilots_service.transition(
        session, pilot, officer_principal, "complete", actor_role=Role.DEPARTMENT_OFFICER
    )
    report = await evidence_service.run_analysis(session, pilot, officer_principal)

    validator = validators[0]
    await session.refresh(validator)
    validator_principal = principal_for(validator)
    await evidence_service.sign_off(
        session,
        report,
        pilot,
        validator_principal,
        decision="sign_off",
        remarks=(
            "Data provenance traced to the district metering area water balance and the billing "
            "extract for six sampled weeks. Twelve sampled unit-periods reconciled against the "
            "source records without discrepancy. The analysis was re-run on the locked dataset "
            "with the recorded seed and reproduced the reported effect and interval exactly. No "
            "amendments or deviations from the pre-registered plan were recorded. The validator "
            "has no interest in the startup or in the outcome of this pilot."
        ),
        checklist={
            "data_provenance": True,
            "sample_checks": True,
            "calculation_rerun": True,
            "deviations_reviewed": True,
            "independence_confirmed": True,
        },
    )
    await session.refresh(report)

    passport = await scale_service.issue_passport(session, pilot, report)

    decision = await scale_service.record_decision(
        session,
        pilot,
        approver_principal,
        decision="Scale",
        reason=(
            "The validated reduction in non-revenue water is 6.5 percentage points against a "
            "pre-registered target of 8, with a 95 percent confidence interval entirely on the "
            "beneficial side of no change and an Evidence Confidence Score in the strong band. "
            "The solution is to be extended to the remaining zones under the recommended "
            "procurement route, subject to the conditions recorded with that route."
        ),
        estimated_value_paise=rupees_to_paise(28000000),
        pathway=await scale_service.pathway_for(
            session, pilot, estimated_value_paise=rupees_to_paise(28000000)
        ),
        scale_projection=await scale_service.simulate_scale(
            session,
            pilot,
            units=96,
            cost_per_unit_paise=rupees_to_paise(185000),
            value_per_effect_unit_paise=rupees_to_paise(42000),
        ),
        vendor_dependency=await scale_service.dependency_for(session, pilot),
    )

    # Reuse: another district raises an adoption request from the passport.
    assert passport is not None, "the flagship pilot must have issued a passport by now"
    jaipur_officer = users["praveen.sharma@jmcg.gov.in"]
    await scale_service.raise_adoption_request(
        session,
        passport,
        principal_for(jaipur_officer),
        department_id=departments["RJ-JAIPUR"].id,
        intent="new_challenge",
        note=(
            "Jaipur has a comparable water loss problem in two zones. Requesting reuse of this "
            "validated evidence to shorten the route to a local pilot."
        ),
        adopting_context={
            "scale_units": 40,
            "population": 850000,
            "environment": "Semi-arid, intermittent supply, predominantly cast iron mains",
            "state_code": "RJ",
            "sector": "Water",
        },
    )

    return {
        "challenge": challenge,
        "pilot": pilot,
        "report": report,
        "passport": passport,
        "decision": decision,
        "simulation": run,
        "design": design,
        "winner": winner,
    }


async def backdate_milestones(
    session,  # type: ignore[no-untyped-def]
    milestones: list[Milestone],
    pilot_start: Any,
) -> None:
    """Give the seeded milestones a believable elapsed history.

    Every transition in the seed runs in the same second, so without this the platform
    would report a submission-to-payment time of zero days. The state history is rewritten
    to span the pilot, using durations inside the agreed service levels.
    """
    gaps: dict[str, int] = {
        MilestoneState.PENDING: 0,
        MilestoneState.SUBMITTED: 0,
        MilestoneState.REJECTED: 2,
        MilestoneState.ACCEPTED: 3,
        MilestoneState.PAYMENT_APPROVED: 2,
        MilestoneState.PAID: 4,
    }
    for index, milestone in enumerate(milestones):
        cursor = pilot_start + timedelta(weeks=2 * index)
        history: list[dict[str, Any]] = []
        for entry in milestone.state_history or []:
            state = str(entry.get("state"))
            cursor = cursor + timedelta(days=gaps.get(state, 2))
            history.append(
                {
                    "state": state,
                    "at": cursor.isoformat(),
                    "sla_due_at": entry.get("sla_due_at"),
                }
            )
        if history:
            milestone.state_history = history
            milestone.state_entered_at = utcnow() if milestone.state != MilestoneState.PAID else cursor
            if milestone.state == MilestoneState.PAID:
                milestone.paid_at = cursor
    await session.flush()


async def write_metrics(
    session,  # type: ignore[no-untyped-def]
    *,
    pilot: Pilot,
    kpi: Kpi,
    units: list[str],
    weeks: int,
    start: Any,
    phase: str,
    mean: float,
    unit_sd: float,
    noise_sd: float,
    submitter: AppUser,
    drop_fraction: float = 0.0,
) -> int:
    """Generate measurement rows with unit heterogeneity and period noise.

    The unit level is drawn from a stream keyed on the measure alone, so each unit keeps
    the same underlying level across the baseline and pilot phases. That is what makes a
    paired comparison meaningful: the unit-to-unit variation cancels and what remains is
    the change.
    """
    import hashlib

    def stream(tag: str) -> int:
        # Keyed on the measure name, not its generated id, so a reseed reproduces
        # exactly the same numbers.
        digest = hashlib.sha256((kpi.name + "|" + tag).encode()).digest()
        return SEED + int.from_bytes(digest[:4], "big") % 1_000_000

    unit_stream = np.random.default_rng(stream("unit-levels"))
    local = np.random.default_rng(stream("noise-" + phase))
    unit_levels = unit_stream.normal(0.0, unit_sd, size=len(units))
    written = 0
    for unit_index, unit_ref in enumerate(units):
        for week in range(weeks):
            if drop_fraction and local.random() < drop_fraction:
                continue
            period_start = start + timedelta(weeks=week)
            value = float(mean + unit_levels[unit_index] + local.normal(0.0, noise_sd))
            if kpi.kind == "proportion":
                value = max(0.0, min(100.0, value))
            session.add(
                MetricSubmission(
                    pilot_id=pilot.id,
                    kpi_id=kpi.id,
                    unit_ref=unit_ref,
                    period_start=period_start,
                    period_end=period_start + timedelta(days=7),
                    phase=phase,
                    arm="treatment",
                    value=round(value, 3),
                    source="csv" if unit_index % 2 else "api",
                    status="Accepted",
                    submitted_by=submitter.id,
                )
            )
            written += 1
    await session.flush()
    return written


async def seed_other_challenges(
    session,  # type: ignore[no-untyped-def]
    departments: dict[str, Department],
    users: dict[str, AppUser],
    startups: list[Startup],
    startup_users: dict[str, AppUser],
) -> list[Challenge]:
    officer_by_department = {
        "MH-PUNE-WATER": ("anita.deshmukh@pmc.gov.in", "ramesh.kulkarni@pmc.gov.in"),
        "MH-WATER": ("vikram.joshi@mahawater.gov.in", "meera.sathe@mahawater.gov.in"),
        "RJ-JAIPUR": ("praveen.sharma@jmcg.gov.in", "kavita.meena@jmcg.gov.in"),
        "RJ-UD": ("praveen.sharma@jmcg.gov.in", "kavita.meena@jmcg.gov.in"),
        "TN-CBE": ("lakshmi.n@tnhealth.gov.in", "arun.prakash@tnhealth.gov.in"),
        "TN-HEALTH": ("lakshmi.n@tnhealth.gov.in", "arun.prakash@tnhealth.gov.in"),
    }

    generic_kpis = [
        {
            "name": "Primary service measure",
            "unit": "percent",
            "kind": "proportion",
            "direction": "lower",
            "baseline_value": 40.0,
            "baseline_sd": 9.0,
            "baseline_source": "Departmental service register",
            "baseline_method": "Computed weekly from the departmental service register using the "
            "method agreed with the pilot units.",
            "target_value": 30.0,
            "is_primary": True,
        },
        {
            "name": "Service turnaround time",
            "unit": "hours",
            "kind": "continuous",
            "direction": "lower",
            "baseline_value": 72.0,
            "baseline_sd": 24.0,
            "baseline_source": "Departmental service register",
            "baseline_method": "Time from request received to service delivered, averaged weekly.",
            "target_value": 48.0,
            "is_primary": False,
        },
    ]

    created: list[Challenge] = []
    for entry in OTHER_CHALLENGES:
        officer_email, approver_email = officer_by_department[entry["department"]]
        officer, approver = users[officer_email], users[approver_email]
        higher = entry["sector"] in ("Urban solid waste", "Public health", "Agriculture")
        kpis = [dict(k) for k in generic_kpis]
        if higher:
            kpis[0].update(
                {
                    "name": "Primary service measure",
                    "direction": "higher",
                    "baseline_value": 45.0,
                    "target_value": 65.0,
                }
            )
        challenge = await build_challenge(
            session,
            department=departments[entry["department"]],
            officer=officer,
            approver=approver,
            title=entry["title"],
            problem=entry["problem"],
            outcome=entry["outcome"],
            sector=entry["sector"],
            budget_rupees=entry["budget"],
            kpis=kpis,
            deadline_days=rng.choice([10, 18, 25, 32]),
        )
        target = entry["state"]
        if target != ChallengeState.DRAFT:
            await advance_to_state(session, challenge, officer, approver, ChallengeState.IN_REVIEW)
        if target not in (ChallengeState.DRAFT, ChallengeState.IN_REVIEW):
            await advance_to_state(session, challenge, officer, approver, ChallengeState.PUBLISHED)
            corpus = challenges_service.challenge_text(challenge)
            await startups_service.refresh_challenge_embedding(session, challenge, corpus)
            await startups_service.compute_matches(session, challenge, corpus, limit=15)
            await seed_applications(session, challenge, startups, startup_users, count=4)
        if target in (
            ChallengeState.APPLICATIONS_CLOSED,
            ChallengeState.SCREENING,
            ChallengeState.EVALUATION,
        ):
            await advance_to_state(
                session, challenge, officer, approver, ChallengeState.APPLICATIONS_CLOSED
            )
        if target in (ChallengeState.SCREENING, ChallengeState.EVALUATION):
            await advance_to_state(session, challenge, officer, approver, ChallengeState.SCREENING)
        if target == ChallengeState.EVALUATION:
            evaluators = [users[email] for _n, email, _d in EVALUATORS[1:4]]
            validators = [users[email] for _n, email, _d in VALIDATORS[1:2]]
            await evaluation_service.assign_panel(
                session,
                challenge,
                principal_for(officer),
                evaluator_ids=[e.id for e in evaluators],
                validator_ids=[v.id for v in validators],
            )
            await advance_to_state(session, challenge, officer, approver, ChallengeState.EVALUATION)
        created.append(challenge)
    return created


async def main(reset: bool = False, quiet: bool = False) -> dict[str, Any]:
    def say(message: str) -> None:
        if not quiet:
            print(message)

    if reset:
        say("Dropping and recreating every table.")
        await reset_database()
    else:
        await ensure_schema()

    async with session_scope() as session:
        installed = await templates_service.install_template_kit(session)
        say("Template Kit: " + str(installed) + " template version(s) installed.")

        departments = await seed_departments(session)
        say("Departments: " + str(len(departments)))

        users = await seed_users(session, departments)
        say("Government, evaluator and validator accounts: " + str(len(users)))

        startups = await seed_startups(session, count=200)
        say("Startups: " + str(len(startups)))

        startup_users = await seed_startup_users(session, startups)
        say("Startup user accounts: " + str(len(startup_users)))

    async with session_scope() as session:
        departments = {d.code: d for d in (await session.execute(select(Department))).scalars().all()}
        users = {u.email: u for u in (await session.execute(select(AppUser))).scalars().all()}
        startups = list((await session.execute(select(Startup))).scalars().all())
        startup_users = {}
        for user in users.values():
            if user.startup_id:
                startup_users[user.startup_id] = user

        existing = await session.execute(
            select(Challenge).where(Challenge.title.like("Reducing water loss%"))
        )
        if existing.scalar_one_or_none() is not None:
            say("The flagship challenge already exists; skipping the lifecycle seed.")
            return {"skipped": True}

        say("Building the complete lifecycle for the flagship challenge.")
        flagship = await seed_flagship(session, departments, users, startups, startup_users)

        say("Building the remaining challenges across every lifecycle stage.")
        others = await seed_other_challenges(session, departments, users, startups, startup_users)

        report = flagship["report"]
        analysis = report.analysis or {}
        say("")
        say("Flagship result")
        say("  Challenge:            " + flagship["challenge"].title)
        say("  Pilot reference:      " + flagship["pilot"].reference)
        say("  Simulated power:      " + str((flagship["simulation"].results or {}).get("proposed", {}).get("power")))
        say("  Measured effect:      " + str(analysis.get("effect")) + " percentage points")
        say("  95 percent interval:  " + str(analysis.get("ci_low")) + " to " + str(analysis.get("ci_high")))
        say("  p-value:              " + str(analysis.get("p_value")))
        say("  Confidence score:     " + str(report.confidence_score) + " (" + str(report.band) + ")")
        say("  Passport:             " + flagship["passport"].reference)
        say("  Decision:             " + flagship["decision"].decision)
        say("  Other challenges:     " + str(len(others)))

    async with session_scope() as session:
        from app.services import audit as audit_service

        verification = await audit_service.verify(session)
        say("")
        say("Audit chain: " + verification.detail)

    say("")
    say("Sign in with any of these accounts. Password for every seeded account: " + DEMO_PASSWORD)
    say("  Department Officer:     anita.deshmukh@pmc.gov.in")
    say("  Department Approver:    ramesh.kulkarni@pmc.gov.in")
    say("  Finance Officer:        sunita.pawar@pmc.gov.in")
    say("  Expert Evaluator:       sanjay.rane@iitb.ac.in")
    say("  Independent Validator:  anjali.rao@nabl.gov.in")
    say("  Platform Admin:         admin@pramaansetu.gov.in")
    say("  Startup users:          listed in the admin console under Users")
    return {"ok": True}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed PramaanSetu with deterministic demo data")
    parser.add_argument("--reset", action="store_true", help="Drop every table before seeding")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress output")
    args = parser.parse_args()
    asyncio.run(main(reset=args.reset, quiet=args.quiet))

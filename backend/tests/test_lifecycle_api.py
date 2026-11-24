"""End-to-end lifecycle through the HTTP API (PRD 4.2, 6.3, 14.1).

One challenge is carried from a plain-language problem to a validated scale decision and
a reusable Innovation Passport, through the same endpoints the web app calls, with every
role acting in turn.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from factories import make_department, make_startup, make_user, sign_in
from httpx import AsyncClient

from app.core.clock import utcnow
from app.core.db import session_scope
from app.workers.runner import drain

PROBLEM = (
    "In the 14 wards of the eastern zone, treated water is lost between the service reservoir "
    "and household connections. Leaks are found only when residents complain, usually several "
    "days after they start. Bulk meters are read manually once a month, so the zonal water "
    "balance is available weeks after the period it describes."
)


@pytest.fixture
async def world(session) -> dict[str, Any]:
    """Two departments, a panel, a validator and three startups."""
    department = await make_department(session, code="E2E-PUNE", name="Pune Water Department")
    other = await make_department(
        session, code="E2E-JAIPUR", name="Jaipur Municipal Corporation",
        state_code="RJ", district="Jaipur",
    )

    officer = await make_user(
        session, email="e2e.officer@test.invalid", name="Anita Deshmukh",
        roles=[("DO", "department", department.id)], department_id=department.id,
    )
    approver = await make_user(
        session, email="e2e.approver@test.invalid", name="Ramesh Kulkarni",
        roles=[("DA", "department", department.id)], department_id=department.id,
    )
    finance = await make_user(
        session, email="e2e.finance@test.invalid", name="Sunita Pawar",
        roles=[("FO", "department", department.id)], department_id=department.id,
    )
    admin = await make_user(
        session, email="e2e.admin@test.invalid", name="Platform Admin",
        roles=[("PA", "global", None)],
    )
    other_officer = await make_user(
        session, email="e2e.other.officer@test.invalid", name="Praveen Sharma",
        roles=[("DO", "department", other.id)], department_id=other.id,
    )
    evaluators = [
        await make_user(
            session, email="e2e.eval" + str(i) + "@test.invalid", name="Evaluator " + str(i)
        )
        for i in range(3)
    ]
    validator = await make_user(
        session, email="e2e.validator@test.invalid", name="Dr Anjali Rao"
    )

    startups = []
    for index in range(3):
        startup = await make_startup(session, index=index + 1)
        user = await make_user(
            session,
            email="e2e.startup" + str(index) + "@test.invalid",
            name="Founder " + str(index),
            roles=[("SU", "startup", startup.id)],
            startup_id=startup.id,
        )
        startups.append({"startup": startup, "user": user})

    await session.commit()
    return {
        "department": department,
        "other_department": other,
        "officer": officer,
        "approver": approver,
        "finance": finance,
        "admin": admin,
        "other_officer": other_officer,
        "evaluators": evaluators,
        "validator": validator,
        "startups": startups,
    }


async def test_full_lifecycle_from_problem_to_passport(client: AsyncClient, world):
    officer = world["officer"]
    approver = world["approver"]
    finance = world["finance"]
    admin = world["admin"]
    department = world["department"]

    # --- 1. Define -------------------------------------------------------
    headers = await sign_in(client, officer.email)
    created = await client.post(
        "/api/v1/challenges",
        json={"department_id": department.id, "title": "", "problem_statement": PROBLEM},
        headers={**headers, "Idempotency-Key": "create-1"},
    )
    assert created.status_code == 201, created.text
    challenge_id = created.json()["id"]

    # A repeat with the same key returns the same record rather than a second draft.
    repeat = await client.post(
        "/api/v1/challenges",
        json={"department_id": department.id, "title": "", "problem_statement": PROBLEM},
        headers={**headers, "Idempotency-Key": "create-1"},
    )
    assert repeat.json()["id"] == challenge_id

    draft = await client.post(
        "/api/v1/challenges/" + challenge_id + "/ai-draft",
        json={"problem_statement": PROBLEM},
        headers=headers,
    )
    assert draft.status_code == 202
    assert "Location" in draft.headers
    await drain()

    job = await client.get(draft.json()["poll"], headers=headers)
    assert job.json()["status"] == "Succeeded"

    detail = await client.get("/api/v1/challenges/" + challenge_id, headers=headers)
    body = detail.json()
    assert body["title"]
    assert len(body["kpis"]) >= 2
    assert sum(c["weight"] for c in body["criteria"]) == 100
    # The drafter must not invent numbers the officer did not supply.
    for kpi in body["kpis"]:
        assert kpi["baseline_value"] is None

    version = body["version"]
    deadline = (utcnow() + timedelta(days=10)).isoformat()
    updated = await client.put(
        "/api/v1/challenges/" + challenge_id,
        json={
            "outcome_statement": (
                "Reduce non-revenue water in the eastern zone from 32 percent to 24 percent "
                "within the pilot period, measured weekly from the district metering area "
                "water balance."
            ),
            "budget_ceiling_rupees": 4500000,
            "application_deadline": deadline,
            "clarification_cutoff": (utcnow() + timedelta(days=6)).isoformat(),
            "evaluation_deadline": (utcnow() + timedelta(days=24)).isoformat(),
            "sector": "Water",
            # Thresholds the relaxation will lift for a recognised startup.
            "eligibility_rules": {
                "require_dpiit": True,
                "min_turnover_paise": 50_00_000 * 100,
                "min_experience_years": 3,
                "notes": "Prior turnover and experience criteria are relaxed for recognised "
                "startups. Quality and technical criteria are not relaxed.",
            },
            "kpis": [
                {
                    "name": "Non-revenue water",
                    "unit": "percent of water supplied",
                    "kind": "proportion",
                    "direction": "lower",
                    "baseline_value": 32.0,
                    "baseline_sd": 8.0,
                    "baseline_source": "Monthly district metering area water balance",
                    "baseline_method": "Water supplied minus billed consumption, computed weekly.",
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
                    "baseline_method": "Time from detection to repair completion, weekly average.",
                    "target_value": 36.0,
                    "is_primary": False,
                },
            ],
        },
        headers={**headers, "If-Match": '"' + str(version) + '"'},
    )
    assert updated.status_code == 200, updated.text

    # A stale version is refused with the current record.
    stale = await client.put(
        "/api/v1/challenges/" + challenge_id,
        json={"title": "Something else"},
        headers={**headers, "If-Match": '"' + str(version) + '"'},
    )
    assert stale.status_code == 409
    assert stale.json()["current_version"] > version

    checklist = await client.get("/api/v1/challenges/" + challenge_id + "/checklist", headers=headers)
    assert checklist.json()["ready_to_submit"], checklist.json()["blocking_problems"]

    submitted = await client.post(
        "/api/v1/challenges/" + challenge_id + "/submit", json={}, headers=headers
    )
    assert submitted.status_code == 200
    assert submitted.json()["state"] == "InReview"

    # --- 2. Approve ------------------------------------------------------
    headers = await sign_in(client, approver.email)
    inbox = await client.get("/api/v1/me/tasks", headers=headers)
    kinds = {t["kind"] for t in inbox.json()["items"]}
    assert "approve_challenge" in kinds

    summary = await client.get("/api/v1/challenges/" + challenge_id + "/summary.pdf", headers=headers)
    assert summary.status_code == 200
    assert summary.headers["content-type"] == "application/pdf"
    assert summary.content.startswith(b"%PDF")

    approved = await client.post(
        "/api/v1/challenges/" + challenge_id + "/approve", json={}, headers=headers
    )
    assert approved.status_code == 200
    assert approved.json()["state"] == "Published"
    await drain()

    # --- 3. Discover -----------------------------------------------------
    board = await client.get("/api/v1/public/challenges")
    references = {item["reference"] for item in board.json()["items"]}
    assert approved.json()["reference"] in references

    demand = await client.get("/api/v1/public/demand/summary")
    assert any(row["sector"] == "Water" for row in demand.json()["open_by_sector"])

    headers = await sign_in(client, officer.email)
    matches = await client.get("/api/v1/challenges/" + challenge_id + "/matches", headers=headers)
    assert matches.json()["items"], "matching produced no candidates"
    assert all(item["reasons"] for item in matches.json()["items"])
    assert len(matches.json()["weights"]) == 4

    # --- 4. Apply --------------------------------------------------------
    application_ids: list[str] = []
    for index, entry in enumerate(world["startups"]):
        headers = await sign_in(client, entry["user"].email)
        form = await client.get(
            "/api/v1/challenges/" + challenge_id + "/application-form", headers=headers
        )
        assert form.status_code == 200
        kpis = next(f for f in form.json()["fields"] if f["key"] == "kpi_commitments")["kpis"]

        started = await client.post(
            "/api/v1/challenges/" + challenge_id + "/applications",
            headers={**headers, "Idempotency-Key": "apply-" + str(index)},
        )
        assert started.status_code == 201, started.text
        application_id = started.json()["id"]
        application_ids.append(application_id)

        saved = await client.put(
            "/api/v1/applications/" + application_id,
            json={
                "proposal_summary": "A" * 120,
                "approach": "B" * 120,
                "kpi_commitments": [
                    {"kpi_id": k["kpi_id"], "committed_value": 24.0 + index}
                    for k in kpis
                ],
                "pilot_cost_rupees": 3000000 + index * 200000,
                "timeline_weeks": 8,
                "data_declaration": "Zone level data only, stored in India.",
                "ip_declaration": "startup_retains",
                "conflict_declaration": True,
            },
            headers=headers,
        )
        assert saved.status_code == 200, saved.text

        submitted = await client.post(
            "/api/v1/applications/" + application_id + "/submit", headers=headers
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["state"] == "Submitted"

    # A startup may not read another startup's application.
    headers = await sign_in(client, world["startups"][0]["user"].email)
    forbidden = await client.get("/api/v1/applications/" + application_ids[1], headers=headers)
    assert forbidden.status_code == 403

    # --- 5. Screen -------------------------------------------------------
    headers = await sign_in(client, admin.email)
    async with session_scope() as db:
        from app.models.challenge import Challenge

        challenge = await db.get(Challenge, challenge_id)
        challenge.application_deadline = utcnow() - timedelta(seconds=1)

    headers = await sign_in(client, officer.email)
    closed = await client.post(
        "/api/v1/challenges/" + challenge_id + "/close-applications", json={}, headers=headers
    )
    assert closed.json()["state"] == "ApplicationsClosed"

    screened = await client.post(
        "/api/v1/challenges/" + challenge_id + "/screen", json={}, headers=headers
    )
    assert screened.json()["state"] == "Screening"

    listing = await client.get(
        "/api/v1/challenges/" + challenge_id + "/applications", headers=headers
    )
    outcomes = {a["eligibility"]["outcome"] for a in listing.json()["items"]}
    assert outcomes == {"Eligible"}
    relaxed = listing.json()["items"][0]["eligibility"]["relaxations_applied"]
    assert {r["rule"] for r in relaxed} == {"turnover", "experience"}

    # --- 6. Evaluate -----------------------------------------------------
    panel = await client.post(
        "/api/v1/challenges/" + challenge_id + "/panel",
        json={
            "evaluator_ids": [e.id for e in world["evaluators"]],
            "validator_ids": [world["validator"].id],
        },
        headers=headers,
    )
    assert panel.status_code == 200, panel.text

    started_evaluation = await client.post(
        "/api/v1/challenges/" + challenge_id + "/start-evaluation", json={}, headers=headers
    )
    assert started_evaluation.json()["state"] == "Evaluation"
    await drain()

    for evaluator in world["evaluators"]:
        headers = await sign_in(client, evaluator.email)
        workspace = await client.get("/api/v1/evaluation/" + challenge_id, headers=headers)
        assert workspace.status_code == 200, workspace.text
        payload = workspace.json()
        assert payload["blinded"]
        for item in payload["applications"]:
            assert "startup_name" not in item
            assert item["blind_label"].startswith("Applicant")

        criteria = payload["criteria"]
        for item in payload["applications"]:
            coi = await client.post(
                "/api/v1/evaluation/applications/" + item["id"] + "/coi",
                json={"has_conflict": False, "statement": ""},
                headers=headers,
            )
            assert coi.status_code == 200
            scored = await client.put(
                "/api/v1/evaluation/applications/" + item["id"] + "/scores",
                json={
                    "round_number": 1,
                    "scores": [
                        {
                            "criterion_id": c["id"],
                            "score": 4,
                            "justification": "Specific on deployment and measurement.",
                        }
                        for c in criteria
                    ],
                },
                headers=headers,
            )
            assert scored.status_code == 200, scored.text

    headers = await sign_in(client, officer.email)
    locked = await client.post(
        "/api/v1/challenges/" + challenge_id + "/lock-scores", json={}, headers=headers
    )
    assert locked.json()["state"] == "Shortlisted"

    ranking = await client.get("/api/v1/challenges/" + challenge_id + "/ranking", headers=headers)
    rows = ranking.json()["items"]
    assert len(rows) == 3
    assert all(row["complete"] for row in rows)
    winner_application = rows[0]["application_id"]

    # --- 7. Shortlist and pilot design ------------------------------------
    headers = await sign_in(client, approver.email)
    shortlist = await client.post(
        "/api/v1/challenges/" + challenge_id + "/shortlist",
        json={"application_ids": [winner_application]},
        headers=headers,
    )
    assert shortlist.status_code == 200, shortlist.text
    pilot_id = shortlist.json()["pilots"][0]["pilot_id"]
    await drain()

    headers = await sign_in(client, officer.email)
    defaults = await client.get(
        "/api/v1/pilots/" + pilot_id + "/simulations/defaults", headers=headers
    )
    assert defaults.status_code == 200, defaults.text
    assert defaults.json()["primary_kpi"]["name"] == "Non-revenue water"

    queued = await client.post(
        "/api/v1/pilots/" + pilot_id + "/simulations",
        json={"duration_weeks": 4, "units": 8, "what_if": [[8, 24]], "iterations": 3000},
        headers=headers,
    )
    assert queued.status_code == 202, queued.text
    run_id = queued.json()["run_id"]
    await drain()

    run = await client.get("/api/v1/simulations/" + run_id, headers=headers)
    assert run.json()["status"] == "Succeeded", run.text
    results = run.json()["results"]
    assert 0.0 <= results["proposed"]["power"] <= 1.0
    assert results["proposed"]["cost_p5_paise"] <= results["proposed"]["cost_p95_paise"]
    assert run.json()["explanation"]

    # Freezing needs an explicit confirmation.
    unconfirmed = await client.post(
        "/api/v1/pilots/" + pilot_id + "/design/freeze",
        json={
            "duration_weeks": 8, "units": 24, "pass_mark": 26.0,
            "analysis_method": "paired_t", "acknowledge": False,
        },
        headers=headers,
    )
    assert unconfirmed.status_code == 422
    assert unconfirmed.json()["errors"][0]["field"] == "acknowledge"

    frozen = await client.post(
        "/api/v1/pilots/" + pilot_id + "/design/freeze",
        json={
            "simulation_run_id": run_id,
            "duration_weeks": 8, "units": 24, "measurements_per_week": 1,
            "pass_mark": 26.0, "analysis_method": "paired_t", "acknowledge": True,
        },
        headers={**headers, "Idempotency-Key": "freeze-1"},
    )
    assert frozen.status_code == 200, frozen.text
    assert frozen.json()["design"]["frozen"]

    refrozen = await client.post(
        "/api/v1/pilots/" + pilot_id + "/design/freeze",
        json={
            "duration_weeks": 12, "units": 40, "pass_mark": 20.0,
            "analysis_method": "paired_t", "acknowledge": True,
        },
        headers=headers,
    )
    assert refrozen.status_code == 422
    assert "already frozen" in refrozen.json()["detail"]

    # --- 8. Agreement ----------------------------------------------------
    agreement_defaults = await client.get(
        "/api/v1/pilots/" + pilot_id + "/agreement/defaults", headers=headers
    )
    assert agreement_defaults.status_code == 200, agreement_defaults.text
    milestones = agreement_defaults.json()["milestones"]
    assert len(milestones) == 4

    drafted = await client.post(
        "/api/v1/pilots/" + pilot_id + "/agreements",
        json={
            "ip_option": "startup_retains",
            "data_terms": {
                "datasets": "Bulk meter readings and the zone-level billing extract.",
                "identifiers_removed": "All customer identifiers removed before transfer.",
                "storage_location": "India",
                "processing_purpose": "Water balance computation for this pilot only.",
                "retention_months": 12,
                "deletion_obligation": "Deleted within 30 days of closure, with certification.",
                "access_log": "All access logged and available on request.",
                "export_format": "CSV with a documented schema plus open JSON.",
            },
            "milestones": milestones,
        },
        headers=headers,
    )
    assert drafted.status_code == 201, drafted.text
    assert drafted.json()["sha256"]

    # Data outside India is refused.
    refused = await client.post(
        "/api/v1/pilots/" + pilot_id + "/agreements",
        json={
            "ip_option": "startup_retains",
            "data_terms": {
                "datasets": "Bulk meter readings.",
                "identifiers_removed": "All identifiers removed.",
                "storage_location": "Singapore",
                "processing_purpose": "Water balance.",
                "retention_months": 12,
                "deletion_obligation": "Deleted within 30 days.",
                "access_log": "Logged.",
            },
            "milestones": milestones,
        },
        headers=headers,
    )
    assert refused.status_code == 422
    assert refused.json()["errors"][0]["field"] == "data_terms.storage_location"

    headers = await sign_in(client, approver.email)
    approved_agreement = await client.post(
        "/api/v1/pilots/" + pilot_id + "/approve-agreement", json={}, headers=headers
    )
    assert approved_agreement.json()["state"] == "AwaitingStartup"
    await drain()

    winner_startup_id = None
    async with session_scope() as db:
        from app.models.pilot import Pilot

        pilot = await db.get(Pilot, pilot_id)
        winner_startup_id = pilot.startup_id
    winner_user = next(
        e["user"] for e in world["startups"] if e["startup"].id == winner_startup_id
    )

    headers = await sign_in(client, winner_user.email)
    # Acceptance is blocked until the cybersecurity checklist is complete.
    premature = await client.post(
        "/api/v1/pilots/" + pilot_id + "/accept-agreement", json={}, headers=headers
    )
    assert premature.status_code == 422
    assert premature.json()["errors"][0]["field"] == "cyber_checklist"

    checklist = await client.post(
        "/api/v1/pilots/" + pilot_id + "/cyber-checklist",
        json={
            "answers": {
                "hosting_in_india": True, "encryption_at_rest": True,
                "encryption_in_transit": True, "access_control": True, "access_logging": True,
                "mfa_admin": True, "backup_restore": True, "vulnerability_contact": True,
                "patching": True, "incident_response": True, "data_export": True,
            }
        },
        headers=headers,
    )
    assert checklist.status_code == 200, checklist.text

    accepted = await client.post(
        "/api/v1/pilots/" + pilot_id + "/accept-agreement", json={}, headers=headers
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["state"] == "Active"
    await drain()

    # --- 9. Pilot data ---------------------------------------------------
    template = await client.get(
        "/api/v1/pilots/" + pilot_id + "/metrics/template.csv", headers=headers
    )
    assert template.status_code == 200
    assert "kpi_name" in template.text

    async with session_scope() as db:
        from app.models.challenge import Challenge

        challenge = await db.get(Challenge, challenge_id)
        primary_kpi_id = challenge.primary_kpi.id
        primary_kpi_name = challenge.primary_kpi.name

    baseline_start = utcnow() - timedelta(weeks=14)
    pilot_start = utcnow() - timedelta(weeks=8)

    def rows(phase: str, start, mean: float) -> list[dict[str, Any]]:
        out = []
        for unit in range(1, 13):
            for week in range(6):
                period = start + timedelta(weeks=week)
                out.append(
                    {
                        "kpi_id": primary_kpi_id,
                        "unit_ref": "DMA-" + str(unit).zfill(2),
                        "period_start": period.isoformat(),
                        "period_end": (period + timedelta(days=7)).isoformat(),
                        "phase": phase,
                        "arm": "treatment",
                        "value": mean + (unit % 5) - 2 + (week % 3) * 0.4,
                    }
                )
        return out

    baseline = await client.post(
        "/api/v1/pilots/" + pilot_id + "/metrics",
        json={"rows": rows("baseline", baseline_start, 32.0)},
        headers=headers,
    )
    assert baseline.status_code == 200, baseline.text
    assert baseline.json()["accepted"] == 72

    pilot_rows = await client.post(
        "/api/v1/pilots/" + pilot_id + "/metrics",
        json={"rows": rows("pilot", pilot_start, 25.5)},
        headers=headers,
    )
    assert pilot_rows.json()["accepted"] == 72

    # A CSV carrying an identifier-like column is refused outright.
    bad_csv = (
        "kpi_name,unit_ref,period_start,period_end,phase,arm,value,phone\n"
        + primary_kpi_name + ",DMA-01,2026-01-05,2026-01-11,pilot,treatment,28.4,9876543210\n"
    )
    rejected = await client.post(
        "/api/v1/pilots/" + pilot_id + "/metrics/csv",
        files={"file": ("metrics.csv", bad_csv.encode(), "text/csv")},
        headers=headers,
    )
    assert rejected.status_code == 422
    assert "personal identifiers" in rejected.json()["detail"]

    # A valid CSV with one bad row reports the line number and stores the rest.
    mixed_csv = (
        "kpi_name,unit_ref,period_start,period_end,phase,arm,value\n"
        + primary_kpi_name + ",DMA-13,2026-01-05,2026-01-11,pilot,treatment,26.1\n"
        + primary_kpi_name + ",DMA-14,not-a-date,2026-01-11,pilot,treatment,25.9\n"
    )
    uploaded = await client.post(
        "/api/v1/pilots/" + pilot_id + "/metrics/csv",
        files={"file": ("metrics.csv", mixed_csv.encode(), "text/csv")},
        headers=headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["accepted"] == 1
    assert uploaded.json()["rejected"][0]["line"] == 3
    assert "period_start" in uploaded.json()["rejected"][0]["reason"]

    dashboard = await client.get("/api/v1/pilots/" + pilot_id + "/dashboard", headers=headers)
    assert dashboard.json()["measurements_received"] > 0
    assert dashboard.json()["plan"]["frozen_at"]

    # --- 10. Milestones and payment --------------------------------------
    milestone_list = await client.get(
        "/api/v1/pilots/" + pilot_id + "/milestones", headers=headers
    )
    first_milestone = milestone_list.json()["items"][0]
    milestone_id = first_milestone["id"]

    submitted = await client.post(
        "/api/v1/milestones/" + milestone_id + "/submit",
        json={"note": "Deployment plan agreed and access provisioned across all units."},
        headers=headers,
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["state"] == "Submitted"
    assert submitted.json()["held_by_role"] == "DO"
    assert submitted.json()["days_remaining"] is not None
    await drain()

    headers = await sign_in(client, officer.email)
    rejected_milestone = await client.post(
        "/api/v1/milestones/" + milestone_id + "/reject",
        json={
            "reason": "The access register does not cover four of the units.",
            "unmet_requirement": "Signed access register covering every pilot unit",
        },
        headers=headers,
    )
    assert rejected_milestone.json()["state"] == "Rejected"
    assert rejected_milestone.json()["unmet_requirement"]

    headers = await sign_in(client, winner_user.email)
    resubmitted = await client.post(
        "/api/v1/milestones/" + milestone_id + "/submit",
        json={"note": "Revised access register covering all 24 units, with commissioning records."},
        headers=headers,
    )
    assert resubmitted.json()["state"] == "Submitted"
    assert resubmitted.json()["resubmission_count"] == 1

    headers = await sign_in(client, officer.email)
    accepted_milestone = await client.post(
        "/api/v1/milestones/" + milestone_id + "/accept", json={}, headers=headers
    )
    assert accepted_milestone.json()["state"] == "Accepted"
    await drain()

    # The officer cannot approve the payment they accepted.
    denied = await client.post(
        "/api/v1/milestones/" + milestone_id + "/approve-payment", json={}, headers=headers
    )
    assert denied.status_code == 403

    headers = await sign_in(client, approver.email)
    approved_payment = await client.post(
        "/api/v1/milestones/" + milestone_id + "/approve-payment", json={}, headers=headers
    )
    assert approved_payment.json()["state"] == "PaymentApproved"
    await drain()

    headers = await sign_in(client, finance.email)
    queue = await client.get("/api/v1/finance/queue", headers=headers)
    assert any(item["id"] == milestone_id for item in queue.json()["items"])

    released = await client.post(
        "/api/v1/milestones/" + milestone_id + "/record-release",
        json={
            "reference_no": "PMC/WS/2026/4101",
            "amount_rupees": first_milestone["amount_paise"] / 100,
            "mode": "Bank transfer",
        },
        headers={**headers, "Idempotency-Key": "release-1"},
    )
    assert released.status_code == 200, released.text
    assert released.json()["state"] == "Paid"

    duplicate = await client.post(
        "/api/v1/milestones/" + milestone_id + "/record-release",
        json={
            "reference_no": "PMC/WS/2026/4102",
            "amount_rupees": first_milestone["amount_paise"] / 100,
        },
        headers=headers,
    )
    assert duplicate.status_code == 409
    await drain()

    # --- 11. Complete, analyse, validate ---------------------------------
    headers = await sign_in(client, officer.email)
    completed = await client.post(
        "/api/v1/pilots/" + pilot_id + "/complete", json={}, headers=headers
    )
    assert completed.json()["state"] == "Completed"

    analysis = await client.post(
        "/api/v1/pilots/" + pilot_id + "/evidence/run",
        json={},
        headers={**headers, "Idempotency-Key": "evidence-1"},
    )
    assert analysis.status_code == 201, analysis.text
    report = analysis.json()
    report_id = report["id"]
    assert report["status"] == "AwaitingValidation"
    assert report["analysis"]["effect"] < 0
    assert report["analysis"]["excludes_zero_95"]
    assert report["dataset_hash"]
    assert report["confidence_score"] is not None
    assert not report["components"]["issued"]
    await drain()

    # The same analysis on the same data reproduces the same result.
    rerun = await client.post(
        "/api/v1/pilots/" + pilot_id + "/evidence/run", json={}, headers=headers
    )
    assert rerun.json()["analysis"]["effect"] == report["analysis"]["effect"]
    assert rerun.json()["dataset_hash"] == report["dataset_hash"]

    # A scale decision is refused before sign-off.
    headers = await sign_in(client, approver.email)
    premature_decision = await client.post(
        "/api/v1/pilots/" + pilot_id + "/decision",
        json={
            "decision": "Scale",
            "reason": "The result looks good enough to proceed without validation.",
            "estimated_value_rupees": 28000000,
        },
        headers=headers,
    )
    assert premature_decision.status_code == 403
    assert "signed-off Evidence Report" in premature_decision.json()["detail"]

    headers = await sign_in(client, world["validator"].email)
    workspace = await client.get(
        "/api/v1/evidence/" + report_id + "/workspace", headers=headers
    )
    assert workspace.status_code == 200, workspace.text
    assert workspace.json()["row_count"] > 100
    assert workspace.json()["dataset_check"]["unchanged"]
    assert len(workspace.json()["checklist"]) == 5

    incomplete = await client.post(
        "/api/v1/evidence/" + report_id + "/sign-off",
        json={
            "decision": "sign_off",
            "remarks": "Everything checked and found correct in every respect.",
            "checklist": {"data_provenance": True},
        },
        headers=headers,
    )
    assert incomplete.status_code == 422
    assert incomplete.json()["errors"]

    signed = await client.post(
        "/api/v1/evidence/" + report_id + "/sign-off",
        json={
            "decision": "sign_off",
            "remarks": (
                "Data provenance traced to the water balance for six sampled weeks. The analysis "
                "was re-run on the locked dataset and reproduced the reported effect exactly."
            ),
            "checklist": {
                "data_provenance": True, "sample_checks": True, "calculation_rerun": True,
                "deviations_reviewed": True, "independence_confirmed": True,
            },
        },
        headers={**headers, "Idempotency-Key": "signoff-1"},
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["status"] == "SignedOff"
    assert signed.json()["confidence_score"] > 0
    assert signed.json()["components"]["issued"]
    await drain()

    # --- 12. Pathway and decision ----------------------------------------
    headers = await sign_in(client, approver.email)
    pathway = await client.get(
        "/api/v1/pilots/" + pilot_id + "/pathway",
        params={"estimated_value_rupees": 28000000},
        headers=headers,
    )
    assert pathway.status_code == 200, pathway.text
    assert pathway.json()["recommended"]["code"]
    assert "competent authority" in pathway.json()["caveat"]

    projection = await client.post(
        "/api/v1/pilots/" + pilot_id + "/scale-simulations",
        json={"units": 96, "cost_per_unit_rupees": 185000, "value_per_effect_unit_rupees": 42000},
        headers=headers,
    )
    assert projection.status_code == 200, projection.text
    assert (
        projection.json()["benefit_low"]
        <= projection.json()["benefit_expected"]
        <= projection.json()["benefit_high"]
    )

    decision = await client.post(
        "/api/v1/pilots/" + pilot_id + "/decision",
        json={
            "decision": "Scale",
            "reason": (
                "The validated reduction is supported by an interval entirely on the beneficial "
                "side of no change, and the Evidence Confidence Score is in the strong band."
            ),
            "estimated_value_rupees": 28000000,
            "exit_plan_on_record": True,
            "scale_projection": projection.json(),
        },
        headers={**headers, "Idempotency-Key": "decision-1"},
    )
    assert decision.status_code == 201, decision.text
    assert decision.json()["decision"] == "Scale"
    assert decision.json()["handoff_file_id"]
    await drain()

    handoff = await client.get("/api/v1/pilots/" + pilot_id + "/handoff.json", headers=headers)
    assert handoff.json()["schema"] == "pramaansetu.handoff.v1"
    assert handoff.json()["evidence"]["dataset_hash"] == report["dataset_hash"]

    handoff_pdf = await client.get("/api/v1/pilots/" + pilot_id + "/handoff.pdf", headers=headers)
    assert handoff_pdf.status_code == 200
    assert handoff_pdf.content.startswith(b"%PDF")

    # --- 13. Passport and reuse -------------------------------------------
    passports = await client.get("/api/v1/passports", headers=headers)
    assert passports.json()["items"], "no passport was issued on sign-off"
    passport = passports.json()["items"][0]
    assert passport["confidence_score"] > 0
    assert passport["validator_name"]

    headers = await sign_in(client, world["other_officer"].email)
    fit = await client.get(
        "/api/v1/passports/" + passport["id"] + "/context-fit",
        params={"scale_units": 400, "state_code": "RJ", "sector": "Water"},
        headers=headers,
    )
    assert fit.status_code == 200
    assert not fit.json()["comparable"]

    adoption = await client.post(
        "/api/v1/passports/" + passport["id"] + "/adoption-requests",
        json={
            "intent": "new_challenge",
            "note": "Jaipur has a comparable water loss problem in two zones.",
            "context": {"scale_units": 40, "state_code": "RJ", "sector": "Water"},
        },
        headers={**headers, "Idempotency-Key": "adopt-1"},
    )
    assert adoption.status_code == 201, adoption.text
    assert adoption.json()["prefilled_challenge_id"]
    await drain()

    prefilled = await client.get(
        "/api/v1/challenges/" + adoption.json()["prefilled_challenge_id"], headers=headers
    )
    assert prefilled.json()["state"] == "Draft"
    assert prefilled.json()["eligibility_rules"]["prior_evidence"]["passport_reference"]
    # The adopting department must collect its own baseline.
    assert all(k["baseline_value"] is None for k in prefilled.json()["kpis"])

    # A read-only share link works without any department role.
    shared = await client.get("/api/v1/passports/shared/" + passport["share_token"])
    assert shared.status_code == 200
    assert shared.json()["read_only"]
    assert "share_token" not in shared.json()

    # --- 14. Audit --------------------------------------------------------
    headers = await sign_in(client, admin.email)
    verification = await client.post("/api/v1/admin/audit/verify", json={}, headers=headers)
    assert verification.status_code == 200, verification.text
    assert verification.json()["verified"], verification.json()["detail"]
    assert verification.json()["entries_total"] > 30

    audit_log = await client.get("/api/v1/admin/audit", headers=headers)
    actions = {row["action"] for row in audit_log.json()["items"]}
    assert "scale.decided" in actions or "evidence.sign-off" in actions

    export = await client.get("/api/v1/admin/audit/export.csv", headers=headers)
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")

    dashboard = await client.get(
        "/api/v1/admin/dashboard", params={"department_id": department.id}, headers=headers
    )
    assert dashboard.json()["challenges_total"] >= 1
    assert dashboard.json()["passports_issued"] >= 1

    transparency = await client.get("/api/v1/public/transparency")
    assert transparency.json()["validated_passports"] >= 1
    assert transparency.json()["pilots_run"] >= 1


async def test_health_and_status_endpoints(client: AsyncClient):
    assert (await client.get("/api/v1/healthz")).json()["status"] == "ok"
    ready = await client.get("/api/v1/readyz")
    assert ready.json()["ready"] is True
    status = await client.get("/api/v1/status")
    body = status.json()
    assert set(body["queues"]) == {"critical", "default", "ai", "compute", "docs"}
    assert body["adapters"]["dpiit"]["mode"] == "mock"


async def test_unauthenticated_requests_are_refused_with_guidance(client: AsyncClient):
    response = await client.get("/api/v1/me/tasks")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")
    assert "Sign in" in response.json()["detail"]


async def test_state_changing_request_without_csrf_is_refused(client: AsyncClient, world):
    await sign_in(client, world["officer"].email)
    response = await client.post(
        "/api/v1/challenges",
        json={"department_id": world["department"].id, "problem_statement": PROBLEM},
    )
    assert response.status_code == 403
    assert "PramaanSetu web app" in response.json()["detail"]


async def test_validation_errors_name_the_field_and_the_fix(client: AsyncClient, world):
    headers = await sign_in(client, world["officer"].email)
    created = await client.post(
        "/api/v1/challenges",
        json={"department_id": world["department"].id, "problem_statement": "too short"},
        headers=headers,
    )
    challenge_id = created.json()["id"]
    submitted = await client.post(
        "/api/v1/challenges/" + challenge_id + "/submit", json={}, headers=headers
    )
    assert submitted.status_code == 422
    problem = submitted.json()
    assert problem["type"].endswith("validation-failed")
    assert problem["errors"]
    for error in problem["errors"]:
        assert error["field"]
        assert error["detail"]
        assert error["fix"]


async def test_the_task_inbox_is_scoped_to_the_signed_in_user(client: AsyncClient, world):
    headers = await sign_in(client, world["finance"].email)
    tasks = await client.get("/api/v1/me/tasks", headers=headers)
    assert tasks.status_code == 200
    for task in tasks.json()["items"]:
        assert task["role"] == "FO"


async def test_templates_are_installed_and_versioned(client: AsyncClient, world):
    headers = await sign_in(client, world["officer"].email)
    templates = await client.get("/api/v1/admin/templates", headers=headers)
    assert templates.status_code == 200
    kinds = {t["kind"] for t in templates.json()["items"]}
    assert kinds == {
        "problem_statement", "evaluation_rubric", "pilot_agreement", "data_sharing",
        "ip_clause", "cyber_checklist", "risk_register", "exit_plan",
    }
    for template in templates.json()["items"]:
        assert template["version"]
        assert "legal cell" in template["source_note"]

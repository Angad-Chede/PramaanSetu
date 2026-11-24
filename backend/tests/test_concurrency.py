"""Concurrency and exactly-once behaviour (PRD 10.3, 10.4, 10.5, 14.1).

Each test here is one of the race scenarios named in the PRD, asserted for an
exactly-once outcome.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest
from factories import make_challenge, make_department, make_startup, make_user, principal_of
from sqlalchemy import func, select

from app.core.clock import utcnow
from app.core.db import session_scope
from app.core.errors import Conflict, TransitionNotAllowed
from app.domain.states import MilestoneState
from app.models.application import Application
from app.models.payment import Milestone, PaymentRelease
from app.models.pilot import MetricSubmission, Pilot
from app.models.platform import AuditLog, Notification, OutboxEvent
from app.services import applications as applications_service
from app.services import audit, outbox
from app.services import payments as payments_service
from app.services import pilots as pilots_service


async def _pilot_with_milestone(session, amount_paise: int = 500000):
    department = await make_department(session, code="RACE")
    officer = await make_user(
        session, email="race.officer@test.invalid",
        roles=[("DO", "department", department.id)], department_id=department.id,
    )
    approver_a = await make_user(
        session, email="race.approver.a@test.invalid",
        roles=[("DA", "department", department.id)], department_id=department.id,
    )
    approver_b = await make_user(
        session, email="race.approver.b@test.invalid",
        roles=[("DA", "department", department.id)], department_id=department.id,
    )
    finance = await make_user(
        session, email="race.finance@test.invalid",
        roles=[("FO", "department", department.id)], department_id=department.id,
    )
    startup = await make_startup(session)
    startup_user = await make_user(
        session, email="race.startup@test.invalid",
        roles=[("SU", "startup", startup.id)], startup_id=startup.id,
    )
    challenge = await make_challenge(
        session, department=department, officer=officer, state="PilotDesign"
    )

    application = Application(
        reference="AP-RACE1",
        challenge_id=challenge.id,
        startup_id=startup.id,
        created_by=startup_user.id,
        state="Shortlisted",
        pilot_cost_paise=amount_paise * 4,
        timeline_weeks=8,
        ip_declaration="startup_retains",
        conflict_declaration=True,
    )
    session.add(application)
    await session.flush()

    pilot = await pilots_service.create_for_application(
        session, application, challenge, principal_of(officer)
    )
    now = utcnow()
    milestone = Milestone(
        pilot_id=pilot.id,
        seq=1,
        title="Mobilisation",
        deliverable="Deployment plan agreed.",
        evidence_required="Deployment plan document.",
        amount_paise=amount_paise,
        due_date=now + timedelta(days=14),
        state=MilestoneState.ACCEPTED,
        state_entered_at=now,
        sla_due_at=now + timedelta(days=5),
        sla_owner_role="DA",
        state_history=[{"state": MilestoneState.ACCEPTED, "at": now.isoformat()}],
    )
    session.add(milestone)
    await session.flush()
    await session.commit()
    return {
        "pilot": pilot,
        "milestone_id": milestone.id,
        "officer": officer,
        "approvers": [approver_a, approver_b],
        "finance": finance,
        "startup_user": startup_user,
        "challenge": challenge,
        "application": application,
    }


async def test_fifty_concurrent_approvals_yield_exactly_one_success(session):
    """PRD 10.10 contention test: 50 concurrent approve calls on one milestone."""
    setup = await _pilot_with_milestone(session)
    milestone_id = setup["milestone_id"]
    approver = principal_of(setup["approvers"][0])

    async def approve() -> str:
        try:
            async with session_scope() as db:
                from app.core.db import lock_row

                milestone = await lock_row(db, Milestone, milestone_id)
                await payments_service.transition(
                    db, milestone, approver, "approve-payment", actor_role="DA"
                )
            return "ok"
        except (TransitionNotAllowed, Conflict):
            return "conflict"
        except Exception as exc:  # pragma: no cover - surfaced only on a real defect
            return "error:" + type(exc).__name__

    results = await asyncio.gather(*[approve() for _ in range(50)])
    successes = [r for r in results if r == "ok"]
    conflicts = [r for r in results if r == "conflict"]

    assert len(successes) == 1, results
    assert len(conflicts) == 49, results

    async with session_scope() as db:
        milestone = await db.get(Milestone, milestone_id)
        assert milestone.state == MilestoneState.PAYMENT_APPROVED

        approvals = await db.execute(
            select(func.count())
            .select_from(AuditLog)
            .where(
                AuditLog.entity_id == milestone_id,
                AuditLog.action == "milestone.approve-payment",
            )
        )
        assert int(approvals.scalar_one()) == 1

        events = await db.execute(
            select(func.count())
            .select_from(OutboxEvent)
            .where(
                OutboxEvent.aggregate_id == milestone_id,
                OutboxEvent.event_type == "milestone.payment_approved",
            )
        )
        assert int(events.scalar_one()) == 1


async def test_duplicate_release_is_refused_by_the_unique_constraint(session):
    setup = await _pilot_with_milestone(session)
    milestone_id = setup["milestone_id"]
    approver = principal_of(setup["approvers"][0])
    finance = principal_of(setup["finance"])

    async with session_scope() as db:
        from app.core.db import lock_row

        milestone = await lock_row(db, Milestone, milestone_id)
        await payments_service.transition(
            db, milestone, approver, "approve-payment", actor_role="DA"
        )

    async def release(reference: str) -> str:
        try:
            async with session_scope() as db:
                from app.core.db import lock_row

                milestone = await lock_row(db, Milestone, milestone_id)
                await payments_service.transition(
                    db, milestone, finance, "record-release", actor_role="FO",
                    payload={"reference_no": reference, "amount_paise": milestone.amount_paise},
                )
            return "ok"
        except Exception:
            return "refused"

    results = await asyncio.gather(release("REF-1"), release("REF-2"), release("REF-3"))
    assert results.count("ok") == 1

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(PaymentRelease).where(
                PaymentRelease.milestone_id == milestone_id
            )
        )
        assert int(count.scalar_one()) == 1


async def test_submission_at_the_deadline_is_decided_by_server_time(session):
    department = await make_department(session, code="DEADLINE")
    officer = await make_user(
        session, email="deadline.officer@test.invalid",
        roles=[("DO", "department", department.id)], department_id=department.id,
    )
    startup = await make_startup(session)
    startup_user = await make_user(
        session, email="deadline.startup@test.invalid",
        roles=[("SU", "startup", startup.id)], startup_id=startup.id,
    )
    challenge = await make_challenge(
        session, department=department, officer=officer, state="Published", deadline_days=1
    )
    application = await applications_service.start_application(
        session, challenge, startup, principal_of(startup_user)
    )
    application.proposal_summary = "A" * 120
    application.approach = "B" * 120
    application.kpi_commitments = [{"kpi_id": challenge.kpis[0].id, "committed_value": 24.0}]
    application.pilot_cost_paise = 1000000
    application.timeline_weeks = 8
    application.data_declaration = "Zone level data only."
    application.ip_declaration = "startup_retains"
    application.conflict_declaration = True
    await session.commit()

    # One second before the deadline: accepted.
    challenge.application_deadline = utcnow() + timedelta(seconds=1)
    await session.commit()
    await applications_service.submit(session, application, challenge, principal_of(startup_user))
    await session.commit()
    assert application.state == "Submitted"

    # One second after the deadline: refused, with how late it was.
    challenge.application_deadline = utcnow() - timedelta(seconds=1)
    await session.commit()
    with pytest.raises(Conflict) as excinfo:
        await applications_service.submit(
            session, application, challenge, principal_of(startup_user)
        )
    problem = excinfo.value.to_problem()
    assert problem["status"] == 409
    assert "deadline passed" in problem["detail"]
    assert problem["late_by_seconds"] >= 1


async def test_double_click_submit_stores_one_application(session):
    department = await make_department(session, code="DOUBLE")
    officer = await make_user(
        session, email="double.officer@test.invalid",
        roles=[("DO", "department", department.id)], department_id=department.id,
    )
    startup = await make_startup(session)
    startup_user = await make_user(
        session, email="double.startup@test.invalid",
        roles=[("SU", "startup", startup.id)], startup_id=startup.id,
    )
    challenge = await make_challenge(
        session, department=department, officer=officer, state="Published"
    )
    await session.commit()

    principal = principal_of(startup_user)
    challenge_id, startup_id = challenge.id, startup.id

    async def start() -> str:
        async with session_scope() as db:
            from app.models.challenge import Challenge
            from app.models.startup import Startup

            local_challenge = await db.get(Challenge, challenge_id)
            local_startup = await db.get(Startup, startup_id)
            application = await applications_service.start_application(
                db, local_challenge, local_startup, principal
            )
            return application.id

    ids = await asyncio.gather(*[start() for _ in range(5)], return_exceptions=True)
    successful = [i for i in ids if isinstance(i, str)]
    assert successful

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(Application).where(
                Application.challenge_id == challenge_id, Application.startup_id == startup_id
            )
        )
        assert int(count.scalar_one()) == 1


async def test_repeated_csv_upload_upserts_instead_of_duplicating(session):
    setup = await _pilot_with_milestone(session)
    pilot = setup["pilot"]
    challenge = setup["challenge"]
    startup_principal = principal_of(setup["startup_user"])
    kpi = challenge.kpis[0]

    rows = [
        {
            "kpi_id": kpi.id,
            "unit_ref": "DMA-01",
            "period_start": "2026-01-05",
            "period_end": "2026-01-11",
            "phase": "pilot",
            "arm": "treatment",
            "value": 28.4,
        }
    ]

    async with session_scope() as db:
        local_pilot = await db.get(Pilot, pilot.id)
        first = await pilots_service.ingest_rows(
            db, local_pilot, startup_principal, rows, source="csv", upload_hash="hash-1"
        )
    async with session_scope() as db:
        local_pilot = await db.get(Pilot, pilot.id)
        second = await pilots_service.ingest_rows(
            db, local_pilot, startup_principal, rows, source="csv", upload_hash="hash-1"
        )

    assert first["accepted"] == 1
    assert second["accepted"] == 1

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(MetricSubmission).where(
                MetricSubmission.pilot_id == pilot.id
            )
        )
        assert int(count.scalar_one()) == 1


async def test_invalid_csv_rows_are_reported_with_line_numbers(session):
    setup = await _pilot_with_milestone(session)
    pilot = setup["pilot"]
    challenge = setup["challenge"]
    startup_principal = principal_of(setup["startup_user"])
    kpi = challenge.kpis[0]

    rows = [
        {"kpi_id": kpi.id, "unit_ref": "DMA-01", "period_start": "2026-01-05",
         "period_end": "2026-01-11", "phase": "pilot", "arm": "treatment", "value": 28.4},
        {"kpi_id": kpi.id, "unit_ref": "", "period_start": "2026-01-05",
         "period_end": "2026-01-11", "phase": "pilot", "arm": "treatment", "value": 28.4},
        {"kpi_id": kpi.id, "unit_ref": "DMA-02", "period_start": "not a date",
         "period_end": "2026-01-11", "phase": "pilot", "arm": "treatment", "value": 28.4},
        {"kpi_id": "unknown", "unit_ref": "DMA-03", "period_start": "2026-01-05",
         "period_end": "2026-01-11", "phase": "pilot", "arm": "treatment", "value": 1.0},
    ]

    async with session_scope() as db:
        local_pilot = await db.get(Pilot, pilot.id)
        result = await pilots_service.ingest_rows(
            db, local_pilot, startup_principal, rows, source="csv"
        )

    assert result["accepted"] == 1
    assert result["rejected_count"] == 3
    lines = [r["line"] for r in result["rejected"]]
    assert lines == [2, 3, 4]
    for rejection in result["rejected"]:
        assert rejection["reason"]


async def test_scheduler_running_twice_escalates_exactly_once(session):
    """PRD 10.10 scheduler test: two instances, one escalation per breaching milestone."""
    setup = await _pilot_with_milestone(session)
    milestone_id = setup["milestone_id"]

    async with session_scope() as db:
        milestone = await db.get(Milestone, milestone_id)
        milestone.state = MilestoneState.SUBMITTED
        milestone.sla_owner_role = "DO"
        milestone.state_entered_at = utcnow() - timedelta(days=9)
        milestone.sla_due_at = utcnow() - timedelta(days=2)
        milestone.escalation_level = 0

    async def scan() -> dict:
        async with session_scope() as db:
            return await payments_service.scan_slas(db)

    first, second = await asyncio.gather(scan(), scan())
    total_escalated = first["escalated"] + second["escalated"]
    assert total_escalated == 1, (first, second)

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(OutboxEvent).where(
                OutboxEvent.aggregate_id == milestone_id,
                OutboxEvent.event_type == "milestone.sla_breached",
            )
        )
        assert int(count.scalar_one()) == 1
        milestone = await db.get(Milestone, milestone_id)
        assert milestone.escalation_level == 1

    # A third scan changes nothing.
    third = await scan()
    assert third["escalated"] == 0


async def test_reminder_is_sent_once_at_seventy_five_percent_of_the_service_level(session):
    setup = await _pilot_with_milestone(session)
    milestone_id = setup["milestone_id"]

    async with session_scope() as db:
        milestone = await db.get(Milestone, milestone_id)
        milestone.state = MilestoneState.SUBMITTED
        milestone.sla_owner_role = "DO"
        milestone.state_entered_at = utcnow() - timedelta(days=6)
        milestone.sla_due_at = utcnow() + timedelta(days=1)
        milestone.escalation_level = 0
        milestone.reminder_sent_at = None

    async with session_scope() as db:
        first = await payments_service.scan_slas(db)
    async with session_scope() as db:
        second = await payments_service.scan_slas(db)

    assert first["reminded"] == 1
    assert second["reminded"] == 0

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(OutboxEvent).where(
                OutboxEvent.aggregate_id == milestone_id,
                OutboxEvent.event_type == "milestone.sla_reminder",
            )
        )
        assert int(count.scalar_one()) == 1


async def test_outbox_events_are_claimed_once_and_marked_published(session):
    async with session_scope() as db:
        for index in range(10):
            outbox.emit(
                db,
                aggregate_type="challenge",
                aggregate_id="c" + str(index),
                event_type="challenge.published",
                payload={"index": index},
            )

    async def relay() -> int:
        async with session_scope() as db:
            events = await outbox.claim_unpublished(db, limit=10)
            for event in events:
                outbox.mark_published(event)
            return len(events)

    first, second = await asyncio.gather(relay(), relay())
    assert first + second == 10

    async with session_scope() as db:
        assert await outbox.pending_count(db) == 0


async def test_notifications_are_idempotent_on_the_event_id(session):
    from app.services import notifications

    user = await make_user(session, email="idem@test.invalid")
    await session.commit()

    async with session_scope() as db:
        await notifications.notify(
            db, user_id=user.id, notification_type="test", title="First",
            body="Body", event_id="event-1",
        )
    async with session_scope() as db:
        duplicate = await notifications.notify(
            db, user_id=user.id, notification_type="test", title="Second",
            body="Body", event_id="event-1",
        )
        assert duplicate is None

    async with session_scope() as db:
        count = await db.execute(
            select(func.count()).select_from(Notification).where(Notification.user_id == user.id)
        )
        assert int(count.scalar_one()) == 1


async def test_audit_chain_has_no_forks_under_concurrent_writes(session):
    department = await make_department(session, code="FORK")
    user = await make_user(session, email="fork@test.invalid", department_id=department.id)
    await session.commit()

    async def write(index: int) -> None:
        async with session_scope() as db:
            await audit.record(
                db,
                action="concurrent.write",
                entity_type="challenge",
                entity_id="c" + str(index),
                actor_id=user.id,
                department_id=department.id,
                after={"index": index},
            )

    await asyncio.gather(*[write(i) for i in range(25)])

    async with session_scope() as db:
        verification = await audit.verify(db)
        assert verification.verified, verification.detail
        assert verification.entries_checked >= 25

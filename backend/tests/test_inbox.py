"""The role inbox (PRD 5.2, 6.2).

Every role signs in to one question: what is waiting for me. The properties under test
are that each role is shown only its own work, that work belonging to another department
never appears, that an overdue item sorts to the top, and that a task disappears once the
thing it asks for has been done.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from factories import make_challenge, make_department, make_startup, make_user, principal_of

from app.core.clock import utcnow
from app.core.policy import Principal, ScopedRole
from app.domain.states import (
    ApplicationState,
    EligibilityOutcome,
    EvidenceStatus,
    MilestoneState,
    PilotState,
    Role,
)
from app.models.application import Application, EligibilityResult
from app.models.challenge import Clarification
from app.models.evaluation import CoiDeclaration, PanelMember
from app.models.evidence import EvidenceReport
from app.models.payment import Milestone
from app.models.pilot import AgreementVersion, Pilot
from app.models.scale import ScaleDecision
from app.models.simulation import PilotDesign
from app.services import evaluation as evaluation_service
from app.services import inbox as inbox_service


async def _base(session, code: str = "INBOX") -> dict[str, Any]:
    department = await make_department(session, code=code + "-DEPT")
    officer = await make_user(
        session,
        email=code.lower() + ".officer@test.invalid",
        name="Anita Deshmukh",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    approver = await make_user(
        session,
        email=code.lower() + ".approver@test.invalid",
        name="Ramesh Kulkarni",
        roles=[("DA", "department", department.id)],
        department_id=department.id,
    )
    finance = await make_user(
        session,
        email=code.lower() + ".finance@test.invalid",
        name="Sunita Pawar",
        roles=[("FO", "department", department.id)],
        department_id=department.id,
    )
    startup = await make_startup(session)
    founder = await make_user(
        session,
        email=code.lower() + ".founder@test.invalid",
        name="Founder",
        roles=[("SU", "startup", startup.id)],
        startup_id=startup.id,
    )
    return {
        "department": department,
        "officer": officer,
        "approver": approver,
        "finance": finance,
        "startup": startup,
        "founder": founder,
    }


async def _application(session, world, challenge, *, state: str = ApplicationState.SHORTLISTED):
    application = Application(
        reference="AP-" + challenge.reference,
        challenge_id=challenge.id,
        startup_id=world["startup"].id,
        created_by=world["founder"].id,
        state=state,
        proposal_summary="A" * 120,
        approach="B" * 120,
        pilot_cost_paise=30_00_000,
        timeline_weeks=8,
        ip_declaration="startup_retains",
        conflict_declaration=True,
        kpi_commitments=[{"kpi_id": challenge.kpis[0].id, "committed_value": 24.0}],
    )
    session.add(application)
    await session.flush()
    return application


async def _pilot(session, world, challenge, application, *, state: str) -> Pilot:
    pilot = Pilot(
        reference="PL-" + challenge.reference,
        application_id=application.id,
        challenge_id=challenge.id,
        startup_id=world["startup"].id,
        department_id=world["department"].id,
        state=state,
        total_value_paise=30_00_000,
    )
    session.add(pilot)
    await session.flush()
    return pilot


def _milestone(pilot, *, state: str, seq: int = 1, sla_due_at=None, due_date=None) -> Milestone:
    now = utcnow()
    return Milestone(
        pilot_id=pilot.id,
        seq=seq,
        title="Installation complete",
        deliverable="Sensors installed on the nominated district metering areas.",
        evidence_required="Installation report, photographs and the commissioning checklist.",
        amount_paise=7_50_000,
        due_date=due_date or (now + timedelta(days=14)),
        state=state,
        state_entered_at=now,
        sla_due_at=sla_due_at,
    )


def _kinds(tasks) -> set[str]:
    return {task.kind for task in tasks}


# --- Department officer --------------------------------------------------


async def test_the_officer_sees_a_draft_they_own_and_not_one_they_do_not(session):
    world = await _base(session, "OFFDRAFT")
    mine = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Draft"
    )
    colleague = await make_user(
        session,
        email="offdraft.colleague@test.invalid",
        roles=[("DO", "department", world["department"].id)],
        department_id=world["department"].id,
    )
    theirs = await make_challenge(
        session,
        department=world["department"],
        officer=colleague,
        state="Draft",
        title="A colleague's draft",
    )

    tasks = await inbox_service.build(session, principal_of(world["officer"]))
    drafts = [t for t in tasks if t.kind == "challenge_draft"]
    assert [t.entity_id for t in drafts] == [mine.id]
    assert theirs.id not in {t.entity_id for t in tasks}


async def test_a_returned_challenge_carries_the_approver_comments(session):
    world = await _base(session, "OFFRET")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Draft"
    )
    challenge.return_comments = "The baseline method is not stated for the primary measure."
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["officer"]))
    returned = next(t for t in tasks if t.kind == "challenge_returned")
    assert "baseline method" in returned.detail
    assert returned.action_label == "Revise and resubmit"
    # A returned challenge outranks an ordinary draft.
    assert returned.priority < next(t for t in tasks if t.kind == "challenge_draft").priority


async def test_an_unanswered_question_past_the_cutoff_is_overdue_and_sorts_first(session):
    world = await _base(session, "OFFCLAR")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Published"
    )
    challenge.clarification_cutoff = utcnow() - timedelta(days=1)
    session.add(
        Clarification(
            challenge_id=challenge.id,
            asked_by=world["founder"].id,
            question="Are the bulk meters already telemetered, or is that part of the scope?",
        )
    )
    answered = Clarification(
        challenge_id=challenge.id,
        asked_by=world["founder"].id,
        question="What is the pilot duration?",
        answer="Eight weeks, as stated in the challenge.",
        published_at=utcnow(),
    )
    session.add(answered)
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["officer"]))
    questions = [t for t in tasks if t.kind == "answer_clarification"]
    assert len(questions) == 1
    assert questions[0].overdue is True
    assert tasks[0].kind == "answer_clarification"


async def test_the_officer_is_asked_to_screen_run_the_simulator_and_accept_milestones(session):
    world = await _base(session, "OFFWORK")
    closed = await make_challenge(
        session,
        department=world["department"],
        officer=world["officer"],
        state="ApplicationsClosed",
        title="Closed challenge",
    )
    designing = await make_challenge(
        session,
        department=world["department"],
        officer=world["officer"],
        state="PilotDesign",
        title="Challenge in pilot design",
    )
    application = await _application(session, world, designing)
    pilot = await _pilot(session, world, designing, application, state=PilotState.ACTIVE)
    session.add(_milestone(pilot, state=MilestoneState.SUBMITTED, sla_due_at=utcnow() - timedelta(days=2)))
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["officer"]))
    assert {"screen_applications", "design_pilot", "accept_milestone"} <= _kinds(tasks)
    assert next(t for t in tasks if t.kind == "screen_applications").entity_id == closed.id
    accept = next(t for t in tasks if t.kind == "accept_milestone")
    assert accept.overdue is True
    assert accept.priority == 0


async def test_a_completed_pilot_asks_for_the_analysis_until_a_report_exists(session):
    world = await _base(session, "OFFEV")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="EvidenceReview"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.COMPLETED)
    await session.flush()

    before = await inbox_service.build(session, principal_of(world["officer"]))
    assert "run_evidence" in _kinds(before)

    session.add(
        EvidenceReport(
            pilot_id=pilot.id,
            reference="EV-1",
            dataset_hash="a" * 64,
            seed=1,
            engine_version="1.0.0",
            status=EvidenceStatus.AWAITING_VALIDATION,
            generated_by=world["officer"].id,
        )
    )
    await session.flush()

    after = await inbox_service.build(session, principal_of(world["officer"]))
    assert "run_evidence" not in _kinds(after)


# --- Department approver -------------------------------------------------


async def test_the_approver_is_asked_to_approve_shortlist_and_release_payment(session):
    world = await _base(session, "APPR")
    review = await make_challenge(
        session,
        department=world["department"],
        officer=world["officer"],
        state="InReview",
        title="Awaiting approval",
    )
    shortlisting = await make_challenge(
        session,
        department=world["department"],
        officer=world["officer"],
        state="Shortlisted",
        title="Awaiting shortlist confirmation",
    )
    application = await _application(session, world, shortlisting)
    pilot = await _pilot(session, world, shortlisting, application, state=PilotState.AGREEMENT_DRAFT)
    session.add(
        AgreementVersion(
            pilot_id=pilot.id,
            number=1,
            body={"clauses": [{"title": "Scope", "text": "The agreed pilot terms."}]},
            ip_option="startup_retains",
            drafted_by=world["officer"].id,
        )
    )
    session.add(_milestone(pilot, state=MilestoneState.ACCEPTED, sla_due_at=utcnow() + timedelta(days=3)))
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["approver"]))
    assert _kinds(tasks) == {
        "approve_challenge",
        "confirm_shortlist",
        "approve_agreement",
        "approve_payment",
    }
    assert next(t for t in tasks if t.kind == "approve_challenge").entity_id == review.id
    assert next(t for t in tasks if t.kind == "approve_payment").overdue is False


async def test_the_scale_decision_appears_once_and_disappears_when_recorded(session):
    world = await _base(session, "SCALE")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="DecisionPending"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.COMPLETED)
    report = EvidenceReport(
        pilot_id=pilot.id,
        reference="EV-SCALE",
        dataset_hash="d" * 64,
        seed=3,
        engine_version="1.0.0",
        status=EvidenceStatus.SIGNED_OFF,
        generated_by=world["officer"].id,
    )
    session.add(report)
    await session.flush()

    before = await inbox_service.build(session, principal_of(world["approver"]))
    assert "scale_decision" in _kinds(before)

    session.add(
        ScaleDecision(
            pilot_id=pilot.id,
            evidence_report_id=report.id,
            decision="Scale",
            reason="The pre-registered analysis met the pass mark with a strong band.",
            decided_by=world["approver"].id,
            decided_at=utcnow(),
        )
    )
    await session.flush()

    after = await inbox_service.build(session, principal_of(world["approver"]))
    assert "scale_decision" not in _kinds(after)


# --- Finance officer -----------------------------------------------------


async def test_finance_sees_only_payments_approved_for_release(session):
    world = await _base(session, "FIN")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="PilotActive"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.ACTIVE)
    session.add(_milestone(pilot, state=MilestoneState.ACCEPTED, seq=1))
    session.add(
        _milestone(
            pilot,
            state=MilestoneState.PAYMENT_APPROVED,
            seq=2,
            sla_due_at=utcnow() - timedelta(days=1),
        )
    )
    session.add(_milestone(pilot, state=MilestoneState.PAID, seq=3))
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["finance"]))
    assert _kinds(tasks) == {"record_release"}
    assert tasks[0].overdue is True
    assert tasks[0].role == Role.FINANCE_OFFICER
    assert tasks[0].link == "/finance/queue"


async def test_a_payment_in_another_department_is_not_shown(session):
    world = await _base(session, "FINSCOPE")
    other = await make_department(session, code="FINSCOPE-OTHER", name="Another Department")
    other_officer = await make_user(
        session,
        email="finscope.other@test.invalid",
        roles=[("DO", "department", other.id)],
        department_id=other.id,
    )
    challenge = await make_challenge(session, department=other, officer=other_officer, state="PilotActive")
    application = Application(
        reference="AP-OTHERDEPT",
        challenge_id=challenge.id,
        startup_id=world["startup"].id,
        created_by=world["founder"].id,
        state=ApplicationState.SHORTLISTED,
        pilot_cost_paise=30_00_000,
        timeline_weeks=8,
        ip_declaration="startup_retains",
        conflict_declaration=True,
    )
    session.add(application)
    await session.flush()
    pilot = Pilot(
        reference="PL-OTHERDEPT",
        application_id=application.id,
        challenge_id=challenge.id,
        startup_id=world["startup"].id,
        department_id=other.id,
        state=PilotState.ACTIVE,
    )
    session.add(pilot)
    await session.flush()
    session.add(_milestone(pilot, state=MilestoneState.PAYMENT_APPROVED))
    await session.flush()

    assert await inbox_service.build(session, principal_of(world["finance"])) == []


# --- Startup user --------------------------------------------------------


async def test_a_draft_application_past_the_deadline_is_overdue(session):
    world = await _base(session, "SUDRAFT")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Published"
    )
    challenge.application_deadline = utcnow() - timedelta(hours=2)
    await _application(session, world, challenge, state=ApplicationState.DRAFT)
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["founder"]))
    draft = next(t for t in tasks if t.kind == "submit_application")
    assert draft.overdue is True
    assert draft.priority == 0
    assert "to the second" in draft.detail


async def test_an_open_eligibility_clarification_window_is_shown_and_a_closed_one_is_not(session):
    world = await _base(session, "SUELIG")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Evaluation"
    )
    application = await _application(session, world, challenge, state=ApplicationState.SCREENED)
    result = EligibilityResult(
        application_id=application.id,
        outcome=EligibilityOutcome.INELIGIBLE,
        rule_results=[{"rule": "turnover", "passed": False}],
        relaxations_applied=[],
        screened_at=utcnow(),
        clarification_window_ends=utcnow() + timedelta(days=2),
    )
    session.add(result)
    await session.flush()

    open_window = await inbox_service.build(session, principal_of(world["founder"]))
    assert "eligibility_clarification" in _kinds(open_window)

    result.clarification_window_ends = utcnow() - timedelta(minutes=1)
    await session.flush()

    closed_window = await inbox_service.build(session, principal_of(world["founder"]))
    assert "eligibility_clarification" not in _kinds(closed_window)


async def test_the_agreement_task_names_the_cybersecurity_checklist_while_it_is_outstanding(session):
    world = await _base(session, "SUAGREE")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="PilotDesign"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.AWAITING_STARTUP)
    await session.flush()

    outstanding = await inbox_service.build(session, principal_of(world["founder"]))
    accept = next(t for t in outstanding if t.kind == "accept_agreement")
    assert "cybersecurity checklist" in accept.detail

    pilot.cyber_completed_at = utcnow()
    await session.flush()

    done = await inbox_service.build(session, principal_of(world["founder"]))
    assert "cybersecurity" not in next(t for t in done if t.kind == "accept_agreement").detail


async def test_an_active_pilot_asks_for_measurements_at_the_frozen_frequency(session):
    world = await _base(session, "SUMETRIC")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="PilotActive"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.ACTIVE)
    session.add(
        PilotDesign(
            pilot_id=pilot.id,
            primary_kpi_id=challenge.kpis[0].id,
            duration_weeks=8,
            units=12,
            measurements_per_week=2,
            pass_mark=26.0,
            analysis_method="paired_t",
            alpha=0.05,
            baseline_mean=32.0,
            baseline_sd=8.0,
            claimed_effect=-8.0,
            comparison_units=0,
            frozen_at=utcnow(),
            frozen_by=world["officer"].id,
        )
    )
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["founder"]))
    metrics = next(t for t in tasks if t.kind == "submit_metrics")
    assert "2 time(s) per week" in metrics.detail


async def test_a_rejected_milestone_asks_for_a_resubmission_and_names_the_gap(session):
    world = await _base(session, "SUMILE")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="PilotActive"
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.ACTIVE)
    session.add(_milestone(pilot, state=MilestoneState.PENDING, seq=1))
    rejected = _milestone(
        pilot, state=MilestoneState.REJECTED, seq=2, due_date=utcnow() - timedelta(days=3)
    )
    rejected.unmet_requirement = "The commissioning checklist was not attached."
    session.add(rejected)
    await session.flush()

    tasks = await inbox_service.build(session, principal_of(world["founder"]))
    submissions = [t for t in tasks if t.kind == "submit_milestone"]
    assert len(submissions) == 2
    resubmit = next(t for t in submissions if t.title.startswith("Resubmit"))
    assert "commissioning checklist" in resubmit.detail
    assert resubmit.overdue is True
    assert resubmit.priority == 0


# --- Evaluator and validator ---------------------------------------------


async def _panel_world(session) -> dict[str, Any]:
    world = await _base(session, "PANEL")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Evaluation"
    )
    evaluator = await make_user(session, email="panel.evaluator@test.invalid", name="Evaluator One")
    session.add(
        PanelMember(
            challenge_id=challenge.id,
            user_id=evaluator.id,
            role=Role.EXPERT_EVALUATOR,
            assigned_by=world["officer"].id,
        )
    )
    application = await _application(session, world, challenge, state=ApplicationState.SCREENED)
    session.add(
        EligibilityResult(
            application_id=application.id,
            outcome=EligibilityOutcome.ELIGIBLE,
            rule_results=[],
            relaxations_applied=[],
            screened_at=utcnow(),
        )
    )
    await session.flush()
    world["challenge"] = challenge
    world["evaluator"] = evaluator
    world["application"] = application
    return world


def _as_evaluator(world) -> Principal:
    """An evaluator's principal carries the challenge-scoped role granted at assignment."""
    principal = principal_of(world["evaluator"])
    principal.scoped_roles.append(
        ScopedRole(
            role=Role.EXPERT_EVALUATOR, scope_type="challenge", scope_id=world["challenge"].id
        )
    )
    return principal


async def test_the_evaluator_is_asked_to_score_what_is_still_outstanding(session):
    world = await _panel_world(session)
    evaluator = _as_evaluator(world)

    tasks = await inbox_service.build(session, evaluator)
    scoring = next(t for t in tasks if t.kind == "score_applications")
    assert "Score 1 application(s)" in scoring.title
    assert scoring.link == "/evaluation/" + world["challenge"].id


async def test_a_declared_conflict_removes_the_application_from_the_evaluator_inbox(session):
    world = await _panel_world(session)
    evaluator = _as_evaluator(world)
    session.add(
        CoiDeclaration(
            user_id=world["evaluator"].id,
            application_id=world["application"].id,
            has_conflict=True,
            statement="I advised this startup on the product described.",
            declared_at=utcnow(),
        )
    )
    await session.flush()

    assert "score_applications" not in _kinds(await inbox_service.build(session, evaluator))


async def test_scoring_everything_clears_the_evaluator_inbox(session):
    world = await _panel_world(session)
    evaluator = _as_evaluator(world)
    await evaluation_service.declare_conflict(
        session, world["application"], evaluator, has_conflict=False, statement=""
    )
    await evaluation_service.submit_scores(
        session,
        world["application"],
        world["challenge"],
        evaluator,
        scores=[
            {
                "criterion_id": criterion.id,
                "score": 4,
                "justification": "Scored against the anchor text for this criterion.",
            }
            for criterion in world["challenge"].criteria
        ],
    )

    assert "score_applications" not in _kinds(await inbox_service.build(session, evaluator))


async def test_the_validator_is_asked_only_when_a_report_awaits_validation(session):
    world = await _base(session, "VALID")
    other = await make_department(session, code="VALID-OTHER", name="External Body")
    validator = await make_user(
        session,
        email="valid.validator@test.invalid",
        name="Dr Anjali Rao",
        department_id=other.id,
    )
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="EvidenceReview"
    )
    session.add(
        PanelMember(
            challenge_id=challenge.id,
            user_id=validator.id,
            role=Role.INDEPENDENT_VALIDATOR,
            assigned_by=world["officer"].id,
        )
    )
    application = await _application(session, world, challenge)
    pilot = await _pilot(session, world, challenge, application, state=PilotState.COMPLETED)
    await session.flush()

    principal = principal_of(validator)
    principal.scoped_roles.append(
        ScopedRole(role=Role.INDEPENDENT_VALIDATOR, scope_type="challenge", scope_id=challenge.id)
    )

    assert await inbox_service.build(session, principal) == []

    report = EvidenceReport(
        pilot_id=pilot.id,
        reference="EV-VALID",
        dataset_hash="c" * 64,
        seed=7,
        engine_version="1.0.0",
        status=EvidenceStatus.DRAFT,
        generated_by=world["officer"].id,
    )
    session.add(report)
    await session.flush()
    assert await inbox_service.build(session, principal) == []

    report.status = EvidenceStatus.AWAITING_VALIDATION
    await session.flush()

    tasks = await inbox_service.build(session, principal)
    assert [t.kind for t in tasks] == ["validate_evidence"]
    assert tasks[0].entity_id == report.id
    assert tasks[0].link == "/validation/" + report.id


# --- Shape and ordering --------------------------------------------------


async def test_an_inbox_with_nothing_waiting_is_empty(session):
    world = await _base(session, "EMPTY")
    assert await inbox_service.build(session, principal_of(world["approver"])) == []
    assert await inbox_service.build(session, principal_of(world["founder"])) == []


async def test_every_task_is_serialisable_and_carries_a_link_and_an_action(session):
    world = await _base(session, "SHAPE")
    challenge = await make_challenge(
        session, department=world["department"], officer=world["officer"], state="Draft"
    )
    assert challenge.id

    tasks = await inbox_service.build(session, principal_of(world["officer"]))
    assert tasks
    for task in tasks:
        row = task.to_dict()
        assert row["link"].startswith("/")
        assert row["action_label"]
        assert row["detail"]
        assert row["entity_type"] and row["entity_id"]
        assert row["role"] in {str(r) for r in Role}


async def test_the_limit_caps_the_list(session):
    world = await _base(session, "LIMIT")
    for index in range(4):
        await make_challenge(
            session,
            department=world["department"],
            officer=world["officer"],
            state="InReview",
            title="Challenge " + str(index),
        )
    await session.flush()

    assert len(await inbox_service.build(session, principal_of(world["approver"]))) == 4
    assert len(await inbox_service.build(session, principal_of(world["approver"]), limit=2)) == 2

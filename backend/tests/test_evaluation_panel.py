"""Expert evaluation rules (PRD 5.5, FR-EV-01 to FR-EV-07).

The properties under test are the ones that make an evaluation defensible after the fact:
a panel large enough to disagree, a validator with no stake in the outcome, a declared
conflict before any score is entered, a written justification behind every number, and a
lock that cannot be lifted silently.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from factories import make_challenge, make_department, make_startup, make_user, principal_of

from app.core.clock import utcnow
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.domain.states import ApplicationState, EligibilityOutcome, Role
from app.models.application import Application, EligibilityResult
from app.models.evaluation import PanelMember
from app.models.identity import RoleAssignment
from app.services import evaluation as evaluation_service


async def _world(session, *, applications: int = 3) -> dict[str, Any]:
    department = await make_department(session, code="EVAL-DEPT")
    other_department = await make_department(
        session, code="EVAL-OTHER", name="Neighbouring Department"
    )
    officer = await make_user(
        session,
        email="eval.officer@test.invalid",
        name="Anita Deshmukh",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    approver = await make_user(
        session,
        email="eval.approver@test.invalid",
        name="Ramesh Kulkarni",
        roles=[("DA", "department", department.id)],
        department_id=department.id,
    )
    evaluators = [
        await make_user(
            session,
            email="eval.panel" + str(index) + "@test.invalid",
            name="Evaluator " + str(index),
        )
        for index in range(3)
    ]
    validator = await make_user(
        session,
        email="eval.validator@test.invalid",
        name="Dr Anjali Rao",
        department_id=other_department.id,
    )
    insider = await make_user(
        session,
        email="eval.insider@test.invalid",
        name="Department Insider",
        department_id=department.id,
    )

    challenge = await make_challenge(
        session, department=department, officer=officer, state="Evaluation"
    )

    records: list[Application] = []
    for index in range(applications):
        startup = await make_startup(session, index=index + 1)
        founder = await make_user(
            session,
            email="eval.founder" + str(index) + "@test.invalid",
            name="Founder " + str(index),
            roles=[("SU", "startup", startup.id)],
            startup_id=startup.id,
        )
        application = Application(
            reference="AP-EVAL-" + str(index),
            challenge_id=challenge.id,
            startup_id=startup.id,
            created_by=founder.id,
            state=ApplicationState.SCREENED,
            proposal_summary=(
                "Acoustic leak detection across the nominated district metering areas, with "
                "a hydraulic model that localises the loss to a street segment."
            ),
            approach=(
                "Sensors are installed on the existing network, correlated nightly, and the "
                "resulting work orders are issued through the existing works register."
            ),
            pilot_cost_paise=30_00_000 + index * 1_00_000,
            timeline_weeks=8,
            ip_declaration="startup_retains",
            conflict_declaration=True,
            data_declaration="No personal identifiers leave the department network.",
            kpi_commitments=[
                {"kpi_id": challenge.kpis[0].id, "committed_value": 24.0 + index}
            ],
            submitted_at=utcnow() - timedelta(days=2),
        )
        session.add(application)
        await session.flush()
        session.add(
            EligibilityResult(
                application_id=application.id,
                outcome=EligibilityOutcome.ELIGIBLE,
                rule_results=[{"rule": "dpiit", "passed": True}],
                relaxations_applied=[],
                screened_at=utcnow() - timedelta(days=1),
            )
        )
        records.append(application)
    await session.flush()

    return {
        "department": department,
        "other_department": other_department,
        "challenge": challenge,
        "officer": officer,
        "approver": approver,
        "evaluators": evaluators,
        "validator": validator,
        "insider": insider,
        "applications": records,
    }


async def _assign(session, world) -> list[PanelMember]:
    return await evaluation_service.assign_panel(
        session,
        world["challenge"],
        principal_of(world["officer"]),
        evaluator_ids=[e.id for e in world["evaluators"]],
        validator_ids=[world["validator"].id],
    )


def _sheet(challenge, value: int) -> list[dict[str, Any]]:
    return [
        {
            "criterion_id": criterion.id,
            "score": value,
            "justification": "Scored against the anchor text for this criterion.",
        }
        for criterion in challenge.criteria
        if criterion.round_number == 1
    ]


# --- Panel composition ---------------------------------------------------


async def test_a_panel_below_the_minimum_size_is_refused(session):
    world = await _world(session)
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.assign_panel(
            session,
            world["challenge"],
            principal_of(world["officer"]),
            evaluator_ids=[world["evaluators"][0].id, world["evaluators"][1].id],
            validator_ids=[world["validator"].id],
        )
    problem = excinfo.value.to_problem()
    assert problem["errors"][0]["field"] == "evaluator_ids"
    assert problem["errors"][0]["fix"]


async def test_the_same_person_cannot_evaluate_and_validate(session):
    world = await _world(session)
    shared = world["evaluators"][0]
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.assign_panel(
            session,
            world["challenge"],
            principal_of(world["officer"]),
            evaluator_ids=[e.id for e in world["evaluators"]],
            validator_ids=[shared.id],
        )
    assert excinfo.value.to_problem()["errors"][0]["field"] == "validator_ids"


async def test_a_validator_from_the_owning_department_is_refused(session):
    """Independence is structural, not a matter of assertion (PRD 3.1)."""
    world = await _world(session)
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.assign_panel(
            session,
            world["challenge"],
            principal_of(world["officer"]),
            evaluator_ids=[e.id for e in world["evaluators"]],
            validator_ids=[world["insider"].id],
        )
    assert "owning department" in excinfo.value.to_problem()["errors"][0]["detail"]


async def test_an_unknown_panel_member_is_refused(session):
    world = await _world(session)
    with pytest.raises(NotFound):
        await evaluation_service.assign_panel(
            session,
            world["challenge"],
            principal_of(world["officer"]),
            evaluator_ids=[world["evaluators"][0].id, world["evaluators"][1].id, "no-such-user"],
            validator_ids=[world["validator"].id],
        )


async def test_assignment_grants_a_challenge_scoped_role_and_repeats_cleanly(session):
    world = await _world(session)
    first = await _assign(session, world)
    assert len(first) == 4

    scoped = await evaluation_service.panel(session, world["challenge"].id, Role.EXPERT_EVALUATOR)
    assert len(scoped) == 3

    roles = (
        await session.execute(
            RoleAssignment.__table__.select().where(
                RoleAssignment.scope_type == "challenge",
                RoleAssignment.scope_id == world["challenge"].id,
            )
        )
    ).all()
    assert len(roles) == 4

    # Reassigning the same panel must not duplicate members or role grants.
    await _assign(session, world)
    again = await evaluation_service.panel(session, world["challenge"].id)
    assert len(again) == 4
    roles_again = (
        await session.execute(
            RoleAssignment.__table__.select().where(
                RoleAssignment.scope_type == "challenge",
                RoleAssignment.scope_id == world["challenge"].id,
            )
        )
    ).all()
    assert len(roles_again) == 4


# --- Conflict of interest ------------------------------------------------


async def test_scoring_without_a_conflict_declaration_is_refused(session):
    world = await _world(session)
    await _assign(session, world)
    evaluator = principal_of(world["evaluators"][0])
    with pytest.raises(Forbidden) as excinfo:
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            evaluator,
            scores=_sheet(world["challenge"], 4),
        )
    assert "conflict of interest" in str(excinfo.value.detail)


async def test_a_declared_conflict_blocks_scoring(session):
    world = await _world(session)
    await _assign(session, world)
    evaluator = principal_of(world["evaluators"][0])
    await evaluation_service.declare_conflict(
        session,
        world["applications"][0],
        evaluator,
        has_conflict=True,
        statement="I advised this startup on the product described in the proposal.",
    )
    with pytest.raises(Forbidden):
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            evaluator,
            scores=_sheet(world["challenge"], 4),
        )


async def test_a_declared_conflict_must_be_described(session):
    world = await _world(session)
    await _assign(session, world)
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.declare_conflict(
            session,
            world["applications"][0],
            principal_of(world["evaluators"][0]),
            has_conflict=True,
            statement="   ",
        )
    assert excinfo.value.to_problem()["errors"][0]["field"] == "statement"


async def test_a_declaration_can_be_corrected_in_place(session):
    world = await _world(session)
    await _assign(session, world)
    evaluator = principal_of(world["evaluators"][0])
    application = world["applications"][0]

    await evaluation_service.declare_conflict(
        session,
        application,
        evaluator,
        has_conflict=True,
        statement="I sat on an advisory board with the founder.",
    )
    await evaluation_service.declare_conflict(
        session, application, evaluator, has_conflict=False, statement=""
    )
    record = await evaluation_service.conflict_declaration(
        session, application.id, evaluator.user_id
    )
    assert record is not None
    assert record.has_conflict is False


# --- Scoring -------------------------------------------------------------


async def _declare_all(session, world) -> None:
    for evaluator in world["evaluators"]:
        for application in world["applications"]:
            await evaluation_service.declare_conflict(
                session, application, principal_of(evaluator), has_conflict=False, statement=""
            )


async def test_a_partial_sheet_is_refused_with_the_missing_criteria_named(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    sheet = _sheet(world["challenge"], 4)[:1]
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            principal_of(world["evaluators"][0]),
            scores=sheet,
        )
    problem = excinfo.value.to_problem()
    assert len(problem["errors"]) == len(world["challenge"].criteria) - 1
    assert all(error["fix"] for error in problem["errors"])


async def test_a_score_outside_the_anchored_scale_is_refused(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    sheet = _sheet(world["challenge"], 4)
    sheet[0]["score"] = 7
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            principal_of(world["evaluators"][0]),
            scores=sheet,
        )
    assert excinfo.value.to_problem()["errors"][0]["field"] == "score"


async def test_a_score_without_a_justification_is_refused(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    sheet = _sheet(world["challenge"], 4)
    sheet[1]["justification"] = "good"
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            principal_of(world["evaluators"][0]),
            scores=sheet,
        )
    assert "justification" in excinfo.value.to_problem()["errors"][0]["detail"]


async def test_a_complete_sheet_is_saved_and_can_be_corrected_before_locking(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    application = world["applications"][0]
    evaluator = principal_of(world["evaluators"][0])

    saved = await evaluation_service.submit_scores(
        session, application, world["challenge"], evaluator, scores=_sheet(world["challenge"], 4)
    )
    assert len(saved) == len(world["challenge"].criteria)
    assert application.state == ApplicationState.UNDER_EVALUATION

    corrected = await evaluation_service.submit_scores(
        session, application, world["challenge"], evaluator, scores=_sheet(world["challenge"], 5)
    )
    assert len(corrected) == len(saved)
    assert {record.score for record in corrected} == {5}

    progress = await evaluation_service.evaluator_progress(
        session, world["challenge"].id, evaluator.user_id
    )
    assert progress["total"] == 3
    assert progress["scored"] == 1
    assert progress["pending"] == 2
    assert progress["declared"] == 3


async def test_scoring_a_round_with_no_rubric_is_refused(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    with pytest.raises(ValidationFailed):
        await evaluation_service.submit_scores(
            session,
            world["applications"][0],
            world["challenge"],
            principal_of(world["evaluators"][0]),
            scores=_sheet(world["challenge"], 4),
            round_number=9,
        )


# --- Locking and reopening -----------------------------------------------


async def test_a_locked_score_cannot_be_edited_until_the_approver_reopens_it(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    application = world["applications"][0]
    evaluator = principal_of(world["evaluators"][0])
    await evaluation_service.submit_scores(
        session, application, world["challenge"], evaluator, scores=_sheet(world["challenge"], 4)
    )

    locked = await evaluation_service.lock_scores(
        session, world["challenge"], principal_of(world["officer"]), reason="Deadline reached."
    )
    assert locked == len(world["challenge"].criteria)

    with pytest.raises(Forbidden) as excinfo:
        await evaluation_service.submit_scores(
            session,
            application,
            world["challenge"],
            evaluator,
            scores=_sheet(world["challenge"], 2),
        )
    assert "reopen" in str(excinfo.value.detail)

    with pytest.raises(ValidationFailed):
        await evaluation_service.reopen_scores(
            session, world["challenge"], principal_of(world["approver"]), "  "
        )

    reopened = await evaluation_service.reopen_scores(
        session,
        world["challenge"],
        principal_of(world["approver"]),
        "An evaluator reported a transcription error on the cost criterion.",
    )
    assert reopened == locked

    after = await evaluation_service.submit_scores(
        session, application, world["challenge"], evaluator, scores=_sheet(world["challenge"], 2)
    )
    assert {record.score for record in after} == {2}


# --- Ranking and shortlist -----------------------------------------------


async def _score_everything(session, world) -> None:
    await _declare_all(session, world)
    # Application 0 is scored highest and unanimously; applications 1 and 2 tie on the
    # weighted score but application 1 has a split panel.
    plan = [
        [5, 5, 5],
        [4, 2, 3],
        [3, 3, 3],
    ]
    for index, application in enumerate(world["applications"]):
        for position, evaluator in enumerate(world["evaluators"]):
            await evaluation_service.submit_scores(
                session,
                application,
                world["challenge"],
                principal_of(evaluator),
                scores=_sheet(world["challenge"], plan[index][position]),
            )


async def test_the_ranking_orders_by_weighted_score_and_flags_a_split_panel(session):
    world = await _world(session)
    await _assign(session, world)
    await _score_everything(session, world)

    ordered = await evaluation_service.ranking(session, world["challenge"])
    assert [row["rank"] for row in ordered] == [1, 2, 3]
    assert ordered[0]["application_id"] == world["applications"][0].id
    assert ordered[0]["weighted_score"] == 100.0
    assert ordered[0]["complete"] is True
    assert ordered[0]["flags"] == []
    assert all(row["blind_label"].startswith("Applicant ") for row in ordered)

    # The tie between the mean-3 applications is broken by the lower disagreement.
    tied = [row for row in ordered if row["weighted_score"] == 50.0]
    assert len(tied) == 2
    assert tied[0]["application_id"] == world["applications"][2].id
    assert tied[0]["disagreement"] < tied[1]["disagreement"]
    assert any("differ by" in flag for flag in tied[1]["flags"])


async def test_an_incomplete_panel_is_reported_as_incomplete(session):
    world = await _world(session)
    await _assign(session, world)
    await _declare_all(session, world)
    await evaluation_service.submit_scores(
        session,
        world["applications"][0],
        world["challenge"],
        principal_of(world["evaluators"][0]),
        scores=_sheet(world["challenge"], 4),
    )
    ordered = await evaluation_service.ranking(session, world["challenge"])
    top = next(row for row in ordered if row["application_id"] == world["applications"][0].id)
    assert top["complete"] is False
    assert any("1 of 3 evaluators" in flag for flag in top["flags"])


async def test_confirming_the_shortlist_ranks_the_chosen_and_closes_the_rest(session):
    world = await _world(session)
    await _assign(session, world)
    await _score_everything(session, world)

    chosen = [world["applications"][0].id, world["applications"][2].id]
    selected = await evaluation_service.confirm_shortlist(
        session, world["challenge"], principal_of(world["approver"]), application_ids=chosen
    )
    assert [a.shortlist_rank for a in selected] == [1, 2]
    assert all(a.state == ApplicationState.SHORTLISTED for a in selected)
    assert world["applications"][1].state == ApplicationState.NOT_SHORTLISTED


async def test_an_empty_shortlist_is_refused(session):
    world = await _world(session)
    await _assign(session, world)
    with pytest.raises(ValidationFailed) as excinfo:
        await evaluation_service.confirm_shortlist(
            session, world["challenge"], principal_of(world["approver"]), application_ids=[]
        )
    assert excinfo.value.to_problem()["errors"][0]["field"] == "application_ids"


async def test_an_application_from_another_challenge_cannot_be_shortlisted(session):
    world = await _world(session)
    await _assign(session, world)
    with pytest.raises(NotFound):
        await evaluation_service.confirm_shortlist(
            session,
            world["challenge"],
            principal_of(world["approver"]),
            application_ids=["not-on-this-challenge"],
        )


# --- Blind view ----------------------------------------------------------


async def test_the_blind_view_carries_the_proposal_and_not_the_applicant(session):
    world = await _world(session)
    application = world["applications"][0]
    view = evaluation_service.blind_view(application, 0)

    assert view["blind_label"] == "Applicant A"
    assert view["proposal_summary"] == application.proposal_summary
    assert "startup_id" not in view
    assert "reference" not in view
    serialised = str(view)
    assert application.startup_id not in serialised
    assert application.reference not in serialised

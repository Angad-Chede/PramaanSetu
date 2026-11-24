"""Evidence Engine behaviour (PRD 5.10, 11.2).

The property under test is pre-registration: the analysis that runs is the one frozen
before any data existed, and a departure forced by missing data is recorded rather than
quietly substituted.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from factories import make_challenge, make_department, make_startup, make_user, principal_of

from app.core.clock import utcnow
from app.core.errors import Forbidden, ValidationFailed
from app.domain.states import EvidenceStatus
from app.models.application import Application
from app.models.pilot import MetricSubmission
from app.services import evidence as evidence_service
from app.services import pilots as pilots_service


async def _pilot_with_data(
    session,
    *,
    analysis_method: str = "paired_t",
    with_comparison: bool = False,
    units: int = 12,
    weeks: int = 6,
    baseline: float = 32.0,
    effect: float = -6.0,
    code: str = "EV",
):
    department = await make_department(session, code=code)
    officer = await make_user(
        session,
        email=code.lower() + ".officer@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    startup = await make_startup(session)
    startup_user = await make_user(
        session,
        email=code.lower() + ".startup@test.invalid",
        roles=[("SU", "startup", startup.id)],
        startup_id=startup.id,
    )
    challenge = await make_challenge(
        session, department=department, officer=officer, state="PilotDesign"
    )
    application = Application(
        reference="AP-" + code,
        challenge_id=challenge.id,
        startup_id=startup.id,
        created_by=startup_user.id,
        state="Shortlisted",
        pilot_cost_paise=3_000_000,
        timeline_weeks=8,
        ip_declaration="startup_retains",
        conflict_declaration=True,
        kpi_commitments=[{"kpi_id": challenge.kpis[0].id, "committed_value": 24.0}],
    )
    session.add(application)
    await session.flush()

    principal = principal_of(officer)
    pilot = await pilots_service.create_for_application(session, application, challenge, principal)
    primary = challenge.primary_kpi

    await pilots_service.freeze_design(
        session,
        pilot,
        principal,
        simulation_run_id=None,
        primary_kpi_id=primary.id,
        duration_weeks=weeks,
        units=units,
        measurements_per_week=1,
        pass_mark=26.0,
        analysis_method=analysis_method,
        alpha=0.05,
        baseline_mean=baseline,
        baseline_sd=8.0,
        claimed_effect=-8.0,
        comparison_units=units if with_comparison else 0,
    )

    start = utcnow() - timedelta(weeks=weeks * 2)
    rows: list[MetricSubmission] = []

    def add(phase: str, arm: str, mean: float) -> None:
        for unit in range(units):
            for week in range(weeks):
                period = start + timedelta(weeks=week + (0 if phase == "baseline" else weeks))
                rows.append(
                    MetricSubmission(
                        pilot_id=pilot.id,
                        kpi_id=primary.id,
                        unit_ref=arm[:1] + "-" + str(unit).zfill(2),
                        period_start=period,
                        period_end=period + timedelta(days=7),
                        phase=phase,
                        arm=arm,
                        value=mean + (unit % 5) - 2 + (week % 3) * 0.3,
                        source="form",
                        status="Accepted",
                        submitted_by=startup_user.id,
                    )
                )

    add("baseline", "treatment", baseline)
    add("pilot", "treatment", baseline + effect)
    if with_comparison:
        add("baseline", "comparison", baseline)
        add("pilot", "comparison", baseline - 1.0)

    for row in rows:
        session.add(row)
    await session.flush()
    await session.commit()
    return {"pilot": pilot, "principal": principal, "challenge": challenge, "startup_user": startup_user}


async def test_the_frozen_method_is_the_method_that_runs(session):
    """A rate measure with a frozen paired test runs the paired test, not a rate test."""
    setup = await _pilot_with_data(session, analysis_method="paired_t", code="PAIRED")
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    assert report.analysis["method"] in ("paired_t", "wilcoxon")
    assert report.analysis["method"] != "two_proportion"


async def test_a_frozen_rate_test_runs_the_rate_test(session):
    setup = await _pilot_with_data(session, analysis_method="two_proportion", code="RATE")
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    assert report.analysis["method"] == "two_proportion"


async def test_a_comparison_design_with_comparison_data_runs_the_comparison_test(session):
    setup = await _pilot_with_data(
        session, analysis_method="welch_did", with_comparison=True, code="DID"
    )
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    assert report.analysis["method"] == "welch_did"
    assert report.analysis["n_comparison"] > 0
    assert not any(d.get("source") == "evidence_engine" for d in report.deviations)


async def test_a_comparison_design_without_comparison_data_records_the_departure(session):
    """The engine does not quietly substitute a different analysis (PRD 11.2)."""
    setup = await _pilot_with_data(
        session, analysis_method="welch_did", with_comparison=False, code="NODID"
    )
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])

    assert report.analysis["method"] in ("paired_t", "wilcoxon")
    forced = [d for d in report.deviations if d.get("source") == "evidence_engine"]
    assert len(forced) == 1
    assert not forced[0]["approved"]
    assert "no comparison data" in forced[0]["description"]
    assert any("no comparison data" in limitation for limitation in report.limitations)

    protocol = next(c for c in report.components["components"] if c["code"] == "P")
    assert protocol["points"] == 10.0  # 15 less 5 for one unapproved deviation


async def test_a_rerun_on_the_same_data_reproduces_the_result(session):
    setup = await _pilot_with_data(session, code="RERUN")
    first = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    first_analysis = dict(first.analysis)
    first_hash = first.dataset_hash

    second = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    assert second.dataset_hash == first_hash
    assert second.analysis["effect"] == first_analysis["effect"]
    assert second.analysis["ci_low"] == first_analysis["ci_low"]
    assert second.analysis["ci_high"] == first_analysis["ci_high"]
    assert second.analysis["p_value"] == first_analysis["p_value"]


async def test_changing_the_data_invalidates_the_report(session):
    setup = await _pilot_with_data(session, code="CHANGE")
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    check = await evidence_service.verify_dataset_unchanged(session, report)
    assert check["unchanged"]

    rows = await pilots_service.metrics_for(session, setup["pilot"].id, phase="pilot", limit=1)
    rows[0].value = float(rows[0].value) + 5.0
    await session.commit()

    check = await evidence_service.verify_dataset_unchanged(session, report)
    assert not check["unchanged"]
    assert "no longer valid" in check["detail"]


async def test_a_signed_off_report_cannot_be_recomputed(session):
    setup = await _pilot_with_data(session, code="SIGNED")
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])

    validator = await make_user(session, email="signed.validator@test.invalid")
    await evidence_service.sign_off(
        session,
        report,
        setup["pilot"],
        principal_of(validator),
        decision="sign_off",
        remarks="Verified against the source records and reproduced on the locked dataset.",
        checklist={
            "data_provenance": True,
            "sample_checks": True,
            "calculation_rerun": True,
            "deviations_reviewed": True,
            "independence_confirmed": True,
        },
    )
    await session.commit()

    with pytest.raises(Forbidden) as excinfo:
        await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])
    assert "already been signed off" in excinfo.value.detail


async def test_a_refused_validation_issues_no_score(session):
    setup = await _pilot_with_data(session, code="REFUSE")
    report = await evidence_service.run_analysis(session, setup["pilot"], setup["principal"])

    validator = await make_user(session, email="refuse.validator@test.invalid")
    updated = await evidence_service.sign_off(
        session,
        report,
        setup["pilot"],
        principal_of(validator),
        decision="refuse",
        remarks="The submitted values could not be reconciled against the source records.",
        checklist={},
    )
    assert updated.status == EvidenceStatus.REFUSED
    assert updated.confidence_score is None
    assert updated.band is None
    assert not updated.components["issued"]


async def test_analysis_without_a_frozen_plan_is_refused(session):
    department = await make_department(session, code="NOPLAN")
    officer = await make_user(
        session,
        email="noplan.officer@test.invalid",
        roles=[("DO", "department", department.id)],
        department_id=department.id,
    )
    startup = await make_startup(session)
    startup_user = await make_user(
        session, email="noplan.startup@test.invalid",
        roles=[("SU", "startup", startup.id)], startup_id=startup.id,
    )
    challenge = await make_challenge(
        session, department=department, officer=officer, state="PilotDesign"
    )
    application = Application(
        reference="AP-NOPLAN",
        challenge_id=challenge.id,
        startup_id=startup.id,
        created_by=startup_user.id,
        state="Shortlisted",
        pilot_cost_paise=1_000_000,
        timeline_weeks=8,
        ip_declaration="startup_retains",
        conflict_declaration=True,
    )
    session.add(application)
    await session.flush()

    principal = principal_of(officer)
    pilot = await pilots_service.create_for_application(session, application, challenge, principal)
    await session.commit()

    with pytest.raises(ValidationFailed) as excinfo:
        await evidence_service.run_analysis(session, pilot, principal)
    assert "no frozen pre-registered plan" in excinfo.value.detail

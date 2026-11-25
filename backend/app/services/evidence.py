"""Evidence Engine and independent validation (PRD 5.10, 12.3, 12.4).

The engine runs the pre-registered analysis, nothing else. The method, the primary
measure and the pass mark were fixed at design freeze, before any pilot data existed,
so the success bar cannot be moved after the results are seen.

A re-run on the same locked dataset produces an identical result: the dataset hash, the
seed and the engine version are all stored on the report.
"""

from __future__ import annotations

from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import format_ist, utcnow
from app.core.config import settings
from app.core.errors import Forbidden, NotFound, ValidationFailed
from app.core.ids import short_ref
from app.core.policy import Principal
from app.domain.ecs import EcsInput, compute
from app.domain.hashchain import dataset_digest
from app.domain.states import ChallengeState, EvidenceStatus, Role
from app.models.challenge import Challenge, Kpi
from app.models.evidence import EvidenceReport
from app.models.pilot import MetricSubmission, Pilot
from app.models.simulation import PilotDesign
from app.services import audit, files, outbox

# The statistics (scipy) and the PDF rendering (reportlab) are imported where they are
# used: loading them up front is a noticeable share of a serverless cold start.

VALIDATION_CHECKLIST = (
    ("data_provenance", "Data provenance confirmed: the submissions come from the sources named "
     "in the measurement methods."),
    ("sample_checks", "Sample checks completed: a sample of submitted values was traced back to "
     "the underlying records."),
    ("calculation_rerun", "Calculation re-run: the analysis was re-run on the locked dataset and "
     "reproduced the same result."),
    ("deviations_reviewed", "Deviations reviewed: every amendment and deviation from the "
     "pre-registered plan was examined."),
    ("independence_confirmed", "Independence confirmed: the validator has no interest in the "
     "startup or in the outcome of this pilot."),
)


async def _series(
    session: AsyncSession, pilot_id: str, kpi_id: str, phase: str, arm: str = "treatment"
) -> list[MetricSubmission]:
    rows = await session.execute(
        select(MetricSubmission)
        .where(
            MetricSubmission.pilot_id == pilot_id,
            MetricSubmission.kpi_id == kpi_id,
            MetricSubmission.phase == phase,
            MetricSubmission.arm == arm,
            MetricSubmission.status == "Accepted",
        )
        .order_by(MetricSubmission.unit_ref.asc(), MetricSubmission.period_start.asc())
    )
    return list(rows.scalars().all())


def _unit_means(rows: list[MetricSubmission]) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for row in rows:
        buckets.setdefault(row.unit_ref, []).append(float(row.value))
    return {unit: float(np.mean(values)) for unit, values in buckets.items()}


def _paired_arrays(
    baseline: dict[str, float], pilot: dict[str, float]
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    shared = sorted(set(baseline) & set(pilot))
    return (
        np.array([baseline[u] for u in shared], dtype=float),
        np.array([pilot[u] for u in shared], dtype=float),
        shared,
    )


async def run_analysis(
    session: AsyncSession,
    pilot: Pilot,
    principal: Principal,
    *,
    seed: int | None = None,
) -> EvidenceReport:
    """Run the pre-registered analysis and build the Evidence Report (FR-EE-01, FR-EE-03)."""
    from app.domain.statistics import (
        analyse_difference_in_differences,
        analyse_paired,
        analyse_two_proportion,
    )

    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()
    if design is None or design.frozen_at is None:
        raise ValidationFailed(
            "This pilot has no frozen pre-registered plan, so no analysis can be run.",
            errors=[
                {
                    "field": "design",
                    "detail": "The design was never frozen.",
                    "fix": "A pilot without a pre-registered plan cannot produce defensible "
                    "evidence. Record this and close the pilot.",
                }
            ],
        )

    challenge = await session.get(Challenge, pilot.challenge_id)
    primary = await session.get(Kpi, design.primary_kpi_id)
    if primary is None:
        raise NotFound("The primary measure for this pilot was not found.")

    seed = seed if seed is not None else settings.default_seed
    resamples = settings.bootstrap_resamples

    baseline_rows = await _series(session, pilot.id, primary.id, "baseline")
    pilot_rows = await _series(session, pilot.id, primary.id, "pilot")
    if not pilot_rows:
        raise ValidationFailed(
            "No pilot measurements have been accepted for the primary measure.",
            errors=[
                {
                    "field": "metrics",
                    "detail": "The primary measure has no accepted pilot data.",
                    "fix": "Ask the startup to submit the measurements, or resolve the disputes "
                    "on the rows that were rejected.",
                }
            ],
        )

    baseline_means = _unit_means(baseline_rows)
    pilot_means = _unit_means(pilot_rows)

    if not baseline_means:
        # Fall back to the declared baseline when no baseline period was measured.
        if primary.baseline_value is None:
            raise ValidationFailed(
                "There is no measured baseline and no declared baseline value for the primary "
                "measure, so no comparison is possible.",
                errors=[
                    {
                        "field": "baseline",
                        "detail": "Neither a baseline period nor a declared baseline exists.",
                        "fix": "Record the baseline on the challenge, or collect a baseline "
                        "period before analysis.",
                    }
                ],
            )
        declared = float(primary.baseline_value)
        baseline_means = {unit: declared for unit in pilot_means}

    # The method was fixed at design freeze and is honoured exactly. The only permitted
    # departure is a pre-registered comparison design that has no comparison data, which
    # is recorded as a deviation on the report rather than quietly substituted.
    method = design.analysis_method
    forced_fallback: str | None = None
    comparison_baseline = await _series(session, pilot.id, primary.id, "baseline", "comparison")
    comparison_pilot = await _series(session, pilot.id, primary.id, "pilot", "comparison")

    if method == "welch_did" and not comparison_pilot:
        forced_fallback = (
            "The pre-registered analysis compared pilot units against a comparison group, but no "
            "comparison data was submitted. A paired before-and-after comparison was run instead, "
            "which cannot separate the pilot from any change that would have happened anyway."
        )
        method = "paired_t"

    if method == "welch_did":
        c_base = _unit_means(comparison_baseline)
        c_pilot = _unit_means(comparison_pilot)
        t_base, t_pilot, _ = _paired_arrays(baseline_means, pilot_means)
        cb, cp, _ = _paired_arrays(c_base, c_pilot)
        analysis = analyse_difference_in_differences(
            t_base, t_pilot, cb, cp,
            direction=primary.direction, seed=seed, resamples=resamples,
        )
    elif method == "two_proportion":
        scale = 100.0 if float(np.mean(list(baseline_means.values()))) > 1.0 else 1.0
        base_trials = max(len(baseline_means), 1) * 100
        pilot_trials = max(len(pilot_means), 1) * 100
        base_rate = float(np.mean(list(baseline_means.values()))) / scale
        pilot_rate = float(np.mean(list(pilot_means.values()))) / scale
        analysis = analyse_two_proportion(
            int(round(base_rate * base_trials)), base_trials,
            int(round(pilot_rate * pilot_trials)), pilot_trials,
            direction=primary.direction, seed=seed, resamples=resamples,
        )
        # Report on the same scale the department uses.
        for field in ("baseline_mean", "pilot_mean", "effect", "ci_low", "ci_high",
                      "ci_90_low", "ci_90_high"):
            setattr(analysis, field, round(getattr(analysis, field) * scale, 6))
    else:
        base_array, pilot_array, _ = _paired_arrays(baseline_means, pilot_means)
        analysis = analyse_paired(
            base_array, pilot_array,
            direction=primary.direction, seed=seed, resamples=resamples,
            force_rank_test=(method == "wilcoxon"),
        )

    all_rows = await session.execute(
        select(MetricSubmission).where(MetricSubmission.pilot_id == pilot.id)
    )
    every_row = list(all_rows.scalars().all())
    accepted_rows = [r for r in every_row if r.status == "Accepted"]
    disputed = len(every_row) - len(accepted_rows)

    digest = dataset_digest(
        [
            {
                "kpi_id": r.kpi_id,
                "phase": r.phase,
                "arm": r.arm,
                "unit_ref": r.unit_ref,
                "period_start": r.period_start.isoformat(),
                "value": float(r.value),
            }
            for r in accepted_rows
        ]
    )

    # Completeness is measured against the primary measure, which is what the
    # pre-registered plan sized the pilot for.
    received = sum(
        1 for r in accepted_rows if r.phase == "pilot" and r.kpi_id == primary.id
    )
    planned = design.planned_unit_periods

    target_effect = 0.0
    if primary.target_value is not None and primary.baseline_value is not None:
        target_effect = float(primary.target_value) - float(primary.baseline_value)
    elif design.claimed_effect:
        target_effect = float(design.claimed_effect)

    ecs = compute(
        EcsInput(
            observed_effect=analysis.effect,
            target_effect=target_effect,
            direction=primary.direction,
            excludes_zero_95=analysis.excludes_zero_95,
            excludes_zero_90=analysis.excludes_zero_90,
            planned_unit_periods=planned,
            received_unit_periods=received,
            rejected_or_disputed_rows=disputed,
            total_rows=len(every_row),
            approved_amendments=design.approved_amendments,
            # Running a different analysis from the pre-registered one, even because the
            # data forced it, is a departure from the plan and is scored as one.
            unapproved_deviations=design.unapproved_deviations + (1 if forced_fallback else 0),
            validation_status=EvidenceStatus.AWAITING_VALIDATION,
        )
    )

    secondary = await _secondary_results(session, pilot, challenge, primary.id, seed, resamples)
    limitations = _limitations(design, analysis, planned, received, bool(comparison_pilot))
    if forced_fallback:
        limitations.insert(0, forced_fallback)

    existing = await session.execute(
        select(EvidenceReport).where(EvidenceReport.pilot_id == pilot.id)
    )
    report = existing.scalar_one_or_none()
    if report is not None and report.is_final:
        raise Forbidden(
            "This Evidence Report has already been signed off. A new analysis would invalidate "
            "a validated result. Record an amendment and issue a new report version instead."
        )

    analysis_block = {
        **analysis.to_dict(),
        "primary_kpi_id": primary.id,
        "primary_kpi_name": primary.name,
        "primary_kpi_unit": primary.unit,
        "pass_mark": design.pass_mark,
        "pass_mark_met": _pass_mark_met(analysis, primary.direction, design.pass_mark),
        "secondary": secondary,
        "units_analysed": len(pilot_means),
        "target_effect": target_effect,
    }

    deviations = list(design.amendments or [])
    if forced_fallback:
        deviations.append(
            {
                "description": forced_fallback,
                "approved": False,
                "at": utcnow().isoformat(),
                "source": "evidence_engine",
            }
        )

    if report is None:
        report = EvidenceReport(
            pilot_id=pilot.id,
            reference=short_ref("EV"),
            dataset_hash=digest,
            seed=seed,
            engine_version=settings.engine_version,
            analysis=analysis_block,
            components=ecs.to_dict(),
            confidence_score=ecs.score,
            band=ecs.band,
            status=EvidenceStatus.AWAITING_VALIDATION,
            deviations=deviations,
            limitations=limitations,
            generated_by=principal.user_id,
        )
        session.add(report)
    else:
        report.dataset_hash = digest
        report.seed = seed
        report.engine_version = settings.engine_version
        report.analysis = analysis_block
        report.components = ecs.to_dict()
        report.confidence_score = ecs.score
        report.band = ecs.band
        report.status = EvidenceStatus.AWAITING_VALIDATION
        report.deviations = deviations
        report.limitations = limitations
        report.version = (report.version or 0) + 1
    await session.flush()

    document = await _render_report(session, pilot, report, challenge, primary, design, principal)
    report.pdf_file_id = document.id
    await session.flush()

    await audit.record(
        session,
        action="evidence.generated",
        entity_type="evidence_report",
        entity_id=report.id,
        actor_id=principal.user_id,
        actor_role=Role.DEPARTMENT_OFFICER,
        department_id=pilot.department_id,
        after={
            "dataset_hash": digest,
            "seed": seed,
            "engine_version": settings.engine_version,
            "confidence_score": ecs.score,
            "band": ecs.band,
            "method": analysis.method,
        },
    )
    outbox.emit(
        session,
        aggregate_type="evidence_report",
        aggregate_id=report.id,
        event_type="evidence.generated",
        payload={
            "pilot_id": pilot.id,
            "challenge_id": pilot.challenge_id,
            "reference": report.reference,
            "confidence_score": ecs.score,
            "band": ecs.band,
        },
    )
    return report


def _pass_mark_met(analysis: Any, direction: str, pass_mark: float) -> bool:
    if direction == "lower":
        return analysis.pilot_mean <= pass_mark
    return analysis.pilot_mean >= pass_mark


async def _secondary_results(
    session: AsyncSession,
    pilot: Pilot,
    challenge: Challenge | None,
    primary_id: str,
    seed: int,
    resamples: int,
) -> list[dict[str, Any]]:
    """Supporting measures, reported but never used to decide (FR-EE-01)."""
    from app.domain.statistics import analyse_paired

    if challenge is None:
        return []
    out: list[dict[str, Any]] = []
    for kpi in challenge.kpis:
        if kpi.id == primary_id:
            continue
        baseline_rows = await _series(session, pilot.id, kpi.id, "baseline")
        pilot_rows = await _series(session, pilot.id, kpi.id, "pilot")
        if not pilot_rows:
            continue
        baseline_means = _unit_means(baseline_rows)
        pilot_means = _unit_means(pilot_rows)
        if not baseline_means and kpi.baseline_value is not None:
            baseline_means = {u: float(kpi.baseline_value) for u in pilot_means}
        if not baseline_means:
            continue
        base_array, pilot_array, _ = _paired_arrays(baseline_means, pilot_means)
        if base_array.size < 2:
            continue
        result = analyse_paired(
            base_array, pilot_array, direction=kpi.direction, seed=seed, resamples=resamples
        )
        out.append(
            {
                "kpi_id": kpi.id,
                "name": kpi.name,
                "unit": kpi.unit,
                "direction": kpi.direction,
                "baseline_mean": result.baseline_mean,
                "pilot_mean": result.pilot_mean,
                "effect": result.effect,
                "ci_low": result.ci_low,
                "ci_high": result.ci_high,
                "p_value": result.p_value,
                "excludes_zero_95": result.excludes_zero_95,
            }
        )
    return out


def _limitations(
    design: PilotDesign,
    analysis: Any,
    planned: int,
    received: int,
    has_comparison: bool,
) -> list[str]:
    """Stated plainly, because a result without its limits invites over-reading."""
    out: list[str] = []
    if not has_comparison:
        out.append(
            "There was no comparison group, so any change that would have happened anyway is "
            "included in the measured effect."
        )
    completeness = (received / planned) if planned else 0.0
    if completeness < 0.9:
        out.append(
            "Only " + str(round(completeness * 100))
            + " percent of the planned measurements were received, so the result rests on less "
            "data than the pre-registered plan assumed."
        )
    if analysis.n_pilot < 10:
        out.append(
            "The analysis covers " + str(analysis.n_pilot)
            + " units, which is small. The confidence interval is correspondingly wide."
        )
    if design.approved_amendments or design.unapproved_deviations:
        out.append(
            "The pilot deviated from its pre-registered plan "
            + str(design.approved_amendments + design.unapproved_deviations)
            + " time(s). Each deviation is listed in this report."
        )
    if design.expected_power is not None and design.expected_power < 0.8:
        out.append(
            "The frozen design was expected to detect the claimed improvement in only "
            + str(round(design.expected_power * 100))
            + " of 100 pilots, so a result that misses the target is hard to interpret."
        )
    out.append(
        "The pilot ran in one context. Results may differ where the scale, population or "
        "operating environment differs; the Innovation Passport records the context for "
        "anyone considering reuse."
    )
    return out


async def _render_report(
    session: AsyncSession,
    pilot: Pilot,
    report: EvidenceReport,
    challenge: Challenge | None,
    primary: Kpi,
    design: PilotDesign,
    principal: Principal,
):
    from app.models.startup import Startup
    from app.services import pdf

    startup = await session.get(Startup, pilot.startup_id)
    analysis = report.analysis or {}
    planned = design.planned_unit_periods
    received = int(analysis.get("units_analysed", 0))

    completeness_rows = await session.execute(
        select(MetricSubmission).where(MetricSubmission.pilot_id == pilot.id)
    )
    rows = list(completeness_rows.scalars().all())
    accepted = sum(
        1
        for r in rows
        if r.status == "Accepted" and r.phase == "pilot" and r.kpi_id == primary.id
    )

    payload = {
        "reference": report.reference,
        "challenge_title": challenge.title if challenge else "",
        "startup_name": startup.legal_name if startup else "",
        "primary_kpi_name": primary.name + " (" + primary.unit + ")",
        "score": report.components,
        "analysis": analysis,
        "secondary": analysis.get("secondary", []),
        "dataset_hash": report.dataset_hash,
        "seed": report.seed,
        "engine_version": report.engine_version,
        "deviations": report.deviations,
        "limitations": report.limitations,
        "plan_vs_actual": [
            {
                "item": "Duration",
                "planned": str(design.duration_weeks) + " weeks",
                "actual": str(analysis.get("periods_observed", design.duration_weeks)) + " weeks of data",
            },
            {"item": "Units", "planned": str(design.units), "actual": str(received)},
            {
                "item": "Primary measure",
                "planned": primary.name,
                "actual": primary.name,
            },
            {
                "item": "Pass mark",
                "planned": str(design.pass_mark) + " " + primary.unit,
                "actual": str(analysis.get("pilot_mean", "")) + " " + primary.unit
                + (" (met)" if analysis.get("pass_mark_met") else " (not met)"),
            },
            {
                "item": "Analysis method",
                "planned": design.analysis_method,
                "actual": str(analysis.get("method", "")),
            },
            {
                "item": "Design frozen",
                "planned": "Before data collection",
                "actual": format_ist(design.frozen_at) if design.frozen_at else "not frozen",
            },
        ],
        "completeness": {
            "planned": planned,
            "received": accepted,
            "percent": round(100.0 * accepted / planned, 1) if planned else 0.0,
            "rejected": sum(1 for r in rows if r.status != "Accepted"),
        },
        "validation": {
            "status": report.status,
            "validator_name": "",
            "signed_at": "",
            "remarks": report.remarks or "",
            "checklist": report.checklist,
        },
    }
    rendered = pdf.render_evidence_report(payload)
    return await files.store_generated(
        session,
        data=rendered.data,
        filename=rendered.filename,
        mime=rendered.mime,
        purpose="evidence",
        uploaded_by=principal.user_id,
        owner_scope_type="pilot",
        owner_scope_id=pilot.id,
    )


async def get_report(session: AsyncSession, report_id: str) -> EvidenceReport:
    report = await session.get(EvidenceReport, report_id)
    if report is None:
        raise NotFound("This Evidence Report was not found.")
    return report


async def report_for_pilot(session: AsyncSession, pilot_id: str) -> EvidenceReport | None:
    result = await session.execute(select(EvidenceReport).where(EvidenceReport.pilot_id == pilot_id))
    return result.scalar_one_or_none()


async def validator_workspace(
    session: AsyncSession, pilot: Pilot, report: EvidenceReport
) -> dict[str, Any]:
    """Raw submissions, baseline and the verification checklist (FR-EE-04)."""
    rows = await session.execute(
        select(MetricSubmission)
        .where(MetricSubmission.pilot_id == pilot.id)
        .order_by(
            MetricSubmission.kpi_id.asc(),
            MetricSubmission.phase.asc(),
            MetricSubmission.unit_ref.asc(),
            MetricSubmission.period_start.asc(),
        )
    )
    submissions = list(rows.scalars().all())
    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one_or_none()

    return {
        "report_id": report.id,
        "reference": report.reference,
        "dataset_hash": report.dataset_hash,
        "seed": report.seed,
        "engine_version": report.engine_version,
        "status": report.status,
        "checklist": [
            {"key": key, "label": label, "checked": bool((report.checklist or {}).get(key))}
            for key, label in VALIDATION_CHECKLIST
        ],
        "pre_registered_plan": (
            {
                "duration_weeks": design.duration_weeks,
                "units": design.units,
                "measurements_per_week": design.measurements_per_week,
                "pass_mark": design.pass_mark,
                "analysis_method": design.analysis_method,
                "alpha": design.alpha,
                "frozen_at": design.frozen_at.isoformat() if design.frozen_at else None,
                "amendments": design.amendments,
            }
            if design
            else None
        ),
        "analysis": report.analysis,
        "components": report.components,
        "raw_submissions": [
            {
                "id": row.id,
                "kpi_id": row.kpi_id,
                "unit_ref": row.unit_ref,
                "phase": row.phase,
                "arm": row.arm,
                "period_start": row.period_start.isoformat(),
                "period_end": row.period_end.isoformat(),
                "value": float(row.value),
                "source": row.source,
                "status": row.status,
                "dispute_reason": row.dispute_reason,
                "submitted_by": row.submitted_by,
                "upload_hash": row.upload_hash,
            }
            for row in submissions
        ],
        "row_count": len(submissions),
    }


async def sign_off(
    session: AsyncSession,
    report: EvidenceReport,
    pilot: Pilot,
    principal: Principal,
    *,
    decision: str,
    remarks: str,
    checklist: dict[str, bool],
) -> EvidenceReport:
    """Sign off, sign off with qualifications, or refuse (FR-EE-05)."""
    valid = {
        "sign_off": EvidenceStatus.SIGNED_OFF,
        "sign_off_with_qualifications": EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS,
        "refuse": EvidenceStatus.REFUSED,
    }
    if decision not in valid:
        raise ValidationFailed(
            "That validation decision is not recognised.",
            errors=[
                {
                    "field": "decision",
                    "detail": "The decision " + decision + " is not one of the three permitted.",
                    "fix": "Choose sign off, sign off with qualifications, or refuse.",
                }
            ],
        )
    if not remarks.strip():
        raise ValidationFailed(
            "Every validation decision needs written remarks.",
            errors=[
                {
                    "field": "remarks",
                    "detail": "No remarks were given.",
                    "fix": "Record what you verified and anything a reader should be careful about.",
                }
            ],
        )
    if report.is_final:
        raise Forbidden("This report has already been signed off.")

    required = [key for key, _ in VALIDATION_CHECKLIST]
    if decision != "refuse":
        missing = [key for key in required if not checklist.get(key)]
        if missing:
            raise ValidationFailed(
                "Complete every verification step before signing off.",
                errors=[
                    {
                        "field": "checklist." + key,
                        "detail": "This step has not been confirmed.",
                        "fix": dict(VALIDATION_CHECKLIST)[key],
                    }
                    for key in missing
                ],
            )

    status = valid[decision]
    report.status = str(status)
    report.validator_id = principal.user_id
    report.signed_at = utcnow()
    report.remarks = remarks.strip()
    report.checklist = {k: bool(v) for k, v in checklist.items()}

    design_row = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
    design = design_row.scalar_one()
    analysis = report.analysis or {}
    all_rows = await session.execute(
        select(MetricSubmission).where(MetricSubmission.pilot_id == pilot.id)
    )
    rows = list(all_rows.scalars().all())
    primary_kpi_id = str((report.analysis or {}).get("primary_kpi_id", ""))
    accepted = sum(
        1
        for r in rows
        if r.status == "Accepted" and r.phase == "pilot" and r.kpi_id == primary_kpi_id
    )

    ecs = compute(
        EcsInput(
            observed_effect=float(analysis.get("effect", 0.0)),
            target_effect=float(analysis.get("target_effect", 0.0)),
            direction=str(analysis.get("effect_direction", "lower")),
            excludes_zero_95=bool(analysis.get("excludes_zero_95")),
            excludes_zero_90=bool(analysis.get("excludes_zero_90")),
            planned_unit_periods=design.planned_unit_periods,
            received_unit_periods=accepted,
            rejected_or_disputed_rows=sum(1 for r in rows if r.status != "Accepted"),
            total_rows=len(rows),
            approved_amendments=design.approved_amendments,
            unapproved_deviations=design.unapproved_deviations,
            validation_status=str(status),
        )
    )
    report.components = ecs.to_dict()
    report.confidence_score = ecs.score if ecs.issued else None
    report.band = ecs.band if ecs.issued else None
    report.version = (report.version or 0) + 1
    await session.flush()

    if status != EvidenceStatus.REFUSED:
        challenge = await session.get(Challenge, pilot.challenge_id)
        if challenge is not None and challenge.state == ChallengeState.VALIDATION:
            challenge.state = ChallengeState.DECISION_PENDING
            challenge.version = (challenge.version or 0) + 1
            await session.flush()

    await audit.record(
        session,
        action="evidence.sign-off",
        entity_type="evidence_report",
        entity_id=report.id,
        actor_id=principal.user_id,
        actor_role=Role.INDEPENDENT_VALIDATOR,
        department_id=pilot.department_id,
        before={"status": EvidenceStatus.AWAITING_VALIDATION},
        after={
            "status": report.status,
            "confidence_score": report.confidence_score,
            "band": report.band,
            "dataset_hash": report.dataset_hash,
        },
        reason=remarks.strip(),
    )
    outbox.emit(
        session,
        aggregate_type="evidence_report",
        aggregate_id=report.id,
        event_type="evidence.signed_off",
        payload={
            "pilot_id": pilot.id,
            "challenge_id": pilot.challenge_id,
            "status": report.status,
            "confidence_score": report.confidence_score,
            "band": report.band,
            "reference": report.reference,
        },
    )
    return report


async def verify_dataset_unchanged(session: AsyncSession, report: EvidenceReport) -> dict[str, Any]:
    """Recompute the dataset hash. Any later change invalidates the report (PRD 11.2)."""
    rows = await session.execute(
        select(MetricSubmission).where(
            MetricSubmission.pilot_id == report.pilot_id, MetricSubmission.status == "Accepted"
        )
    )
    current = dataset_digest(
        [
            {
                "kpi_id": r.kpi_id,
                "phase": r.phase,
                "arm": r.arm,
                "unit_ref": r.unit_ref,
                "period_start": r.period_start.isoformat(),
                "value": float(r.value),
            }
            for r in rows.scalars().all()
        ]
    )
    unchanged = current == report.dataset_hash
    return {
        "unchanged": unchanged,
        "recorded_hash": report.dataset_hash,
        "current_hash": current,
        "detail": (
            "The dataset is unchanged since this report was produced."
            if unchanged
            else "The pilot data has changed since this report was produced. The report is no "
            "longer valid and the analysis must be run again."
        ),
    }

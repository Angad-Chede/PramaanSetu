"""Task inbox (PRD 6.1, endpoint GET /me/tasks).

Every user's home page answers one question: what do I do next. Items needing this
user's action, sorted by deadline, each with the action it needs. Two clicks from home
to any pending action (UX-02).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.policy import Principal
from app.domain.states import (
    ApplicationState,
    ChallengeState,
    EvidenceStatus,
    MilestoneState,
    PilotState,
    Role,
)
from app.models.application import Application, EligibilityResult
from app.models.challenge import Challenge, Clarification
from app.models.evaluation import CoiDeclaration, EvaluationScore, PanelMember
from app.models.evidence import EvidenceReport
from app.models.payment import Milestone
from app.models.pilot import AgreementVersion, Pilot
from app.models.scale import ScaleDecision
from app.models.simulation import PilotDesign


@dataclass
class Task:
    id: str
    kind: str
    title: str
    detail: str
    action_label: str
    link: str
    due_at: str | None
    overdue: bool
    priority: int
    entity_type: str
    entity_id: str
    role: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _due(value: datetime | None, now: datetime) -> tuple[str | None, bool]:
    if value is None:
        return None, False
    return value.isoformat(), value < now


async def build(session: AsyncSession, principal: Principal, *, limit: int = 100) -> list[Task]:
    now = utcnow()
    tasks: list[Task] = []
    roles = principal.roles

    if Role.DEPARTMENT_OFFICER in roles and principal.department_id:
        tasks.extend(await _officer_tasks(session, principal, now))
    if Role.DEPARTMENT_APPROVER in roles and principal.department_id:
        tasks.extend(await _approver_tasks(session, principal, now))
    if Role.FINANCE_OFFICER in roles and principal.department_id:
        tasks.extend(await _finance_tasks(session, principal, now))
    if Role.STARTUP_USER in roles and principal.startup_id:
        tasks.extend(await _startup_tasks(session, principal, now))
    if Role.EXPERT_EVALUATOR in roles:
        tasks.extend(await _evaluator_tasks(session, principal, now))
    if Role.INDEPENDENT_VALIDATOR in roles:
        tasks.extend(await _validator_tasks(session, principal, now))

    tasks.sort(
        key=lambda t: (
            not t.overdue,
            t.priority,
            t.due_at or "9999-12-31T00:00:00",
            t.title,
        )
    )
    return tasks[:limit]


async def _officer_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    department_id = principal.department_id

    drafts = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id,
            Challenge.state.in_((ChallengeState.DRAFT,)),
            Challenge.created_by == principal.user_id,
        )
    )
    for challenge in drafts.scalars().all():
        due, overdue = _due(challenge.application_deadline, now)
        out.append(
            Task(
                id="challenge-draft-" + challenge.id,
                kind="challenge_draft",
                title="Finish and submit: " + (challenge.title or "Untitled challenge"),
                detail="This challenge is still a draft. Submit it for approval when the "
                "measures and the rubric are complete.",
                action_label="Open draft",
                link="/challenges/" + challenge.id + "/edit",
                due_at=due,
                overdue=False,
                priority=3,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    returned = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id,
            Challenge.state == ChallengeState.DRAFT,
            Challenge.return_comments.isnot(None),
        )
    )
    for challenge in returned.scalars().all():
        out.append(
            Task(
                id="challenge-returned-" + challenge.id,
                kind="challenge_returned",
                title="Returned by the approver: " + (challenge.title or "Untitled challenge"),
                detail=str(challenge.return_comments or "")[:200],
                action_label="Revise and resubmit",
                link="/challenges/" + challenge.id + "/edit",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    to_screen = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id,
            Challenge.state == ChallengeState.APPLICATIONS_CLOSED,
        )
    )
    for challenge in to_screen.scalars().all():
        out.append(
            Task(
                id="challenge-screen-" + challenge.id,
                kind="screen_applications",
                title="Screen applications: " + challenge.title,
                detail="Applications closed. Run eligibility screening to move to evaluation.",
                action_label="Run screening",
                link="/challenges/" + challenge.id + "/screening",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    unanswered = await session.execute(
        select(Clarification, Challenge)
        .join(Challenge, Challenge.id == Clarification.challenge_id)
        .where(Challenge.department_id == department_id, Clarification.answer.is_(None))
    )
    for clarification, challenge in unanswered.all():
        due, overdue = _due(challenge.clarification_cutoff, now)
        out.append(
            Task(
                id="clarification-" + clarification.id,
                kind="answer_clarification",
                title="Answer a question on " + challenge.title,
                detail=clarification.question[:200],
                action_label="Publish an answer",
                link="/challenges/" + challenge.id + "/clarifications",
                due_at=due,
                overdue=overdue,
                priority=2,
                entity_type="clarification",
                entity_id=clarification.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    pilots_to_design = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id,
            Challenge.state == ChallengeState.PILOT_DESIGN,
        )
    )
    for challenge in pilots_to_design.scalars().all():
        out.append(
            Task(
                id="design-" + challenge.id,
                kind="design_pilot",
                title="Design the pilot: " + challenge.title,
                detail="Run the Pilot Flight Simulator and freeze a design that can detect the "
                "improvement claimed.",
                action_label="Open the simulator",
                link="/challenges/" + challenge.id + "/pilot",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    milestones = await session.execute(
        select(Milestone, Pilot)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(Pilot.department_id == department_id, Milestone.state == MilestoneState.SUBMITTED)
    )
    for milestone, pilot in milestones.all():
        due, overdue = _due(milestone.sla_due_at, now)
        out.append(
            Task(
                id="milestone-accept-" + milestone.id,
                kind="accept_milestone",
                title="Accept or reject milestone " + str(milestone.seq) + ": " + milestone.title,
                detail="Evidence required: " + milestone.evidence_required[:160],
                action_label="Review evidence",
                link="/pilots/" + pilot.id + "/milestones",
                due_at=due,
                overdue=overdue,
                priority=0 if overdue else 1,
                entity_type="milestone",
                entity_id=milestone.id,
                role=Role.DEPARTMENT_OFFICER,
            )
        )

    ready_for_evidence = await session.execute(
        select(Pilot).where(
            Pilot.department_id == department_id, Pilot.state == PilotState.COMPLETED
        )
    )
    for pilot in ready_for_evidence.scalars().all():
        report = await session.execute(
            select(EvidenceReport).where(EvidenceReport.pilot_id == pilot.id)
        )
        if report.scalar_one_or_none() is None:
            out.append(
                Task(
                    id="evidence-run-" + pilot.id,
                    kind="run_evidence",
                    title="Run the Evidence Engine for pilot " + pilot.reference,
                    detail="The pilot is complete. Run the pre-registered analysis and send the "
                    "report for independent validation.",
                    action_label="Run analysis",
                    link="/pilots/" + pilot.id + "/evidence",
                    due_at=None,
                    overdue=False,
                    priority=1,
                    entity_type="pilot",
                    entity_id=pilot.id,
                    role=Role.DEPARTMENT_OFFICER,
                )
            )
    return out


async def _approver_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    department_id = principal.department_id

    in_review = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id, Challenge.state == ChallengeState.IN_REVIEW
        )
    )
    for challenge in in_review.scalars().all():
        out.append(
            Task(
                id="challenge-approve-" + challenge.id,
                kind="approve_challenge",
                title="Approve or return: " + challenge.title,
                detail="Read the one-page summary, then approve for publication or return with "
                "comments.",
                action_label="Review summary",
                link="/challenges/" + challenge.id + "/review",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_APPROVER,
            )
        )

    shortlist = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id, Challenge.state == ChallengeState.SHORTLISTED
        )
    )
    for challenge in shortlist.scalars().all():
        out.append(
            Task(
                id="shortlist-" + challenge.id,
                kind="confirm_shortlist",
                title="Confirm the shortlist: " + challenge.title,
                detail="Scores are locked. Confirm which applications go forward to pilot design.",
                action_label="Review ranking",
                link="/challenges/" + challenge.id + "/ranking",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="challenge",
                entity_id=challenge.id,
                role=Role.DEPARTMENT_APPROVER,
            )
        )

    agreements = await session.execute(
        select(AgreementVersion, Pilot)
        .join(Pilot, Pilot.id == AgreementVersion.pilot_id)
        .where(
            Pilot.department_id == department_id,
            Pilot.state == PilotState.AGREEMENT_DRAFT,
            AgreementVersion.approved_at.is_(None),
        )
    )
    for agreement, pilot in agreements.all():
        out.append(
            Task(
                id="agreement-approve-" + agreement.id,
                kind="approve_agreement",
                title="Approve the pilot agreement for " + pilot.reference,
                detail="Version " + str(agreement.number) + " is ready for your approval.",
                action_label="Review agreement",
                link="/pilots/" + pilot.id + "/agreement",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="pilot",
                entity_id=pilot.id,
                role=Role.DEPARTMENT_APPROVER,
            )
        )

    milestones = await session.execute(
        select(Milestone, Pilot)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(Pilot.department_id == department_id, Milestone.state == MilestoneState.ACCEPTED)
    )
    for milestone, pilot in milestones.all():
        due, overdue = _due(milestone.sla_due_at, now)
        out.append(
            Task(
                id="milestone-approve-" + milestone.id,
                kind="approve_payment",
                title="Approve payment for milestone " + str(milestone.seq) + ": " + milestone.title,
                detail="The officer accepted this milestone. Approve the payment to send it to "
                "the finance office.",
                action_label="Approve payment",
                link="/pilots/" + pilot.id + "/milestones",
                due_at=due,
                overdue=overdue,
                priority=0 if overdue else 1,
                entity_type="milestone",
                entity_id=milestone.id,
                role=Role.DEPARTMENT_APPROVER,
            )
        )

    decisions = await session.execute(
        select(Challenge).where(
            Challenge.department_id == department_id,
            Challenge.state == ChallengeState.DECISION_PENDING,
        )
    )
    for challenge in decisions.scalars().all():
        pilot_row = await session.execute(select(Pilot).where(Pilot.challenge_id == challenge.id))
        pilot = pilot_row.scalar_one_or_none()
        if pilot is None:
            continue
        existing = await session.execute(select(ScaleDecision).where(ScaleDecision.pilot_id == pilot.id))
        if existing.scalar_one_or_none() is not None:
            continue
        out.append(
            Task(
                id="scale-decide-" + pilot.id,
                kind="scale_decision",
                title="Record the scale decision for " + challenge.title,
                detail="The Evidence Report is validated. Record Scale, Extend pilot or Close, "
                "with reasons.",
                action_label="Open decision",
                link="/pilots/" + pilot.id + "/decision",
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="pilot",
                entity_id=pilot.id,
                role=Role.DEPARTMENT_APPROVER,
            )
        )
    return out


async def _finance_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    rows = await session.execute(
        select(Milestone)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(
            Pilot.department_id == principal.department_id,
            Milestone.state == MilestoneState.PAYMENT_APPROVED,
        )
        .order_by(Milestone.sla_due_at.asc())
    )
    for milestone in rows.scalars().all():
        due, overdue = _due(milestone.sla_due_at, now)
        out.append(
            Task(
                id="milestone-release-" + milestone.id,
                kind="record_release",
                title="Record release for milestone " + str(milestone.seq) + ": " + milestone.title,
                detail="Approved for payment. Record the release reference, amount and date.",
                action_label="Record release",
                link="/finance/queue",
                due_at=due,
                overdue=overdue,
                priority=0 if overdue else 1,
                entity_type="milestone",
                entity_id=milestone.id,
                role=Role.FINANCE_OFFICER,
            )
        )
    return out


async def _startup_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    startup_id = principal.startup_id

    drafts = await session.execute(
        select(Application, Challenge)
        .join(Challenge, Challenge.id == Application.challenge_id)
        .where(
            Application.startup_id == startup_id,
            Application.state == ApplicationState.DRAFT,
            Challenge.state == ChallengeState.PUBLISHED,
        )
    )
    for application, challenge in drafts.all():
        due, overdue = _due(challenge.application_deadline, now)
        out.append(
            Task(
                id="application-draft-" + application.id,
                kind="submit_application",
                title="Submit your application to " + challenge.title,
                detail="Your draft is saved. Applications close at the deadline, to the second.",
                action_label="Finish application",
                link="/applications/" + application.id,
                due_at=due,
                overdue=overdue,
                priority=0 if overdue else 1,
                entity_type="application",
                entity_id=application.id,
                role=Role.STARTUP_USER,
            )
        )

    ineligible = await session.execute(
        select(EligibilityResult, Application, Challenge)
        .join(Application, Application.id == EligibilityResult.application_id)
        .join(Challenge, Challenge.id == Application.challenge_id)
        .where(
            Application.startup_id == startup_id,
            EligibilityResult.outcome == "Ineligible",
            EligibilityResult.clarification_window_ends.isnot(None),
        )
    )
    for result, application, challenge in ineligible.all():
        if result.clarification_window_ends and result.clarification_window_ends < now:
            continue
        due, overdue = _due(result.clarification_window_ends, now)
        out.append(
            Task(
                id="eligibility-clarify-" + application.id,
                kind="eligibility_clarification",
                title="Eligibility result on " + challenge.title,
                detail="Your application was found ineligible. You may raise a clarification "
                "within the window shown.",
                action_label="Read the reasons",
                link="/applications/" + application.id,
                due_at=due,
                overdue=overdue,
                priority=2,
                entity_type="application",
                entity_id=application.id,
                role=Role.STARTUP_USER,
            )
        )

    pilots = await session.execute(select(Pilot).where(Pilot.startup_id == startup_id))
    for pilot in pilots.scalars().all():
        if pilot.state == PilotState.AWAITING_STARTUP:
            detail = "Review the pilot agreement and accept it, or request changes."
            if not pilot.cyber_completed_at:
                detail += " The cybersecurity checklist must be completed first."
            out.append(
                Task(
                    id="agreement-accept-" + pilot.id,
                    kind="accept_agreement",
                    title="Accept the pilot agreement for " + pilot.reference,
                    detail=detail,
                    action_label="Review agreement",
                    link="/pilots/" + pilot.id + "/agreement",
                    due_at=None,
                    overdue=False,
                    priority=1,
                    entity_type="pilot",
                    entity_id=pilot.id,
                    role=Role.STARTUP_USER,
                )
            )
        if pilot.state == PilotState.ACTIVE:
            design = await session.execute(select(PilotDesign).where(PilotDesign.pilot_id == pilot.id))
            plan = design.scalar_one_or_none()
            out.append(
                Task(
                    id="metrics-" + pilot.id,
                    kind="submit_metrics",
                    title="Submit this period's measurements for " + pilot.reference,
                    detail="Measurements are due "
                    + (str(plan.measurements_per_week) + " time(s) per week." if plan else "each period."),
                    action_label="Upload measurements",
                    link="/pilots/" + pilot.id + "/metrics",
                    due_at=None,
                    overdue=False,
                    priority=2,
                    entity_type="pilot",
                    entity_id=pilot.id,
                    role=Role.STARTUP_USER,
                )
            )

    milestones = await session.execute(
        select(Milestone, Pilot)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(
            Pilot.startup_id == startup_id,
            Milestone.state.in_((MilestoneState.PENDING, MilestoneState.REJECTED)),
        )
    )
    for milestone, pilot in milestones.all():
        due, overdue = _due(milestone.due_date, now)
        title = "Submit evidence for milestone " + str(milestone.seq) + ": " + milestone.title
        detail = "Evidence required: " + milestone.evidence_required[:160]
        if milestone.state == MilestoneState.REJECTED:
            title = "Resubmit milestone " + str(milestone.seq) + ": " + milestone.title
            detail = "Not accepted: " + str(milestone.unmet_requirement or milestone.rejection_reason or "")[:160]
        out.append(
            Task(
                id="milestone-submit-" + milestone.id,
                kind="submit_milestone",
                title=title,
                detail=detail,
                action_label="Submit evidence",
                link="/pilots/" + pilot.id + "/milestones",
                due_at=due,
                overdue=overdue,
                priority=0 if overdue else 2,
                entity_type="milestone",
                entity_id=milestone.id,
                role=Role.STARTUP_USER,
            )
        )
    return out


async def _evaluator_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    memberships = await session.execute(
        select(PanelMember, Challenge)
        .join(Challenge, Challenge.id == PanelMember.challenge_id)
        .where(
            PanelMember.user_id == principal.user_id,
            PanelMember.role == Role.EXPERT_EVALUATOR,
            PanelMember.active.is_(True),
            Challenge.state == ChallengeState.EVALUATION,
        )
    )
    for _member, challenge in memberships.all():
        applications = await session.execute(
            select(Application)
            .join(EligibilityResult, EligibilityResult.application_id == Application.id)
            .where(
                Application.challenge_id == challenge.id,
                EligibilityResult.outcome == "Eligible",
            )
        )
        pending = 0
        for application in applications.scalars().all():
            declared = await session.execute(
                select(CoiDeclaration).where(
                    CoiDeclaration.user_id == principal.user_id,
                    CoiDeclaration.application_id == application.id,
                )
            )
            declaration = declared.scalar_one_or_none()
            if declaration is not None and declaration.has_conflict:
                continue
            scored = await session.execute(
                select(EvaluationScore).where(
                    EvaluationScore.application_id == application.id,
                    EvaluationScore.evaluator_id == principal.user_id,
                ).limit(1)
            )
            if scored.scalar_one_or_none() is None:
                pending += 1
        if pending:
            due, overdue = _due(challenge.evaluation_deadline, now)
            out.append(
                Task(
                    id="score-" + challenge.id,
                    kind="score_applications",
                    title="Score " + str(pending) + " application(s) on " + challenge.title,
                    detail="Round one is blind. Declare any conflict before scoring, and give a "
                    "one-line justification for every criterion.",
                    action_label="Start scoring",
                    link="/evaluation/" + challenge.id,
                    due_at=due,
                    overdue=overdue,
                    priority=0 if overdue else 1,
                    entity_type="challenge",
                    entity_id=challenge.id,
                    role=Role.EXPERT_EVALUATOR,
                )
            )
    return out


async def _validator_tasks(session: AsyncSession, principal: Principal, now: datetime) -> list[Task]:
    out: list[Task] = []
    memberships = await session.execute(
        select(PanelMember, Challenge)
        .join(Challenge, Challenge.id == PanelMember.challenge_id)
        .where(
            PanelMember.user_id == principal.user_id,
            PanelMember.role == Role.INDEPENDENT_VALIDATOR,
            PanelMember.active.is_(True),
        )
    )
    for _member, challenge in memberships.all():
        pilot_row = await session.execute(select(Pilot).where(Pilot.challenge_id == challenge.id))
        pilot = pilot_row.scalar_one_or_none()
        if pilot is None:
            continue
        report_row = await session.execute(
            select(EvidenceReport).where(
                EvidenceReport.pilot_id == pilot.id,
                EvidenceReport.status == EvidenceStatus.AWAITING_VALIDATION,
            )
        )
        report = report_row.scalar_one_or_none()
        if report is None:
            continue
        out.append(
            Task(
                id="validate-" + report.id,
                kind="validate_evidence",
                title="Verify and sign off the Evidence Report for " + challenge.title,
                detail="Raw submissions, the baseline and the pre-registered plan are in your "
                "workspace. Complete the checklist before signing.",
                action_label="Open workspace",
                link="/validation/" + report.id,
                due_at=None,
                overdue=False,
                priority=1,
                entity_type="evidence_report",
                entity_id=report.id,
                role=Role.INDEPENDENT_VALIDATOR,
            )
        )
    return out

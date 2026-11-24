"""Who gets told what, and in what words (PRD 5.13).

Each message states what happened, what is needed, by whom and by when. Plain text,
no emojis, no marketing language. Every rule here maps one committed event to a list
of recipients, so a change in wording never changes who is notified.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import format_ist
from app.core.money import format_inr
from app.domain.states import Role
from app.models.application import Application
from app.models.challenge import Challenge
from app.models.evaluation import PanelMember
from app.models.evidence import EvidenceReport
from app.models.identity import AppUser, RoleAssignment
from app.models.payment import Milestone
from app.models.pilot import Pilot
from app.models.scale import InnovationPassport
from app.services.notifications import compose


async def _users_with_role_in_department(
    session: AsyncSession, role: str, department_id: str | None
) -> list[AppUser]:
    if not department_id:
        return []
    rows = await session.execute(
        select(AppUser)
        .join(RoleAssignment, RoleAssignment.user_id == AppUser.id)
        .where(
            RoleAssignment.role == role,
            AppUser.status == "Active",
            (RoleAssignment.scope_id == department_id) | (AppUser.department_id == department_id),
        )
    )
    seen: dict[str, AppUser] = {}
    for user in rows.scalars().all():
        seen[user.id] = user
    return list(seen.values())


async def _startup_users(session: AsyncSession, startup_id: str | None) -> list[AppUser]:
    if not startup_id:
        return []
    rows = await session.execute(
        select(AppUser).where(AppUser.startup_id == startup_id, AppUser.status == "Active")
    )
    return list(rows.scalars().all())


async def _panel_users(session: AsyncSession, challenge_id: str, role: str) -> list[AppUser]:
    rows = await session.execute(
        select(AppUser)
        .join(PanelMember, PanelMember.user_id == AppUser.id)
        .where(
            PanelMember.challenge_id == challenge_id,
            PanelMember.role == role,
            PanelMember.active.is_(True),
        )
    )
    return list(rows.scalars().all())


def _item(
    user: AppUser,
    *,
    title: str,
    body: str,
    link: str | None = None,
    action_required: bool = False,
    due_at: datetime | None = None,
) -> dict[str, Any]:
    return {
        "user_id": user.id,
        "title": title,
        "body": body,
        "link": link,
        "action_required": action_required,
        "due_at": due_at,
    }


async def recipients_for(
    session: AsyncSession, event_type: str, aggregate_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    """Map one committed event to the people who need to know, and what they must do."""
    out: list[dict[str, Any]] = []

    if event_type.startswith("challenge."):
        out.extend(await _challenge_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("application."):
        out.extend(await _application_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("pilot."):
        out.extend(await _pilot_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("milestone."):
        out.extend(await _milestone_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("evidence."):
        out.extend(await _evidence_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("scale."):
        out.extend(await _scale_events(session, event_type, aggregate_id, payload))
    elif event_type.startswith("passport."):
        out.extend(await _passport_events(session, event_type, aggregate_id, payload))

    return out


async def _challenge_events(
    session: AsyncSession, event_type: str, challenge_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    challenge = await session.get(Challenge, challenge_id)
    if challenge is None:
        return []
    department_id = challenge.department_id
    link = "/challenges/" + challenge_id
    out: list[dict[str, Any]] = []

    if event_type == "challenge.submitted":
        for user in await _users_with_role_in_department(session, Role.DEPARTMENT_APPROVER, department_id):
            if user.id == challenge.created_by:
                continue
            out.append(
                _item(
                    user,
                    title="Challenge awaiting your approval: " + challenge.title,
                    body=compose(
                        what_happened="A challenge was submitted for approval.",
                        what_is_needed="Read the one-page summary and approve it for publication, "
                        "or return it with comments",
                        by_whom="Department Approver",
                    ),
                    link=link + "/review",
                    action_required=True,
                )
            )

    elif event_type == "challenge.returned":
        creator = await session.get(AppUser, challenge.created_by)
        if creator:
            out.append(
                _item(
                    creator,
                    title="Challenge returned for revision: " + challenge.title,
                    body=compose(
                        what_happened="The approver returned this challenge with comments: "
                        + str(payload.get("reason", "")),
                        what_is_needed="Revise the challenge and submit it again",
                        by_whom="Department Officer",
                    ),
                    link=link + "/edit",
                    action_required=True,
                )
            )

    elif event_type == "challenge.published":
        creator = await session.get(AppUser, challenge.created_by)
        if creator:
            out.append(
                _item(
                    creator,
                    title="Challenge published: " + challenge.title,
                    body=compose(
                        what_happened="The approver published this challenge. It is now on the "
                        "public challenge board and matched startups are being notified.",
                        what_is_needed="No action is needed until applications close",
                        by_whom="Department Officer",
                        by_when=format_ist(challenge.application_deadline)
                        if challenge.application_deadline
                        else None,
                    ),
                    link=link,
                )
            )

    elif event_type == "challenge.applications_closed":
        for user in await _users_with_role_in_department(session, Role.DEPARTMENT_OFFICER, department_id):
            out.append(
                _item(
                    user,
                    title="Applications closed: " + challenge.title,
                    body=compose(
                        what_happened="The application deadline passed and every submitted "
                        "application is now locked.",
                        what_is_needed="Run eligibility screening",
                        by_whom="Department Officer",
                    ),
                    link=link + "/screening",
                    action_required=True,
                )
            )

    elif event_type == "challenge.corrigendum":
        rows = await session.execute(
            select(Application).where(Application.challenge_id == challenge_id)
        )
        for application in rows.scalars().all():
            for user in await _startup_users(session, application.startup_id):
                out.append(
                    _item(
                        user,
                        title="Corrigendum issued on " + challenge.title,
                        body=compose(
                            what_happened="Corrigendum " + str(payload.get("number", ""))
                            + ": " + str(payload.get("summary", "")),
                            what_is_needed="Review the change and update your application if needed",
                            by_whom="your startup",
                            by_when=format_ist(challenge.application_deadline)
                            if challenge.application_deadline
                            else None,
                        ),
                        link=link,
                        action_required=True,
                    )
                )

    elif event_type == "challenge.clarification_answered":
        rows = await session.execute(
            select(Application).where(Application.challenge_id == challenge_id)
        )
        for application in rows.scalars().all():
            for user in await _startup_users(session, application.startup_id):
                out.append(
                    _item(
                        user,
                        title="A clarification was published on " + challenge.title,
                        body=compose(
                            what_happened="The department published an answer to a question. "
                            "Answers are published to all applicants at once and are anonymised.",
                            what_is_needed="Read the answer on the challenge page",
                            by_whom="your startup",
                        ),
                        link=link + "/clarifications",
                    )
                )

    elif event_type == "challenge.panel_assigned":
        for user in await _panel_users(session, challenge_id, Role.EXPERT_EVALUATOR):
            out.append(
                _item(
                    user,
                    title="You have been assigned to evaluate: " + challenge.title,
                    body=compose(
                        what_happened="You were added to the evaluation panel for this challenge.",
                        what_is_needed="Declare any conflict of interest, then score the "
                        "applications. Round one is blind",
                        by_whom="Expert Evaluator",
                        by_when=format_ist(challenge.evaluation_deadline)
                        if challenge.evaluation_deadline
                        else None,
                    ),
                    link="/evaluation/" + challenge_id,
                    action_required=True,
                    due_at=challenge.evaluation_deadline,
                )
            )
        for user in await _panel_users(session, challenge_id, Role.INDEPENDENT_VALIDATOR):
            out.append(
                _item(
                    user,
                    title="You have been assigned as independent validator: " + challenge.title,
                    body=compose(
                        what_happened="You were named as the independent validator for the pilot "
                        "arising from this challenge.",
                        what_is_needed="No action until the pilot completes and the Evidence "
                        "Report is ready for verification",
                        by_whom="Independent Validator",
                    ),
                    link="/challenges/" + challenge_id,
                )
            )

    elif event_type == "challenge.scores_locked":
        for user in await _users_with_role_in_department(session, Role.DEPARTMENT_APPROVER, department_id):
            out.append(
                _item(
                    user,
                    title="Scores locked, shortlist awaiting confirmation: " + challenge.title,
                    body=compose(
                        what_happened="Every evaluator has submitted and the scores are locked.",
                        what_is_needed="Review the ranking and confirm the shortlist",
                        by_whom="Department Approver",
                    ),
                    link=link + "/ranking",
                    action_required=True,
                )
            )

    elif event_type == "challenge.shortlist_confirmed":
        for application_id in payload.get("shortlisted_application_ids", []):
            shortlisted = await session.get(Application, application_id)
            if shortlisted is None:
                continue
            application = shortlisted
            for user in await _startup_users(session, application.startup_id):
                out.append(
                    _item(
                        user,
                        title="Your application was shortlisted: " + challenge.title,
                        body=compose(
                            what_happened="The department confirmed the shortlist and your "
                            "application is on it.",
                            what_is_needed="Wait for the pilot design and agreement, then review "
                            "and accept the agreement",
                            by_whom="your startup",
                        ),
                        link="/applications/" + application_id,
                    )
                )
        for user in await _users_with_role_in_department(session, Role.DEPARTMENT_OFFICER, department_id):
            out.append(
                _item(
                    user,
                    title="Shortlist confirmed: " + challenge.title,
                    body=compose(
                        what_happened="The approver confirmed the shortlist.",
                        what_is_needed="Run the Pilot Flight Simulator and freeze a pilot design",
                        by_whom="Department Officer",
                    ),
                    link=link + "/pilot",
                    action_required=True,
                )
            )

    elif event_type == "challenge.cancelled":
        rows = await session.execute(
            select(Application).where(Application.challenge_id == challenge_id)
        )
        for application in rows.scalars().all():
            for user in await _startup_users(session, application.startup_id):
                out.append(
                    _item(
                        user,
                        title="Challenge cancelled: " + challenge.title,
                        body=compose(
                            what_happened="The department cancelled this challenge. Reason: "
                            + str(payload.get("reason", "not stated")),
                            what_is_needed="No further action is needed on this application",
                            by_whom="your startup",
                        ),
                        link=link,
                    )
                )
    return out


async def _application_events(
    session: AsyncSession, event_type: str, application_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    application = await session.get(Application, application_id)
    if application is None:
        return []
    challenge = await session.get(Challenge, application.challenge_id)
    out: list[dict[str, Any]] = []

    if event_type == "application.submitted":
        for user in await _startup_users(session, application.startup_id):
            out.append(
                _item(
                    user,
                    title="Application submitted: " + (challenge.title if challenge else ""),
                    body=compose(
                        what_happened="Your application " + application.reference
                        + " was received. You can edit it until the deadline; the last submitted "
                        "version is the one that counts.",
                        what_is_needed="No action needed now",
                        by_whom="your startup",
                        by_when=format_ist(challenge.application_deadline)
                        if challenge and challenge.application_deadline
                        else None,
                    ),
                    link="/applications/" + application_id,
                )
            )

    elif event_type == "application.eligibility_decided":
        outcome = str(payload.get("outcome", ""))
        for user in await _startup_users(session, application.startup_id):
            if outcome == "Eligible":
                body = compose(
                    what_happened="Your application passed eligibility screening. "
                    + str(payload.get("summary", "")),
                    what_is_needed="No action needed. Evaluation follows",
                    by_whom="your startup",
                )
            else:
                body = compose(
                    what_happened=str(payload.get("summary", "")),
                    what_is_needed="Read the reasons on your application page. You may raise a "
                    "clarification within 3 days",
                    by_whom="your startup",
                )
            out.append(
                _item(
                    user,
                    title="Eligibility result: " + (challenge.title if challenge else ""),
                    body=body,
                    link="/applications/" + application_id,
                    action_required=outcome != "Eligible",
                )
            )

    elif event_type == "application.eligibility_overridden":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_APPROVER, challenge.department_id if challenge else None
        ):
            out.append(
                _item(
                    user,
                    title="An eligibility result was overridden",
                    body=compose(
                        what_happened="An officer changed the screening result for application "
                        + application.reference + " from " + str(payload.get("from"))
                        + " to " + str(payload.get("to")) + ". Justification: "
                        + str(payload.get("justification", "")),
                        what_is_needed="Review the justification. It is recorded in the audit log",
                        by_whom="Department Approver",
                    ),
                    link="/challenges/" + application.challenge_id + "/screening",
                )
            )
    return out


async def _pilot_events(
    session: AsyncSession, event_type: str, pilot_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    pilot = await session.get(Pilot, pilot_id)
    if pilot is None:
        return []
    link = "/pilots/" + pilot_id
    out: list[dict[str, Any]] = []

    if event_type == "pilot.agreement_drafted":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_APPROVER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Pilot agreement awaiting approval: " + pilot.reference,
                    body=compose(
                        what_happened="Version " + str(payload.get("version"))
                        + " of the pilot agreement was drafted.",
                        what_is_needed="Review the terms, milestones and data clauses, then approve",
                        by_whom="Department Approver",
                    ),
                    link=link + "/agreement",
                    action_required=True,
                )
            )

    elif event_type == "pilot.agreement_approved":
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Pilot agreement ready for your acceptance: " + pilot.reference,
                    body=compose(
                        what_happened="The department approved the pilot agreement.",
                        what_is_needed="Complete the cybersecurity checklist, then accept the "
                        "agreement or request changes",
                        by_whom="your startup",
                    ),
                    link=link + "/agreement",
                    action_required=True,
                )
            )

    elif event_type == "pilot.agreement_accepted":
        for role in (Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER):
            for user in await _users_with_role_in_department(session, role, pilot.department_id):
                out.append(
                    _item(
                        user,
                        title="Pilot started: " + pilot.reference,
                        body=compose(
                            what_happened="The startup accepted the agreement and the pilot is "
                            "now active. The pre-registered plan is locked.",
                            what_is_needed="Monitor measurement completeness on the pilot dashboard",
                            by_whom="Department Officer",
                        ),
                        link=link,
                    )
                )

    elif event_type == "pilot.changes_requested":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_OFFICER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Startup requested changes to the agreement: " + pilot.reference,
                    body=compose(
                        what_happened="The startup asked for changes: " + str(payload.get("reason", "")),
                        what_is_needed="Review the request and issue a revised agreement version",
                        by_whom="Department Officer",
                    ),
                    link=link + "/agreement",
                    action_required=True,
                )
            )

    elif event_type in ("pilot.paused", "pilot.resumed", "pilot.terminated"):
        word = {"pilot.paused": "paused", "pilot.resumed": "resumed", "pilot.terminated": "terminated"}[
            event_type
        ]
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Pilot " + word + ": " + pilot.reference,
                    body=compose(
                        what_happened="The department " + word + " this pilot. Reason: "
                        + str(payload.get("reason", "not stated")),
                        what_is_needed="Read the reason and contact the department if anything is "
                        "unclear",
                        by_whom="your startup",
                    ),
                    link=link,
                    action_required=word == "terminated",
                )
            )

    elif event_type == "pilot.completed":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_OFFICER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Pilot complete, evidence analysis due: " + pilot.reference,
                    body=compose(
                        what_happened="The pilot finished and the final measurements are in.",
                        what_is_needed="Run the Evidence Engine, then send the report for "
                        "independent validation",
                        by_whom="Department Officer",
                    ),
                    link=link + "/evidence",
                    action_required=True,
                )
            )
    return out


async def _milestone_events(
    session: AsyncSession, event_type: str, milestone_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    milestone = await session.get(Milestone, milestone_id)
    if milestone is None:
        return []
    pilot = await session.get(Pilot, milestone.pilot_id)
    if pilot is None:
        return []
    link = "/pilots/" + pilot.id + "/milestones"
    due = milestone.sla_due_at
    due_text = format_ist(due) if due else None
    label = "milestone " + str(milestone.seq) + ": " + milestone.title
    out: list[dict[str, Any]] = []

    if event_type == "milestone.submitted":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_OFFICER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Evidence submitted for " + label,
                    body=compose(
                        what_happened="The startup submitted evidence for this milestone.",
                        what_is_needed="Accept it, or reject it citing the evidence requirement "
                        "that was not met",
                        by_whom="Department Officer",
                        by_when=due_text,
                    ),
                    link=link,
                    action_required=True,
                    due_at=due,
                )
            )

    elif event_type == "milestone.accepted":
        for user in await _users_with_role_in_department(
            session, Role.DEPARTMENT_APPROVER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Payment approval needed for " + label,
                    body=compose(
                        what_happened="The officer accepted this milestone. Amount "
                        + format_inr(milestone.amount_paise) + " rupees.",
                        what_is_needed="Approve the payment so the finance office can release it",
                        by_whom="Department Approver",
                        by_when=due_text,
                    ),
                    link=link,
                    action_required=True,
                    due_at=due,
                )
            )
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Milestone accepted: " + label,
                    body=compose(
                        what_happened="The department accepted your evidence. The milestone is "
                        "now with the approver for payment approval.",
                        what_is_needed="No action needed",
                        by_whom="your startup",
                    ),
                    link=link,
                )
            )

    elif event_type == "milestone.rejected":
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Milestone returned: " + label,
                    body=compose(
                        what_happened="The department did not accept the evidence. Requirement "
                        "not met: " + str(milestone.unmet_requirement or ""),
                        what_is_needed="Supply the missing evidence and submit again. The clock "
                        "restarts when you resubmit",
                        by_whom="your startup",
                    ),
                    link=link,
                    action_required=True,
                )
            )

    elif event_type == "milestone.payment_approved":
        for user in await _users_with_role_in_department(
            session, Role.FINANCE_OFFICER, pilot.department_id
        ):
            out.append(
                _item(
                    user,
                    title="Release due for " + label,
                    body=compose(
                        what_happened="Payment of " + format_inr(milestone.amount_paise)
                        + " rupees was approved.",
                        what_is_needed="Record the release reference, amount and date",
                        by_whom="Finance Officer",
                        by_when=due_text,
                    ),
                    link="/finance/queue",
                    action_required=True,
                    due_at=due,
                )
            )
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Payment approved for " + label,
                    body=compose(
                        what_happened="The approver cleared payment of "
                        + format_inr(milestone.amount_paise) + " rupees.",
                        what_is_needed="No action needed. The finance office will record the release",
                        by_whom="your startup",
                        by_when=due_text,
                    ),
                    link=link,
                )
            )

    elif event_type == "milestone.paid":
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Payment released for " + label,
                    body=compose(
                        what_happened="The finance office recorded release of "
                        + format_inr(milestone.amount_paise) + " rupees.",
                        what_is_needed="Check the reference on the milestone page against your "
                        "bank record",
                        by_whom="your startup",
                    ),
                    link=link,
                )
            )

    elif event_type == "milestone.sla_reminder":
        owner_role = str(payload.get("owner_role", ""))
        targets = (
            await _users_with_role_in_department(session, owner_role, pilot.department_id)
            if owner_role
            else []
        )
        for user in targets:
            out.append(
                _item(
                    user,
                    title="Service level nearly due on " + label,
                    body=compose(
                        what_happened=str(payload.get("hours_remaining", ""))
                        + " hours remain on the service level for this milestone in state "
                        + str(payload.get("state", "")) + ".",
                        what_is_needed="Act on this item before the service level expires",
                        by_whom=owner_role,
                        by_when=due_text,
                    ),
                    link=link,
                    action_required=True,
                    due_at=due,
                )
            )

    elif event_type == "milestone.sla_breached":
        escalate_to = str(payload.get("escalate_to_role", ""))
        owner_role = str(payload.get("owner_role", ""))
        for user in await _users_with_role_in_department(session, escalate_to, pilot.department_id):
            out.append(
                _item(
                    user,
                    title="Service level breached on " + label,
                    body=compose(
                        what_happened="This milestone has been in state "
                        + str(payload.get("state", "")) + " past its service level by "
                        + str(payload.get("overdue_hours", "")) + " hours. It was held by "
                        + owner_role + ".",
                        what_is_needed="Escalated to you. Clear it or direct the holder to act",
                        by_whom=escalate_to,
                    ),
                    link=link,
                    action_required=True,
                    due_at=due,
                )
            )
        for user in await _users_with_role_in_department(session, owner_role, pilot.department_id):
            out.append(
                _item(
                    user,
                    title="You missed the service level on " + label,
                    body=compose(
                        what_happened="This milestone passed its service level while held by you "
                        "and has been escalated.",
                        what_is_needed="Act on it now",
                        by_whom=owner_role,
                    ),
                    link=link,
                    action_required=True,
                )
            )
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Your milestone is overdue with the department: " + label,
                    body=compose(
                        what_happened="The department has passed its own service level on this "
                        "milestone. It has been escalated automatically.",
                        what_is_needed="No action needed from you",
                        by_whom="your startup",
                    ),
                    link=link,
                )
            )
    return out


async def _evidence_events(
    session: AsyncSession, event_type: str, report_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    report = await session.get(EvidenceReport, report_id)
    if report is None:
        return []
    pilot = await session.get(Pilot, report.pilot_id)
    if pilot is None:
        return []
    out: list[dict[str, Any]] = []

    if event_type == "evidence.generated":
        for user in await _panel_users(session, pilot.challenge_id, Role.INDEPENDENT_VALIDATOR):
            out.append(
                _item(
                    user,
                    title="Evidence Report ready for validation: " + report.reference,
                    body=compose(
                        what_happened="The pre-registered analysis was run and the report is "
                        "ready for independent verification.",
                        what_is_needed="Verify data provenance, re-run the calculation, review "
                        "deviations, then sign off or refuse",
                        by_whom="Independent Validator",
                    ),
                    link="/validation/" + report.id,
                    action_required=True,
                )
            )

    elif event_type == "evidence.signed_off":
        status = str(payload.get("status", ""))
        for role in (Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER):
            for user in await _users_with_role_in_department(session, role, pilot.department_id):
                if status == "Refused":
                    body = compose(
                        what_happened="The independent validator refused to sign off. No Evidence "
                        "Confidence Score is issued and no Scale decision can be recorded on this "
                        "pilot. Remarks: " + str(report.remarks or ""),
                        what_is_needed="Read the remarks and decide whether to extend or close "
                        "the pilot",
                        by_whom=role,
                    )
                else:
                    body = compose(
                        what_happened="The validator signed off. Evidence Confidence Score "
                        + str(payload.get("confidence_score")) + " out of 100, band "
                        + str(payload.get("band")) + ".",
                        what_is_needed="Review the pathway recommendation and record the scale "
                        "decision",
                        by_whom=role,
                    )
                out.append(
                    _item(
                        user,
                        title="Evidence Report validated: " + report.reference,
                        body=body,
                        link="/pilots/" + pilot.id + "/evidence",
                        action_required=role == Role.DEPARTMENT_APPROVER,
                    )
                )
        for user in await _startup_users(session, pilot.startup_id):
            out.append(
                _item(
                    user,
                    title="Your pilot has been independently validated: " + report.reference,
                    body=compose(
                        what_happened="The independent validator completed verification of the "
                        "Evidence Report for your pilot.",
                        what_is_needed="Read the report. If the result is validated, an Innovation "
                        "Passport is issued that you can share with other departments",
                        by_whom="your startup",
                    ),
                    link="/pilots/" + pilot.id + "/evidence",
                )
            )
    return out


async def _scale_events(
    session: AsyncSession, event_type: str, pilot_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    pilot = await session.get(Pilot, pilot_id)
    if pilot is None:
        return []
    decision = str(payload.get("decision", ""))
    out: list[dict[str, Any]] = []
    for user in await _startup_users(session, pilot.startup_id):
        out.append(
            _item(
                user,
                title="Decision recorded on pilot " + pilot.reference + ": " + decision,
                body=compose(
                    what_happened="The competent authority recorded the decision " + decision
                    + " on this pilot.",
                    what_is_needed="Read the decision and the reasons on the pilot page",
                    by_whom="your startup",
                ),
                link="/pilots/" + pilot_id + "/decision",
            )
        )
    for user in await _users_with_role_in_department(
        session, Role.DEPARTMENT_OFFICER, pilot.department_id
    ):
        out.append(
            _item(
                user,
                title="Decision recorded: " + decision,
                body=compose(
                    what_happened="The approver recorded " + decision + " on pilot "
                    + pilot.reference + ".",
                    what_is_needed="If the decision is Scale, take the procurement handoff pack "
                    "to the procurement cell",
                    by_whom="Department Officer",
                ),
                link="/pilots/" + pilot_id + "/decision",
                action_required=decision == "Scale",
            )
        )
    return out


async def _passport_events(
    session: AsyncSession, event_type: str, passport_id: str, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    passport = await session.get(InnovationPassport, passport_id)
    if passport is None:
        return []
    out: list[dict[str, Any]] = []

    if event_type == "passport.issued":
        for user in await _startup_users(session, passport.startup_id):
            out.append(
                _item(
                    user,
                    title="Innovation Passport issued: " + passport.reference,
                    body=compose(
                        what_happened="Your validated pilot result was packaged as an Innovation "
                        "Passport with a score of " + str(passport.confidence_score)
                        + " out of 100.",
                        what_is_needed="Share the read-only link with other departments so they "
                        "can reuse the evidence instead of repeating the pilot",
                        by_whom="your startup",
                    ),
                    link="/passports/" + passport.id,
                )
            )

    elif event_type == "passport.adoption_requested":
        for role in (Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER):
            for user in await _users_with_role_in_department(
                session, role, str(payload.get("original_department_id"))
            ):
                out.append(
                    _item(
                        user,
                        title="Another department wants to reuse your validated pilot",
                        body=compose(
                            what_happened="An adoption request was raised against Innovation "
                            "Passport " + passport.reference + ".",
                            what_is_needed="No action is required. You may be contacted for "
                            "context about the original pilot",
                            by_whom=role,
                        ),
                        link="/passports/" + passport.id,
                    )
                )
        for user in await _startup_users(session, passport.startup_id):
            out.append(
                _item(
                    user,
                    title="A department raised an adoption request for " + passport.reference,
                    body=compose(
                        what_happened="A department asked to reuse your validated result.",
                        what_is_needed="Expect contact from that department",
                        by_whom="your startup",
                    ),
                    link="/passports/" + passport.id,
                )
            )
    return out

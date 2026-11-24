"""Payment Pulse (PRD 5.9).

Each milestone carries an SLA per state. A scheduler evaluates open milestones every
cycle: at 75 percent of an SLA the owner gets a reminder, and at breach the item
escalates to the next authority and is flagged on dashboards.

Exactly-once escalation is the property that matters and it is enforced three ways:
a single-leader lock on the scheduler, a batch claim that skips locked rows, and an
escalation_level check inside the same transaction as the escalation itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import claim_rows
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.policy import Principal
from app.domain.states import MilestoneState, Role, check_transition
from app.models.identity import Department
from app.models.payment import Milestone, PaymentRelease
from app.models.pilot import Pilot
from app.services import audit, outbox

# Which role holds a milestone in each state, and which SLA applies.
SLA_OWNER: dict[str, tuple[str, str]] = {
    MilestoneState.SUBMITTED: (Role.DEPARTMENT_OFFICER, "accept"),
    MilestoneState.ACCEPTED: (Role.DEPARTMENT_APPROVER, "approve"),
    MilestoneState.PAYMENT_APPROVED: (Role.FINANCE_OFFICER, "release"),
}

ESCALATION_TARGET: dict[str, str] = {
    MilestoneState.SUBMITTED: Role.DEPARTMENT_APPROVER,
    MilestoneState.ACCEPTED: Role.PLATFORM_ADMIN,
    MilestoneState.PAYMENT_APPROVED: Role.DEPARTMENT_APPROVER,
}

STATE_LABELS: dict[str, str] = {
    MilestoneState.PENDING: "Waiting for the startup to submit evidence",
    MilestoneState.SUBMITTED: "With the department officer for acceptance",
    MilestoneState.ACCEPTED: "With the approver for payment approval",
    MilestoneState.REJECTED: "Returned to the startup for resubmission",
    MilestoneState.PAYMENT_APPROVED: "With the finance office for release",
    MilestoneState.PAID: "Paid",
}

# Policy limits: a department may tighten an SLA but not loosen it beyond these.
SLA_MAX_DAYS = {"accept": 10, "approve": 7, "release": 10}


async def sla_days_for(session: AsyncSession, department_id: str, kind: str) -> int:
    department = await session.get(Department, department_id)
    default = {
        "accept": settings.sla_accept_days,
        "approve": settings.sla_approve_days,
        "release": settings.sla_release_days,
    }[kind]
    override = None
    if department is not None:
        override = getattr(department, "sla_" + kind + "_days", None)
    value = int(override) if override else default
    return max(1, min(value, SLA_MAX_DAYS[kind]))


async def get(session: AsyncSession, milestone_id: str) -> Milestone:
    milestone = await session.get(Milestone, milestone_id)
    if milestone is None:
        raise NotFound("This milestone was not found.")
    return milestone


async def _enter_state(
    session: AsyncSession, milestone: Milestone, new_state: str, *, now: datetime
) -> None:
    """Move to a new state and start that state's SLA clock."""
    milestone.state = new_state
    milestone.state_entered_at = now
    milestone.escalation_level = 0
    milestone.reminder_sent_at = None

    owner = SLA_OWNER.get(new_state)
    if owner is None:
        milestone.sla_due_at = None
        milestone.sla_owner_role = None
    else:
        role, kind = owner
        pilot = await session.get(Pilot, milestone.pilot_id)
        days = await sla_days_for(session, pilot.department_id if pilot else "", kind)
        milestone.sla_owner_role = role
        milestone.sla_due_at = now + timedelta(days=days)

    history = list(milestone.state_history or [])
    history.append(
        {
            "state": new_state,
            "at": now.isoformat(),
            "sla_due_at": milestone.sla_due_at.isoformat() if milestone.sla_due_at else None,
        }
    )
    milestone.state_history = history
    milestone.version = (milestone.version or 0) + 1


async def transition(
    session: AsyncSession,
    milestone: Milestone,
    principal: Principal,
    action: str,
    *,
    actor_role: str,
    reason: str | None = None,
    payload: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> Milestone:
    """One guarded milestone transition. The caller must already hold the row lock."""
    transition_def = check_transition("milestone", action, milestone.state, reason)
    before = milestone.state
    now = utcnow()
    payload = payload or {}
    pilot = await session.get(Pilot, milestone.pilot_id)

    if action == "submit":
        note = str(payload.get("note", "")).strip()
        if not note:
            raise ValidationFailed(
                "Say what you are submitting for this milestone.",
                errors=[
                    {
                        "field": "note",
                        "detail": "No submission note was given.",
                        "fix": "Describe the evidence you are attaching against the requirement: "
                        + milestone.evidence_required,
                    }
                ],
            )
        milestone.submission_note = note
        milestone.submission_files = list(payload.get("file_ids") or [])
        if before == MilestoneState.REJECTED:
            milestone.resubmission_count += 1
            # The clock stopped only for the time the startup took to resubmit (FR-PP-03).
            paused = int((now - milestone.state_entered_at).total_seconds())
            milestone.clock_paused_seconds += paused
        milestone.rejection_reason = None
        milestone.unmet_requirement = None

    elif action == "accept":
        milestone.accepted_at = now

    elif action == "reject":
        unmet = str(payload.get("unmet_requirement", "")).strip()
        if not unmet:
            raise ValidationFailed(
                "A rejection must cite the evidence requirement that was not met.",
                errors=[
                    {
                        "field": "unmet_requirement",
                        "detail": "No requirement was cited.",
                        "fix": "Quote the part of the evidence requirement that is missing: "
                        + milestone.evidence_required,
                    }
                ],
            )
        milestone.rejection_reason = reason
        milestone.unmet_requirement = unmet

    elif action == "approve-payment":
        milestone.payment_approved_at = now

    elif action == "record-release":
        reference_no = str(payload.get("reference_no", "")).strip()
        if not reference_no:
            raise ValidationFailed(
                "A release must carry the payment reference number.",
                errors=[
                    {
                        "field": "reference_no",
                        "detail": "No reference number was given.",
                        "fix": "Enter the reference from the payment advice or treasury voucher.",
                    }
                ],
            )
        amount = int(payload.get("amount_paise", milestone.amount_paise))
        if amount != milestone.amount_paise:
            raise ValidationFailed(
                "The released amount must match the approved milestone amount.",
                errors=[
                    {
                        "field": "amount_paise",
                        "detail": "Approved "
                        + str(milestone.amount_paise)
                        + " paise, release quoted "
                        + str(amount)
                        + " paise.",
                        "fix": "Correct the amount, or raise an amendment if the approved amount "
                        "was wrong.",
                    }
                ],
            )
        release = PaymentRelease(
            milestone_id=milestone.id,
            reference_no=reference_no,
            amount_paise=amount,
            released_on=_parse_release_date(payload.get("released_on"), now),
            mode=str(payload.get("mode", "Bank transfer")),
            recorded_by=principal.user_id,
            remarks=str(payload.get("remarks", "")) or None,
        )
        session.add(release)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise Conflict(
                "A release has already been recorded for this milestone. Only one release per "
                "milestone is permitted."
            ) from None
        milestone.paid_at = release.released_on

    await _enter_state(session, milestone, transition_def.target, now=now)
    await session.flush()

    event_map = {
        "submit": "milestone.submitted",
        "accept": "milestone.accepted",
        "reject": "milestone.rejected",
        "approve-payment": "milestone.payment_approved",
        "record-release": "milestone.paid",
    }
    await audit.record(
        session,
        action="milestone." + action,
        entity_type="milestone",
        entity_id=milestone.id,
        actor_id=principal.user_id,
        actor_role=actor_role,
        department_id=pilot.department_id if pilot else None,
        before={"state": before},
        after={
            "state": milestone.state,
            "amount_paise": milestone.amount_paise,
            "sla_due_at": milestone.sla_due_at.isoformat() if milestone.sla_due_at else None,
        },
        reason=reason,
        request_id=request_id,
    )
    outbox.emit(
        session,
        aggregate_type="milestone",
        aggregate_id=milestone.id,
        event_type=event_map[action],
        payload={
            "pilot_id": milestone.pilot_id,
            "seq": milestone.seq,
            "title": milestone.title,
            "state": milestone.state,
            "amount_paise": milestone.amount_paise,
            "sla_due_at": milestone.sla_due_at.isoformat() if milestone.sla_due_at else None,
            "reason": reason,
        },
    )
    return milestone


def _parse_release_date(value: Any, default: datetime) -> datetime:
    if not value:
        return default
    if isinstance(value, datetime):
        return value
    from app.core.clock import UTC

    try:
        parsed = datetime.fromisoformat(str(value)[:19])
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except ValueError:
        return default


async def scan_slas(session: AsyncSession, *, batch_size: int = 200) -> dict[str, int]:
    """One scheduler cycle. Sends reminders at 75 percent and escalates at breach.

    The escalation_level check inside the transaction is what makes this exactly-once:
    a second scheduler instance that reaches the same row after the first has committed
    sees escalation_level already raised and does nothing.
    """
    now = utcnow()
    reminded = 0
    escalated = 0

    stmt = (
        select(Milestone)
        .where(
            Milestone.state.in_(tuple(SLA_OWNER.keys())),
            Milestone.sla_due_at.isnot(None),
        )
        .order_by(Milestone.sla_due_at.asc())
    )
    candidates = await claim_rows(session, stmt, limit=batch_size)

    for milestone in candidates:
        if milestone.sla_due_at is None or milestone.state not in SLA_OWNER:
            continue
        total = (milestone.sla_due_at - milestone.state_entered_at).total_seconds()
        elapsed = (now - milestone.state_entered_at).total_seconds()
        if total <= 0:
            continue
        fraction = elapsed / total

        if now >= milestone.sla_due_at and milestone.escalation_level == 0:
            milestone.escalation_level = 1
            milestone.version = (milestone.version or 0) + 1
            escalated += 1
            pilot = await session.get(Pilot, milestone.pilot_id)
            await audit.record(
                session,
                action="milestone.sla_breached",
                entity_type="milestone",
                entity_id=milestone.id,
                actor_id=None,
                actor_role=Role.PLATFORM_ADMIN,
                department_id=pilot.department_id if pilot else None,
                before={"escalation_level": 0},
                after={"escalation_level": 1, "state": milestone.state},
                reason="Service level for state " + milestone.state + " was exceeded.",
            )
            outbox.emit(
                session,
                aggregate_type="milestone",
                aggregate_id=milestone.id,
                event_type="milestone.sla_breached",
                payload={
                    "pilot_id": milestone.pilot_id,
                    "seq": milestone.seq,
                    "title": milestone.title,
                    "state": milestone.state,
                    "owner_role": milestone.sla_owner_role,
                    "escalate_to_role": ESCALATION_TARGET.get(milestone.state),
                    "due_at": milestone.sla_due_at.isoformat(),
                    "overdue_hours": round((now - milestone.sla_due_at).total_seconds() / 3600, 1),
                },
            )
        elif (
            fraction >= settings.sla_reminder_fraction
            and milestone.reminder_sent_at is None
            and now < milestone.sla_due_at
        ):
            milestone.reminder_sent_at = now
            milestone.version = (milestone.version or 0) + 1
            reminded += 1
            outbox.emit(
                session,
                aggregate_type="milestone",
                aggregate_id=milestone.id,
                event_type="milestone.sla_reminder",
                payload={
                    "pilot_id": milestone.pilot_id,
                    "seq": milestone.seq,
                    "title": milestone.title,
                    "state": milestone.state,
                    "owner_role": milestone.sla_owner_role,
                    "due_at": milestone.sla_due_at.isoformat(),
                    "hours_remaining": round(
                        (milestone.sla_due_at - now).total_seconds() / 3600, 1
                    ),
                },
            )

    await session.flush()
    return {"scanned": len(candidates), "reminded": reminded, "escalated": escalated}


async def for_pilot(session: AsyncSession, pilot_id: str) -> list[Milestone]:
    rows = await session.execute(
        select(Milestone).where(Milestone.pilot_id == pilot_id).order_by(Milestone.seq.asc())
    )
    return list(rows.scalars().all())


async def finance_queue(session: AsyncSession, department_id: str, limit: int = 100) -> list[Milestone]:
    """Approved milestones sorted by SLA deadline (FR-PP-04)."""
    rows = await session.execute(
        select(Milestone)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(
            Pilot.department_id == department_id,
            Milestone.state == MilestoneState.PAYMENT_APPROVED,
        )
        .order_by(Milestone.sla_due_at.asc().nulls_last())
        .limit(limit)
    )
    return list(rows.scalars().all())


def view(milestone: Milestone, *, now: datetime | None = None) -> dict[str, Any]:
    """What the startup sees: state, who holds it, days remaining (FR-PP-05)."""
    now = now or utcnow()
    days_remaining = None
    overdue = False
    if milestone.sla_due_at is not None:
        delta = (milestone.sla_due_at - now).total_seconds() / 86400.0
        days_remaining = round(delta, 1)
        overdue = delta < 0
    return {
        "id": milestone.id,
        "pilot_id": milestone.pilot_id,
        "seq": milestone.seq,
        "title": milestone.title,
        "deliverable": milestone.deliverable,
        "evidence_required": milestone.evidence_required,
        "amount_paise": milestone.amount_paise,
        "due_date": milestone.due_date.isoformat(),
        "state": milestone.state,
        "state_label": STATE_LABELS.get(milestone.state, milestone.state),
        "held_by_role": milestone.sla_owner_role,
        "sla_due_at": milestone.sla_due_at.isoformat() if milestone.sla_due_at else None,
        "days_remaining": days_remaining,
        "overdue": overdue,
        "escalation_level": milestone.escalation_level,
        "resubmission_count": milestone.resubmission_count,
        "rejection_reason": milestone.rejection_reason,
        "unmet_requirement": milestone.unmet_requirement,
        "submission_note": milestone.submission_note,
        "version": milestone.version,
        "state_history": milestone.state_history,
    }


async def department_report(session: AsyncSession, department_id: str, days: int = 90) -> dict[str, Any]:
    """Average days per state, adherence percentage, and breaches (FR-PP-06)."""
    since = utcnow() - timedelta(days=days)
    rows = await session.execute(
        select(Milestone)
        .join(Pilot, Pilot.id == Milestone.pilot_id)
        .where(Pilot.department_id == department_id, Milestone.updated_at >= since)
    )
    milestones = list(rows.scalars().all())

    durations: dict[str, list[float]] = {"accept": [], "approve": [], "release": []}
    breaches = 0
    paid_on_time = 0
    paid_total = 0

    for milestone in milestones:
        history = milestone.state_history or []
        entered: dict[str, datetime] = {}
        for entry in history:
            try:
                entered[entry["state"]] = datetime.fromisoformat(entry["at"])
            except (KeyError, ValueError):
                continue
        pairs = (
            ("accept", MilestoneState.SUBMITTED, MilestoneState.ACCEPTED),
            ("approve", MilestoneState.ACCEPTED, MilestoneState.PAYMENT_APPROVED),
            ("release", MilestoneState.PAYMENT_APPROVED, MilestoneState.PAID),
        )
        for kind, start_state, end_state in pairs:
            start, end = entered.get(start_state), entered.get(end_state)
            if start and end and end > start:
                durations[kind].append((end - start).total_seconds() / 86400.0)
        if milestone.escalation_level > 0:
            breaches += 1
        if milestone.state == MilestoneState.PAID:
            paid_total += 1
            if milestone.escalation_level == 0:
                paid_on_time += 1

    def average(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 2) if values else None

    return {
        "department_id": department_id,
        "window_days": days,
        "milestones_considered": len(milestones),
        "average_days": {
            "officer_acceptance": average(durations["accept"]),
            "approver_payment_approval": average(durations["approve"]),
            "finance_release": average(durations["release"]),
        },
        "sla_adherence_percent": round(100.0 * paid_on_time / paid_total, 1) if paid_total else None,
        "paid_milestones": paid_total,
        "breaches": breaches,
    }


async def open_breaches(session: AsyncSession, department_id: str | None = None) -> int:
    stmt = (
        select(func.count())
        .select_from(Milestone)
        .where(Milestone.escalation_level > 0, Milestone.state.in_(tuple(SLA_OWNER.keys())))
    )
    if department_id:
        stmt = stmt.join(Pilot, Pilot.id == Milestone.pilot_id).where(
            Pilot.department_id == department_id
        )
    result = await session.execute(stmt)
    return int(result.scalar_one())

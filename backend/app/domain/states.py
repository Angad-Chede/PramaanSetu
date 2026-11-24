"""State machines. Every transition names its actor role, precondition and artefact.

The server is the only authority on state: a transition that is not in these tables
cannot happen, whatever a client sends (PRD section 4).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.core.errors import TransitionNotAllowed


class Role(StrEnum):
    DEPARTMENT_OFFICER = "DO"
    DEPARTMENT_APPROVER = "DA"
    STARTUP_USER = "SU"
    EXPERT_EVALUATOR = "EE"
    INDEPENDENT_VALIDATOR = "IV"
    FINANCE_OFFICER = "FO"
    PLATFORM_ADMIN = "PA"


ROLE_LABELS: dict[str, str] = {
    Role.DEPARTMENT_OFFICER: "Department Officer",
    Role.DEPARTMENT_APPROVER: "Department Approver",
    Role.STARTUP_USER: "Startup User",
    Role.EXPERT_EVALUATOR: "Expert Evaluator",
    Role.INDEPENDENT_VALIDATOR: "Independent Validator",
    Role.FINANCE_OFFICER: "Finance Officer",
    Role.PLATFORM_ADMIN: "Platform Admin",
}

DEPARTMENT_ROLES = {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER}


class ChallengeState(StrEnum):
    DRAFT = "Draft"
    IN_REVIEW = "InReview"
    PUBLISHED = "Published"
    APPLICATIONS_CLOSED = "ApplicationsClosed"
    SCREENING = "Screening"
    EVALUATION = "Evaluation"
    SHORTLISTED = "Shortlisted"
    PILOT_DESIGN = "PilotDesign"
    PILOT_ACTIVE = "PilotActive"
    VALIDATION = "Validation"
    DECISION_PENDING = "DecisionPending"
    SCALED = "Scaled"
    CLOSED = "Closed"
    CANCELLED = "Cancelled"


TERMINAL_CHALLENGE_STATES = {ChallengeState.SCALED, ChallengeState.CLOSED, ChallengeState.CANCELLED}


class ApplicationState(StrEnum):
    DRAFT = "Draft"
    SUBMITTED = "Submitted"
    LOCKED = "Locked"
    SCREENED = "Screened"
    UNDER_EVALUATION = "UnderEvaluation"
    SHORTLISTED = "Shortlisted"
    NOT_SHORTLISTED = "NotShortlisted"
    WITHDRAWN = "Withdrawn"


class EligibilityOutcome(StrEnum):
    ELIGIBLE = "Eligible"
    INELIGIBLE = "Ineligible"
    NEEDS_REVIEW = "NeedsReview"


class PilotState(StrEnum):
    AGREEMENT_DRAFT = "AgreementDraft"
    AWAITING_STARTUP = "AwaitingStartup"
    ACTIVE = "Active"
    PAUSED = "Paused"
    COMPLETED = "Completed"
    TERMINATED = "Terminated"


class MilestoneState(StrEnum):
    PENDING = "Pending"
    SUBMITTED = "Submitted"
    ACCEPTED = "Accepted"
    REJECTED = "Rejected"
    PAYMENT_APPROVED = "PaymentApproved"
    PAID = "Paid"


OPEN_MILESTONE_STATES = (
    MilestoneState.SUBMITTED,
    MilestoneState.ACCEPTED,
    MilestoneState.PAYMENT_APPROVED,
)


class EvidenceStatus(StrEnum):
    DRAFT = "Draft"
    AWAITING_VALIDATION = "AwaitingValidation"
    SIGNED_OFF = "SignedOff"
    SIGNED_OFF_WITH_QUALIFICATIONS = "SignedOffWithQualifications"
    REFUSED = "Refused"


class ScaleDecisionType(StrEnum):
    SCALE = "Scale"
    EXTEND_PILOT = "ExtendPilot"
    CLOSE = "Close"


class AdoptionState(StrEnum):
    RAISED = "Raised"
    UNDER_REVIEW = "UnderReview"
    ACCEPTED = "Accepted"
    DECLINED = "Declined"


class JobStatus(StrEnum):
    QUEUED = "Queued"
    RUNNING = "Running"
    SUCCEEDED = "Succeeded"
    FAILED = "Failed"
    DEAD_LETTER = "DeadLetter"


class DpiitStatus(StrEnum):
    VERIFIED = "Verified"
    NOT_FOUND = "NotFound"
    PENDING = "Pending"


@dataclass(frozen=True)
class Transition:
    """One edge of a state machine, with the role allowed to take it."""

    action: str
    source: tuple[str, ...]
    target: str
    actor_roles: tuple[str, ...]
    artefact: str
    requires_reason: bool = False


CHALLENGE_TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        "submit",
        (ChallengeState.DRAFT,),
        ChallengeState.IN_REVIEW,
        (Role.DEPARTMENT_OFFICER,),
        "One-page summary sent for approval",
    ),
    Transition(
        "return",
        (ChallengeState.IN_REVIEW,),
        ChallengeState.DRAFT,
        (Role.DEPARTMENT_APPROVER,),
        "Approver comments",
        requires_reason=True,
    ),
    Transition(
        "approve",
        (ChallengeState.IN_REVIEW,),
        ChallengeState.PUBLISHED,
        (Role.DEPARTMENT_APPROVER,),
        "Published challenge record",
    ),
    Transition(
        "close-applications",
        (ChallengeState.PUBLISHED,),
        ChallengeState.APPLICATIONS_CLOSED,
        (Role.PLATFORM_ADMIN, Role.DEPARTMENT_OFFICER),
        "Deadline closure record",
    ),
    Transition(
        "screen",
        (ChallengeState.APPLICATIONS_CLOSED, ChallengeState.SCREENING),
        ChallengeState.SCREENING,
        (Role.DEPARTMENT_OFFICER,),
        "Eligibility result per application",
    ),
    Transition(
        "start-evaluation",
        (ChallengeState.SCREENING,),
        ChallengeState.EVALUATION,
        (Role.DEPARTMENT_OFFICER,),
        "Panel assignment",
    ),
    Transition(
        "lock-scores",
        (ChallengeState.EVALUATION,),
        ChallengeState.SHORTLISTED,
        (Role.DEPARTMENT_OFFICER, Role.PLATFORM_ADMIN),
        "Locked score sheet",
    ),
    Transition(
        "confirm-shortlist",
        (ChallengeState.SHORTLISTED,),
        ChallengeState.PILOT_DESIGN,
        (Role.DEPARTMENT_APPROVER,),
        "Confirmed shortlist",
    ),
    Transition(
        "activate-pilot",
        (ChallengeState.PILOT_DESIGN,),
        ChallengeState.PILOT_ACTIVE,
        (Role.STARTUP_USER, Role.DEPARTMENT_OFFICER),
        "Signed pilot agreement",
    ),
    Transition(
        "complete-pilot",
        (ChallengeState.PILOT_ACTIVE,),
        ChallengeState.VALIDATION,
        (Role.DEPARTMENT_OFFICER,),
        "Final metric submission",
    ),
    Transition(
        "sign-off",
        (ChallengeState.VALIDATION,),
        ChallengeState.DECISION_PENDING,
        (Role.INDEPENDENT_VALIDATOR,),
        "Validated Evidence Report",
    ),
    Transition(
        "scale",
        (ChallengeState.DECISION_PENDING,),
        ChallengeState.SCALED,
        (Role.DEPARTMENT_APPROVER,),
        "Scale decision and procurement handoff pack",
    ),
    Transition(
        "close",
        (ChallengeState.DECISION_PENDING,),
        ChallengeState.CLOSED,
        (Role.DEPARTMENT_APPROVER,),
        "Closure decision",
        requires_reason=True,
    ),
    Transition(
        "cancel",
        (
            ChallengeState.PUBLISHED,
            ChallengeState.APPLICATIONS_CLOSED,
            ChallengeState.SCREENING,
            ChallengeState.EVALUATION,
            ChallengeState.SHORTLISTED,
            ChallengeState.PILOT_DESIGN,
        ),
        ChallengeState.CANCELLED,
        (Role.DEPARTMENT_APPROVER,),
        "Cancellation record",
        requires_reason=True,
    ),
)

PILOT_TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        "approve-agreement",
        (PilotState.AGREEMENT_DRAFT,),
        PilotState.AWAITING_STARTUP,
        (Role.DEPARTMENT_APPROVER,),
        "Approved agreement version",
    ),
    Transition(
        "accept-agreement",
        (PilotState.AWAITING_STARTUP,),
        PilotState.ACTIVE,
        (Role.STARTUP_USER,),
        "Acceptance record with document hash",
    ),
    Transition(
        "request-changes",
        (PilotState.AWAITING_STARTUP,),
        PilotState.AGREEMENT_DRAFT,
        (Role.STARTUP_USER,),
        "Change request",
        requires_reason=True,
    ),
    Transition(
        "pause",
        (PilotState.ACTIVE,),
        PilotState.PAUSED,
        (Role.DEPARTMENT_OFFICER,),
        "Pause record",
        requires_reason=True,
    ),
    Transition(
        "resume",
        (PilotState.PAUSED,),
        PilotState.ACTIVE,
        (Role.DEPARTMENT_OFFICER,),
        "Resume record",
        requires_reason=True,
    ),
    Transition(
        "complete",
        (PilotState.ACTIVE,),
        PilotState.COMPLETED,
        (Role.DEPARTMENT_OFFICER,),
        "Final metric submission",
    ),
    Transition(
        "terminate",
        (PilotState.ACTIVE, PilotState.PAUSED, PilotState.AWAITING_STARTUP),
        PilotState.TERMINATED,
        (Role.DEPARTMENT_APPROVER,),
        "Termination record citing the exit clause",
        requires_reason=True,
    ),
)

MILESTONE_TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        "submit",
        (MilestoneState.PENDING, MilestoneState.REJECTED),
        MilestoneState.SUBMITTED,
        (Role.STARTUP_USER,),
        "Milestone evidence",
    ),
    Transition(
        "accept",
        (MilestoneState.SUBMITTED,),
        MilestoneState.ACCEPTED,
        (Role.DEPARTMENT_OFFICER,),
        "Acceptance record",
    ),
    Transition(
        "reject",
        (MilestoneState.SUBMITTED,),
        MilestoneState.REJECTED,
        (Role.DEPARTMENT_OFFICER,),
        "Rejection citing the unmet evidence requirement",
        requires_reason=True,
    ),
    Transition(
        "approve-payment",
        (MilestoneState.ACCEPTED,),
        MilestoneState.PAYMENT_APPROVED,
        (Role.DEPARTMENT_APPROVER,),
        "Payment approval",
    ),
    Transition(
        "record-release",
        (MilestoneState.PAYMENT_APPROVED,),
        MilestoneState.PAID,
        (Role.FINANCE_OFFICER,),
        "Release reference number",
    ),
)

_INDEX: dict[str, dict[str, Transition]] = {
    "challenge": {t.action: t for t in CHALLENGE_TRANSITIONS},
    "pilot": {t.action: t for t in PILOT_TRANSITIONS},
    "milestone": {t.action: t for t in MILESTONE_TRANSITIONS},
}


def get_transition(machine: str, action: str) -> Transition:
    try:
        return _INDEX[machine][action]
    except KeyError:
        raise TransitionNotAllowed(
            "The step " + repr(action) + " is not recognised for a " + machine + "."
        ) from None


def check_transition(
    machine: str, action: str, current_state: str, reason: str | None = None
) -> Transition:
    """Validate a transition before any write, with a plain-language explanation on failure."""
    transition = get_transition(machine, action)
    if current_state not in transition.source:
        allowed = sorted(t.action for t in _INDEX[machine].values() if current_state in t.source)
        message = (
            "This " + machine + " is in state " + repr(current_state) + ", so the step "
            + repr(action) + " is not available. "
        )
        message += (
            "Available now: " + ", ".join(allowed) + "."
            if allowed
            else "No further steps are available from this state."
        )
        raise TransitionNotAllowed(
            message,
            extra={"current_state": current_state, "available_actions": allowed},
        )
    if transition.requires_reason and not (reason or "").strip():
        raise TransitionNotAllowed(
            "The step " + repr(action) + " must be recorded with a written reason.",
            errors=[
                {
                    "field": "reason",
                    "detail": "A reason is required.",
                    "fix": "Write one or two sentences explaining the decision.",
                }
            ],
        )
    return transition


def available_actions(machine: str, current_state: str, roles: set[str]) -> list[str]:
    """Actions the holder of these roles can take right now. Used to drive the task inbox."""
    return sorted(
        t.action
        for t in _INDEX[machine].values()
        if current_state in t.source and (roles & set(t.actor_roles))
    )


def all_states(machine: str) -> set[str]:
    out: set[str] = set()
    for t in _INDEX[machine].values():
        out.update(t.source)
        out.add(t.target)
    return out


def all_transitions(machine: str) -> tuple[Transition, ...]:
    return tuple(_INDEX[machine].values())


def machines() -> tuple[str, ...]:
    return tuple(_INDEX.keys())

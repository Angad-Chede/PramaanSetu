"""Role-by-action authorisation matrix (PRD 3.2, 11.1, 14.1).

Deny by default: every role not listed against an action in the permission matrix is
refused. The matrix below is generated over every action the policy knows about, so a
new action added without a rule fails this test rather than silently allowing access.
"""

from __future__ import annotations

import pytest

from app.core.errors import Forbidden
from app.core.policy import ACTIONS, Principal, ScopedRole, can, require
from app.domain.states import Role

DEPARTMENT = "dept-1"
OTHER_DEPARTMENT = "dept-2"
STARTUP = "startup-1"
OTHER_STARTUP = "startup-2"
CHALLENGE = "challenge-1"


def principal(role: str, **kwargs) -> Principal:
    scopes: list[ScopedRole] = []
    department_id = kwargs.pop("department_id", DEPARTMENT)
    startup_id = kwargs.pop("startup_id", None)

    if role in (Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER):
        scopes.append(ScopedRole(role=role, scope_type="department", scope_id=department_id))
    elif role == Role.STARTUP_USER:
        startup_id = startup_id or STARTUP
        department_id = None
        scopes.append(ScopedRole(role=role, scope_type="startup", scope_id=startup_id))
    elif role in (Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR):
        department_id = None
        scopes.append(
            ScopedRole(role=role, scope_type="challenge", scope_id=kwargs.pop("challenge_id", CHALLENGE))
        )
    elif role == Role.PLATFORM_ADMIN:
        department_id = None
        scopes.append(ScopedRole(role=role, scope_type="global", scope_id=None))

    return Principal(
        user_id=kwargs.pop("user_id", "user-" + str(role)),
        name="Test",
        email=str(role).lower() + "@test.invalid",
        department_id=department_id,
        startup_id=startup_id,
        scoped_roles=scopes,
    )


OWN_RESOURCE = {
    "department_id": DEPARTMENT,
    "startup_id": STARTUP,
    "challenge_id": CHALLENGE,
    "state": "Published",
    "created_by": "someone-else",
    "approved_by": "someone-else",
    "uploaded_by": "someone-else",
    "results_published": True,
}

# The permission matrix from PRD 3.2, expressed as the roles allowed on each action
# when the resource is in the caller's own scope.
ALLOWED: dict[str, set[str]] = {
    "challenge:create": {Role.DEPARTMENT_OFFICER},
    "challenge:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
    },
    "challenge:update": set(),  # published challenges are immutable; see the draft test below
    "challenge:submit": {Role.DEPARTMENT_OFFICER},
    "challenge:approve": {Role.DEPARTMENT_APPROVER},
    "challenge:publish": {Role.DEPARTMENT_APPROVER},
    "challenge:cancel": {Role.DEPARTMENT_APPROVER},
    "challenge:corrigendum": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER},
    "challenge:clarify-ask": {Role.STARTUP_USER},
    "challenge:clarify-answer": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER},
    "challenge:ai-draft": {Role.DEPARTMENT_OFFICER},
    "challenge:matches": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.PLATFORM_ADMIN},
    "challenge:screen": {Role.DEPARTMENT_OFFICER},
    "challenge:panel": {Role.DEPARTMENT_OFFICER},
    "challenge:lock-scores": {Role.DEPARTMENT_OFFICER, Role.PLATFORM_ADMIN},
    "challenge:ranking": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.PLATFORM_ADMIN},
    "challenge:shortlist": {Role.DEPARTMENT_APPROVER},
    "startup:create": {Role.STARTUP_USER},
    "startup:read": {
        Role.STARTUP_USER, Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER,
        Role.FINANCE_OFFICER, Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "startup:update": {Role.STARTUP_USER},
    "startup:verify": {Role.STARTUP_USER, Role.DEPARTMENT_OFFICER},
    "application:create": {Role.STARTUP_USER},
    "application:read": {
        Role.STARTUP_USER, Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER,
        Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "application:read-blinded": {Role.EXPERT_EVALUATOR, Role.PLATFORM_ADMIN},
    "application:update": set(),  # only in Draft or Submitted; see the dedicated test
    "application:submit": {Role.STARTUP_USER},
    "application:override-eligibility": {Role.DEPARTMENT_OFFICER},
    "evaluation:declare-coi": {Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR},
    "evaluation:score": {Role.EXPERT_EVALUATOR},
    "evaluation:read-scores": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.EXPERT_EVALUATOR,
        Role.STARTUP_USER, Role.PLATFORM_ADMIN,
    },
    "simulation:create": {Role.DEPARTMENT_OFFICER},
    "simulation:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "design:freeze": {Role.DEPARTMENT_OFFICER},
    "pilot:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER,
        Role.STARTUP_USER, Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "pilot:create-agreement": {Role.DEPARTMENT_OFFICER},
    "pilot:approve-agreement": {Role.DEPARTMENT_APPROVER},
    "pilot:accept-agreement": {Role.STARTUP_USER},
    "pilot:request-changes": {Role.STARTUP_USER},
    "pilot:pause": {Role.DEPARTMENT_OFFICER},
    "pilot:resume": {Role.DEPARTMENT_OFFICER},
    "pilot:terminate": {Role.DEPARTMENT_APPROVER},
    "pilot:submit-metrics": {Role.STARTUP_USER, Role.DEPARTMENT_OFFICER},
    "pilot:read-metrics": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "pilot:dispute-metrics": {Role.DEPARTMENT_OFFICER},
    "pilot:cyber-checklist": {Role.STARTUP_USER},
    "milestone:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER,
        Role.STARTUP_USER, Role.PLATFORM_ADMIN,
    },
    "milestone:submit": {Role.STARTUP_USER},
    "milestone:accept": {Role.DEPARTMENT_OFFICER},
    "milestone:reject": {Role.DEPARTMENT_OFFICER},
    "milestone:approve-payment": {Role.DEPARTMENT_APPROVER},
    "milestone:record-release": {Role.FINANCE_OFFICER},
    "evidence:run": {Role.DEPARTMENT_OFFICER},
    "evidence:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER,
        Role.STARTUP_USER, Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "evidence:read-raw": {Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN},
    "evidence:sign-off": {Role.INDEPENDENT_VALIDATOR},
    "scale:pathway": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER},
    "scale:simulate": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER},
    "scale:decide": {Role.DEPARTMENT_APPROVER},
    "passport:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
    },
    "passport:adopt": {Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER},
    "passport:update": {Role.PLATFORM_ADMIN},
    "audit:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER,
        Role.STARTUP_USER, Role.INDEPENDENT_VALIDATOR, Role.PLATFORM_ADMIN,
    },
    "audit:verify": {Role.PLATFORM_ADMIN},
    "admin:manage": {Role.PLATFORM_ADMIN},
    "template:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
    },
    "template:manage": {Role.PLATFORM_ADMIN},
    "file:upload": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
    },
    "file:read": {
        Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
        Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
    },
}

ALL_ROLES = [
    Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.STARTUP_USER,
    Role.EXPERT_EVALUATOR, Role.INDEPENDENT_VALIDATOR, Role.FINANCE_OFFICER, Role.PLATFORM_ADMIN,
]


def test_the_matrix_covers_every_action_the_policy_knows():
    """A new action added without a matrix entry fails here rather than passing silently."""
    assert set(ALLOWED) == set(ACTIONS), {
        "missing_from_matrix": sorted(set(ACTIONS) - set(ALLOWED)),
        "unknown_to_policy": sorted(set(ALLOWED) - set(ACTIONS)),
    }


@pytest.mark.parametrize("action", sorted(ALLOWED))
@pytest.mark.parametrize("role", ALL_ROLES)
def test_role_by_action_matrix(action: str, role: str):
    allowed = role in ALLOWED[action]
    assert can(principal(role), action, dict(OWN_RESOURCE)) is allowed, (
        role + " on " + action + " should be " + ("allowed" if allowed else "refused")
    )


@pytest.mark.parametrize("action", sorted(ALLOWED))
def test_a_principal_with_no_roles_is_refused_everything(action: str):
    anonymous = Principal(user_id="nobody", name="No One", email="nobody@test.invalid")
    assert can(anonymous, action, dict(OWN_RESOURCE)) is False


def test_an_unknown_action_is_always_refused():
    for role in ALL_ROLES:
        assert can(principal(role), "challenge:destroy-everything", dict(OWN_RESOURCE)) is False


@pytest.mark.parametrize(
    "action",
    [
        "challenge:submit", "challenge:approve", "challenge:screen", "challenge:panel",
        "milestone:accept", "milestone:approve-payment", "milestone:record-release",
        "evidence:run", "scale:decide", "pilot:create-agreement",
    ],
)
def test_department_scope_is_enforced(action: str):
    """A department role has no reach into another department's records."""
    foreign = dict(OWN_RESOURCE, department_id=OTHER_DEPARTMENT)
    for role in (Role.DEPARTMENT_OFFICER, Role.DEPARTMENT_APPROVER, Role.FINANCE_OFFICER):
        assert can(principal(role), action, foreign) is False


@pytest.mark.parametrize(
    "action", ["application:submit", "startup:update", "pilot:accept-agreement", "milestone:submit"]
)
def test_startup_scope_is_enforced(action: str):
    foreign = dict(OWN_RESOURCE, startup_id=OTHER_STARTUP)
    assert can(principal(Role.STARTUP_USER), action, foreign) is False


def test_evaluator_cannot_read_a_challenge_they_are_not_assigned_to():
    other = dict(OWN_RESOURCE, challenge_id="challenge-elsewhere")
    assert can(principal(Role.EXPERT_EVALUATOR), "application:read-blinded", other) is False


def test_drafting_officer_cannot_approve_their_own_challenge():
    """Separation of duties (PRD 11.2)."""
    approver = principal(Role.DEPARTMENT_APPROVER, user_id="user-DA")
    own_draft = dict(OWN_RESOURCE, created_by="user-DA", state="InReview")
    assert can(approver, "challenge:approve", own_draft) is False
    someone_elses = dict(OWN_RESOURCE, created_by="user-DO", state="InReview")
    assert can(approver, "challenge:approve", someone_elses) is True


def test_finance_officer_cannot_approve_a_payment_they_would_release():
    """Separation of duties (PRD 11.2)."""
    both = Principal(
        user_id="user-both",
        name="Both roles",
        email="both@test.invalid",
        department_id=DEPARTMENT,
        scoped_roles=[
            ScopedRole(role=Role.DEPARTMENT_APPROVER, scope_type="department", scope_id=DEPARTMENT),
            ScopedRole(role=Role.FINANCE_OFFICER, scope_type="department", scope_id=DEPARTMENT),
        ],
    )
    assert can(both, "milestone:approve-payment", dict(OWN_RESOURCE)) is False


def test_finance_officer_cannot_release_a_payment_they_approved():
    finance = principal(Role.FINANCE_OFFICER, user_id="user-FO")
    self_approved = dict(OWN_RESOURCE, approved_by="user-FO")
    assert can(finance, "milestone:record-release", self_approved) is False


def test_an_evaluator_cannot_validate_the_same_challenge():
    """A validator who also evaluated the challenge cannot sign off (PRD 3.1)."""
    both = Principal(
        user_id="user-both",
        name="Both roles",
        email="both@test.invalid",
        scoped_roles=[
            ScopedRole(role=Role.EXPERT_EVALUATOR, scope_type="challenge", scope_id=CHALLENGE),
            ScopedRole(role=Role.INDEPENDENT_VALIDATOR, scope_type="challenge", scope_id=CHALLENGE),
        ],
    )
    assert can(both, "evidence:sign-off", dict(OWN_RESOURCE)) is False

    validator_only = principal(Role.INDEPENDENT_VALIDATOR)
    assert can(validator_only, "evidence:sign-off", dict(OWN_RESOURCE)) is True


def test_a_draft_challenge_is_editable_only_by_its_own_department_officer():
    draft = dict(OWN_RESOURCE, state="Draft")
    assert can(principal(Role.DEPARTMENT_OFFICER), "challenge:update", draft) is True
    assert can(principal(Role.DEPARTMENT_APPROVER), "challenge:update", draft) is False
    assert can(principal(Role.STARTUP_USER), "challenge:update", draft) is False


def test_a_draft_challenge_is_not_readable_outside_its_department():
    draft = dict(OWN_RESOURCE, state="Draft")
    assert can(principal(Role.STARTUP_USER), "challenge:read", draft) is False
    assert can(principal(Role.DEPARTMENT_OFFICER), "challenge:read", draft) is True


def test_an_application_is_editable_only_before_it_locks():
    for state, expected in (("Draft", True), ("Submitted", True), ("Locked", False), ("Screened", False)):
        resource = dict(OWN_RESOURCE, state=state)
        assert can(principal(Role.STARTUP_USER), "application:update", resource) is expected


def test_a_startup_sees_its_scores_only_after_results_are_published():
    before = dict(OWN_RESOURCE, results_published=False)
    assert can(principal(Role.STARTUP_USER), "evaluation:read-scores", before) is False
    after = dict(OWN_RESOURCE, results_published=True)
    assert can(principal(Role.STARTUP_USER), "evaluation:read-scores", after) is True


def test_platform_admin_reads_widely_but_holds_no_business_approval():
    admin = principal(Role.PLATFORM_ADMIN)
    assert can(admin, "audit:verify", {}) is True
    assert can(admin, "admin:manage", {}) is True
    assert can(admin, "challenge:read", dict(OWN_RESOURCE)) is True
    for action in (
        "challenge:approve", "milestone:approve-payment", "scale:decide",
        "evidence:sign-off", "pilot:approve-agreement",
    ):
        assert can(admin, action, dict(OWN_RESOURCE)) is False, action


def test_require_raises_a_forbidden_problem_with_guidance():
    with pytest.raises(Forbidden) as excinfo:
        require(principal(Role.STARTUP_USER), "scale:decide", dict(OWN_RESOURCE))
    problem = excinfo.value.to_problem()
    assert problem["status"] == 403
    assert "role assignment" in problem["detail"]

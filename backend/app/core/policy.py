"""Central authorisation. Deny by default (PRD 3.2, 11.1).

Every endpoint calls require(principal, action, resource). Access is never granted by
hiding a button: the check is here, on the server, and the role-by-endpoint test matrix
in tests/test_authz.py asserts that every role not listed in the permission matrix is
refused on every endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.errors import Forbidden
from app.domain.states import Role


@dataclass
class ScopedRole:
    role: str
    scope_type: str  # global, department, challenge, startup
    scope_id: str | None


@dataclass
class Principal:
    """The authenticated caller, with every role they hold and the scope of each."""

    user_id: str
    name: str
    email: str
    locale: str = "en"
    department_id: str | None = None
    startup_id: str | None = None
    scoped_roles: list[ScopedRole] = field(default_factory=list)
    session_id: str = ""

    @property
    def roles(self) -> set[str]:
        return {r.role for r in self.scoped_roles}

    def has_role(self, role: str) -> bool:
        return role in self.roles

    def role_scopes(self, role: str) -> list[ScopedRole]:
        return [r for r in self.scoped_roles if r.role == role]

    def in_department(self, department_id: str | None) -> bool:
        if not department_id:
            return False
        if self.department_id == department_id:
            return True
        return any(
            r.scope_type == "department" and r.scope_id == department_id for r in self.scoped_roles
        )

    def owns_startup(self, startup_id: str | None) -> bool:
        if not startup_id:
            return False
        if self.startup_id == startup_id:
            return True
        return any(
            r.scope_type == "startup" and r.scope_id == startup_id for r in self.scoped_roles
        )

    def assigned_to_challenge(self, challenge_id: str | None, role: str | None = None) -> bool:
        if not challenge_id:
            return False
        return any(
            r.scope_type == "challenge"
            and r.scope_id == challenge_id
            and (role is None or r.role == role)
            for r in self.scoped_roles
        )

    def is_admin(self) -> bool:
        return Role.PLATFORM_ADMIN in self.roles


Resource = dict[str, Any]

# Actions are namespaced resource:verb. Anything not listed here is denied.
ACTIONS: tuple[str, ...] = (
    "challenge:create", "challenge:read", "challenge:update", "challenge:submit",
    "challenge:approve", "challenge:publish", "challenge:cancel", "challenge:corrigendum",
    "challenge:clarify-ask", "challenge:clarify-answer", "challenge:ai-draft",
    "challenge:matches", "challenge:screen", "challenge:panel", "challenge:lock-scores",
    "challenge:ranking", "challenge:shortlist",
    "startup:create", "startup:read", "startup:update", "startup:verify",
    "application:create", "application:read", "application:read-blinded", "application:update",
    "application:submit", "application:override-eligibility",
    "evaluation:declare-coi", "evaluation:score", "evaluation:read-scores",
    "simulation:create", "simulation:read", "design:freeze",
    "pilot:read", "pilot:create-agreement", "pilot:approve-agreement", "pilot:accept-agreement",
    "pilot:request-changes", "pilot:pause", "pilot:resume", "pilot:terminate",
    "pilot:submit-metrics", "pilot:read-metrics", "pilot:dispute-metrics", "pilot:cyber-checklist",
    "milestone:read", "milestone:submit", "milestone:accept", "milestone:reject",
    "milestone:approve-payment", "milestone:record-release",
    "evidence:run", "evidence:read", "evidence:sign-off", "evidence:read-raw",
    "scale:pathway", "scale:simulate", "scale:decide",
    "passport:read", "passport:adopt", "passport:update",
    "audit:read", "audit:verify", "admin:manage", "template:read", "template:manage",
    "file:upload", "file:read",
)


def can(principal: Principal, action: str, resource: Resource | None = None) -> bool:
    """The single authorisation decision point. Returns True only for an allowed action."""
    resource = resource or {}
    if action not in ACTIONS:
        return False

    roles = principal.roles

    # Platform Admin has read across the platform and manages configuration, but is
    # deliberately not granted business approvals: separation of duties (PRD 11.2).
    if Role.PLATFORM_ADMIN in roles:
        if action.endswith(":read") or action in (
            "audit:read", "audit:verify", "admin:manage", "template:read", "template:manage",
            "challenge:matches", "challenge:ranking", "evidence:read-raw", "passport:update",
            "challenge:lock-scores", "application:read-blinded", "milestone:read",
            "simulation:read", "pilot:read-metrics", "file:read",
            "evaluation:read-scores",
        ):
            return True

    department_id = resource.get("department_id")
    startup_id = resource.get("startup_id")
    challenge_id = resource.get("challenge_id")
    own_department = principal.in_department(department_id)
    own_startup = principal.owns_startup(startup_id)

    handler = _HANDLERS.get(action)
    if handler is None:
        return False
    return handler(principal, resource, roles, own_department, own_startup, challenge_id)


def require(principal: Principal, action: str, resource: Resource | None = None) -> None:
    if not can(principal, action, resource):
        raise Forbidden(
            "Your roles do not permit this action on this record. "
            "If you believe this is wrong, ask the platform administrator to check your role "
            "assignment and its scope."
        )


def _do(roles: set[str]) -> bool:
    return Role.DEPARTMENT_OFFICER in roles


def _da(roles: set[str]) -> bool:
    return Role.DEPARTMENT_APPROVER in roles


def _su(roles: set[str]) -> bool:
    return Role.STARTUP_USER in roles


def _fo(roles: set[str]) -> bool:
    return Role.FINANCE_OFFICER in roles


def _ee(roles: set[str]) -> bool:
    return Role.EXPERT_EVALUATOR in roles


def _iv(roles: set[str]) -> bool:
    return Role.INDEPENDENT_VALIDATOR in roles


# Each handler receives (principal, resource, roles, own_department, own_startup, challenge_id).
_HANDLERS: dict[str, Any] = {}


def _register(action: str):  # type: ignore[no-untyped-def]
    def wrapper(fn):  # type: ignore[no-untyped-def]
        _HANDLERS[action] = fn
        return fn

    return wrapper


# Challenges -----------------------------------------------------------------

@_register("challenge:create")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and (own_dept or r.get("department_id") == p.department_id)


@_register("challenge:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    state = r.get("state")
    if state in (None, "Draft", "InReview"):
        return own_dept and (_do(roles) or _da(roles))
    # Published onwards is readable by any user holding a role on the platform. The
    # public board serves unauthenticated readers through a separate endpoint.
    return bool(roles)


@_register("challenge:update")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept and r.get("state") == "Draft"


@_register("challenge:submit")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("challenge:ai-draft")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("challenge:approve")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    # Separation of duties: the officer who drafted cannot approve (PRD 11.2).
    return _da(roles) and own_dept and r.get("created_by") != p.user_id


@_register("challenge:publish")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


@_register("challenge:cancel")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


@_register("challenge:corrigendum")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("challenge:clarify-ask")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles)


@_register("challenge:clarify-answer")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("challenge:matches")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("challenge:screen")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("challenge:panel")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("challenge:lock-scores")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("challenge:ranking")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("challenge:shortlist")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


# Startups -------------------------------------------------------------------

@_register("startup:create")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles)


@_register("startup:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return own_startup or _do(roles) or _da(roles) or _fo(roles) or _iv(roles)


@_register("startup:update")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("startup:verify")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_su(roles) and own_startup) or _do(roles)


# Applications ---------------------------------------------------------------

@_register("application:create")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("application:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if own_startup and _su(roles):
        return True
    if (_do(roles) or _da(roles)) and own_dept:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("application:read-blinded")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _ee(roles) and p.assigned_to_challenge(cid, Role.EXPERT_EVALUATOR)


@_register("application:update")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup and r.get("state") in ("Draft", "Submitted")


@_register("application:submit")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("application:override-eligibility")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


# Evaluation -----------------------------------------------------------------

@_register("evaluation:declare-coi")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_ee(roles) or _iv(roles)) and p.assigned_to_challenge(cid)


@_register("evaluation:score")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _ee(roles) and p.assigned_to_challenge(cid, Role.EXPERT_EVALUATOR)


@_register("evaluation:read-scores")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles)) and own_dept:
        return True
    if _ee(roles) and p.assigned_to_challenge(cid, Role.EXPERT_EVALUATOR):
        return True
    # A startup sees its own scores only after results are published (FR-EV-07).
    return _su(roles) and own_startup and bool(r.get("results_published"))


# Simulation and design ------------------------------------------------------

@_register("simulation:create")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("simulation:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles)) and own_dept:
        return True
    if _su(roles) and own_startup:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("design:freeze")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


# Pilots ---------------------------------------------------------------------

@_register("pilot:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles) or _fo(roles)) and own_dept:
        return True
    if _su(roles) and own_startup:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("pilot:create-agreement")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("pilot:approve-agreement")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


@_register("pilot:accept-agreement")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("pilot:request-changes")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("pilot:pause")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("pilot:resume")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("pilot:terminate")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


@_register("pilot:submit-metrics")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_su(roles) and own_startup) or (_do(roles) and own_dept)


@_register("pilot:read-metrics")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles)) and own_dept:
        return True
    if _su(roles) and own_startup:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("pilot:dispute-metrics")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("pilot:cyber-checklist")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


# Milestones and payments ----------------------------------------------------

@_register("milestone:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return ((_do(roles) or _da(roles) or _fo(roles)) and own_dept) or (
        _su(roles) and own_startup
    )


@_register("milestone:submit")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _su(roles) and own_startup


@_register("milestone:accept")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("milestone:reject")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("milestone:approve-payment")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    # A finance officer cannot approve a payment they will release (PRD 11.2).
    return _da(roles) and own_dept and not _fo(roles)


@_register("milestone:record-release")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _fo(roles) and own_dept and r.get("approved_by") != p.user_id


# Evidence -------------------------------------------------------------------

@_register("evidence:run")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) and own_dept


@_register("evidence:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles) or _fo(roles)) and own_dept:
        return True
    if _su(roles) and own_startup:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("evidence:read-raw")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("evidence:sign-off")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    # A validator cannot also be an evaluator on the same challenge (PRD 3.1).
    if _ee(roles) and p.assigned_to_challenge(cid, Role.EXPERT_EVALUATOR):
        return False
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


# Scale and passports --------------------------------------------------------

@_register("scale:pathway")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("scale:simulate")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return (_do(roles) or _da(roles)) and own_dept


@_register("scale:decide")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _da(roles) and own_dept


@_register("passport:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    # Validated evidence is deliberately open across departments; the share link and the
    # public listing serve readers outside the platform.
    return bool(roles)


@_register("passport:adopt")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return _do(roles) or _da(roles)


@_register("passport:update")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return False  # Platform Admin only, handled above.


# Platform -------------------------------------------------------------------

@_register("audit:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if (_do(roles) or _da(roles) or _fo(roles)) and own_dept:
        return True
    if _su(roles) and own_startup:
        return True
    return _iv(roles) and p.assigned_to_challenge(cid, Role.INDEPENDENT_VALIDATOR)


@_register("audit:verify")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return False  # Platform Admin only, handled above.


@_register("admin:manage")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return False  # Platform Admin only, handled above.


@_register("template:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return bool(roles)


@_register("template:manage")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return False  # Platform Admin only, handled above.


@_register("file:upload")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    return bool(roles)


@_register("file:read")
def _(p, r, roles, own_dept, own_startup, cid):  # noqa: ANN001
    if r.get("uploaded_by") == p.user_id:
        return True
    return own_dept or own_startup or p.assigned_to_challenge(cid)

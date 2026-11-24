"""SQLAlchemy models. Import order matters only for relationship resolution."""

from app.models.application import Application, EligibilityResult  # noqa: F401
from app.models.base import Base  # noqa: F401
from app.models.challenge import (  # noqa: F401
    Challenge,
    Clarification,
    Corrigendum,
    Kpi,
    RubricCriterion,
)
from app.models.evaluation import CoiDeclaration, EvaluationScore, PanelMember  # noqa: F401
from app.models.evidence import EvidenceReport  # noqa: F401
from app.models.identity import (  # noqa: F401
    AppUser,
    Department,
    LoginAttempt,
    OtpCode,
    RefreshToken,
    RoleAssignment,
)
from app.models.payment import Milestone, PaymentRelease  # noqa: F401
from app.models.pilot import AgreementVersion, MetricSubmission, Pilot  # noqa: F401
from app.models.platform import (  # noqa: F401
    AuditLog,
    FileObject,
    IdempotencyKey,
    Job,
    LeaderLock,
    Notification,
    OutboxEvent,
    Template,
)
from app.models.scale import AdoptionRequest, InnovationPassport, ScaleDecision  # noqa: F401
from app.models.simulation import PilotDesign, SimulationRun  # noqa: F401
from app.models.startup import ChallengeEmbedding, MatchResult, Startup, StartupEmbedding  # noqa: F401

__all__ = ["Base"]

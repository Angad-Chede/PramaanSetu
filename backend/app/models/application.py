"""Applications and eligibility results (PRD 5.3, 5.4, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import ApplicationState
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Application(BusinessBase):
    """One application per startup per challenge, enforced by a unique constraint."""

    __tablename__ = "application"

    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    startup_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("startup.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)
    state: Mapped[str] = mapped_column(
        String(24), default=ApplicationState.DRAFT, nullable=False, index=True
    )

    proposal_summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    approach: Mapped[str] = mapped_column(Text, default="", nullable=False)
    kpi_commitments: Mapped[list] = mapped_column(default=list)  # [{kpi_id, committed_value}]
    pilot_cost_paise: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    timeline_weeks: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    data_declaration: Mapped[str] = mapped_column(Text, default="", nullable=False)
    ip_declaration: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    conflict_declaration: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attachments: Mapped[list] = mapped_column(default=list)
    extra: Mapped[dict[str, Any]] = mapped_column(default=dict)

    submitted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    shortlist_rank: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    startup = relationship("Startup", lazy="selectin")
    challenge = relationship("Challenge", lazy="selectin")
    eligibility = relationship(
        "EligibilityResult", back_populates="application", lazy="selectin",
        uselist=False, cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("challenge_id", "startup_id", name="uq_application_once"),
        Index("ix_application_challenge_state", "challenge_id", "state"),
    )

    def blocking_problems(self) -> list[dict[str, str]]:
        """Field-level gaps that block submission, each carrying its fix (PRD 6.1)."""
        problems: list[dict[str, str]] = []
        if len(self.proposal_summary.strip()) < 80:
            problems.append(
                {
                    "field": "proposal_summary",
                    "detail": "The proposal summary is too short to evaluate.",
                    "fix": "Describe the solution and the expected outcome in at least 80 characters.",
                }
            )
        if len(self.approach.strip()) < 80:
            problems.append(
                {
                    "field": "approach",
                    "detail": "The approach is too short to evaluate.",
                    "fix": "Explain how the solution will be deployed and measured during the pilot.",
                }
            )
        if not self.kpi_commitments:
            problems.append(
                {
                    "field": "kpi_commitments",
                    "detail": "No committed value was given for any measure.",
                    "fix": "Enter the value you commit to reach for each measure in the challenge.",
                }
            )
        if self.pilot_cost_paise <= 0:
            problems.append(
                {
                    "field": "pilot_cost_paise",
                    "detail": "Pilot cost is missing.",
                    "fix": "Enter the total pilot cost in rupees.",
                }
            )
        if self.timeline_weeks <= 0:
            problems.append(
                {
                    "field": "timeline_weeks",
                    "detail": "Pilot timeline is missing.",
                    "fix": "Enter the number of weeks you need for the pilot.",
                }
            )
        if not self.ip_declaration:
            problems.append(
                {
                    "field": "ip_declaration",
                    "detail": "The intellectual property option has not been selected.",
                    "fix": "Choose one of the three intellectual property options.",
                }
            )
        if not self.conflict_declaration:
            problems.append(
                {
                    "field": "conflict_declaration",
                    "detail": "The conflict of interest declaration is not signed.",
                    "fix": "Read and tick the conflict of interest declaration.",
                }
            )
        return problems


class EligibilityResult(Base, PkMixin, TimestampMixin):
    """Outcome per application with a human-readable reason per rule (FR-ES-03)."""

    __tablename__ = "eligibility_result"

    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("application.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    outcome: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    rule_results: Mapped[list] = mapped_column(default=list)
    relaxations_applied: Mapped[list] = mapped_column(default=list)
    screened_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    overridden_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_outcome: Mapped[str | None] = mapped_column(String(20), nullable=True)
    clarification_window_ends: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    application = relationship("Application", back_populates="eligibility")

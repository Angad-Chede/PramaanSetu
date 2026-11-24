"""Challenges, KPIs, rubric criteria, clarifications and corrigenda (PRD 5.1, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import ChallengeState
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Challenge(BusinessBase):
    __tablename__ = "challenge"

    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=False, index=True
    )
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("app_user.id"), nullable=False)
    state: Mapped[str] = mapped_column(
        String(24), default=ChallengeState.DRAFT, nullable=False, index=True
    )

    title: Mapped[str] = mapped_column(String(240), default="", nullable=False)
    problem_statement: Mapped[str] = mapped_column(Text, default="", nullable=False)
    current_situation: Mapped[str] = mapped_column(Text, default="", nullable=False)
    outcome_statement: Mapped[str] = mapped_column(Text, default="", nullable=False)
    constraints: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pilot_scope: Mapped[str] = mapped_column(Text, default="", nullable=False)
    commercial_terms: Mapped[str] = mapped_column(Text, default="", nullable=False)

    sector: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    state_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    budget_ceiling_paise: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    pilot_duration_weeks: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    application_deadline: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)
    clarification_cutoff: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    evaluation_deadline: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)

    eligibility_rules: Mapped[dict[str, Any]] = mapped_column(default=dict)
    ip_option: Mapped[str] = mapped_column(String(40), default="startup_retains", nullable=False)
    template_versions: Mapped[dict[str, Any]] = mapped_column(default=dict)
    ai_draft_meta: Mapped[dict[str, Any]] = mapped_column(default=dict)
    quality_flags: Mapped[list] = mapped_column(default=list)

    submitted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    return_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    department = relationship("Department", lazy="selectin")
    kpis = relationship(
        "Kpi", back_populates="challenge", lazy="selectin", cascade="all, delete-orphan",
        order_by="Kpi.position",
    )
    criteria = relationship(
        "RubricCriterion", back_populates="challenge", lazy="selectin",
        cascade="all, delete-orphan", order_by="RubricCriterion.position",
    )

    __table_args__ = (
        Index("ix_challenge_board", "state", "published_at"),
        Index("ix_challenge_dept_state", "department_id", "state"),
    )

    @property
    def primary_kpi(self):  # type: ignore[no-untyped-def]
        for kpi in self.kpis:
            if kpi.is_primary:
                return kpi
        return self.kpis[0] if self.kpis else None


class Kpi(Base, PkMixin, TimestampMixin):
    """A measurable outcome. Unit, method, baseline and target are all mandatory (FR-CB-03)."""

    __tablename__ = "kpi"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    unit: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="continuous", nullable=False)  # continuous, proportion
    direction: Mapped[str] = mapped_column(String(10), default="lower", nullable=False)  # lower, higher
    baseline_value: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    baseline_sd: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    baseline_method: Mapped[str] = mapped_column(Text, default="", nullable=False)
    baseline_source: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    baseline_plan: Mapped[str] = mapped_column(Text, default="", nullable=False)
    target_value: Mapped[float | None] = mapped_column(Numeric(18, 6), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    challenge = relationship("Challenge", back_populates="kpis")

    __table_args__ = (Index("ix_kpi_primary", "challenge_id", "is_primary"),)

    def completeness_problems(self) -> list[str]:
        """Blocking gaps, phrased for the officer (FR-CB-03)."""
        problems: list[str] = []
        if not self.name.strip():
            problems.append("Give this measure a name.")
        if not self.unit.strip():
            problems.append("State the unit, for example percent, minutes or rupees.")
        if not self.baseline_method.strip():
            problems.append("Describe how the measure will be recorded.")
        if self.baseline_value is None and not self.baseline_plan.strip():
            problems.append("Record the baseline value, or describe how it will be collected.")
        if self.target_value is None:
            problems.append("Set a target value.")
        if self.baseline_value is not None and self.target_value is not None:
            base, target = float(self.baseline_value), float(self.target_value)
            if self.direction == "lower" and target >= base:
                problems.append(
                    "Target must be lower than the baseline for a measure where lower is better."
                )
            if self.direction == "higher" and target <= base:
                problems.append(
                    "Target must be higher than the baseline for a measure where higher is better."
                )
        return problems


class RubricCriterion(Base, PkMixin, TimestampMixin):
    """Weighted evaluation criterion with 1 to 5 anchors (FR-EV-03)."""

    __tablename__ = "rubric_criterion"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    weight: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    anchors: Mapped[dict[str, Any]] = mapped_column(default=dict)
    round_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    challenge = relationship("Challenge", back_populates="criteria")


class Clarification(Base, PkMixin, TimestampMixin):
    """Question and answer, published to all applicants at once and anonymised (FR-DM-05)."""

    __tablename__ = "clarification"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asked_by: Mapped[str] = mapped_column(String(36), nullable=False)  # stored, never exposed
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)


class Corrigendum(Base, PkMixin, TimestampMixin):
    """The only permitted change to a published challenge (FR-CB-08)."""

    __tablename__ = "corrigendum"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    changes: Mapped[dict[str, Any]] = mapped_column(default=dict)
    issued_by: Mapped[str] = mapped_column(String(36), nullable=False)

    __table_args__ = (UniqueConstraint("challenge_id", "number", name="uq_corrigendum_number"),)

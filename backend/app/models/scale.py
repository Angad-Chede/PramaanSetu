"""Scale decisions, Innovation Passports and adoption requests (PRD 5.11, 5.12, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import AdoptionState
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class ScaleDecision(BusinessBase):
    __tablename__ = "scale_decision"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    evidence_report_id: Mapped[str] = mapped_column(String(36), nullable=False)
    decision: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    pathway: Mapped[dict[str, Any]] = mapped_column(default=dict)
    scale_projection: Mapped[dict[str, Any]] = mapped_column(default=dict)
    vendor_dependency: Mapped[dict[str, Any]] = mapped_column(default=dict)
    handoff_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    estimated_value_paise: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    decided_by: Mapped[str] = mapped_column(String(36), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)


class InnovationPassport(BusinessBase):
    """Reusable evidence package, issued automatically on validator sign-off (FR-IP-01)."""

    __tablename__ = "innovation_passport"

    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    evidence_report_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evidence_report.id"), nullable=False, index=True
    )
    pilot_id: Mapped[str] = mapped_column(String(36), ForeignKey("pilot.id"), nullable=False)
    startup_id: Mapped[str] = mapped_column(String(36), ForeignKey("startup.id"), nullable=False, index=True)
    department_id: Mapped[str] = mapped_column(String(36), ForeignKey("department.id"), nullable=False)
    solution_name: Mapped[str] = mapped_column(String(240), nullable=False)
    category: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    sector: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    state_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    context: Mapped[dict[str, Any]] = mapped_column(default=dict)
    result_summary: Mapped[dict[str, Any]] = mapped_column(default=dict)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    band: Mapped[str] = mapped_column(String(20), nullable=False)
    validator_name: Mapped[str] = mapped_column(String(160), nullable=False)
    validated_on: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    links: Mapped[dict[str, Any]] = mapped_column(default=dict)
    passport_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    share_token: Mapped[str] = mapped_column(String(48), nullable=False, unique=True)
    appended_results: Mapped[list] = mapped_column(default=list)

    startup = relationship("Startup", lazy="selectin")
    department = relationship("Department", lazy="selectin")

    __table_args__ = (Index("ix_passport_search", "category", "sector", "confidence_score"),)


class AdoptionRequest(Base, PkMixin, TimestampMixin):
    """Another department reusing the evidence instead of repeating the experiment (FR-IP-03)."""

    __tablename__ = "adoption_request"

    passport_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("innovation_passport.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=False, index=True
    )
    raised_by: Mapped[str] = mapped_column(String(36), nullable=False)
    intent: Mapped[str] = mapped_column(String(30), default="new_challenge", nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    context_fit: Mapped[dict[str, Any]] = mapped_column(default=dict)
    prefilled_challenge_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    state: Mapped[str] = mapped_column(
        String(20), default=AdoptionState.RAISED, nullable=False, index=True
    )

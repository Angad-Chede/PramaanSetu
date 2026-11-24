"""Pilots, agreement versions and metric submissions (PRD 5.7, 5.8, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import PilotState
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Pilot(BusinessBase):
    """One pilot per shortlisted application."""

    __tablename__ = "pilot"

    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("application.id"), nullable=False, unique=True, index=True
    )
    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id"), nullable=False, index=True
    )
    startup_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("startup.id"), nullable=False, index=True
    )
    department_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=False, index=True
    )
    state: Mapped[str] = mapped_column(
        String(24), default=PilotState.AGREEMENT_DRAFT, nullable=False, index=True
    )
    design_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    api_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    paused_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    pause_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    termination_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cyber_checklist: Mapped[dict[str, Any]] = mapped_column(default=dict)
    cyber_completed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    total_value_paise: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    application = relationship("Application", lazy="selectin")
    challenge = relationship("Challenge", lazy="selectin")
    startup = relationship("Startup", lazy="selectin")

    __table_args__ = (Index("ix_pilot_dept_state", "department_id", "state"),)


class AgreementVersion(Base, PkMixin, TimestampMixin):
    """Every revision is kept and diffable; acceptance records the document hash (FR-PA-06)."""

    __tablename__ = "agreement_version"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[dict[str, Any]] = mapped_column(default=dict)
    template_versions: Mapped[dict[str, Any]] = mapped_column(default=dict)
    ip_option: Mapped[str] = mapped_column(String(40), nullable=False)
    data_terms: Mapped[dict[str, Any]] = mapped_column(default=dict)
    pdf_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    drafted_by: Mapped[str] = mapped_column(String(36), nullable=False)
    approved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    accepted_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    esign_reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    change_request: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("pilot_id", "number", name="uq_agreement_number"),)


class MetricSubmission(Base, PkMixin, TimestampMixin):
    """One value per measure, per unit, per period. The unique key makes retries safe."""

    __tablename__ = "metric_submission"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kpi_id: Mapped[str] = mapped_column(String(36), ForeignKey("kpi.id"), nullable=False, index=True)
    unit_ref: Mapped[str] = mapped_column(String(80), nullable=False)
    period_start: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    period_end: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    phase: Mapped[str] = mapped_column(String(12), default="pilot", nullable=False)  # baseline, pilot
    arm: Mapped[str] = mapped_column(String(12), default="treatment", nullable=False)  # treatment, comparison
    value: Mapped[float] = mapped_column(Float, nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)  # form, csv, api
    status: Mapped[str] = mapped_column(String(12), default="Accepted", nullable=False, index=True)
    dispute_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    upload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_by: Mapped[str] = mapped_column(String(36), nullable=False)
    is_final: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "pilot_id", "kpi_id", "unit_ref", "period_start", "phase", name="uq_metric_cell"
        ),
        Index("ix_metric_pilot_kpi", "pilot_id", "kpi_id", "phase"),
        Index("ix_metric_period", "pilot_id", "period_start"),
    )

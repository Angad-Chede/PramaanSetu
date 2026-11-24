"""Milestones and payment releases, the state Payment Pulse watches (PRD 5.9, 8.2)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import MilestoneState
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Milestone(BusinessBase):
    """A deliverable with money attached and an SLA clock on every state."""

    __tablename__ = "milestone"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    deliverable: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_required: Mapped[str] = mapped_column(Text, nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    due_date: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    state: Mapped[str] = mapped_column(
        String(24), default=MilestoneState.PENDING, nullable=False, index=True
    )
    state_entered_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    sla_due_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)
    sla_owner_role: Mapped[str | None] = mapped_column(String(4), nullable=True)
    escalation_level: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    submission_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    submission_files: Mapped[list] = mapped_column(default=list)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    unmet_requirement: Mapped[str | None] = mapped_column(Text, nullable=True)
    resubmission_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    clock_paused_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    state_history: Mapped[list] = mapped_column(default=list)
    accepted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    payment_approved_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    pilot = relationship("Pilot", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("pilot_id", "seq", name="uq_milestone_seq"),
        # The scheduler scans on this index every cycle (PRD 8.2)
        Index("ix_milestone_sla", "state", "sla_due_at"),
    )


class PaymentRelease(Base, PkMixin, TimestampMixin):
    """One release per milestone, enforced by the unique constraint (PRD 10.3)."""

    __tablename__ = "payment_release"

    milestone_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("milestone.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )
    reference_no: Mapped[str] = mapped_column(String(80), nullable=False)
    amount_paise: Mapped[int] = mapped_column(BigInteger, nullable=False)
    released_on: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    mode: Mapped[str] = mapped_column(String(40), default="Bank transfer", nullable=False)
    recorded_by: Mapped[str] = mapped_column(String(36), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

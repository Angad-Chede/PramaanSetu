"""Panels, conflict declarations and scores (PRD 5.5, 8.2)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, PkMixin, TimestampMixin, UtcDateTime


class PanelMember(Base, PkMixin, TimestampMixin):
    """An evaluator or validator bound to one challenge (PRD 3.3).

    A user cannot hold both roles on the same challenge; the service layer enforces it
    and this unique constraint stops a duplicate assignment.
    """

    __tablename__ = "panel_member"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(4), nullable=False)  # EE or IV
    assigned_by: Mapped[str] = mapped_column(String(36), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user = relationship("AppUser", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("challenge_id", "user_id", "role", name="uq_panel_member"),
    )


class CoiDeclaration(Base, PkMixin, TimestampMixin):
    """Mandatory before scoring or validating (FR-EV-01, PRD 11.2)."""

    __tablename__ = "coi_declaration"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("application.id", ondelete="CASCADE"), nullable=False, index=True
    )
    has_conflict: Mapped[bool] = mapped_column(Boolean, nullable=False)
    statement: Mapped[str] = mapped_column(Text, default="", nullable=False)
    declared_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "application_id", name="uq_coi_once"),
    )


class EvaluationScore(Base, PkMixin, TimestampMixin):
    """One score per evaluator per criterion per application, with a mandatory justification."""

    __tablename__ = "evaluation_score"

    application_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("application.id", ondelete="CASCADE"), nullable=False, index=True
    )
    evaluator_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    criterion_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("rubric_criterion.id", ondelete="CASCADE"), nullable=False
    )
    round_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    justification: Mapped[str] = mapped_column(Text, nullable=False)
    locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    submitted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "application_id", "evaluator_id", "criterion_id", "round_number", name="uq_score_once"
        ),
        Index("ix_score_lookup", "application_id", "round_number", "locked"),
    )

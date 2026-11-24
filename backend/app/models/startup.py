"""Startup registry, embeddings and match results (PRD 5.2, 5.3, 8.2, 12.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import DpiitStatus
from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Startup(BusinessBase):
    __tablename__ = "startup"

    legal_name: Mapped[str] = mapped_column(String(240), nullable=False)
    cin: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True)
    dpiit_number: Mapped[str | None] = mapped_column(String(40), nullable=True, unique=True)
    dpiit_status: Mapped[str] = mapped_column(
        String(20), default=DpiitStatus.PENDING, nullable=False, index=True
    )
    dpiit_checked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    incorporation_date: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    sectors: Mapped[list] = mapped_column(default=list)
    state_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    product_description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    capability_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    team_size: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    website: Mapped[str | None] = mapped_column(String(300), nullable=True)
    contact_name: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    contact_email: Mapped[str] = mapped_column(String(254), default="", nullable=False)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    case_references: Mapped[list] = mapped_column(default=list)  # up to 5 (FR-SR-03)
    annual_turnover_paise: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    years_of_experience: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    REQUIRED_FIELDS = (
        "legal_name",
        "cin",
        "dpiit_number",
        "sectors",
        "product_description",
        "capability_text",
        "contact_name",
        "contact_email",
    )

    def missing_fields(self) -> list[str]:
        """Exactly which fields block applying (FR-SR-04)."""
        missing = []
        for field in self.REQUIRED_FIELDS:
            value = getattr(self, field)
            if value in (None, "", [], 0):
                missing.append(field)
        return missing

    def completeness_percent(self) -> int:
        total = len(self.REQUIRED_FIELDS)
        return int(round(100 * (total - len(self.missing_fields())) / total))

    @property
    def capability_corpus(self) -> str:
        parts = [self.legal_name, self.product_description, self.capability_text]
        parts.extend(str(tag) for tag in (self.sectors or []))
        for ref in self.case_references or []:
            if isinstance(ref, dict):
                parts.append(str(ref.get("title", "")))
                parts.append(str(ref.get("summary", "")))
        return "\n".join(p for p in parts if p)


class StartupEmbedding(Base, PkMixin, TimestampMixin):
    """Vector of the capability corpus. Recomputed only when content_hash changes (FR 12.2).

    PostgreSQL deployments store this in a pgvector column with an HNSW index; the MVP
    keeps the same vector as JSON so the stack also runs with no extension installed.
    """

    __tablename__ = "startup_embedding"

    startup_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("startup.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    vector: Mapped[list] = mapped_column(default=list)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)


class ChallengeEmbedding(Base, PkMixin, TimestampMixin):
    __tablename__ = "challenge_embedding"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    model: Mapped[str] = mapped_column(String(80), nullable=False)
    dimensions: Mapped[int] = mapped_column(Integer, nullable=False)
    vector: Mapped[list] = mapped_column(default=list)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)


class MatchResult(Base, PkMixin, TimestampMixin):
    """Ranked startup for a challenge, with the reasons shown to the officer (FR-DM-03)."""

    __tablename__ = "match_result"

    challenge_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("challenge.id", ondelete="CASCADE"), nullable=False, index=True
    )
    startup_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("startup.id", ondelete="CASCADE"), nullable=False, index=True
    )
    score: Mapped[float] = mapped_column(Float, nullable=False)
    components: Mapped[dict[str, Any]] = mapped_column(default=dict)
    reasons: Mapped[list] = mapped_column(default=list)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    invited_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    startup = relationship("Startup", lazy="selectin")

    __table_args__ = (
        UniqueConstraint("challenge_id", "startup_id", name="uq_match_pair"),
        Index("ix_match_rank", "challenge_id", "rank"),
    )

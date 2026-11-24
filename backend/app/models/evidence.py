"""Evidence reports and independent validation (PRD 5.10, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.states import EvidenceStatus
from app.models.base import BusinessBase


class EvidenceReport(BusinessBase):
    """The dataset hash locks the exact data analysed; any later change invalidates it."""

    __tablename__ = "evidence_report"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reference: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    dataset_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    seed: Mapped[int] = mapped_column(Integer, nullable=False)
    engine_version: Mapped[str] = mapped_column(String(20), nullable=False)
    analysis: Mapped[dict[str, Any]] = mapped_column(default=dict)
    components: Mapped[dict[str, Any]] = mapped_column(default=dict)
    confidence_score: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    band: Mapped[str | None] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), default=EvidenceStatus.DRAFT, nullable=False, index=True
    )
    deviations: Mapped[list] = mapped_column(default=list)
    limitations: Mapped[list] = mapped_column(default=list)
    checklist: Mapped[dict[str, Any]] = mapped_column(default=dict)
    validator_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    signed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    generated_by: Mapped[str] = mapped_column(String(36), nullable=False)

    pilot = relationship("Pilot", lazy="selectin")

    @property
    def is_final(self) -> bool:
        return self.status in (
            EvidenceStatus.SIGNED_OFF,
            EvidenceStatus.SIGNED_OFF_WITH_QUALIFICATIONS,
        )

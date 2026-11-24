"""Simulation runs and the frozen pre-registered pilot design (PRD 5.6, 8.2)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class SimulationRun(Base, PkMixin, TimestampMixin):
    """Inputs plus seed make every result reproducible (FR-EE-06, PRD 10.5)."""

    __tablename__ = "simulation_run"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(20), default="pilot", nullable=False)  # pilot, scale
    inputs: Mapped[dict[str, Any]] = mapped_column(default=dict)
    seed: Mapped[int] = mapped_column(BigInteger, nullable=False)
    iterations: Mapped[int] = mapped_column(Integer, nullable=False)
    results: Mapped[dict[str, Any]] = mapped_column(default=dict)
    status: Mapped[str] = mapped_column(String(20), default="Queued", nullable=False, index=True)
    engine_version: Mapped[str] = mapped_column(String(20), nullable=False)
    runtime_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), nullable=False)


class PilotDesign(BusinessBase):
    """The pre-registered plan. Immutable once frozen, except by logged amendment (FR-PS-05)."""

    __tablename__ = "pilot_design"

    pilot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("pilot.id", ondelete="CASCADE"), nullable=False, index=True
    )
    simulation_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    primary_kpi_id: Mapped[str] = mapped_column(String(36), nullable=False)
    duration_weeks: Mapped[int] = mapped_column(Integer, nullable=False)
    units: Mapped[int] = mapped_column(Integer, nullable=False)
    measurements_per_week: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    pass_mark: Mapped[float] = mapped_column(Float, nullable=False)
    analysis_method: Mapped[str] = mapped_column(String(40), nullable=False)
    alpha: Mapped[float] = mapped_column(Float, default=0.05, nullable=False)
    expected_power: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_cost_paise: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    minimum_detectable_effect: Mapped[float | None] = mapped_column(Float, nullable=True)
    baseline_mean: Mapped[float] = mapped_column(Float, nullable=False)
    baseline_sd: Mapped[float] = mapped_column(Float, nullable=False)
    claimed_effect: Mapped[float] = mapped_column(Float, nullable=False)
    comparison_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    frozen_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    frozen_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    amendments: Mapped[list] = mapped_column(default=list)

    @property
    def planned_unit_periods(self) -> int:
        return self.units * self.duration_weeks * self.measurements_per_week

    @property
    def approved_amendments(self) -> int:
        return sum(1 for a in self.amendments or [] if a.get("approved"))

    @property
    def unapproved_deviations(self) -> int:
        return sum(1 for a in self.amendments or [] if not a.get("approved"))

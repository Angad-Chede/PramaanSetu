"""Identity, departments and role assignments (PRD 3.1, 3.2, 3.3, 8.2)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, BusinessBase, PkMixin, TimestampMixin, UtcDateTime


class Department(BusinessBase):
    """Central, state or district body. The hierarchy drives district roll-ups."""

    __tablename__ = "department"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    level: Mapped[str] = mapped_column(String(20), nullable=False)  # central, state, district
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=True, index=True
    )
    state_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    district: Mapped[str | None] = mapped_column(String(120), nullable=True)
    sectors: Mapped[list] = mapped_column(default=list)

    # SLA overrides, bounded by policy limits when applied (PRD FR-PP-01)
    sla_accept_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_approve_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_release_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    parent = relationship("Department", remote_side="Department.id", lazy="selectin")

    __table_args__ = (Index("ix_department_level_state", "level", "state_code"),)


class AppUser(BusinessBase):
    """A person. One person may hold several scoped roles (PRD 3.1)."""

    __tablename__ = "app_user"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    locale: Mapped[str] = mapped_column(String(5), default="en", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="Active", nullable=False)
    designation: Mapped[str | None] = mapped_column(String(160), nullable=True)
    department_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=True, index=True
    )
    startup_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    privacy_notice_accepted_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    department = relationship("Department", lazy="selectin")
    roles = relationship(
        "RoleAssignment", back_populates="user", lazy="selectin", cascade="all, delete-orphan"
    )

    @property
    def role_codes(self) -> set[str]:
        return {r.role for r in self.roles}


class RoleAssignment(Base, PkMixin, TimestampMixin):
    """A role held within a scope: a department, a challenge or a startup."""

    __tablename__ = "role_assignment"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(4), nullable=False)
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)  # global, department, challenge, startup
    scope_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)

    user = relationship("AppUser", back_populates="roles")

    __table_args__ = (
        UniqueConstraint("user_id", "role", "scope_type", "scope_id", name="uq_role_scope"),
        Index("ix_role_lookup", "role", "scope_type", "scope_id"),
    )


class OtpCode(Base, PkMixin, TimestampMixin):
    """One-time codes for sign-in. Hashed at rest; never logged (PRD 11.1, 13.1)."""

    __tablename__ = "otp_code"

    identifier: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)  # email, sms
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    purpose: Mapped[str] = mapped_column(String(30), default="login", nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class RefreshToken(Base, PkMixin, TimestampMixin):
    """Rotating refresh tokens with reuse detection (PRD 11.1)."""

    __tablename__ = "refresh_token"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    family_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)


class LoginAttempt(Base, PkMixin, TimestampMixin):
    """Lockout after repeated failures, and an audit trail of access attempts."""

    __tablename__ = "login_attempt"

    identifier: Mapped[str] = mapped_column(String(254), nullable=False, index=True)
    succeeded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(120), nullable=True)

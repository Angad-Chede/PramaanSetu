"""Initial schema.

Revision ID: 0001
Revises:
Created: 2026-09-24

Creates every table from the declarative metadata. Later revisions are generated with
`alembic revision --autogenerate` and must follow expand, migrate, contract so that the
previous release keeps working during a rolling deploy.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.models import Base

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)

    if bind.dialect.name == "postgresql":
        # The audit log is append-only at the database level, not merely by convention.
        # The grant itself lives in infra/postgres/roles.sql, which runs after this.
        op.execute(sa.text("COMMENT ON TABLE audit_log IS 'Append-only. No UPDATE, no DELETE.'"))
        # Range partitioning for the append-heavy tables is applied separately when data
        # volume warrants it; the indexes below carry the queries until then.
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_metric_submission_recent "
                "ON metric_submission (pilot_id, period_start DESC)"
            )
        )
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_notification_recent "
                "ON notification (user_id, created_at DESC)"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("DROP INDEX IF EXISTS ix_notification_recent"))
        op.execute(sa.text("DROP INDEX IF EXISTS ix_metric_submission_recent"))
    Base.metadata.drop_all(bind=bind)

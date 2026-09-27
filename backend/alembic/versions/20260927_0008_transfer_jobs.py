"""transfer jobs

Full-data export/import (D-90). One row per export or import job; archives live in
settings.transfer_dir under random names, pre-import backups in settings.backups_dir.
The table holds counts and sizes only — never the passphrase or record content.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "transfer_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("stage", sa.String(length=32), nullable=False),
        sa.Column("progress", sa.SmallInteger(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("archive_name", sa.String(length=32), nullable=True),
        sa.Column("archive_size", sa.BigInteger(), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column("preview", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("backup_name", sa.String(length=128), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind IN ('export', 'import')", name=op.f("ck_transfer_jobs_transfer_kind")
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'validated', 'done', 'failed')",
            name=op.f("ck_transfer_jobs_transfer_status"),
        ),
        sa.CheckConstraint(
            "progress BETWEEN 0 AND 100", name=op.f("ck_transfer_jobs_progress_range")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_transfer_jobs_created_by_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_transfer_jobs")),
    )
    op.create_index(
        op.f("ix_transfer_jobs_created_by"), "transfer_jobs", ["created_by"], unique=False
    )
    op.create_index("ix_transfer_jobs_expires_at", "transfer_jobs", ["expires_at"], unique=False)
    op.create_index("ix_transfer_jobs_status", "transfer_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_transfer_jobs_status", table_name="transfer_jobs")
    op.drop_index("ix_transfer_jobs_expires_at", table_name="transfer_jobs")
    op.drop_index(op.f("ix_transfer_jobs_created_by"), table_name="transfer_jobs")
    op.drop_table("transfer_jobs")

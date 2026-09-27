"""pdf jobs

Stage 7 (D-83). One row per PDF export or import, run by the in-process worker.
Only random file names are stored; the files live in settings.pdf_dir. Rows expire
and are deleted by the sweeper, so the table stays small. No foreign key to the
exported record: it may be deleted while its export waits.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-26 21:21:29.564182
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pdf_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress", sa.SmallInteger(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("lang", sa.String(length=2), nullable=False),
        sa.Column("source_type", sa.String(length=16), nullable=True),
        sa.Column("source_id", sa.Integer(), nullable=True),
        sa.Column("input_name", sa.String(length=32), nullable=True),
        sa.Column("original_name", sa.String(length=255), nullable=True),
        sa.Column("result_name", sa.String(length=32), nullable=True),
        sa.Column("result_filename", sa.String(length=255), nullable=True),
        sa.Column("draft_title", sa.String(length=300), nullable=True),
        sa.Column("draft_md", sa.Text(), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("warnings", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
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
            "(kind = 'export') = (source_type IS NOT NULL AND source_id IS NOT NULL)",
            name=op.f("ck_pdf_jobs_export_has_source"),
        ),
        sa.CheckConstraint("kind IN ('export', 'import')", name=op.f("ck_pdf_jobs_pdf_job_kind")),
        sa.CheckConstraint(
            "source_type IN ('report', 'note')", name=op.f("ck_pdf_jobs_pdf_source_type")
        ),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'done', 'failed')",
            name=op.f("ck_pdf_jobs_pdf_job_status"),
        ),
        sa.CheckConstraint("progress BETWEEN 0 AND 100", name=op.f("ck_pdf_jobs_progress_range")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_pdf_jobs_created_by_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pdf_jobs")),
    )
    op.create_index(op.f("ix_pdf_jobs_created_by"), "pdf_jobs", ["created_by"], unique=False)
    op.create_index("ix_pdf_jobs_expires_at", "pdf_jobs", ["expires_at"], unique=False)
    op.create_index("ix_pdf_jobs_status", "pdf_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_pdf_jobs_status", table_name="pdf_jobs")
    op.drop_index("ix_pdf_jobs_expires_at", table_name="pdf_jobs")
    op.drop_index(op.f("ix_pdf_jobs_created_by"), table_name="pdf_jobs")
    op.drop_table("pdf_jobs")

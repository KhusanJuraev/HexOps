"""reports, evidence attachments, activity actor

Stage 4. reports.project_id is ON DELETE RESTRICT: a project with reports cannot be
deleted (D-60). Attachment rows cascade with their report; the files on disk are
removed by the application after commit (D-62). activity_logs gains actor_user_id
(nullable: earlier events have no recorded actor).

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-26 15:25:46.428558
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("cvss_score", sa.Numeric(precision=3, scale=1), nullable=True),
        sa.Column("cvss_vector", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("triaged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("bounty_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("bounty_currency", sa.String(length=3), nullable=True),
        sa.Column("body_md", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "bounty_currency ~ '^[A-Z]{3}$'", name=op.f("ck_reports_bounty_currency_iso")
        ),
        sa.CheckConstraint(
            "severity IN ('critical', 'high', 'medium', 'low', 'info')",
            name=op.f("ck_reports_severity"),
        ),
        sa.CheckConstraint(
            "status <> 'paid' OR type = 'bbp'", name=op.f("ck_reports_paid_only_bbp")
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'triaged', "
            "'accepted', 'duplicate', 'rejected', 'paid')",
            name=op.f("ck_reports_report_status"),
        ),
        sa.CheckConstraint(
            "type IN ('cve', 'bbp', 'vdp', 'pentest')", name=op.f("ck_reports_report_type")
        ),
        sa.CheckConstraint(
            "(bounty_amount IS NULL) = (bounty_currency IS NULL)",
            name=op.f("ck_reports_bounty_amount_currency"),
        ),
        sa.CheckConstraint("bounty_amount >= 0", name=op.f("ck_reports_bounty_amount_positive")),
        sa.CheckConstraint(
            "cvss_score >= 0 AND cvss_score <= 10", name=op.f("ck_reports_cvss_score_range")
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_reports_project_id_projects"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reports")),
    )
    op.create_index("ix_reports_created_at", "reports", ["created_at"], unique=False)
    op.create_index(
        "ix_reports_project_updated_at", "reports", ["project_id", "updated_at"], unique=False
    )
    op.create_index("ix_reports_severity", "reports", ["severity"], unique=False)
    op.create_index(
        "ix_reports_status_updated_at", "reports", ["status", "updated_at"], unique=False
    )
    op.create_index("ix_reports_submitted_at", "reports", ["submitted_at"], unique=False)
    op.create_index(
        "ix_reports_title_lower", "reports", [sa.literal_column("lower(title)")], unique=False
    )
    op.create_index("ix_reports_type", "reports", ["type"], unique=False)
    op.create_index("ix_reports_updated_at", "reports", ["updated_at"], unique=False)
    op.create_table(
        "report_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("report_id", sa.Integer(), nullable=False),
        sa.Column("storage_name", sa.String(length=32), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "storage_name ~ '^[0-9a-f]{32}$'",
            name=op.f("ck_report_attachments_storage_name_format"),
        ),
        sa.CheckConstraint("size_bytes >= 0", name=op.f("ck_report_attachments_size_positive")),
        sa.ForeignKeyConstraint(
            ["report_id"],
            ["reports.id"],
            name=op.f("fk_report_attachments_report_id_reports"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_report_attachments")),
        sa.UniqueConstraint("storage_name", name=op.f("uq_report_attachments_storage_name")),
    )
    op.create_index(
        "ix_report_attachments_report_id", "report_attachments", ["report_id"], unique=False
    )
    op.add_column("activity_logs", sa.Column("actor_user_id", sa.Integer(), nullable=True))
    op.create_index(
        "ix_activity_logs_entity",
        "activity_logs",
        ["entity_type", "entity_id", "occurred_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_activity_logs_entity", table_name="activity_logs")
    op.drop_column("activity_logs", "actor_user_id")
    op.drop_index("ix_report_attachments_report_id", table_name="report_attachments")
    op.drop_table("report_attachments")
    op.drop_index("ix_reports_updated_at", table_name="reports")
    op.drop_index("ix_reports_type", table_name="reports")
    op.drop_index("ix_reports_title_lower", table_name="reports")
    op.drop_index("ix_reports_submitted_at", table_name="reports")
    op.drop_index("ix_reports_status_updated_at", table_name="reports")
    op.drop_index("ix_reports_severity", table_name="reports")
    op.drop_index("ix_reports_project_updated_at", table_name="reports")
    op.drop_index("ix_reports_created_at", table_name="reports")
    op.drop_table("reports")

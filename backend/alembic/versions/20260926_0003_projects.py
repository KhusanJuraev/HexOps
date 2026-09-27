"""projects, scope items, activity log

Stage 3. Enum columns are VARCHAR(32) + a named CHECK (no native PG enums), so a
new value is an ordinary migration. activity_logs.project_id has no foreign key on
purpose: history outlives deleted projects (D-53).

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26 14:50:52.096822
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_activity_logs")),
    )
    op.create_index("ix_activity_logs_occurred_at", "activity_logs", ["occurred_at"], unique=False)
    op.create_index(
        "ix_activity_logs_project_occurred",
        "activity_logs",
        ["project_id", "occurred_at"],
        unique=False,
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
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
            "status IN ('active', 'paused', 'closed')", name=op.f("ck_projects_project_status")
        ),
        sa.CheckConstraint(
            "type IN ('bounty_program', 'pentest_client', 'personal_research')",
            name=op.f("ck_projects_project_type"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    op.create_index(
        "ix_projects_name_lower", "projects", [sa.literal_column("lower(name)")], unique=False
    )
    op.create_index("ix_projects_start_date", "projects", ["start_date"], unique=False)
    op.create_index(
        "ix_projects_status_updated_at", "projects", ["status", "updated_at"], unique=False
    )
    op.create_index("ix_projects_type", "projects", ["type"], unique=False)
    op.create_index("ix_projects_updated_at", "projects", ["updated_at"], unique=False)
    op.create_table(
        "project_scope_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("value", sa.String(length=512), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('domain', 'wildcard', 'url', 'ip', 'cidr', 'other')",
            name=op.f("ck_project_scope_items_scope_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_project_scope_items_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_scope_items")),
    )
    op.create_index(
        "ix_project_scope_items_project_position",
        "project_scope_items",
        ["project_id", "position"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_scope_items_project_position", table_name="project_scope_items")
    op.drop_table("project_scope_items")
    op.drop_index("ix_projects_updated_at", table_name="projects")
    op.drop_index("ix_projects_type", table_name="projects")
    op.drop_index("ix_projects_status_updated_at", table_name="projects")
    op.drop_index("ix_projects_start_date", table_name="projects")
    op.drop_index("ix_projects_name_lower", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_activity_logs_project_occurred", table_name="activity_logs")
    op.drop_index("ix_activity_logs_occurred_at", table_name="activity_logs")
    op.drop_table("activity_logs")

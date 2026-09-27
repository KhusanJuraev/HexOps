"""notes and tags

Stage 5. notes.project_id is optional and ON DELETE SET NULL: deleting a project
keeps its notes, unlinked (D-68). Tags are normalized names shared by notes (D-69).

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-26 16:07:13.239280
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=32), nullable=False),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 32", name=op.f("ck_tags_name_length")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tags")),
        sa.UniqueConstraint("name", name=op.f("uq_tags_name")),
    )
    op.create_table(
        "notes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=300), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_notes_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notes")),
    )
    op.create_index("ix_notes_created_at", "notes", ["created_at"], unique=False)
    op.create_index(
        "ix_notes_project_updated_at", "notes", ["project_id", "updated_at"], unique=False
    )
    op.create_index(
        "ix_notes_title_lower", "notes", [sa.literal_column("lower(title)")], unique=False
    )
    op.create_index("ix_notes_updated_at", "notes", ["updated_at"], unique=False)
    op.create_table(
        "note_tags",
        sa.Column("note_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["note_id"], ["notes.id"], name=op.f("fk_note_tags_note_id_notes"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["tag_id"], ["tags.id"], name=op.f("fk_note_tags_tag_id_tags"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("note_id", "tag_id", name=op.f("pk_note_tags")),
    )
    op.create_index("ix_note_tags_tag_id", "note_tags", ["tag_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_note_tags_tag_id", table_name="note_tags")
    op.drop_table("note_tags")
    op.drop_index("ix_notes_updated_at", table_name="notes")
    op.drop_index("ix_notes_title_lower", table_name="notes")
    op.drop_index("ix_notes_project_updated_at", table_name="notes")
    op.drop_index("ix_notes_created_at", table_name="notes")
    op.drop_table("notes")
    op.drop_table("tags")

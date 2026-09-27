"""search vectors and indexes

Stage 6 (D-76). Adds a stored, generated tsvector to reports and notes (title
weight A, body weight B, each in the simple, english and russian configurations,
apostrophes removed) with a GIN index, and trigram GIN indexes on title and body
for identifier substrings. pg_trgm is a trusted extension, so the database owner
can create it. Downgrade keeps the extension (harmless, may be shared).

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-26 17:01:41.454888
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Must equal app.core.textsearch.search_vector_sql("title", "body_md") at this revision.
VECTOR_SQL = (
    "setweight(to_tsvector('simple'::regconfig, translate(coalesce(title, ''), 'ʻ‘’''`ʼ', '')), 'A') || "
    "setweight(to_tsvector('english'::regconfig, translate(coalesce(title, ''), 'ʻ‘’''`ʼ', '')), 'A') || "
    "setweight(to_tsvector('russian'::regconfig, translate(coalesce(title, ''), 'ʻ‘’''`ʼ', '')), 'A') || "
    "setweight(to_tsvector('simple'::regconfig, translate(coalesce(left(body_md, 100000), ''), 'ʻ‘’''`ʼ', '')), 'B') || "
    "setweight(to_tsvector('english'::regconfig, translate(coalesce(left(body_md, 100000), ''), 'ʻ‘’''`ʼ', '')), 'B') || "
    "setweight(to_tsvector('russian'::regconfig, translate(coalesce(left(body_md, 100000), ''), 'ʻ‘’''`ʼ', '')), 'B')"
)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.add_column(
        "notes",
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(
                VECTOR_SQL,
                persisted=True,
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_notes_body_trgm",
        "notes",
        ["body_md"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"body_md": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_notes_search_vector", "notes", ["search_vector"], unique=False, postgresql_using="gin"
    )
    op.create_index(
        "ix_notes_title_trgm",
        "notes",
        ["title"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.add_column(
        "reports",
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(
                VECTOR_SQL,
                persisted=True,
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_reports_body_trgm",
        "reports",
        ["body_md"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"body_md": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_reports_search_vector",
        "reports",
        ["search_vector"],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_reports_title_trgm",
        "reports",
        ["title"],
        unique=False,
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )


def downgrade() -> None:
    op.drop_index(
        "ix_reports_title_trgm",
        table_name="reports",
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.drop_index("ix_reports_search_vector", table_name="reports", postgresql_using="gin")
    op.drop_index(
        "ix_reports_body_trgm",
        table_name="reports",
        postgresql_using="gin",
        postgresql_ops={"body_md": "gin_trgm_ops"},
    )
    op.drop_column("reports", "search_vector")
    op.drop_index(
        "ix_notes_title_trgm",
        table_name="notes",
        postgresql_using="gin",
        postgresql_ops={"title": "gin_trgm_ops"},
    )
    op.drop_index("ix_notes_search_vector", table_name="notes", postgresql_using="gin")
    op.drop_index(
        "ix_notes_body_trgm",
        table_name="notes",
        postgresql_using="gin",
        postgresql_ops={"body_md": "gin_trgm_ops"},
    )
    op.drop_column("notes", "search_vector")

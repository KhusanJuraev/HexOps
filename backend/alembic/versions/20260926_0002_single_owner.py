"""single owner: at most one row in users

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26

Enforces HexOps v1's single account in the database itself, so concurrent
first-run setup requests cannot create two owners. Existing rows are untouched.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    count = op.get_bind().execute(sa.text("SELECT count(*) FROM users")).scalar_one()
    if count > 1:
        # Never delete or merge accounts automatically; make the operator decide.
        raise RuntimeError(
            f"users has {count} rows; HexOps v1 allows one account. "
            "Remove the extra accounts manually, then run the migration again."
        )
    op.create_index("uq_users_single_owner", "users", [sa.text("(true)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_users_single_owner", table_name="users")

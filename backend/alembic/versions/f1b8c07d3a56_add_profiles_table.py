"""add profiles table for onboarding state and target roles

Backs the post-login onboarding interceptor: whether a user has completed
setup, and the 3-5 target roles that drive their job feed and dashboard.

RLS is enabled with no policies attached, matching b3f1a7c92d40. This table
sits in `public` and is therefore reachable through PostgREST with the
browser's anon key; without RLS every user's target roles and onboarding
state would be world-readable, and writable if the anon role holds write
grants. The FastAPI backend connects as the table owner and so bypasses RLS,
which is why the application still works with zero policies.

Revision ID: f1b8c07d3a56
Revises: e4a91c33f7b2
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f1b8c07d3a56'
down_revision: Union[str, None] = 'e4a91c33f7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "profiles",
        sa.Column("user_id", postgresql.UUID(as_uuid=False), primary_key=True, nullable=False),
        sa.Column(
            "onboarding_completed",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("target_roles", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("primary_resume_analysis_id", sa.Integer(), nullable=True),
        sa.Column("primary_resume_filename", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_profiles_user_id", "profiles", ["user_id"])

    # Deny-by-default, same posture as b3f1a7c92d40. Skipped on SQLite, which
    # has no RLS and would error on the statement.
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("ix_profiles_user_id", table_name="profiles")
    op.drop_table("profiles")

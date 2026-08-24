"""add star_stories table

Backing store for the STAR story bank (app/models/story.py).

Deny-by-default RLS, consistent with every other user-owned table: the
frontend never reaches PostgREST, it calls this backend, which verifies the
Supabase JWT and connects as the service role.

Revision ID: c4d8f19a62e3
Revises: f2b8e64a05d7
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d8f19a62e3'
down_revision: Union[str, None] = 'f2b8e64a05d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=False) if is_postgres else sa.String(36)

    op.create_table(
        "star_stories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("situation", sa.Text(), server_default="", nullable=False),
        sa.Column("task", sa.Text(), server_default="", nullable=False),
        sa.Column("action", sa.Text(), server_default="", nullable=False),
        sa.Column("result", sa.Text(), server_default="", nullable=False),
        sa.Column("tags", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_star_stories_id", "star_stories", ["id"])
    op.create_index("ix_star_stories_user_id", "star_stories", ["user_id"])

    if not is_postgres:
        return
    op.execute(
        "ALTER TABLE public.star_stories ADD CONSTRAINT fk_star_stories_user "
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    op.execute("ALTER TABLE public.star_stories ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.star_stories FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.star_stories DISABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.star_stories DROP CONSTRAINT IF EXISTS fk_star_stories_user")
    op.drop_index("ix_star_stories_user_id", table_name="star_stories")
    op.drop_index("ix_star_stories_id", table_name="star_stories")
    op.drop_table("star_stories")

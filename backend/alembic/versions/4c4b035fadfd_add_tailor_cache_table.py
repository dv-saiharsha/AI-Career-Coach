"""add tailor_cache table

Backing store for resume_builder/cache.py: cached Claude bullet-rewrite
proposals and compiled quick-tailor PDFs, keyed by (user, resume scan, job),
so re-opening the same tailor tab doesn't re-spend a Claude call or re-run
several tectonic compiles for identical input. See app/models/tailor_cache.py.

No `auth.uid() = user_id` policies despite this being per-user data — same
reasoning as job_applications (c9f4e21b7d83): the frontend never talks to
PostgREST, only to this FastAPI backend, which verifies the Supabase JWT
itself and filters every query by user_id in Python. Deny-by-default RLS
(enabled, no policies, grants revoked) keeps this consistent with every
other table rather than leaving a single un-gated exception.

Revision ID: 4c4b035fadfd
Revises: b7e21c93f4a8
Create Date: 2026-09-05 18:55:33.929244

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '4c4b035fadfd'
down_revision: Union[str, None] = 'b7e21c93f4a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tailor_cache",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=False).with_variant(sa.String(36), "sqlite"),
            nullable=False,
        ),
        sa.Column("analysis_id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("target_pages", sa.Integer(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("pdf_base64", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            # sa.func.now(), not sa.text("now()"): the former compiles per
            # dialect (CURRENT_TIMESTAMP on SQLite), the latter emits a
            # literal now() that SQLite has no function for.
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tailor_cache_id", "tailor_cache", ["id"])
    op.create_index("ix_tailor_cache_user_id", "tailor_cache", ["user_id"])
    op.create_index("ix_tailor_cache_analysis_id", "tailor_cache", ["analysis_id"])
    op.create_index("ix_tailor_cache_job_id", "tailor_cache", ["job_id"])
    op.create_index(
        "ix_tailor_cache_lookup",
        "tailor_cache",
        ["user_id", "analysis_id", "job_id", "kind", "target_pages"],
        unique=True,
    )

    # Postgres-only: the local dev database is SQLite, which has no RLS.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE public.tailor_cache ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.tailor_cache FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.tailor_cache DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_tailor_cache_lookup", table_name="tailor_cache")
    op.drop_index("ix_tailor_cache_job_id", table_name="tailor_cache")
    op.drop_index("ix_tailor_cache_analysis_id", table_name="tailor_cache")
    op.drop_index("ix_tailor_cache_user_id", table_name="tailor_cache")
    op.drop_index("ix_tailor_cache_id", table_name="tailor_cache")
    op.drop_table("tailor_cache")

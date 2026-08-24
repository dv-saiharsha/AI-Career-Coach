"""add job_listings cache table

Backing store for the /jobs directory. Rows are cached results of paid Apify
actor runs, keyed by normalised search query and aged out by TTL rather than
deleted per request — see app/models/job.py.

RLS is enabled here for the same reason as b3f1a7c92d40: anything landing in
`public` is exposed through PostgREST to a publishable key that ships to every
browser. This table holds no user data, but it does hold data we paid per-row
to acquire, and there is no reason for it to be readable outside the backend.
Deny-by-default (RLS on, no policies, grants revoked) keeps it consistent with
every other table rather than leaving a single un-gated exception.

Revision ID: d7e2a45b81c9
Revises: b3f1a7c92d40
Create Date: 2026-08-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd7e2a45b81c9'
down_revision: Union[str, None] = 'b3f1a7c92d40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "job_listings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("query_key", sa.String(), nullable=False),
        sa.Column("external_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("company", sa.String(), nullable=False),
        sa.Column("location", sa.String(), nullable=False),
        sa.Column("work_mode", sa.String(), nullable=False),
        sa.Column("salary_range", sa.String(), nullable=True),
        sa.Column("skills", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("apply_url", sa.String(), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            # sa.func.now(), not sa.text("now()"): the former compiles per
            # dialect (CURRENT_TIMESTAMP on SQLite), the latter emits a
            # literal now() that SQLite has no function for.
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_job_listings_id", "job_listings", ["id"])
    op.create_index("ix_job_listings_query_key", "job_listings", ["query_key"])
    op.create_index("ix_job_listings_external_id", "job_listings", ["external_id"])
    # Matches the cache lookup shape: rows for a query, filtered by freshness.
    op.create_index(
        "ix_job_listings_query_fetched", "job_listings", ["query_key", "fetched_at"]
    )

    # Postgres-only: the local dev database is SQLite, which has no RLS.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.job_listings FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.job_listings DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_job_listings_query_fetched", table_name="job_listings")
    op.drop_index("ix_job_listings_external_id", table_name="job_listings")
    op.drop_index("ix_job_listings_query_key", table_name="job_listings")
    op.drop_index("ix_job_listings_id", table_name="job_listings")
    op.drop_table("job_listings")

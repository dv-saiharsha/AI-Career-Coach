"""add job_listings full-text search index

Backs job_market/services.py's search_jobs(): a GIN index over a tsvector
expression on title/company/skills/description, so the Job Portal's search
reads directly against crawled data with no external call and no per-query
cache. Postgres-only — SQLite (local dev, every test here) has no
equivalent without a separate FTS5 virtual table, so search_jobs() falls
back to a plain substring match there; that path never runs in production
and never needs this index.

CORRECTED before ever successfully running anywhere: the first version of
this migration built the index directly on
`to_tsvector('english', concat_ws(...))`, which Postgres refuses —
`to_tsvector`'s regconfig overload is STABLE, not IMMUTABLE (the config
name is looked up in a system catalog that could in principle change), and
an index expression must be provably immutable. Confirmed against the real
Supabase database (17.6): the whole `alembic upgrade head` batch rolled
back atomically on this exact error, leaving nothing partially applied.
The fix is the standard one — wrap the expression in a SQL function
explicitly declared IMMUTABLE, and index a call to that function instead.

search_jobs()'s Postgres branch calls the exact same function, not a bare
to_tsvector(...), or Postgres will not recognise the query as matching this
index and will fall back to a sequential scan instead.

Revision ID: 176726787f72
Revises: 287a84183e11
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = '176726787f72'
down_revision: Union[str, None] = '287a84183e11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(
        """
        CREATE FUNCTION job_listings_search_vector(title text, company text, skills text, description text)
        RETURNS tsvector
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT to_tsvector('english', concat_ws(' ', title, company, skills, description))
        $$
        """
    )
    op.execute(
        """
        CREATE INDEX ix_job_listings_fts ON job_listings
        USING GIN (job_listings_search_vector(title, company, skills, description))
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_job_listings_fts")
    op.execute("DROP FUNCTION IF EXISTS job_listings_search_vector(text, text, text, text)")

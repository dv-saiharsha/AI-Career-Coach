"""add job_listings full-text search index

Backs job_market/services.py's search_jobs(): a GIN index over a
to_tsvector expression on title/company/skills/description, so the Job
Portal's search reads directly against crawled data with no external call
and no per-query cache. Postgres-only — SQLite (local dev, every test here)
has no equivalent without a separate FTS5 virtual table, so search_jobs()
falls back to a plain substring match there; that path never runs in
production and never needs this index.

The concat_ws(' ', ...) expression here must match search_jobs()'s own
to_tsvector call exactly, or Postgres will not recognise a search query as
using this index and will fall back to a sequential scan instead.

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
        CREATE INDEX ix_job_listings_fts ON job_listings
        USING GIN (to_tsvector('english', concat_ws(' ', title, company, skills, description)))
        """
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP INDEX IF EXISTS ix_job_listings_fts")

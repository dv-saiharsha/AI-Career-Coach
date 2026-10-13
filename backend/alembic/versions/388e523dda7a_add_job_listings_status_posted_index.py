"""add job_listings status posted index

Backs job_market/services.py's Job Portal read path now that it shows every
open row instead of a hard-coded 1000-row/7-day-window snapshot: every page
load and every filter-pill count queries "status = 'open', newest posted_at
first, optionally no older than a Date-posted floor." Without this index
that is a sequential scan + sort over an unbounded, ever-growing table on
every request.

statement_timeout raised for this one statement, same reasoning and same
fix as 176726787f72_add_job_listings_full_text_search.py: building an index
against a table that already has tens of thousands of real rows is a
one-time cost the initial build pays, not something a later insert pays,
and it has already been enough to exceed Supabase's pooler default (2
minutes) once for a heavier GIN index on this same table. A plain two-column
B-tree index is much cheaper than that GIN build, but there is no upside to
re-risking the same failure mode for the sake of skipping one SET LOCAL.

Revision ID: 388e523dda7a
Revises: 176726787f72
Create Date: 2026-09-29 16:56:49.230360

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '388e523dda7a'
down_revision: Union[str, None] = '176726787f72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("SET LOCAL statement_timeout = '5min'")
    op.create_index(
        "ix_job_listings_status_posted", "job_listings", ["status", "posted_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_job_listings_status_posted", table_name="job_listings")

"""crawl_runs.stats: per-crawler counts for each run

A JSON object (text) written by job_market/crawler.py at the end of every run:
postings fetched, new, updated, duplicates (fetched and already stored
unchanged), companies and errors per crawler (ATS type), and the run's
enrichment counts. Read by GET /api/jobs/scheduler-status. Defaults to "{}" so
existing rows stay valid.

Chains after a9d3c5e7f102 (jd_analyses). The deferred crawler migrations must
chain after this revision now; see MIGRATION_RUNBOOK.md.

Revision ID: b4e1c2d3f501
Revises: a9d3c5e7f102
Create Date: 2026-10-14 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4e1c2d3f501"
down_revision: Union[str, None] = "a9d3c5e7f102"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crawl_runs", sa.Column("stats", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("crawl_runs", "stats")

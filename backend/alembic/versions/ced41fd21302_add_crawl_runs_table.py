"""add crawl_runs table

One row per crawl sweep — what the admin API reads to answer "did the last
run work" without grepping logs. See app/models/crawl_run.py and
CRAWLER_PLAN.md §3.3.

RLS enabled for the same reason as companies (0893da5ea7ab) and every other
public table.

Revision ID: ced41fd21302
Revises: 0893da5ea7ab
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'ced41fd21302'
down_revision: Union[str, None] = '0893da5ea7ab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "crawl_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("trigger", sa.String(length=16), server_default="scheduled", nullable=False),
        # No SQLAlchemy ForeignKey — auth.users lives in Supabase, not a table
        # this backend models, same as JobApplication.user_id elsewhere.
        sa.Column("triggered_by", sa.String(length=36), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("companies_attempted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("companies_succeeded", sa.Integer(), server_default="0", nullable=False),
        sa.Column("companies_failed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("jobs_new", sa.Integer(), server_default="0", nullable=False),
        sa.Column("jobs_updated", sa.Integer(), server_default="0", nullable=False),
        sa.Column("jobs_closed", sa.Integer(), server_default="0", nullable=False),
        sa.Column("errors", sa.Text(), server_default="[]", nullable=False),
        sa.Column("cost_usd", sa.Float(), server_default="0", nullable=False),
        sa.CheckConstraint("trigger IN ('scheduled', 'manual')", name="ck_crawl_runs_trigger"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_crawl_runs_id", "crawl_runs", ["id"])
    # What the admin "recent runs" endpoint and the alerting check both read:
    # runs ordered by recency.
    op.create_index("ix_crawl_runs_started_at", "crawl_runs", ["started_at"])

    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE public.crawl_runs ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.crawl_runs FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.crawl_runs DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_crawl_runs_started_at", table_name="crawl_runs")
    op.drop_index("ix_crawl_runs_id", table_name="crawl_runs")
    op.drop_table("crawl_runs")

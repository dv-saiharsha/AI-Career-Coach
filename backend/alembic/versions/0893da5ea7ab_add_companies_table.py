"""add companies table

The employer registry a crawl sweeps — see app/models/company.py and
CRAWLER_PLAN.md §3.1. Replaces the hardcoded tuples in
job_market/boards_registry.py with a DB-backed, team-editable registry that
also tracks crawl health per company.

RLS enabled for the same reason as every other public table (b3f1a7c92d40):
anything in `public` is reachable through PostgREST via the anon/publishable
key. This table holds no user data, but there is no reason for it to be
readable outside the backend either.

Revision ID: 0893da5ea7ab
Revises: 6946f777f090
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0893da5ea7ab'
down_revision: Union[str, None] = '6946f777f090'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("logo_url", sa.String(), nullable=True),
        sa.Column("website", sa.String(), nullable=True),
        sa.Column("careers_url", sa.String(), nullable=True),
        sa.Column("ats_type", sa.String(length=24), nullable=True),
        sa.Column("ats_slug", sa.String(), nullable=True),
        sa.Column("industry", sa.String(), nullable=True),
        sa.Column("size", sa.String(), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("last_crawled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("crawl_status", sa.String(length=12), server_default="never_run", nullable=False),
        sa.Column("consecutive_failures", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("etag", sa.String(), nullable=True),
        sa.Column("last_modified", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "crawl_status IN ('never_run', 'ok', 'failing')", name="ck_companies_crawl_status"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_companies_id", "companies", ["id"])
    # Partial: most rows start with no ats_slug (manual_review), and NULL
    # pairs must not collide on a uniqueness check that only means something
    # once a real slug is assigned.
    op.create_index(
        "ix_companies_ats_identity",
        "companies",
        ["ats_type", "ats_slug"],
        unique=True,
        postgresql_where=sa.text("ats_slug IS NOT NULL"),
        sqlite_where=sa.text("ats_slug IS NOT NULL"),
    )

    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.companies FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_companies_ats_identity", table_name="companies")
    op.drop_index("ix_companies_id", table_name="companies")
    op.drop_table("companies")

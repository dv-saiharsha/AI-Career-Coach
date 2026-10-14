"""add jd_analyses: stored analyses of job descriptions

One row per analysed job description (see app/modules/jd_analyzer). jd_hash is the
SHA-256 of the cleaned text and is how a repeat is recognised; job_listing_id links a
row to a crawled listing and is NOT a foreign key (listings are deleted by retention,
an analysis of the same text stays useful). analysis is JSON (Postgres json, text on
SQLite). source records how it was made and is constrained to llm / rules / hybrid.
analyzer_version lets a change to the prompt or the checking retire old rows.

The table holds no user data, so account erasure has nothing to remove from it.

Chains after c7e4a19d5b36 (user_id is text). The six deferred migrations from the
unmerged crawler work are also meant to chain after that revision, so whichever of the
two lands second has to be re-parented onto the other; see MIGRATION_RUNBOOK.md.

Revision ID: a9d3c5e7f102
Revises: c7e4a19d5b36
Create Date: 2026-10-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a9d3c5e7f102"
down_revision: Union[str, None] = "c7e4a19d5b36"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "jd_analyses",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("jd_hash", sa.String(length=64), nullable=False),
        sa.Column("job_listing_id", sa.Integer(), nullable=True),
        sa.Column("analysis", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(length=8), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("analyzer_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source IN ('llm', 'rules', 'hybrid')", name="ck_jd_analyses_source"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_jd_analyses_id", "jd_analyses", ["id"])
    op.create_index("ix_jd_analyses_hash", "jd_analyses", ["jd_hash"])
    op.create_index("ix_jd_analyses_job_listing_id", "jd_analyses", ["job_listing_id"])


def downgrade() -> None:
    op.drop_index("ix_jd_analyses_job_listing_id", table_name="jd_analyses")
    op.drop_index("ix_jd_analyses_hash", table_name="jd_analyses")
    op.drop_index("ix_jd_analyses_id", table_name="jd_analyses")
    op.drop_table("jd_analyses")

"""add content hash and Claude enrichment columns to job_listings

content_hash is a unique identity key (md5 of normalised company|title|
location) so a re-run recognises postings it already holds. enriched_at is
what makes the cost model work: a sweep skips anything already enriched, so
re-running costs nothing for jobs already stored.

All columns are nullable. Rows cached before this migration have no hash and
no enrichment, and backfilling either would mean inventing data about postings
we can no longer verify.

Revision ID: a8f31c67d9e2
Revises: c4d8f19a62e3
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8f31c67d9e2'
down_revision: Union[str, None] = 'c4d8f19a62e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_listings", sa.Column("content_hash", sa.String(32), nullable=True))
    op.add_column("job_listings", sa.Column("h1b_sponsorship", sa.String(24), nullable=True))
    op.add_column("job_listings", sa.Column("h1b_evidence", sa.Text(), nullable=True))
    op.add_column("job_listings", sa.Column("experience_level", sa.String(12), nullable=True))
    op.add_column("job_listings", sa.Column("employment_type", sa.String(16), nullable=True))
    op.add_column("job_listings", sa.Column("enriched_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_job_listings_content_hash", "job_listings", ["content_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_job_listings_content_hash", table_name="job_listings")
    for column in ("enriched_at", "employment_type", "experience_level",
                   "h1b_evidence", "h1b_sponsorship", "content_hash"):
        op.drop_column("job_listings", column)

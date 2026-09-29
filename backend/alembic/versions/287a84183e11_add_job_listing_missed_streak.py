"""add job_listings.missed_streak

The close-after-2-misses lifecycle (job_market/crawler.py) needs to count
consecutive successful crawls that didn't re-see a row, and neither
last_seen_at nor status alone can express "missed once" vs "missed twice"
without also knowing when the crawl before last actually ran per company.
A counter is simpler and cheaper than reconstructing that from crawl_runs.

Revision ID: 287a84183e11
Revises: 796ac588caab
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '287a84183e11'
down_revision: Union[str, None] = '796ac588caab'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "job_listings",
        sa.Column("missed_streak", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("job_listings", "missed_streak")

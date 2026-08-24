"""add description column to job_listings

The feed discarded the posting body until now, keeping only the fields the
grid rendered. The detail drawer needs the full text, and it is also what a
resume gets matched against when a user sends a listing to /resume.

Nullable rather than backfilled in the migration: the text only exists in the
upstream API response, so rows cached before this point cannot be filled in
from the database. Re-running scripts/refresh_jobs.py repopulates them.

Revision ID: e4a91c33f7b2
Revises: d7e2a45b81c9
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4a91c33f7b2'
down_revision: Union[str, None] = 'd7e2a45b81c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_listings", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_listings", "description")

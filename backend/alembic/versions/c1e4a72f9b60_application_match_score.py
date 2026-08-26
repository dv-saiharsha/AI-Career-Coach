"""add match_score to job_applications

The dashboard reports an average match across a user's pipeline. Computing it
per request is not viable: predict_score is a trained-model call at ~127ms, so
a pipeline of twenty applications would add 2.5s to every dashboard load.

Scored once and stored instead. NULL means not yet scored — kept distinct from
a real low score, and excluded from the average rather than counted as zero,
which would drag the figure down for applications nobody has measured.

Revision ID: c1e4a72f9b60
Revises: f7b31d0e58a2
Create Date: 2026-08-26 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1e4a72f9b60'
down_revision: Union[str, None] = 'f7b31d0e58a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_applications", sa.Column("match_score", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_applications", "match_score")

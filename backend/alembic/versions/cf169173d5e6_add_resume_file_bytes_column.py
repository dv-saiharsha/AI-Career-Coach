"""add resume_file_bytes column

Revision ID: cf169173d5e6
Revises: 90cb7acbc15d
Create Date: 2026-07-18 14:40:24.839735

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cf169173d5e6'
down_revision: Union[str, None] = '90cb7acbc15d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("resume_analyses", sa.Column("resume_file_bytes", sa.LargeBinary(), nullable=True))


def downgrade() -> None:
    op.drop_column("resume_analyses", "resume_file_bytes")

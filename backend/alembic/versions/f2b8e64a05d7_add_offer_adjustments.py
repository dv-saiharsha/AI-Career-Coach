"""add user-entered tax and cost-of-living fields to job_offers

Both optional and both user-supplied. Nothing here is inferred or looked up:
an effective tax rate depends on filing status, deductions, and state/local
rules this app doesn't know, so a guessed multiplier applied to a real offer
would be worse than no adjustment at all.

estimated_tax_rate is NULLABLE with no default, because NULL ("not supplied")
has to stay distinguishable from 0.0 ("no state income tax"), which is a real
answer for TX, FL, WA and others. Defaulting to 0 would silently claim every
offer was tax-free.

Revision ID: f2b8e64a05d7
Revises: e7a3d59c1f42
Create Date: 2026-08-21 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f2b8e64a05d7'
down_revision: Union[str, None] = 'e7a3d59c1f42'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("job_offers", sa.Column("estimated_tax_rate", sa.Numeric(5, 4), nullable=True))
    op.add_column("job_offers", sa.Column("col_index", sa.Numeric(6, 4), nullable=True))


def downgrade() -> None:
    op.drop_column("job_offers", "col_index")
    op.drop_column("job_offers", "estimated_tax_rate")

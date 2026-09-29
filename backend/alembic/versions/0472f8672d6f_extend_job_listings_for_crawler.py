"""extend job_listings for the crawler

Adds the columns the close-after-2-misses lifecycle and the companies
registry need: company_id (FK, nullable — only crawler/ATS rows resolve to
one), department, structured salary_min/max/currency (alongside the existing
salary_range display string), first_seen_at/last_seen_at, and status/closed_at.

All new rows default status='open'; existing rows backfill to 'open' with
first_seen_at/last_seen_at set from their existing fetched_at, since that is
the closest true value already on hand — not a guess, the best available
reading of "when did we first/last see this."

Revision ID: 0472f8672d6f
Revises: ced41fd21302
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '0472f8672d6f'
down_revision: Union[str, None] = 'ced41fd21302'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("job_listings") as batch:
        batch.add_column(sa.Column("company_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("department", sa.String(), nullable=True))
        batch.add_column(sa.Column("salary_min", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("salary_max", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("salary_currency", sa.String(length=8), nullable=True))
        batch.add_column(sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("status", sa.String(length=8), server_default="open", nullable=False))
        batch.add_column(sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key(
            "fk_job_listings_company_id", "companies", ["company_id"], ["id"], ondelete="SET NULL"
        )
        batch.create_check_constraint("ck_job_listings_status", "status IN ('open', 'closed')")

    op.execute("UPDATE job_listings SET first_seen_at = fetched_at WHERE first_seen_at IS NULL")
    op.execute("UPDATE job_listings SET last_seen_at = fetched_at WHERE last_seen_at IS NULL")

    op.create_index("ix_job_listings_company_id", "job_listings", ["company_id"])
    op.create_index("ix_job_listings_company_status", "job_listings", ["company_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_job_listings_company_status", table_name="job_listings")
    op.drop_index("ix_job_listings_company_id", table_name="job_listings")

    with op.batch_alter_table("job_listings") as batch:
        batch.drop_constraint("ck_job_listings_status", type_="check")
        batch.drop_constraint("fk_job_listings_company_id", type_="foreignkey")
        batch.drop_column("closed_at")
        batch.drop_column("status")
        batch.drop_column("last_seen_at")
        batch.drop_column("first_seen_at")
        batch.drop_column("salary_currency")
        batch.drop_column("salary_max")
        batch.drop_column("salary_min")
        batch.drop_column("department")
        batch.drop_column("company_id")

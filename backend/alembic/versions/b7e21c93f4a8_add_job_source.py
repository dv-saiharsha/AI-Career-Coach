"""Record which ATS a job listing came from.

Nullable on purpose and left null for every existing row. The rows already in
the table came from the Apify LinkedIn scraper, where the underlying ATS is
genuinely unknowable — 2,536 of ~2,570 of their apply URLs are linkedin.com —
so backfilling any value would be inventing one. Null means "we do not know",
which is different from "none", and the UI must render it as such.

Revision ID: b7e21c93f4a8
Revises: a3f81c40d2e7
"""

import sqlalchemy as sa
from alembic import op

revision = "b7e21c93f4a8"
down_revision = "a3f81c40d2e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("job_listings", sa.Column("source", sa.String(length=24), nullable=True))
    op.create_index("ix_job_listings_source", "job_listings", ["source"])


def downgrade() -> None:
    op.drop_index("ix_job_listings_source", table_name="job_listings")
    op.drop_column("job_listings", "source")

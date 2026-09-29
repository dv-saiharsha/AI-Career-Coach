"""fix job_listings identity key for ATS/crawler rows

content_hash = md5(company|title|location) was used as the upsert identity
for every standing (non-JSearch) row. That is a content fingerprint, not an
identity: two distinct open reqs with the same title at the same location
collapsed into one row, and editing a posting's title (a rename, not a new
job) was read as a brand-new listing replacing the old one.

Every ats_boards.py adapter already synthesizes a provider-scoped
external_id at collection time (e.g. "greenhouse:stripe:12345"), so
(source, company, external_id) is available with no new scraping and becomes
the real identity for those rows. content_hash is kept, demoted to change
detection only. JSearch rows (source IS NULL) are untouched — they keep
today's content_hash-based upsert exactly as it was.

This drops content_hash's column-level uniqueness (it can no longer be
globally unique once two distinct same-title/location ATS postings are
allowed to coexist) and adds the new partial unique index. A defensive dedup
runs first: under the old scheme, an external_id could already appear on
more than one row if company/title text drifted slightly between crawls
(the lookup was by content_hash, which would differ, so a fresh row was
inserted rather than the existing one updated) — the unique index below
fails outright on the first such collision, and finding out at deploy time is
worse than checking here. Row recency is approximated by MAX(id) (this
table's PK is a monotonic autoincrement and every insert here comes from an
append-only crawl, so higher id already means "seen more recently" without
needing a second, dialect-sensitive comparison on fetched_at).

Revision ID: 796ac588caab
Revises: 0472f8672d6f
Create Date: 2026-09-29 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '796ac588caab'
down_revision: Union[str, None] = '0472f8672d6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM job_listings
        WHERE source IS NOT NULL AND external_id IS NOT NULL
          AND id NOT IN (
              SELECT MAX(id) FROM job_listings
              WHERE source IS NOT NULL AND external_id IS NOT NULL
              GROUP BY source, company, external_id
          )
        """
    )

    op.drop_index("ix_job_listings_content_hash", table_name="job_listings")
    op.create_index("ix_job_listings_content_hash", "job_listings", ["content_hash"])
    op.create_index(
        "ix_job_listings_ats_identity",
        "job_listings",
        ["source", "company", "external_id"],
        unique=True,
        postgresql_where=sa.text("source IS NOT NULL"),
        sqlite_where=sa.text("source IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_job_listings_ats_identity", table_name="job_listings")
    op.drop_index("ix_job_listings_content_hash", table_name="job_listings")
    op.create_index("ix_job_listings_content_hash", "job_listings", ["content_hash"], unique=True)

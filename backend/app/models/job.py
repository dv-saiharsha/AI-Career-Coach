from sqlalchemy import Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class JobListing(Base):
    """One job posting, cached from an Apify actor run.

    This table is a paid-API cache, not user data — every row here cost money
    to fetch, so rows are kept and re-served until stale rather than deleted
    per request. `query_key` + `fetched_at` are what make that work: a lookup
    is "rows for this query newer than the TTL", and a miss is what triggers a
    billed actor run. Index the pair, not the columns separately.

    There is no user_id. Listings are global and shared across all users —
    that is the entire point of caching them centrally.
    """

    __tablename__ = "job_listings"

    id = Column(Integer, primary_key=True, index=True)
    # Normalised search term that produced this row (see services.normalise_query).
    # Not the user's raw input — "Senior  ML Engineer " and "ml engineer" must
    # collapse to one cache entry or we pay twice for the same listings.
    query_key = Column(String, nullable=False, index=True)
    # Stable identifier from the actor, used to dedupe across overlapping
    # queries ("ml engineer" and "machine learning engineer" return overlap).
    # Nullable because not every actor guarantees one; falls back to a hash.
    external_id = Column(String, nullable=True, index=True)

    title = Column(String, nullable=False)
    company = Column(String, nullable=False)
    location = Column(String, nullable=False)
    # "Remote" | "Hybrid" | "On-site" — inferred, since Google Jobs has no
    # dedicated field for it. See services.infer_work_mode.
    work_mode = Column(String, nullable=False)
    salary_range = Column(String, nullable=True)
    # Full posting text, for the detail drawer and as the source a resume can
    # be matched against. Nullable because rows cached before this column
    # existed have none, and a listing without a description is still useful.
    description = Column(Text, nullable=True)
    # JSON-encoded list[str]. Derived from the description via the shared
    # keyword extractor, not returned by the actor.
    skills = Column(Text, nullable=False, default="[]")
    apply_url = Column(String, nullable=False)
    posted_at = Column(DateTime(timezone=True), nullable=True)

    # TTL basis. Distinct from posted_at: when *we* fetched it, not when the
    # employer published it.
    # Stable identity across sweeps: md5(company|title|location), normalised.
    # Nullable because rows cached before the ingestion worker existed have no
    # hash — backfilling one would be inventing an identity for a posting we
    # can no longer verify.
    content_hash = Column(String(32), nullable=True, index=True, unique=True)

    # Claude-extracted, and only ever reporting what the posting SAYS.
    # h1b_sponsorship is never a claim about what an employer will do:
    # sponsorship boilerplate goes stale and is routinely contradicted at
    # screening, so the evidence sentence is stored alongside it and shown to
    # the candidate to judge.
    h1b_sponsorship = Column(String(24), nullable=True)
    h1b_evidence = Column(Text, nullable=True)
    # NULL means the posting gave no basis to judge — deliberately distinct
    # from any real level, so a failed or skipped enrichment is never
    # mistaken for a classification.
    experience_level = Column(String(12), nullable=True)
    employment_type = Column(String(16), nullable=True)
    # NULL means never enriched. This is what lets a re-run skip postings
    # already paid for.
    enriched_at = Column(DateTime(timezone=True), nullable=True)

    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# Composite index matching the actual cache lookup (query_key AND freshness).
# Without this, every /jobs request table-scans a table that only grows.
Index("ix_job_listings_query_fetched", JobListing.query_key, JobListing.fetched_at)

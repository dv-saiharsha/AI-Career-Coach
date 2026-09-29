from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class JobListing(Base):
    """One job posting — from an employer's own ATS board, a JSON-LD careers
    page, or a cached JSearch aggregator result.

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

    # Which ATS this posting came from: "greenhouse", "lever", or null for the
    # Apify/LinkedIn feed where it is genuinely unknown.
    #
    # Known by construction rather than inferred — a row fetched from
    # boards-api.greenhouse.io is a Greenhouse posting because that is where
    # the bytes came from. It cannot be recovered for the scraped feed: 2,536
    # of ~2,570 of those apply URLs are linkedin.com, so the ATS behind them
    # is unknowable and null is the honest value.
    #
    # Worth storing because resume_analyzer/ats_vendors.py already knows which
    # parsers a given resume loses content in, and pairing the two turns a
    # general warning into a specific one about the job in front of you.
    source = Column(String(24), nullable=True, index=True)

    # TTL basis. Distinct from posted_at: when *we* fetched it, not when the
    # employer published it.
    # Content fingerprint, not identity: md5(company|title|location),
    # normalised. NOT unique — see ix_job_listings_ats_identity below for why
    # a content-based hash cannot also serve as the row's identity. Still
    # useful as "did this posting change" for rows whose real identity comes
    # from elsewhere. Nullable because rows cached before the ingestion
    # worker existed have no hash — backfilling one would be inventing an
    # identity for a posting we can no longer verify.
    content_hash = Column(String(32), nullable=True, index=True)

    # Structured pay, alongside salary_range's display string above — filled
    # only when a source states numbers (Ashby's compensation block, a
    # JSON-LD baseSalary). salary_range stays the thing every card renders;
    # these exist for the salary filter, which can't range-query a string.
    salary_min = Column(Integer, nullable=True)
    salary_max = Column(Integer, nullable=True)
    salary_currency = Column(String(8), nullable=True)

    department = Column(String, nullable=True)

    # Nullable: only crawler/ATS-sourced rows resolve to a registry entry.
    # JSearch rows and any row from before the companies table existed have
    # no company_id, and that's an accepted gap, not an error — see
    # CRAWLER_PLAN.md §3.2.
    company_id = Column(Integer, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True, index=True)

    # first_seen_at is set once, at insert. last_seen_at is bumped on every
    # crawl that re-observes the row — the pair is what the close-after-2-
    # misses logic in job_market/ingestion.py compares against a company's
    # last two successful crawls.
    first_seen_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)

    # 'open' | 'closed'. Only meaningful for standing crawler-sourced rows —
    # the JSearch on-demand cache is replaced wholesale per query
    # (services._replace_cache) and never transitions through this field.
    status = Column(String(8), nullable=False, default="open", server_default="open")
    closed_at = Column(DateTime(timezone=True), nullable=True)

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

    __table_args__ = (
        # A CHECK rather than an enum, matching job_applications.status:
        # SQLite has no enum type and the local dev database is SQLite.
        CheckConstraint("status IN ('open', 'closed')", name="ck_job_listings_status"),
    )


# Composite index matching the actual cache lookup (query_key AND freshness).
# Without this, every /jobs request table-scans a table that only grows.
Index("ix_job_listings_query_fetched", JobListing.query_key, JobListing.fetched_at)

# The real identity key for crawler/ATS-sourced rows. content_hash
# (company|title|location) used to serve this purpose and was wrong on two
# counts: two distinct open reqs with the same title at the same location
# collapsed into one row, and a posting whose title was edited (a rename, not
# a new job) read as a brand-new listing replacing the old one. Every
# adapter in ats_boards.py already synthesizes a provider-scoped external_id
# (e.g. "greenhouse:stripe:12345") at collection time, so (source, company,
# external_id) is available with no new scraping — see
# job_market/ingestion.py's upsert for the lookup this backs.
#
# Partial (source IS NOT NULL): JSearch rows carry no source and keep their
# existing content_hash-based upsert entirely unchanged — this index does
# not apply to them. NULLs in external_id are not deduplicated by a SQL
# unique index (Postgres/SQLite both treat NULL <> NULL), so a source whose
# adapter cannot produce a stable external_id (a JSON-LD page with no @id)
# can still produce duplicate rows — an accepted, disclosed gap rather than
# a silent one.
Index(
    "ix_job_listings_ats_identity",
    JobListing.source, JobListing.company, JobListing.external_id,
    unique=True,
    postgresql_where=JobListing.source.isnot(None),
    sqlite_where=JobListing.source.isnot(None),
)

# What the close-after-2-misses sweep queries: every open row for one
# company. Without this it's a table scan per company per sweep.
Index("ix_job_listings_company_status", JobListing.company_id, JobListing.status)

from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base

# "manual_review" is a real, expected steady state — not every company on
# data/companies_seed.csv resolves to a live ATS or a JSON-LD careers page on
# the first detection pass (see backend/scripts/detect_ats.py), and a row
# left there is a queue for a human, not a bug.
ATS_TYPES = (
    "greenhouse", "lever", "ashby", "workable", "smartrecruiters", "recruitee",
    "jsonld", "manual_review",
)
CRAWL_STATUSES = ("never_run", "ok", "failing")


class Company(Base):
    """The employer registry a crawl sweeps.

    Replaces the hardcoded GREENHOUSE_BOARDS/LEVER_BOARDS/ASHBY_BOARDS tuples
    in job_market/boards_registry.py with a DB-backed, team-editable registry
    seeded from data/companies_seed.csv — see backend/scripts/detect_ats.py
    for how ats_type/ats_slug get filled in for a row that starts without
    them.

    Crawl health lives directly on this row (last_crawled_at, crawl_status,
    consecutive_failures, last_error) rather than in a separate per-run
    table, so "which companies are failing" is one indexed read, not a join
    over crawl_runs.
    """

    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    logo_url = Column(String, nullable=True)
    website = Column(String, nullable=True)
    careers_url = Column(String, nullable=True)

    # Which adapter reads this company, and the token/slug that adapter needs
    # (a Greenhouse/Lever/.../Recruitee board token, or nothing for jsonld —
    # careers_url is all that path needs).
    ats_type = Column(String(24), nullable=True)
    ats_slug = Column(String, nullable=True)

    industry = Column(String, nullable=True)
    size = Column(String, nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="true")

    last_crawled_at = Column(DateTime(timezone=True), nullable=True)
    crawl_status = Column(String(12), nullable=False, default="never_run", server_default="never_run")
    consecutive_failures = Column(Integer, nullable=False, default=0, server_default="0")
    last_error = Column(Text, nullable=True)

    # Conditional-request cache (If-None-Match / If-Modified-Since),
    # best-effort — not every provider honors these. See the crawl
    # orchestrator in job_market/ingestion.py.
    etag = Column(String, nullable=True)
    last_modified = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # A CHECK rather than an enum, matching job_applications.status and
        # user_devices.platform: SQLite has no enum type and the local dev
        # database is SQLite.
        CheckConstraint(
            "crawl_status IN ('never_run', 'ok', 'failing')", name="ck_companies_crawl_status"
        ),
    )


# Partial: most rows start with no ats_slug at all (manual_review, or a
# jsonld row that only needs careers_url), and two such rows sharing
# ats_type/ats_slug = (NULL, NULL) must not collide on a uniqueness check
# that only means something once a real slug is assigned.
Index(
    "ix_companies_ats_identity",
    Company.ats_type, Company.ats_slug,
    unique=True,
    postgresql_where=Company.ats_slug.isnot(None),
    sqlite_where=Company.ats_slug.isnot(None),
)

from sqlalchemy import CheckConstraint, Column, DateTime, Float, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

TRIGGERS = ("scheduled", "manual")


class CrawlRun(Base):
    """One row per crawl sweep — what the admin API reads to answer "did the
    last run work" without grepping logs.

    Counts are cumulative across every company/adapter in that run, not
    per-company; per-company detail lives on Company itself
    (last_crawled_at/crawl_status/consecutive_failures), not here — see
    Company's own docstring for why a join table wasn't worth it.
    """

    __tablename__ = "crawl_runs"

    id = Column(Integer, primary_key=True, index=True)
    trigger = Column(String(16), nullable=False, default="scheduled", server_default="scheduled")
    # Supabase auth user id, when a human triggered this from the admin API.
    # Null for the worker's own scheduled loop. No SQLAlchemy ForeignKey —
    # auth.users lives in Supabase, not a table this backend owns a model
    # for, matching how user_id is already handled on JobApplication et al.
    triggered_by = Column(UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=True)

    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    companies_attempted = Column(Integer, nullable=False, default=0, server_default="0")
    companies_succeeded = Column(Integer, nullable=False, default=0, server_default="0")
    companies_failed = Column(Integer, nullable=False, default=0, server_default="0")
    jobs_new = Column(Integer, nullable=False, default=0, server_default="0")
    jobs_updated = Column(Integer, nullable=False, default=0, server_default="0")
    jobs_closed = Column(Integer, nullable=False, default=0, server_default="0")

    # JSON-encoded list[str] — same convention as JobListing.skills for a
    # variable-length list on a backend (SQLite in dev) with no array type.
    errors = Column(Text, nullable=False, default="[]", server_default="[]")
    cost_usd = Column(Float, nullable=False, default=0.0, server_default="0")

    __table_args__ = (
        CheckConstraint("trigger IN ('scheduled', 'manual')", name="ck_crawl_runs_trigger"),
    )

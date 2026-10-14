from sqlalchemy import JSON, CheckConstraint, Column, DateTime, Index, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class JDAnalysisRecord(Base):
    """A stored analysis of one job description (modules/jd_analyzer).

    Keyed by the SHA-256 of the cleaned JD text, so the same posting pasted twice,
    or re-crawled unchanged, is analysed once. `job_listing_id` links the analysis to
    a crawled listing when there is one; it is deliberately NOT a foreign key, because
    listings are deleted by the retention job while an analysis of the same text stays
    useful to anyone who pasted it, and nothing else in the schema references
    job_listings by id either.

    `source` is how the analysis was made: "llm", "hybrid" (the model plus keyword
    rules) or "rules" (the model was unavailable). Lookups ignore "rules" rows so a
    later request can try the model again. `analyzer_version` is bumped when the prompt
    or the checking changes what an analysis looks like, so stale rows are not served.
    No user_id: a JD is not personal data, and one analysis serves every user.
    """

    __tablename__ = "jd_analyses"

    id = Column(Integer, primary_key=True, index=True)
    jd_hash = Column(String(64), nullable=False)
    job_listing_id = Column(Integer, nullable=True)
    analysis = Column(JSON, nullable=False)
    source = Column(String(8), nullable=False)
    model = Column(String(64), nullable=True)
    analyzer_version = Column(Integer, nullable=False, default=1, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index("ix_jd_analyses_hash", "jd_hash"),
        Index("ix_jd_analyses_job_listing_id", "job_listing_id"),
        CheckConstraint("source IN ('llm', 'rules', 'hybrid')", name="ck_jd_analyses_source"),
    )

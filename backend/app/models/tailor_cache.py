from sqlalchemy import Column, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class TailorCache(Base):
    """Cached tailoring output for one (user, resume scan, job posting).

    Two kinds share this table rather than two tables, since both are keyed
    the same way and neither is ever queried without the other in scope:

    - "preview": the Claude bullet-rewrite call from resume_builder/faang.py,
      keyed on (user_id, analysis_id, job_id). target_pages is unused (NULL).
    - "quick_tailor": the compiled PDF/tex from resume_builder/services.py,
      additionally keyed on target_pages — a 1-page and 2-page build of the
      same resume/job pair are different outputs, not the same one twice.

    Rows are read-then-expired rather than swept on a timer, matching
    core/ratelimit.py's own amortized-sweep preference over a background job.
    """

    __tablename__ = "tailor_cache"

    id = Column(Integer, primary_key=True, index=True)
    # with_variant: Postgres' UUID type raises on SQLite, which DB_URL
    # defaults to locally. Matches resume_analyses.user_id exactly.
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )
    analysis_id = Column(Integer, nullable=False, index=True)
    job_id = Column(Integer, nullable=False, index=True)
    kind = Column(String, nullable=False)  # "preview" | "quick_tailor"
    # NULL for kind="preview" — a rewrite proposal doesn't depend on page count.
    target_pages = Column(Integer, nullable=True)
    # Everything JSON-serializable about the cached result. Large binary
    # content (the PDF) is kept in its own column rather than base64-inflated
    # inside this text blob, so a row can be inspected without decoding one.
    payload_json = Column(Text, nullable=False)
    pdf_base64 = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index(
            "ix_tailor_cache_lookup",
            "user_id",
            "analysis_id",
            "job_id",
            "kind",
            "target_pages",
            unique=True,
        ),
    )

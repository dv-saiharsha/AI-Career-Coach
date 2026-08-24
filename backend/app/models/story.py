from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class StarStory(Base):
    """A reusable STAR story the candidate can pull into any interview."""

    __tablename__ = "star_stories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )

    title = Column(String, nullable=False)
    situation = Column(Text, nullable=False, default="", server_default="")
    task = Column(Text, nullable=False, default="", server_default="")
    action = Column(Text, nullable=False, default="", server_default="")
    result = Column(Text, nullable=False, default="", server_default="")

    # Comma-separated competency labels ("leadership, conflict"), matching the
    # Text-not-JSONB convention used by resume_analyses.result_json and
    # job_listings.skills so the SQLite dev fallback keeps working.
    tags = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

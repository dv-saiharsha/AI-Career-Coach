from sqlalchemy import Column, DateTime, Float, Index, Integer, LargeBinary, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class TailoredResume(Base):
    """A user-owned resume variant saved independently from its source scan."""

    __tablename__ = "tailored_resumes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=False, index=True)
    # Snapshots rather than foreign keys: a saved copy remains available if its
    # source scan or the shared job listing is later deleted.
    source_analysis_id = Column(Integer, nullable=True, index=True)
    job_id = Column(Integer, nullable=True, index=True)
    job_title = Column(String, nullable=False)
    company = Column(String, nullable=True)
    job_description = Column(Text, nullable=False)
    resume_filename = Column(String, nullable=False)
    resume_text = Column(Text, nullable=False)
    resume_content = Column(Text, nullable=False)
    pdf_bytes = Column(LargeBinary, nullable=False)
    score_before = Column(Float, nullable=True)
    score_after = Column(Float, nullable=True)
    details_json = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


Index("ix_tailored_resumes_user_created", TailoredResume.user_id, TailoredResume.created_at)
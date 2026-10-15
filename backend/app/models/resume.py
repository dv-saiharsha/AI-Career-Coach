from sqlalchemy import Column, DateTime, Float, Integer, LargeBinary, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class ResumeAnalysis(Base):
    __tablename__ = "resume_analyses"
    id = Column(Integer, primary_key=True, index=True)
    # Firebase UID stored as text, not a UUID. Authentication is external to
    # this database, so ownership is enforced by the API rather than an FK.
    user_id = Column(
        String, nullable=False, index=True
    )
    resume_filename = Column(String, nullable=False)
    job_description = Column(Text, nullable=False)
    ats_score = Column(Float, nullable=False)
    result_json = Column(Text, nullable=False)  # full structured analysis, serialized
    resume_text = Column(Text, nullable=True)  # extracted resume text, kept so we can build an updated resume later
    # Original uploaded PDF bytes — kept so "Tailor my resume" can overlay new
    # skills onto the real document instead of regenerating a lookalike from
    # scratch. Nullable: records created before this column existed won't have it.
    resume_file_bytes = Column(LargeBinary, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

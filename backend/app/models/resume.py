from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.core.database import Base


class ResumeAnalysis(Base):
    __tablename__ = "resume_analyses"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    resume_filename = Column(String, nullable=False)
    job_description = Column(Text, nullable=False)
    ats_score = Column(Float, nullable=False)
    result_json = Column(Text, nullable=False)  # full structured analysis, serialized
    resume_text = Column(Text, nullable=True)  # extracted resume text, kept so we can build an updated resume later
    created_at = Column(DateTime(timezone=True), server_default=func.now())

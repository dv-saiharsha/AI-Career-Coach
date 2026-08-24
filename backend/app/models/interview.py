from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"
    id = Column(Integer, primary_key=True, index=True)
    # References auth.users(id) in Supabase Postgres — see resume.py's
    # ResumeAnalysis.user_id for why this isn't an SQLAlchemy-level FK.
    # with_variant: Postgres' UUID type raises on SQLite, which DB_URL
    # defaults to. Postgres DDL and behaviour are unchanged.
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )
    role = Column(String, nullable=False)
    seniority = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False, index=True)
    question_type = Column(String, nullable=False)  # "technical" | "behavioral"
    text = Column(Text, nullable=False)


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("interview_questions.id"), nullable=False, index=True)
    answer_text = Column(Text, nullable=False)
    score = Column(Float, nullable=False)
    feedback = Column(Text, nullable=False)
    improvement_tips = Column(Text, nullable=False)
    sample_answer = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

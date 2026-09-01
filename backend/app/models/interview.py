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

    # --- Mock Interview session lifecycle (Milestone 5) ---
    # category is nullable because it predates the 5-category scheme used by
    # Interview Preparation; old drill sessions never set it.
    category = Column(String, nullable=True)
    # "in_progress" | "completed" | "abandoned"
    status = Column(String, nullable=False, server_default="in_progress")
    overall_score = Column(Float, nullable=True)
    readiness_band = Column(String, nullable=True)
    performance_summary = Column(Text, nullable=True)
    topics_to_improve = Column(Text, nullable=True)  # JSON-encoded list[str]
    practice_plan = Column(Text, nullable=True)  # JSON-encoded list[str]
    completed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("interview_sessions.id"), nullable=False, index=True)
    question_type = Column(String, nullable=False)  # "technical" | "behavioral"
    text = Column(Text, nullable=False)

    # Provenance into the shared Interview Prep cache this question was
    # sourced from — nullable/SET NULL so a prep question being removed
    # later can never delete a user's interview history.
    prep_question_id = Column(Integer, ForeignKey("prep_questions.id", ondelete="SET NULL"), nullable=True, index=True)
    sequence_order = Column(Integer, nullable=False, server_default="0")


class InterviewAnswer(Base):
    __tablename__ = "interview_answers"
    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("interview_questions.id"), nullable=False, index=True)
    answer_text = Column(Text, nullable=False)
    score = Column(Float, nullable=False)
    # Kept for old rows; new answers populate the richer columns below
    # instead and leave these two null.
    feedback = Column(Text, nullable=True)
    improvement_tips = Column(Text, nullable=True)
    sample_answer = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # --- 7-dimension evaluation pipeline (Milestone 5) ---
    strengths = Column(Text, nullable=True)  # JSON-encoded list[str]
    weaknesses = Column(Text, nullable=True)  # JSON-encoded list[str]
    missing_points = Column(Text, nullable=True)  # JSON-encoded list[str]
    learning_suggestions = Column(Text, nullable=True)  # JSON-encoded list[str]
    dimension_scores = Column(Text, nullable=True)  # JSON-encoded dict[str, float]

    # --- Voice Interview (Milestone 7) ---
    # JSON-encoded dict — see schemas.interview.VoiceMetricsSchema. Null for
    # a typed answer; only the fields voice.py could derive reliably for a
    # voice one. No raw audio is ever stored — this is the only trace a
    # voice answer leaves beyond the transcript itself.
    voice_metrics = Column(Text, nullable=True)

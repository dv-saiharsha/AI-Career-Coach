from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class PrepQuestion(Base):
    """A generated Interview Preparation question. Shared cache, not
    user-owned — the content ("explain a hash table") doesn't depend on who's
    asking, only on role + category + difficulty, so it's generated once and
    served to everyone after. Same shape as JobListing: no user_id, keyed by
    a normalised string, RLS deny-by-default in the migration.

    Unlike JobListing there is no TTL/freshness column — job postings go
    stale, an explanation of a concept does not. prompt_version and
    model_version are the versioning axis instead: they let a future prompt
    or model change mint new rows without invalidating or rewriting old
    ones, and without requiring a scheduled re-scrape.
    """

    __tablename__ = "prep_questions"

    id = Column(Integer, primary_key=True, index=True)
    # Normalised role + category + difficulty + prompt_version + model_version.
    # See interview_coach/prep.py build_cache_key — this column exists so the
    # lookup is one indexed equality check, not five.
    cache_key = Column(String, nullable=False, index=True)
    role = Column(String, nullable=False)
    category = Column(String, nullable=False)
    difficulty = Column(String, nullable=False)
    prompt_version = Column(String, nullable=False)
    model_version = Column(String, nullable=False)

    text = Column(Text, nullable=False)
    estimated_answer_time = Column(String, nullable=False)
    ideal_answer = Column(Text, nullable=False)
    concept_explanation = Column(Text, nullable=False)
    beginner_explanation = Column(Text, nullable=False)
    real_world_example = Column(Text, nullable=False)
    interviewer_intent = Column(Text, nullable=False)
    # JSON-encoded list[str] — same convention as Profile.target_roles.
    interview_tips = Column(Text, nullable=False, default="[]")
    common_mistakes = Column(Text, nullable=False, default="[]")
    important_keywords = Column(Text, nullable=False, default="[]")
    follow_up_questions = Column(Text, nullable=False, default="[]")

    generated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PrepQuestionUserState(Base):
    """Bookmark, completion, and notes for one (user, question) pair.

    Deliberately one table with three concerns rather than three tables —
    they're always read and written together for the same pair, and
    splitting them would add joins without adding any real independence
    between the fields. Explicitly NOT part of the shared cache: this is the
    one piece of Interview Prep data that is genuinely user-specific.
    """

    __tablename__ = "prep_question_user_state"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )
    prep_question_id = Column(Integer, ForeignKey("prep_questions.id", ondelete="CASCADE"), nullable=False, index=True)
    bookmarked = Column(Boolean, nullable=False, default=False, server_default="false")
    completed = Column(Boolean, nullable=False, default=False, server_default="false")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "prep_question_id", name="uq_prep_state_user_question"),)

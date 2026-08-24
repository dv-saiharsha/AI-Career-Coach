from sqlalchemy import CheckConstraint, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

# Pipeline stages, in board order. A plain String + CHECK constraint rather
# than a native Postgres ENUM: adding a stage to an enum needs ALTER TYPE
# (which can't run inside a transaction in older PG), and SQLite — the local
# dev default in app/core/config.py — has no enum type at all. A CHECK gives
# the same integrity on Postgres and still works locally.
APPLICATION_STATUSES = ("saved", "applied", "interviewing", "offer", "rejected")


class JobApplication(Base):
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True, index=True)

    # References auth.users(id), matching resume_analyses and profiles —
    # Supabase's auth schema is authoritative and isn't modelled here.
    # with_variant: Postgres' UUID type raises on SQLite.
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )

    job_title = Column(String, nullable=False)
    company = Column(String, nullable=False)
    location = Column(String, nullable=True)
    salary_range = Column(String, nullable=True)

    status = Column(String, nullable=False, default="saved", server_default="saved")

    job_url = Column(Text, nullable=True)
    job_description = Column(Text, nullable=True)

    # The resume scan this application was tailored from. Plain Integer, not an
    # FK: resume_analyses rows are user-deletable, and losing the scan should
    # not cascade away the application record itself.
    tailored_resume_id = Column(Integer, nullable=True)

    notes = Column(Text, nullable=True)

    # Set when the card first reaches 'applied', not on every later edit — it
    # answers "when did I apply", which is what follow-up timing depends on.
    applied_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected')",
            name="ck_job_applications_status",
        ),
        # The board is always read as "this user's pipeline", so the composite
        # covers the only query shape that matters.
        Index("ix_job_applications_user_status", "user_id", "status"),
    )

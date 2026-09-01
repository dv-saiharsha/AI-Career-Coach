from sqlalchemy import CheckConstraint, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

# Pipeline stages, in board order. A plain String + CHECK constraint rather
# than a native Postgres ENUM: adding a stage to an enum needs ALTER TYPE
# (which can't run inside a transaction in older PG), and SQLite — the local
# dev default in app/core/config.py — has no enum type at all. A CHECK gives
# the same integrity on Postgres and still works locally.
#
# Expanded from the original 5 (saved/applied/interviewing/offer/rejected) in
# Milestone 8 to track the real shape of a hiring pipeline instead of one
# catch-all "interviewing" bucket. See the Milestone 8 migration for the
# one-time remap of existing 'interviewing' rows to 'recruiter_screening' —
# the least presumptuous read of "somewhere in the interview process" when
# the exact round reached was never recorded under the old scheme.
APPLICATION_STATUSES = (
    "saved",
    "applied",
    "recruiter_contacted",
    "recruiter_screening",
    "online_assessment",
    "technical_interview",
    "manager_interview",
    "final_interview",
    "offer",
    "accepted",
    "rejected",
    "withdrawn",
)

# Stages that represent an active interview conversation, in the sense
# analytics cares about: "has this application progressed past an initial
# recruiter touch". Used to compute reached_interviewing as an ordinal count
# (offer/accepted necessarily passed through here) — see
# analytics/services.py's pipeline_funnel, which owns that logic.
INTERVIEW_STAGES = (
    "recruiter_screening",
    "online_assessment",
    "technical_interview",
    "manager_interview",
    "final_interview",
)


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

    # The user's resume scored against this posting, by the trained model.
    # Stored rather than computed per request: predict_score costs ~127ms, so
    # averaging across a pipeline on every dashboard load would add seconds.
    # NULL means not yet scored — distinct from a genuine low score, and
    # excluded from the average rather than counted as zero.
    match_score = Column(Float, nullable=True)

    notes = Column(Text, nullable=True)

    # --- Milestone 8: recruiter contact ---
    recruiter_name = Column(String, nullable=True)
    recruiter_email = Column(String, nullable=True)

    # Set when the card first reaches 'applied', not on every later edit — it
    # answers "when did I apply", which is what follow-up timing depends on.
    applied_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint(
            "status IN ("
            "'saved', 'applied', 'recruiter_contacted', 'recruiter_screening', "
            "'online_assessment', 'technical_interview', 'manager_interview', "
            "'final_interview', 'offer', 'accepted', 'rejected', 'withdrawn'"
            ")",
            name="ck_job_applications_status",
        ),
        # The board is always read as "this user's pipeline", so the composite
        # covers the only query shape that matters.
        Index("ix_job_applications_user_status", "user_id", "status"),
    )


class ApplicationStatusHistory(Base):
    """One row per status change — what the Timeline view renders.

    Deliberately its own table rather than a JSON column on JobApplication:
    the Timeline and the activity feed both need to query across many
    applications' history at once ("what changed recently"), which a JSON
    blob per application can't do without loading and parsing every row.

    from_status is nullable — the very first entry for an application (set
    the moment it's created, and backfilled once for pre-Milestone-8 rows)
    has no prior stage to name.
    """

    __tablename__ = "application_status_history"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(
        Integer, ForeignKey("job_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    from_status = Column(String, nullable=True)
    to_status = Column(String, nullable=False)
    changed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

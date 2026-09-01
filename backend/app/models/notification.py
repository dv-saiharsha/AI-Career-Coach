from sqlalchemy import CheckConstraint, Column, DateTime, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

# Every type the engine currently knows how to raise, grouped by the six
# integration categories the milestone names. Several of the spec's named
# notifications collapse into one real, honestly-triggerable type rather than
# each getting its own row — see notifications/service.py's module docstring
# for exactly which and why (no fabricated calendar/date data, no per-user
# job-score history that doesn't exist elsewhere in the schema).
NOTIFICATION_TYPES = (
    # resume
    "resume_score_changed",
    "resume_needs_attention",
    # jobs
    "high_match_job",
    "missing_skill_recommendation",
    # interview
    "interview_stage_reached",
    "mock_interview_reminder",
    "voice_interview_reminder",
    "practice_streak",
    # application
    "application_status_changed",
    "follow_up_reminder",
    # career_coach
    "suggested_learning",
    "resume_advice",
    "interview_advice",
    # analytics
    "weekly_progress",
    "monthly_progress",
    "career_milestone",
)

NOTIFICATION_CATEGORIES = ("resume", "jobs", "interview", "application", "career_coach", "analytics")

NOTIFICATION_PRIORITIES = ("high", "medium", "low")


class Notification(Base):
    """One row per surfaced notification. The system of record — the SSE
    channel in core/events.py is a live-push nicety on top of this, never the
    source of truth, since it holds nothing once a client disconnects.

    dedupe_key is what stops the engine from re-raising the same event: see
    service.create_notification for the exact "already exists within window"
    check. group_key plus occurrence_count is what "Groups related
    notifications" means here — a second event with a matching, still-active
    group_key bumps the existing row instead of inserting a new one, so the
    center shows one growing entry ("+2 more") rather than a flood.
    """

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )

    type = Column(String, nullable=False)
    category = Column(String, nullable=False)
    priority = Column(String, nullable=False, default="medium", server_default="medium")

    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    # Where "view this" should take the user — always an existing module
    # route, never a new page built just for notifications.
    href = Column(String, nullable=True)

    dedupe_key = Column(String, nullable=False, index=True)
    group_key = Column(String, nullable=True, index=True)
    occurrence_count = Column(Integer, nullable=False, default=1, server_default="1")

    read_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    # NULL means it never expires. Time-sensitive nudges (a stale follow-up,
    # an interview-stage nudge) age out of the active list on their own
    # rather than sitting there stale forever; achievements and summaries
    # don't expire.
    expires_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint(
            "type IN ("
            "'resume_score_changed', 'resume_needs_attention', "
            "'high_match_job', 'missing_skill_recommendation', "
            "'interview_stage_reached', 'mock_interview_reminder', "
            "'voice_interview_reminder', 'practice_streak', "
            "'application_status_changed', 'follow_up_reminder', "
            "'suggested_learning', 'resume_advice', 'interview_advice', "
            "'weekly_progress', 'monthly_progress', 'career_milestone'"
            ")",
            name="ck_notifications_type",
        ),
        CheckConstraint("category IN ('resume', 'jobs', 'interview', 'application', 'career_coach', 'analytics')", name="ck_notifications_category"),
        CheckConstraint("priority IN ('high', 'medium', 'low')", name="ck_notifications_priority"),
        # The Notification Center's one query: this user's active feed,
        # newest first — the composite matches that access path exactly.
        Index("ix_notifications_user_active", "user_id", "archived_at", "created_at"),
        Index("ix_notifications_dedupe", "user_id", "dedupe_key"),
    )

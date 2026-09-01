"""add notifications table

Purely additive: one new table, nothing else touched. type/category/priority
are plain Strings with CHECK constraints (matching job_applications.status'
approach) rather than native enums, so SQLite dev/test and Postgres prod both
enforce the same values without needing ALTER TYPE support.

Revision ID: e885039971d2
Revises: 23061ee9a125
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e885039971d2'
down_revision: Union[str, None] = '23061ee9a125'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    user_id_type = postgresql.UUID() if is_postgres else sa.String(36)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", user_id_type, nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("priority", sa.String(), nullable=False, server_default="medium"),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("href", sa.String(), nullable=True),
        sa.Column("dedupe_key", sa.String(), nullable=False),
        sa.Column("group_key", sa.String(), nullable=True),
        sa.Column("occurrence_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
        ),
        sa.CheckConstraint(
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
        sa.CheckConstraint(
            "category IN ('resume', 'jobs', 'interview', 'application', 'career_coach', 'analytics')",
            name="ck_notifications_category",
        ),
        sa.CheckConstraint("priority IN ('high', 'medium', 'low')", name="ck_notifications_priority"),
    )
    op.create_index("ix_notifications_id", "notifications", ["id"])
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_dedupe_key", "notifications", ["dedupe_key"])
    op.create_index("ix_notifications_group_key", "notifications", ["group_key"])
    op.create_index("ix_notifications_user_active", "notifications", ["user_id", "archived_at", "created_at"])
    op.create_index("ix_notifications_dedupe", "notifications", ["user_id", "dedupe_key"])

    if not is_postgres:
        return
    op.execute("ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.notifications FROM anon, authenticated")


def downgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    if is_postgres:
        op.execute("ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_notifications_dedupe", table_name="notifications")
    op.drop_index("ix_notifications_user_active", table_name="notifications")
    op.drop_index("ix_notifications_group_key", table_name="notifications")
    op.drop_index("ix_notifications_dedupe_key", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_index("ix_notifications_id", table_name="notifications")
    op.drop_table("notifications")

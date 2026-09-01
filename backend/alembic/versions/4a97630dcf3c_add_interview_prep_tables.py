"""add interview prep tables

Two tables for AI Interview Preparation (app/models/interview_prep.py):

prep_questions — shared cache, no user_id. Same reasoning as
job_listings (d7e2a45b81c9): content doesn't depend on who's asking, so it's
generated once and served to everyone after. RLS deny-by-default for the
same reason as every other public table — the backend connects as table
owner and bypasses it; this only guards the PostgREST/anon-key surface.

prep_question_user_state — genuinely user-owned (bookmarks, completion,
notes), same RLS + FK-to-auth.users pattern as star_stories (c4d8f19a62e3).

Revision ID: 4a97630dcf3c
Revises: c1e4a72f9b60
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4a97630dcf3c'
down_revision: Union[str, None] = 'c1e4a72f9b60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    uuid_type = sa.dialects.postgresql.UUID(as_uuid=False) if is_postgres else sa.String(36)

    op.create_table(
        "prep_questions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("cache_key", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("difficulty", sa.String(), nullable=False),
        sa.Column("prompt_version", sa.String(), nullable=False),
        sa.Column("model_version", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("estimated_answer_time", sa.String(), nullable=False),
        sa.Column("ideal_answer", sa.Text(), nullable=False),
        sa.Column("concept_explanation", sa.Text(), nullable=False),
        sa.Column("beginner_explanation", sa.Text(), nullable=False),
        sa.Column("real_world_example", sa.Text(), nullable=False),
        sa.Column("interviewer_intent", sa.Text(), nullable=False),
        sa.Column("interview_tips", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("common_mistakes", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("important_keywords", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("follow_up_questions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_prep_questions_id", "prep_questions", ["id"])
    op.create_index("ix_prep_questions_cache_key", "prep_questions", ["cache_key"])

    op.create_table(
        "prep_question_user_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("prep_question_id", sa.Integer(), nullable=False),
        sa.Column("bookmarked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["prep_question_id"], ["prep_questions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "prep_question_id", name="uq_prep_state_user_question"),
    )
    op.create_index("ix_prep_question_user_state_id", "prep_question_user_state", ["id"])
    op.create_index("ix_prep_question_user_state_user_id", "prep_question_user_state", ["user_id"])
    op.create_index("ix_prep_question_user_state_prep_question_id", "prep_question_user_state", ["prep_question_id"])

    if not is_postgres:
        return
    op.execute("ALTER TABLE public.prep_questions ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.prep_questions FROM anon, authenticated")

    op.execute(
        "ALTER TABLE public.prep_question_user_state ADD CONSTRAINT fk_prep_state_user "
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )
    op.execute("ALTER TABLE public.prep_question_user_state ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.prep_question_user_state FROM anon, authenticated")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TABLE public.prep_question_user_state DISABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.prep_question_user_state DROP CONSTRAINT IF EXISTS fk_prep_state_user")
        op.execute("ALTER TABLE public.prep_questions DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_prep_question_user_state_prep_question_id", table_name="prep_question_user_state")
    op.drop_index("ix_prep_question_user_state_user_id", table_name="prep_question_user_state")
    op.drop_index("ix_prep_question_user_state_id", table_name="prep_question_user_state")
    op.drop_table("prep_question_user_state")

    op.drop_index("ix_prep_questions_cache_key", table_name="prep_questions")
    op.drop_index("ix_prep_questions_id", table_name="prep_questions")
    op.drop_table("prep_questions")

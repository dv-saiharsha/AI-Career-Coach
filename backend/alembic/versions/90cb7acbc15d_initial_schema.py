"""initial schema

Revision ID: 90cb7acbc15d
Revises:
Create Date: 2026-07-17 23:01:01.451233

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '90cb7acbc15d'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tables whose user_id references Supabase's auth.users(id) — not modeled
# as a SQLAlchemy ForeignKey since that table lives in the auth schema, but
# enforced here at the Postgres level for real referential integrity.
_USER_OWNED_TABLES = ("resume_analyses", "interview_sessions")


def upgrade() -> None:
    op.create_table(
        "resume_analyses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("resume_filename", sa.String(), nullable=False),
        sa.Column("job_description", sa.Text(), nullable=False),
        sa.Column("ats_score", sa.Float(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("resume_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_resume_analyses_user_id", "resume_analyses", ["user_id"])

    op.create_table(
        "interview_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("seniority", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_interview_sessions_user_id", "interview_sessions", ["user_id"])

    op.create_table(
        "interview_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "session_id", sa.Integer(), sa.ForeignKey("interview_sessions.id"), nullable=False
        ),
        sa.Column("question_type", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
    )
    op.create_index("ix_interview_questions_session_id", "interview_questions", ["session_id"])

    op.create_table(
        "interview_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "question_id", sa.Integer(), sa.ForeignKey("interview_questions.id"), nullable=False
        ),
        sa.Column("answer_text", sa.Text(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("feedback", sa.Text(), nullable=False),
        sa.Column("improvement_tips", sa.Text(), nullable=False),
        sa.Column("sample_answer", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_interview_answers_question_id", "interview_answers", ["question_id"])

    # FK to Supabase's auth.users(id) — real referential integrity even
    # though it's not expressible as a SQLAlchemy ForeignKey (cross-schema).
    for table in _USER_OWNED_TABLES:
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_user "
            f"FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
        )

    # RLS, enabled with zero policies: default-deny for the public/anon Data
    # API (defense in depth — our backend reaches this DB with its own
    # privileged Postgres role via SQLAlchemy, which bypasses RLS, so this
    # doesn't affect the app; it only blocks accidental exposure through
    # Supabase's REST API if grants are ever added to anon/authenticated).
    for table in ("resume_analyses", "interview_sessions", "interview_questions", "interview_answers"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("interview_answers")
    op.drop_table("interview_questions")
    op.drop_table("interview_sessions")
    op.drop_table("resume_analyses")

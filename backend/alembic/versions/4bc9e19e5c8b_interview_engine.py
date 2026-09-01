"""interview engine — session lifecycle, richer evaluation, reports

All additive: new nullable columns (or a NOT NULL column with a server
default, so existing rows are satisfied automatically) on the three existing
interview tables. No column dropped, no existing history touched.

interview_sessions: category (nullable — old sessions predate the 5-category
scheme), status (defaults 'in_progress' so old completed sessions read as
in_progress until backfilled, which is acceptable since they're read-only
history, not something a user will try to "resume"), overall_score,
readiness_band, performance_summary, topics_to_improve, practice_plan,
completed_at, updated_at.

interview_questions: prep_question_id (FK to prep_questions, nullable and
ON DELETE SET NULL — a session's history must survive a prep question being
removed later) and sequence_order, so the engine has an explicit order
instead of relying on row-insertion order.

interview_answers: strengths / weaknesses / missing_points /
learning_suggestions / dimension_scores (all JSON-text, nullable) replace
the single feedback blob going forward. feedback and improvement_tips are
relaxed to nullable rather than dropped — new answers simply stop writing
them, old answers keep their history exactly as it was.

Revision ID: 4bc9e19e5c8b
Revises: 4a97630dcf3c
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4bc9e19e5c8b'
down_revision: Union[str, None] = '4a97630dcf3c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"

    with op.batch_alter_table("interview_sessions") as batch:
        batch.add_column(sa.Column("category", sa.String(), nullable=True))
        batch.add_column(sa.Column("status", sa.String(), nullable=False, server_default="in_progress"))
        batch.add_column(sa.Column("overall_score", sa.Float(), nullable=True))
        batch.add_column(sa.Column("readiness_band", sa.String(), nullable=True))
        batch.add_column(sa.Column("performance_summary", sa.Text(), nullable=True))
        batch.add_column(sa.Column("topics_to_improve", sa.Text(), nullable=True))
        batch.add_column(sa.Column("practice_plan", sa.Text(), nullable=True))
        batch.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True)
        )

    with op.batch_alter_table("interview_questions") as batch:
        batch.add_column(sa.Column("prep_question_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("sequence_order", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_interview_questions_prep_question_id", "interview_questions", ["prep_question_id"])

    with op.batch_alter_table("interview_answers") as batch:
        batch.add_column(sa.Column("strengths", sa.Text(), nullable=True))
        batch.add_column(sa.Column("weaknesses", sa.Text(), nullable=True))
        batch.add_column(sa.Column("missing_points", sa.Text(), nullable=True))
        batch.add_column(sa.Column("learning_suggestions", sa.Text(), nullable=True))
        batch.add_column(sa.Column("dimension_scores", sa.Text(), nullable=True))
        batch.alter_column("feedback", existing_type=sa.Text(), nullable=True)
        batch.alter_column("improvement_tips", existing_type=sa.Text(), nullable=True)

    if not is_postgres:
        return
    op.execute(
        "ALTER TABLE public.interview_questions ADD CONSTRAINT fk_interview_questions_prep_question "
        "FOREIGN KEY (prep_question_id) REFERENCES public.prep_questions(id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    if is_postgres:
        op.execute(
            "ALTER TABLE public.interview_questions DROP CONSTRAINT IF EXISTS fk_interview_questions_prep_question"
        )

    with op.batch_alter_table("interview_answers") as batch:
        batch.alter_column("improvement_tips", existing_type=sa.Text(), nullable=False)
        batch.alter_column("feedback", existing_type=sa.Text(), nullable=False)
        batch.drop_column("dimension_scores")
        batch.drop_column("learning_suggestions")
        batch.drop_column("missing_points")
        batch.drop_column("weaknesses")
        batch.drop_column("strengths")

    op.drop_index("ix_interview_questions_prep_question_id", table_name="interview_questions")
    with op.batch_alter_table("interview_questions") as batch:
        batch.drop_column("sequence_order")
        batch.drop_column("prep_question_id")

    with op.batch_alter_table("interview_sessions") as batch:
        batch.drop_column("updated_at")
        batch.drop_column("completed_at")
        batch.drop_column("practice_plan")
        batch.drop_column("topics_to_improve")
        batch.drop_column("performance_summary")
        batch.drop_column("readiness_band")
        batch.drop_column("overall_score")
        batch.drop_column("status")
        batch.drop_column("category")

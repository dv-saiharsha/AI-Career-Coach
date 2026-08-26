"""cascade deletes through the interview tables

Deleting a user failed with a ForeignKeyViolation. interview_sessions cascades
from auth.users correctly, but its own children do not:

    interview_questions -> interview_sessions   NO ACTION
    interview_answers   -> interview_questions  NO ACTION

so removing the session was blocked by the questions hanging off it, and the
whole delete rolled back. This is not only an operations annoyance — it breaks
Supabase's own "Delete user" button, and it means an account-deletion request
cannot be honoured without hand-deleting rows in dependency order.

Both are re-created with ON DELETE CASCADE. An interview question has no
meaning without its session and an answer none without its question, so
cascading is the correct semantic here, not merely the convenient one.

Revision ID: d5a1f83b62c4
Revises: b2e7c94f1a38
Create Date: 2026-08-26 08:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'd5a1f83b62c4'
down_revision: Union[str, None] = 'b2e7c94f1a38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (constraint, child table, child column, parent table, parent column)
_FKS = [
    ("interview_questions_session_id_fkey", "interview_questions", "session_id",
     "interview_sessions", "id"),
    ("interview_answers_question_id_fkey", "interview_answers", "question_id",
     "interview_questions", "id"),
]


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        # SQLite cannot ALTER a constraint, and the local schema is rebuilt
        # from the models anyway.
        return
    for name, child, column, parent, parent_col in _FKS:
        op.execute(f"ALTER TABLE public.{child} DROP CONSTRAINT IF EXISTS {name}")
        op.execute(
            f"ALTER TABLE public.{child} ADD CONSTRAINT {name} "
            f"FOREIGN KEY ({column}) REFERENCES public.{parent}({parent_col}) ON DELETE CASCADE"
        )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for name, child, column, parent, parent_col in _FKS:
        op.execute(f"ALTER TABLE public.{child} DROP CONSTRAINT IF EXISTS {name}")
        op.execute(
            f"ALTER TABLE public.{child} ADD CONSTRAINT {name} "
            f"FOREIGN KEY ({column}) REFERENCES public.{parent}({parent_col})"
        )

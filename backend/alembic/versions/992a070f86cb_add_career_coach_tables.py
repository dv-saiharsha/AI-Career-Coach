"""add career coach conversation + message tables

Purely additive: two new tables, nothing else touched. Conversations own
messages (ON DELETE CASCADE) — deleting a conversation is meant to actually
remove its transcript, unlike the interview tables where history is
deliberately preserved. A chat conversation carries no scoring or reporting
value once deleted; it is closer to browser history than to an interview
record.

Revision ID: 992a070f86cb
Revises: 4bc9e19e5c8b
Create Date: 2026-08-27 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '992a070f86cb'
down_revision: Union[str, None] = '4bc9e19e5c8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    user_id_type = postgresql.UUID() if is_postgres else sa.String(36)

    op.create_table(
        "coach_conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", user_id_type, nullable=False),
        # Derived from the first user message, not a separate LLM call —
        # a cosmetic label doesn't justify its own generation cost.
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()
        ),
    )
    op.create_index("ix_coach_conversations_id", "coach_conversations", ["id"])
    op.create_index("ix_coach_conversations_user_id", "coach_conversations", ["user_id"])

    op.create_table(
        "coach_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("coach_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(), nullable=False),  # "user" | "assistant"
        sa.Column("content", sa.Text(), nullable=False),
        # JSON-encoded list[str], assistant messages only — regenerated on
        # every read is unnecessary since these were already produced once
        # alongside the reply they belong to.
        sa.Column("follow_ups", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_coach_messages_id", "coach_messages", ["id"])
    op.create_index("ix_coach_messages_conversation_id", "coach_messages", ["conversation_id"])

    if not is_postgres:
        return
    op.execute("ALTER TABLE public.coach_conversations ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.coach_conversations FROM anon, authenticated")
    op.execute("ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE public.coach_messages FROM anon, authenticated")


def downgrade() -> None:
    is_postgres = op.get_bind().dialect.name == "postgresql"
    if is_postgres:
        op.execute("ALTER TABLE public.coach_messages DISABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE public.coach_conversations DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_coach_messages_conversation_id", table_name="coach_messages")
    op.drop_index("ix_coach_messages_id", table_name="coach_messages")
    op.drop_table("coach_messages")

    op.drop_index("ix_coach_conversations_user_id", table_name="coach_conversations")
    op.drop_index("ix_coach_conversations_id", table_name="coach_conversations")
    op.drop_table("coach_conversations")

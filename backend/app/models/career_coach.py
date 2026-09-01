from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class CoachConversation(Base):
    """One chat thread with the Career Coach.

    Unlike interview_sessions, deleting a conversation actually removes its
    messages (see the CASCADE below) — a chat transcript carries no scoring
    or reporting value once discarded, closer to browser history than to an
    interview record worth preserving.
    """

    __tablename__ = "coach_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )
    # Derived from the first user message rather than a separate LLM call —
    # a cosmetic label doesn't justify its own generation cost.
    title = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CoachMessage(Base):
    __tablename__ = "coach_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(
        Integer, ForeignKey("coach_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String, nullable=False)  # "user" | "assistant"
    content = Column(Text, nullable=False)
    # JSON-encoded list[str]. Assistant messages only — generated once
    # alongside the reply they belong to, not recomputed on read.
    follow_ups = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

from typing import List, Optional

from pydantic import BaseModel


class ConversationSchema(BaseModel):
    id: int
    title: Optional[str]
    created_at: str
    updated_at: str


class CoachMessageSchema(BaseModel):
    id: int
    role: str  # "user" | "assistant"
    content: str
    follow_ups: List[str] = []
    created_at: str


class SendMessageRequestSchema(BaseModel):
    message: str

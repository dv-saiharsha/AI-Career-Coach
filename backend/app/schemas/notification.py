from typing import Optional

from pydantic import BaseModel


class NotificationSchema(BaseModel):
    id: int
    type: str
    category: str
    priority: str
    title: str
    message: str
    href: Optional[str] = None
    occurrence_count: int
    read_at: Optional[str] = None
    archived_at: Optional[str] = None
    created_at: str
    updated_at: str


class NotificationListSchema(BaseModel):
    notifications: list[NotificationSchema]
    unread_count: int

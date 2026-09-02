from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


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


class RegisterDeviceRequest(BaseModel):
    """A device asking to be notified.

    `expo_push_token` is validated for shape in the router rather than here,
    so a malformed token produces a 400 with a message about tokens instead of
    a 422 with a Pydantic trace.
    """

    expo_push_token: str
    platform: Literal["ios", "android"]


class DeviceSchema(BaseModel):
    id: int
    platform: str

    model_config = ConfigDict(from_attributes=True)

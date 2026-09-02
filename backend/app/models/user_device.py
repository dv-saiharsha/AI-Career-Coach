from sqlalchemy import CheckConstraint, Column, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base

PLATFORMS = ("ios", "android")


class UserDevice(Base):
    """One row per install that has agreed to be notified.

    The Expo push token is the natural key, not the user. A token identifies
    an *install*, and installs change hands: a phone is sold, a family device
    is shared, someone signs out and a colleague signs in. So the token is
    unique and carries whichever user most recently registered it, rather
    than the pair being unique — otherwise the previous owner keeps receiving
    the new owner's interview reminders, which is the failure this table
    exists to avoid.

    Expo rotates a token when an app is reinstalled or restored to a new
    device, so rows go stale on their own. `updated_at` is what a cleanup
    sweep would read; nothing prunes them yet, and one dead token costs a
    single rejected send.
    """

    __tablename__ = "user_devices"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), nullable=False, index=True
    )

    # Unique, because the same physical install must not appear twice — a
    # duplicate row is a duplicate notification.
    expo_push_token = Column(String, nullable=False, unique=True, index=True)
    platform = Column(String, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        # A CHECK rather than an enum, matching job_applications.status: SQLite
        # has no enum type and the local dev database is SQLite.
        CheckConstraint("platform IN ('ios', 'android')", name="ck_user_devices_platform"),
    )

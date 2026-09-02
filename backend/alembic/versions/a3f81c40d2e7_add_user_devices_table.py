"""add user_devices table

One row per install that has agreed to receive push notifications.

Purely additive: one new table, nothing else touched. platform is a String
with a CHECK constraint rather than a native enum, matching
job_applications.status — SQLite (the local dev default) has no enum type,
and adding a value later would need ALTER TYPE outside a transaction on
Postgres.

expo_push_token is UNIQUE rather than (user_id, token) being unique. A token
identifies an install, and installs change hands; a token registering under a
new user must move to that user rather than sit alongside the old row, or the
previous owner keeps receiving the new owner's notifications.

Revision ID: a3f81c40d2e7
Revises: e885039971d2
Create Date: 2026-09-01 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "a3f81c40d2e7"
down_revision: Union[str, None] = "e885039971d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(
            "user_id",
            UUID(as_uuid=False).with_variant(sa.String(36), "sqlite"),
            nullable=False,
        ),
        sa.Column("expo_push_token", sa.String(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("platform IN ('ios', 'android')", name="ck_user_devices_platform"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_devices_id"), "user_devices", ["id"])
    op.create_index(op.f("ix_user_devices_user_id"), "user_devices", ["user_id"])
    op.create_index(
        op.f("ix_user_devices_expo_push_token"), "user_devices", ["expo_push_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_user_devices_expo_push_token"), table_name="user_devices")
    op.drop_index(op.f("ix_user_devices_user_id"), table_name="user_devices")
    op.drop_index(op.f("ix_user_devices_id"), table_name="user_devices")
    op.drop_table("user_devices")

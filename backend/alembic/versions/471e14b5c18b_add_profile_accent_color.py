"""Per-user accent color preference (Settings > Appearance).

Recolors only the app's one deliberate accent hue (--signal in globals.css)
client-side — this column just holds the preference. Nullable, and NULL means
"use the default blue," not "no preference recorded" — there is no separate
flag, so every existing row is already correctly "using the default."

Revision ID: 471e14b5c18b
Revises: b7e21c93f4a8
"""

import sqlalchemy as sa
from alembic import op

revision = "471e14b5c18b"
down_revision = "b7e21c93f4a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("accent_color", sa.String(length=7), nullable=True))


def downgrade() -> None:
    op.drop_column("profiles", "accent_color")

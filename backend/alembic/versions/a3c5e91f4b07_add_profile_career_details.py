"""add career detail and avatar columns to profiles

Backs the /profile module: bio, current title, seniority, a single
aspirational target role, and the avatar reference.

Two naming decisions worth recording:

  * `current_title`, not `current_role`. `current_role` is a reserved SQL
    keyword — `ALTER TABLE ... ADD COLUMN current_role TEXT` is a syntax
    error, and quoting it makes every future query one missing quote away
    from breaking. The concept is the same; the identifier is not.

  * `primary_target_role` is separate from the existing `target_roles` list.
    That list is bound to 3-5 entries and drives the job feed; collapsing it
    into a single profile field would delete the user's onboarding choices
    and violate the minimum the API enforces.

Avatar bytes live in Supabase Storage, not here — only the public URL and the
object path are stored, the latter so deletion doesn't have to parse the URL.

Revision ID: a3c5e91f4b07
Revises: f1b8c07d3a56
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c5e91f4b07'
down_revision: Union[str, None] = 'f1b8c07d3a56'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_COLUMNS = (
    ("bio", sa.Text()),
    ("current_title", sa.String()),
    ("seniority", sa.String()),
    ("primary_target_role", sa.String()),
    ("avatar_url", sa.Text()),
    ("avatar_path", sa.Text()),
)


def upgrade() -> None:
    for name, type_ in NEW_COLUMNS:
        op.add_column("profiles", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(NEW_COLUMNS):
        op.drop_column("profiles", name)

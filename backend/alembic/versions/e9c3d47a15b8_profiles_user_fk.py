"""add the missing auth.users foreign key to profiles

profiles was the only user-owned table without a foreign key to auth.users, so
deleting a user left its profile behind. Every other table (resume_analyses,
interview_sessions, job_applications, job_offers, star_stories) already had
ON DELETE CASCADE; this one was created in a later migration that omitted it.

Consequences of the gap, all of which were live:
  * Deleting an account silently orphaned its profile row.
  * A new account could never reclaim that row, because user_id is the primary
    key — get_or_create_profile would return a stranger's stale profile if the
    same UUID were ever reissued.
  * An account-deletion request could not be honoured completely.

Pre-existing orphans are removed first; the constraint cannot be added while
rows violate it.

Revision ID: e9c3d47a15b8
Revises: d5a1f83b62c4
Create Date: 2026-08-26 08:45:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'e9c3d47a15b8'
down_revision: Union[str, None] = 'd5a1f83b62c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        # auth.users does not exist on SQLite; the local schema is built from
        # the models, which do not model Supabase's auth schema.
        return
    op.execute(
        "DELETE FROM public.profiles p "
        "WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.user_id)"
    )
    op.execute(
        "ALTER TABLE public.profiles ADD CONSTRAINT fk_profiles_user "
        "FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS fk_profiles_user")

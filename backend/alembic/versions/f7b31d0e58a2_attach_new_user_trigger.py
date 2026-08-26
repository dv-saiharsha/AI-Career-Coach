"""attach the handle_new_user trigger to auth.users

b2e7c94f1a38 repaired the function body but only ever ran CREATE OR REPLACE
FUNCTION. The TRIGGER itself was created by hand in the SQL editor, so it
existed only in that one database — a fresh project would get the function and
nothing calling it, and Google avatars would silently never be captured.

Idempotent: the trigger is dropped and recreated, so running this against the
existing project is a no-op in effect while a new project gets it for the
first time.

Revision ID: f7b31d0e58a2
Revises: e9c3d47a15b8
Create Date: 2026-08-26 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'f7b31d0e58a2'
down_revision: Union[str, None] = 'e9c3d47a15b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # auth.users is Supabase's table and does not exist on SQLite.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")
    op.execute(
        "CREATE TRIGGER on_auth_user_created "
        "AFTER INSERT ON auth.users "
        "FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()"
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")

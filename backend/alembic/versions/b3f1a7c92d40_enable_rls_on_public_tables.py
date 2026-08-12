"""Enable row level security on all public tables

Supabase exposes the `public` schema through PostgREST, and the frontend ships
a publishable (anon) key to every browser. Any table sitting in `public`
without RLS is therefore world-readable — and, if the anon/authenticated roles
hold write grants, world-writable.

This migration takes a deny-by-default posture:

  * RLS is enabled on every table, with **no policies attached**. Under
    PostgREST that means anon/authenticated get zero rows and cannot write.
  * The FastAPI backend connects over a direct Postgres connection as the
    table owner (see app/core/database.py -> settings.DB_URL). A table owner
    bypasses RLS unless FORCE ROW LEVEL SECURITY is set, which we deliberately
    do not set. So application queries and Alembic itself are unaffected.

  ⚠ If you ever repoint DB_URL at a NON-owner role, these tables will start
  returning zero rows to the backend. In that case grant that role BYPASSRLS,
  or add explicit policies for it.

`alembic_version` additionally has its grants revoked: schema-migration state
has no business being reachable from the API surface at all.

Revision ID: b3f1a7c92d40
Revises: cf169173d5e6
"""

from typing import Sequence, Union

from alembic import op

revision: str = 'b3f1a7c92d40'
down_revision: Union[str, None] = 'cf169173d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Application tables holding user data. All are reachable from PostgREST.
DATA_TABLES = (
    'resume_analyses',
    'interview_sessions',
    'interview_questions',
    'interview_answers',
)


def upgrade() -> None:
    # Postgres-only: the local dev database is SQLite, which has no RLS.
    if op.get_bind().dialect.name != 'postgresql':
        return

    for table in DATA_TABLES:
        op.execute(f'ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY')
        # Defence in depth: even with RLS on, no reason for the API roles to
        # hold grants on tables only the backend touches.
        op.execute(f'REVOKE ALL ON TABLE public.{table} FROM anon, authenticated')

    # Alembic's own bookkeeping table. IF EXISTS because a fresh database may
    # run this before the table is stamped.
    op.execute('ALTER TABLE IF EXISTS public.alembic_version ENABLE ROW LEVEL SECURITY')
    op.execute(
        'REVOKE ALL ON TABLE public.alembic_version FROM anon, authenticated'
    )


def downgrade() -> None:
    if op.get_bind().dialect.name != 'postgresql':
        return

    op.execute('ALTER TABLE IF EXISTS public.alembic_version DISABLE ROW LEVEL SECURITY')
    op.execute('GRANT ALL ON TABLE public.alembic_version TO anon, authenticated')

    for table in DATA_TABLES:
        op.execute(f'ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY')
        op.execute(f'GRANT ALL ON TABLE public.{table} TO anon, authenticated')

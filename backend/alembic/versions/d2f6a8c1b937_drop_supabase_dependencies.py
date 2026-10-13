"""drop the Supabase dependencies: auth FKs, signup trigger, RLS, storage

The database is moving from Supabase to Cloud SQL. Authentication moves to
Firebase and avatars to Cloud Storage, so nothing in this database may point
at Supabase's auth or storage schemas any more:

  * the user_id -> auth.users(id) foreign keys. These were the only thing that
    erased star_stories and prep_question_user_state when an account was
    deleted: app/modules/user_profile/privacy.py (as of f0a4169) removes 7 of
    the 11 tables that carry a user_id and does NOT cover coach_conversations
    (and its coach_messages), prep_question_user_state, star_stories or
    tailor_cache. Account erasure MUST be extended to all of them before this
    migration is applied to a database serving users.
  * the on_auth_user_created trigger and public.handle_new_user() (the profile
    row is created by the application on first authenticated request)
  * row level security (it only ever protected Supabase's REST API) and the
    grants to anon / authenticated
  * the storage policies, and the auth / storage schemas themselves

REFUSES TO RUN against a real Supabase database. Running it there before the
cutover would delete the signup trigger and every user FK on the live system.
It proceeds only when the auth schema is absent, or is the stand-in created by
scripts/supabase_compat_shim.sql (recognised by its marker comment, and by
the absence of anything GoTrue creates). The three NOLOGIN roles are left in
place: roles belong to the whole instance, not one database, so dropping them
here would fail while another database on the instance still references them.
They hold no privileges once this has run.

One-way: there is no downgrade. Re-creating Supabase's schemas is not
something this project does.

Revision ID: d2f6a8c1b937
Revises: 388e523dda7a
Create Date: 2026-10-13 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d2f6a8c1b937"
down_revision: Union[str, None] = "388e523dda7a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SHIM_MARKER = "applycenter-compat-shim"


def _refuse_if_real_supabase(bind) -> None:
    exists = bind.execute(sa.text("SELECT to_regnamespace('auth') IS NOT NULL")).scalar()
    if not exists:
        return

    marker = bind.execute(
        sa.text("SELECT obj_description(to_regnamespace('auth'), 'pg_namespace')")
    ).scalar()
    # Tables only GoTrue (Supabase Auth) creates. The shim has none of them.
    gotrue = bind.execute(
        sa.text(
            "SELECT count(*) FROM pg_class c WHERE c.relnamespace = to_regnamespace('auth') "
            "AND c.relkind = 'r' AND c.relname IN "
            "('schema_migrations', 'identities', 'sessions', 'refresh_tokens', 'instances')"
        )
    ).scalar()
    users = bind.execute(sa.text("SELECT count(*) FROM auth.users")).scalar()

    if marker != _SHIM_MARKER or gotrue or users:
        raise RuntimeError(
            "Refusing to run: this looks like a real Supabase auth schema "
            f"(shim marker={'present' if marker == _SHIM_MARKER else 'absent'}, "
            f"GoTrue tables={gotrue}, auth.users rows={users}). "
            "This migration removes the signup trigger and every user foreign key and "
            "must only run on the Cloud SQL database, after cutover. Nothing was changed."
        )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return  # SQLite never had auth/storage/RLS.

    _refuse_if_real_supabase(bind)

    # Every FK into auth.users, whatever it is called.
    op.execute(
        """
        DO $$
        DECLARE c record;
        BEGIN
          IF to_regnamespace('auth') IS NOT NULL THEN
            FOR c IN
              SELECT conrelid::regclass AS tbl, conname FROM pg_constraint
              WHERE contype = 'f' AND confrelid = to_regclass('auth.users')
            LOOP
              EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
            END LOOP;
          END IF;
        END $$;
        """
    )

    op.execute("DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS public.handle_new_user()")

    # RLS off and grants revoked on everything in public.
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
          FOR t IN SELECT c.relname FROM pg_class c
                   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
          LOOP
            EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.relname);
          END LOOP;
        END $$;
        """
    )
    for role in ("anon", "authenticated", "service_role"):
        op.execute(
            f"""
            DO $$ BEGIN
              IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role};
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {role};
                REVOKE ALL ON SCHEMA public FROM {role};
              END IF;
            END $$;
            """
        )

    op.execute("DROP SCHEMA IF EXISTS storage CASCADE")  # takes its policies with it
    op.execute("DROP SCHEMA IF EXISTS auth CASCADE")


def downgrade() -> None:
    raise NotImplementedError(
        "drop_supabase_dependencies is one-way: Supabase's auth and storage schemas are not recreated."
    )

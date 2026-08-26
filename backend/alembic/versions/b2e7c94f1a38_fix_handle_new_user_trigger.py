"""repair the handle_new_user trigger so signup cannot fail

The trigger on auth.users inserted into public.profiles (user_id, full_name,
avatar_url, email). Two of those columns do not exist on this table, so every
INSERT raised undefined_column, the trigger aborted, and the enclosing
auth.users insert rolled back with it. Supabase surfaces that as "Database
error saving new user" — every Google sign-up failed, and password sign-ups
would have too.

Two changes:

1. Only columns that exist are written. avatar_url is genuinely worth keeping
   — it is the Google profile picture, and the lazy get_or_create_profile path
   in app/modules/user_profile/services.py has no access to provider metadata,
   so this trigger is the only place it can be captured.

2. The body is wrapped in an exception handler that logs and returns NEW.
   A profile row is a convenience; an account is not. Nothing about
   provisioning a profile is worth failing a signup over, and without this
   guard any future column rename silently locks every new user out of the
   product again. get_or_create_profile still backfills the row on first
   access, so a swallowed failure costs nothing but the avatar.

Revision ID: b2e7c94f1a38
Revises: a8f31c67d9e2
Create Date: 2026-08-26 08:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b2e7c94f1a38'
down_revision: Union[str, None] = 'a8f31c67d9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FIXED_FUNCTION = """
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, avatar_url)
    VALUES (
      new.id,
      new.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (user_id) DO UPDATE SET
      -- COALESCE so a provider that sends no picture cannot blank one the
      -- user uploaded themselves.
      avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url),
      updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    -- Never abort the signup. The account is the thing that matters; the
    -- profile row is backfilled lazily on first access either way.
    RAISE WARNING 'handle_new_user failed for %: %', new.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
"""

# The original, restored verbatim on downgrade. It is broken against the
# current schema — that is the point of the downgrade being exact.
ORIGINAL_FUNCTION = """
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, avatar_url, email)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url',
    new.email
  )
  ON CONFLICT (user_id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();
  RETURN NEW;
END;
$$;
"""


def upgrade() -> None:
    # auth.users lives in Supabase's own schema — nothing to do on SQLite.
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(FIXED_FUNCTION)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(ORIGINAL_FUNCTION)

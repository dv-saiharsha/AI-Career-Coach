-- Stand-ins for the Supabase-managed objects the historical Alembic chain
-- references, so that chain can build a schema on a plain PostgreSQL
-- (Cloud SQL). Apply to an EMPTY database ONLY, before `alembic upgrade`:
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/supabase_compat_shim.sql
--
-- Never apply this to a Supabase database: it refuses if auth or storage
-- already exist. The migration "drop_supabase_dependencies" removes everything
-- created here (and the FKs, trigger and policies the old migrations built on
-- top of it), and refuses to run against a real Supabase auth schema.
--
-- The marker comment on schema auth is how that migration recognises this shim.
-- Do not change it without changing the migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('auth', 'storage')) THEN
    RAISE EXCEPTION 'schema auth or storage already exists: refusing to apply the compat shim';
  END IF;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

CREATE SCHEMA auth;
COMMENT ON SCHEMA auth IS 'applycenter-compat-shim';
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

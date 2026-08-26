# Supabase directory

This exists **only** so the Supabase GitHub integration can attach to this
repository. The integration looks for `supabase/config.toml` and will not link
a repo without one.

## `migrations/` is intentionally empty

Do not add SQL files here.

This project's schema is owned entirely by **Alembic**, in
`backend/alembic/versions/` — 17 migrations covering every table, index, RLS
policy, foreign key, the `handle_new_user` function and its trigger on
`auth.users`, and the `avatars` storage bucket. That chain rebuilt the whole
us-east-1 database from empty with one command.

Putting SQL in `supabase/migrations/` would create a second system that also
believes it owns the schema, with no coordination between them:

* Alembic's `alembic_version` table would not know about Supabase-applied
  changes, so a later `alembic upgrade head` would try to create objects that
  already exist and fail mid-chain.
* Supabase would not know about Alembic-applied changes, so a branch deploy
  could reset objects Alembic depends on.

One owner, one source of truth.

## Applying schema changes

```bash
cd backend && alembic upgrade head
```

That is the only command that should ever change this database's structure.

## What the integration is useful for here

Linking gives you the dashboard association and preview-branch plumbing.
Branching itself requires a paid plan, and with no SQL migrations to run, a
preview branch will come up with an empty schema unless `alembic upgrade head`
is pointed at it.

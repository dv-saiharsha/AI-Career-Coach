"""create the public avatars storage bucket and its RLS policies

Kept in Alembic rather than run by hand in the Supabase SQL Editor so the
bucket and its policies are reproducible on a fresh project and reviewable in
version control, like the rest of the schema.

The bucket is public: avatars are rendered by <img> in the browser, and a
private bucket would require minting a signed URL per render. "Public" here
means anyone holding the URL can fetch the image — the paths contain a UUID
and a timestamp, so they are unguessable, but they are not secret. Do not put
anything sensitive in this bucket.

Writes stay owner-scoped: `(storage.foldername(name))[1]` is the first path
segment, so a policy comparing it to auth.uid() confines each user to their
own `{uid}/…` prefix even though reads are open.

Revision ID: b6d2f84a1c93
Revises: a3c5e91f4b07
Create Date: 2026-08-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b6d2f84a1c93'
down_revision: Union[str, None] = 'a3c5e91f4b07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BUCKET = "avatars"

# Named so they can be dropped precisely on downgrade. Supabase seeds its own
# policies on storage.objects, so a blanket drop would take out unrelated ones.
POLICIES = (
    (
        "zenith_avatars_public_read",
        f"CREATE POLICY zenith_avatars_public_read ON storage.objects "
        f"FOR SELECT USING (bucket_id = '{BUCKET}')",
    ),
    (
        "zenith_avatars_owner_insert",
        f"CREATE POLICY zenith_avatars_owner_insert ON storage.objects "
        f"FOR INSERT WITH CHECK (bucket_id = '{BUCKET}' "
        f"AND auth.uid()::text = (storage.foldername(name))[1])",
    ),
    (
        "zenith_avatars_owner_update",
        f"CREATE POLICY zenith_avatars_owner_update ON storage.objects "
        f"FOR UPDATE USING (bucket_id = '{BUCKET}' "
        f"AND auth.uid()::text = (storage.foldername(name))[1])",
    ),
    (
        "zenith_avatars_owner_delete",
        f"CREATE POLICY zenith_avatars_owner_delete ON storage.objects "
        f"FOR DELETE USING (bucket_id = '{BUCKET}' "
        f"AND auth.uid()::text = (storage.foldername(name))[1])",
    ),
)


def upgrade() -> None:
    bind = op.get_bind()
    # SQLite has no storage schema; this migration is a no-op there so the
    # local fallback database still upgrades cleanly.
    if bind.dialect.name != "postgresql":
        return

    op.execute(
        f"INSERT INTO storage.buckets (id, name, public) "
        f"VALUES ('{BUCKET}', '{BUCKET}', true) ON CONFLICT (id) DO NOTHING"
    )
    for name, statement in POLICIES:
        # DROP-then-CREATE rather than CREATE alone: policy creation has no
        # IF NOT EXISTS, so a re-run against a project where these were
        # applied by hand would abort the whole migration.
        op.execute(f"DROP POLICY IF EXISTS {name} ON storage.objects")
        op.execute(statement)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return

    for name, _ in POLICIES:
        op.execute(f"DROP POLICY IF EXISTS {name} ON storage.objects")
    # The bucket itself is left in place: dropping it would delete every
    # uploaded avatar, which is not something a schema downgrade should do.

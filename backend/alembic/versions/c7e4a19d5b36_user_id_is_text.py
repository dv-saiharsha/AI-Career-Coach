"""user_id is text, not uuid: Firebase uids are not UUIDs

Firebase assigns every brand-new account a 28-character id. Only the users imported
from Supabase have UUID-shaped ids (the import deliberately kept them), so the
eleven user_id columns, declared uuid because Supabase's auth.users.id was a uuid,
reject every other account with "invalid input syntax for type uuid". The result
was a 500 on every user-scoped query and a failed profile bootstrap for each new
signup, discovered when the first non-imported account signed in.

The identity provider's id is an opaque string, so it is stored as text. Existing
values convert exactly: a uuid's canonical text form is what was already being
compared against, and COPY of a uuid column's text into a text column is lossless,
so the data load from Supabase is unaffected.

Indexes (17 mention user_id) and the primary key on profiles.user_id are rebuilt by
Postgres as part of the type change. The tables are small; the rewrite is brief.

Runs only after d2f6a8c1b937, which refuses to run against a real Supabase database,
so this cannot be applied to Supabase by accident. Skipped on SQLite, whose column
types are loose and never rejected these values.

The downgrade refuses if any value is not UUID-shaped: converting such a row back to
uuid would fail partway, and silently dropping or rewriting a person's id is worse.

Revision ID: c7e4a19d5b36
Revises: d2f6a8c1b937
Create Date: 2026-10-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

revision: str = "c7e4a19d5b36"
down_revision: Union[str, None] = "d2f6a8c1b937"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Exactly the tables that carry a user_id. tests/test_user_id_is_text.py requires
# this to equal privacy.USER_ID_TABLES so a table added later cannot be missed.
TABLES = (
    "profiles",
    "resume_analyses",
    "job_applications",
    "interview_sessions",
    "job_offers",
    "notifications",
    "user_devices",
    "star_stories",
    "prep_question_user_state",
    "tailor_cache",
    "coach_conversations",
)

_UUID_SHAPE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for table in TABLES:
        op.execute(f'ALTER TABLE public."{table}" ALTER COLUMN user_id TYPE text USING user_id::text')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in TABLES:
        bad = bind.exec_driver_sql(
            f"SELECT count(*) FROM public.\"{table}\" WHERE user_id !~ '{_UUID_SHAPE}'"
        ).scalar()
        if bad:
            raise RuntimeError(
                f"{table} holds {bad} user_id value(s) that are not UUIDs (Firebase-issued ids), "
                "so the column cannot go back to uuid. Nothing was changed."
            )
    for table in TABLES:
        op.execute(f'ALTER TABLE public."{table}" ALTER COLUMN user_id TYPE uuid USING user_id::uuid')

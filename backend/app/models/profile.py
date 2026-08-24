from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.core.database import Base


class Profile(Base):
    """Per-user onboarding state and career preferences.

    One row per Supabase user, keyed by the auth.users UUID. There is no
    foreign key to auth.users — the same convention the other tables follow,
    because auth lives in a schema this app does not own and Alembic should
    not be issuing DDL that depends on it.

    Rows are created lazily on first read rather than by a signup hook: the
    backend never sees a signup (Supabase handles it), so there is no moment
    at which it could insert one eagerly.
    """

    __tablename__ = "profiles"

    # Not a surrogate id — the Supabase user UUID *is* the identity here, so a
    # separate primary key would just add a second way to say the same thing
    # and allow two profiles for one user.
    #
    # with_variant because Postgres' UUID type has no SQLite implementation:
    # its result processor tries to build a uuid.UUID from whatever SQLite
    # hands back and raises. DB_URL defaults to SQLite (app/core/config.py),
    # so without this the model can only ever be used against Postgres.
    user_id = Column(
        UUID(as_uuid=False).with_variant(String(36), "sqlite"), primary_key=True, index=True
    )

    onboarding_completed = Column(Boolean, nullable=False, default=False, server_default="false")

    # JSON-encoded list[str]. Text rather than JSONB to match the existing
    # convention (resume_analyses.result_json, job_listings.skills) and to keep
    # the local SQLite fallback in app/core/database.py working — the app
    # filters these in Python, never with a JSON operator in SQL.
    target_roles = Column(Text, nullable=False, default="[]", server_default="[]")

    # The analysis produced by the onboarding upload. Points at resume_analyses
    # rather than storing a file path: the resume is put through the normal
    # analysis pipeline, so the bytes and extracted text already live there and
    # a second copy in object storage would be a second thing to keep in sync.
    primary_resume_analysis_id = Column(Integer, nullable=True)
    primary_resume_filename = Column(String, nullable=True)

    # ── Career details, edited on /profile ────────────────────────────────
    bio = Column(Text, nullable=True)
    # Named current_title, not current_role: `current_role` is a *reserved*
    # SQL keyword (pg_get_keywords catcode 'R'), so a column of that name has
    # to be double-quoted in every statement forever, and any query that
    # forgets is a syntax error rather than a wrong answer.
    current_title = Column(String, nullable=True)
    seniority = Column(String, nullable=True)

    # The single aspirational role shown on /profile. Deliberately separate
    # from target_roles above: that list drives the job feed and interview
    # drills and is bound to 3-5 entries, so writing one value into it would
    # both destroy the user's onboarding choices and break that invariant.
    primary_target_role = Column(String, nullable=True)

    # Public URL of the avatar in the Supabase `avatars` bucket. Only the URL
    # lives here — the bytes are uploaded browser-to-Storage so image data
    # never round-trips through the API.
    avatar_url = Column(Text, nullable=True)
    # Storage object path, kept so deletion doesn't have to reverse-engineer
    # it by string-splitting the public URL.
    avatar_path = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

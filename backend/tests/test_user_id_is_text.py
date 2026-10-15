"""A user id is a Firebase uid, which is not a UUID.

Firebase gives new accounts a 28-character id; only users imported from Supabase have
UUID-shaped ones. A Postgres uuid column rejects the rest ("invalid input syntax for
type uuid"), which returned 500 on every user-scoped query for the first non-imported
account. SQLite cannot show this (its types are loose), so these tests guard the
declarations that Postgres would act on.
"""

import importlib
import importlib.util
import pkgutil
from pathlib import Path

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base
from app.modules.user_profile import privacy
import app.models as _models_pkg

# Import every module in app/models so Base.metadata holds every table, without
# naming them: a new model file is covered automatically.
for _module in pkgutil.iter_modules(_models_pkg.__path__):
    importlib.import_module(f"app.models.{_module.name}")

MIGRATION = Path(__file__).resolve().parent.parent / "alembic" / "versions" / "c7e4a19d5b36_user_id_is_text.py"

FIREBASE_STYLE_UID = "2riuWqPvi8Yh5R0f4FV9dknQW162"  # what a real new account looks like (28 chars)


def _user_id_columns():
    for table in Base.metadata.sorted_tables:
        for name in ("user_id", "triggered_by"):
            if name in table.columns:
                yield table.name, table.columns[name]


def test_no_model_declares_a_user_id_as_a_uuid():
    offenders = [
        f"{table}.{col.name}: {col.type!r}"
        for table, col in _user_id_columns()
        if isinstance(col.type, UUID) or getattr(col.type, "as_uuid", False)
    ]
    assert not offenders, (
        "these columns would reject a Firebase uid on Postgres: " + "; ".join(offenders)
    )


def test_every_user_id_column_is_text():
    wrong = [
        f"{table}.{col.name}: {col.type!r}"
        for table, col in _user_id_columns()
        if not isinstance(col.type, String)
    ]
    assert not wrong, "user ids must be String/text: " + "; ".join(wrong)


# Tables created after the uuid->text migration, with user_id as text from
# their first migration. They have nothing to convert, so they are not in that
# migration's TABLES, but erasure must still cover them. A table belongs here
# only if its creating migration declares user_id as sa.Text().
TEXT_FROM_CREATION = {"tailored_resumes"}


def test_the_migration_converts_exactly_the_tables_erasure_covers():
    spec = importlib.util.spec_from_file_location("user_id_is_text", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert set(module.TABLES) | TEXT_FROM_CREATION == set(privacy.USER_ID_TABLES), (
        "a table with a user_id was added to erasure but not to the uuid->text migration "
        "or TEXT_FROM_CREATION (or the reverse); new accounts would fail on it"
    )
    assert not set(module.TABLES) & TEXT_FROM_CREATION
    # and every model table that carries user_id is in that set
    modelled = {table for table, col in _user_id_columns() if col.name == "user_id"}
    assert modelled <= set(module.TABLES) | TEXT_FROM_CREATION


def test_tables_created_as_text_really_are_text_in_their_migration():
    versions = Path(MIGRATION).parent
    for table in TEXT_FROM_CREATION:
        creating = [
            f for f in versions.glob("*.py")
            if f'op.create_table(\n        "{table}"' in f.read_text() or f"create_table('{table}'" in f.read_text()
        ]
        assert creating, f"no migration creates {table}"
        source = creating[0].read_text()
        assert 'sa.Column("user_id", sa.Text(), nullable=False)' in source


def test_a_firebase_style_uid_is_not_uuid_shaped():
    """Documents the premise: if this ever stopped being true the migration would be moot."""
    import re
    assert not re.fullmatch(r"[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}", FIREBASE_STYLE_UID)
    assert len(FIREBASE_STYLE_UID) == 28

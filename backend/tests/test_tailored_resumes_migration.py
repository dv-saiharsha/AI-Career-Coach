"""tailored_resumes: the migration is on the chain, applies, matches the model, reverses."""

import sqlite3

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.tailored_resume import TailoredResume
from tests.test_jd_analyses_migration import BACKEND, alembic, tables, version

REVISION = "c8f2d1a07b34"
PARENT = "b4e1c2d3f501"


def test_the_chain_has_one_head_and_this_migration_sits_on_crawl_run_stats():
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    assert len(script.get_heads()) == 1
    assert script.get_revision(REVISION).down_revision == PARENT


def test_upgrade_matches_the_model_and_downgrade_removes_the_table(tmp_path):
    db_file = tmp_path / "tailored.db"
    assert alembic(db_file, "upgrade", REVISION).returncode == 0
    assert version(db_file) == REVISION
    with sqlite3.connect(db_file) as conn:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tailored_resumes)")}
        indexes = {r[1] for r in conn.execute("PRAGMA index_list(tailored_resumes)")}
    assert cols == {c.name for c in TailoredResume.__table__.columns}
    # Listing a user's saved copies newest-first is the hot query.
    assert "ix_tailored_resumes_user_created" in indexes

    assert alembic(db_file, "downgrade", PARENT).returncode == 0
    assert version(db_file) == PARENT and "tailored_resumes" not in tables(db_file)

"""crawl_runs.stats: the migration is the single head, applies, reverses."""

import sqlite3

from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.crawl_run import CrawlRun
from tests.test_jd_analyses_migration import BACKEND, alembic, version

REVISION = "b4e1c2d3f501"
PARENT = "a9d3c5e7f102"


def columns(db_file):
    with sqlite3.connect(db_file) as conn:
        return {r[1]: r for r in conn.execute("PRAGMA table_info(crawl_runs)")}


def test_the_chain_has_one_head_and_this_migration_sits_on_jd_analyses():
    # One head, not "this is the head": later migrations stack on top, the
    # same rule test_jd_analyses_migration.py follows.
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    assert len(script.get_heads()) == 1
    assert script.get_revision(REVISION).down_revision == PARENT


def test_upgrade_adds_stats_with_an_empty_object_default_and_downgrade_removes_it(tmp_path):
    db_file = tmp_path / "stats.db"
    assert alembic(db_file, "upgrade", REVISION).returncode == 0
    assert version(db_file) == REVISION
    cols = columns(db_file)
    assert cols["stats"][3] == 1 and cols["stats"][4] == "'{}'"
    assert set(cols) == {c.name for c in CrawlRun.__table__.columns}
    with sqlite3.connect(db_file) as conn:
        conn.execute("INSERT INTO crawl_runs (trigger) VALUES ('scheduled')")
        assert conn.execute("SELECT stats FROM crawl_runs").fetchone()[0] == "{}"
    down = alembic(db_file, "downgrade", PARENT)
    assert down.returncode == 0, down.stderr[-2000:]
    assert version(db_file) == PARENT and "stats" not in columns(db_file)

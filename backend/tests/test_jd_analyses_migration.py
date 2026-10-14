"""The jd_analyses migration: one head, it applies, it reverses, it matches the model.

Runs the real Alembic chain against SQLite, the way tests/test_erasure_coverage.py
does. (Postgres is covered by running the same upgrade and downgrade against the
rehearsal database; see the Phase 2 report.)
"""

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.models.jd_analysis import JDAnalysisRecord

BACKEND = Path(__file__).resolve().parent.parent
REVISION = "a9d3c5e7f102"
PARENT = "c7e4a19d5b36"


def alembic(db_file, *args):
    env = {
        "PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", ""), "DB_URL": f"sqlite:///{db_file}",
        "ENVIRONMENT": "development", "FIREBASE_PROJECT_ID": "", "ANTHROPIC_API_KEY": "", "REDIS_URL": "",
    }
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, capture_output=True, text=True)


def version(db_file):
    with sqlite3.connect(db_file) as conn:
        return conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]


def tables(db_file):
    with sqlite3.connect(db_file) as conn:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


@pytest.fixture(scope="module")
def migrated(tmp_path_factory):
    db_file = tmp_path_factory.mktemp("jd") / "schema.db"
    result = alembic(db_file, "upgrade", "head")
    assert result.returncode == 0, result.stderr[-2000:]
    return db_file


def test_the_chain_has_one_head_and_this_migration_sits_on_the_previous_one():
    script = ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))
    assert script.get_heads() == [REVISION]
    assert script.get_revision(REVISION).down_revision == PARENT


def test_upgrade_creates_the_table_and_stamps_the_version(migrated):
    assert version(migrated) == REVISION
    assert "jd_analyses" in tables(migrated)


def test_the_table_has_the_columns_the_model_declares(migrated):
    with sqlite3.connect(migrated) as conn:
        columns = {r[1]: (r[2], r[3]) for r in conn.execute("PRAGMA table_info(jd_analyses)")}
    assert set(columns) == {c.name for c in JDAnalysisRecord.__table__.columns}
    assert columns["jd_hash"][1] == 1 and columns["analysis"][1] == 1 and columns["analyzer_version"][1] == 1
    assert columns["job_listing_id"][1] == 0 and columns["model"][1] == 0


def test_the_indexes_exist(migrated):
    with sqlite3.connect(migrated) as conn:
        indexes = {r[1] for r in conn.execute("PRAGMA index_list(jd_analyses)")}
    assert {"ix_jd_analyses_hash", "ix_jd_analyses_job_listing_id", "ix_jd_analyses_id"} <= indexes


def test_a_row_round_trips_and_defaults_apply(migrated):
    with sqlite3.connect(migrated) as conn:
        conn.execute("INSERT INTO jd_analyses (jd_hash, analysis, source) VALUES ('h', '{\"a\": 1}', 'llm')")
        row = conn.execute("SELECT analyzer_version, created_at, job_listing_id FROM jd_analyses").fetchone()
        conn.execute("DELETE FROM jd_analyses")
    assert row[0] == 1 and row[1] is not None and row[2] is None


def test_the_source_check_rejects_anything_but_llm_rules_or_hybrid(migrated):
    with sqlite3.connect(migrated) as conn:
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO jd_analyses (jd_hash, analysis, source) VALUES ('h', '{}', 'guess')")


def test_job_listing_id_is_not_a_foreign_key(migrated):
    with sqlite3.connect(migrated) as conn:
        assert conn.execute("PRAGMA foreign_key_list(jd_analyses)").fetchall() == []


def test_downgrade_removes_the_table_and_restores_the_previous_version_then_upgrade_reapplies(tmp_path):
    db_file = tmp_path / "round_trip.db"
    assert alembic(db_file, "upgrade", "head").returncode == 0
    down = alembic(db_file, "downgrade", "-1")
    assert down.returncode == 0, down.stderr[-2000:]
    assert version(db_file) == PARENT and "jd_analyses" not in tables(db_file)
    up = alembic(db_file, "upgrade", "head")
    assert up.returncode == 0, up.stderr[-2000:]
    assert version(db_file) == REVISION and "jd_analyses" in tables(db_file)

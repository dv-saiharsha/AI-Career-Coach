"""Account erasure must cover every table that holds a person's data.

Until Supabase was removed, user_id referenced auth.users with ON DELETE
CASCADE, so deleting the login quietly cleaned up whatever the application code
forgot. That safety net is gone. These tests read the schema Alembic actually
builds (not the SQLAlchemy models, which omit the coach tables) and fail the
moment a table carrying a user_id, or a child of one, is not listed in
privacy.USER_ID_TABLES / privacy.CHILD_TABLES.

A failure here means: add the table to the erasure in privacy.delete_user_data
and to the registry, and to the export if it holds something the person owns.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.interview_prep import PrepQuestion, PrepQuestionUserState
from app.models.notification import Notification
from app.models.offer import JobOffer
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.models.story import StarStory
from app.models.tailor_cache import TailorCache
from app.models.user_device import UserDevice
from app.modules.user_profile import privacy

BACKEND = Path(__file__).resolve().parent.parent
ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"


@pytest.fixture(scope="module")
def schema_file(tmp_path_factory):
    """A SQLite database built by the real Alembic chain, as `alembic upgrade head` does.

    Built once; each test works on its own copy so seeded rows never leak across tests.
    """
    db_file = tmp_path_factory.mktemp("migrated") / "schema.db"
    env = {
        "PATH": os.environ["PATH"],
        "HOME": os.environ.get("HOME", ""),
        "DB_URL": f"sqlite:///{db_file}",
        "ENVIRONMENT": "development",
        "FIREBASE_PROJECT_ID": "",
        "ANTHROPIC_API_KEY": "",
        "REDIS_URL": "",
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND, env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    return db_file


@pytest.fixture
def migrated_engine(schema_file, tmp_path):
    copy = tmp_path / "copy.db"
    shutil.copy(schema_file, copy)
    engine = create_engine(f"sqlite:///{copy}")
    yield engine
    engine.dispose()


def _tables_with_user_id(engine) -> set[str]:
    insp = inspect(engine)
    return {
        t for t in insp.get_table_names()
        if t != "alembic_version" and "user_id" in {c["name"] for c in insp.get_columns(t)}
    }


def test_every_table_with_a_user_id_is_erased(migrated_engine):
    found = _tables_with_user_id(migrated_engine)
    missing = found - privacy.USER_ID_TABLES
    assert not missing, (
        f"tables with a user_id column that account erasure does not cover: {sorted(missing)}"
    )
    stale = privacy.USER_ID_TABLES - found
    assert not stale, f"USER_ID_TABLES names tables that do not exist: {sorted(stale)}"


def test_every_child_of_a_user_table_is_erased(migrated_engine):
    insp = inspect(migrated_engine)
    owned = set(privacy.USER_ID_TABLES) | set(privacy.CHILD_TABLES)
    children = {
        t for t in insp.get_table_names()
        if any(fk["referred_table"] in owned for fk in insp.get_foreign_keys(t))
    }
    missing = children - owned
    assert not missing, (
        f"tables that reference a user-owned table but are not erased: {sorted(missing)}"
    )
    stale = privacy.CHILD_TABLES - set(insp.get_table_names())
    assert not stale, f"CHILD_TABLES names tables that do not exist: {sorted(stale)}"


def _seed(session, user_id: str, bank_question_id: int) -> None:
    """One row in every table that holds this person's data, children included."""
    n = user_id[-1]
    session.add(Profile(user_id=user_id, onboarding_completed=True))
    session.add(ResumeAnalysis(user_id=user_id, resume_filename="cv.pdf", job_description="jd",
                               ats_score=70, result_json="{}"))
    application = JobApplication(user_id=user_id, job_title="Engineer", company="Acme", status="applied")
    session.add(application)
    session.flush()
    session.add(ApplicationStatusHistory(application_id=application.id, to_status="applied"))
    session.add(JobOffer(user_id=user_id, company="Acme", role_title="Engineer",
                         application_id=application.id))
    interview = InterviewSession(user_id=user_id, role="Backend", seniority="mid")
    session.add(interview)
    session.flush()
    question = InterviewQuestion(session_id=interview.id, text="Q", question_type="behavioral")
    session.add(question)
    session.flush()
    session.add(InterviewAnswer(question_id=question.id, answer_text="A", score=5))
    session.add(Notification(user_id=user_id, type="resume_needs_attention", category="resume", title="t", message="m",
                             dedupe_key=f"k-{n}"))
    session.add(UserDevice(user_id=user_id, expo_push_token=f"ExponentPushToken[{n}]", platform="ios"))
    session.add(StarStory(user_id=user_id, title="story"))
    session.add(PrepQuestionUserState(user_id=user_id, prep_question_id=bank_question_id))
    session.add(TailorCache(user_id=user_id, analysis_id=1, job_id=1, kind="k", payload_json="{}"))
    session.flush()
    conversation_id = session.execute(
        text("INSERT INTO coach_conversations (user_id, title) VALUES (:u, 't') RETURNING id"),
        {"u": user_id},
    ).scalar()
    session.execute(
        text("INSERT INTO coach_messages (conversation_id, role, content) VALUES (:c, 'user', 'hi')"),
        {"c": conversation_id},
    )
    session.commit()


def _count(session, table: str, user_id: str) -> int:
    if table in privacy.CHILD_TABLES:
        return -1  # reached through a parent; checked by total row count below
    return session.execute(text(f"SELECT count(*) FROM {table} WHERE user_id = :u"), {"u": user_id}).scalar()


def test_deleting_an_account_leaves_zero_rows_in_every_table(migrated_engine):
    session = sessionmaker(bind=migrated_engine)()
    try:
        bank_id = _bank_question(session)
        _seed(session, ALICE, bank_id)
        _seed(session, BOB, bank_id)

        before = {t: session.execute(text(f"SELECT count(*) FROM {t}")).scalar()
                  for t in privacy.USER_ID_TABLES | privacy.CHILD_TABLES}
        assert all(v == 2 for v in before.values()), f"seed should put one row per user in every table: {before}"

        privacy.delete_user_data(session, ALICE)

        for table in sorted(privacy.USER_ID_TABLES):
            assert _count(session, table, ALICE) == 0, f"{table} still holds Alice's rows"
            assert _count(session, table, BOB) == 1, f"{table} lost Bob's rows"
        after = {t: session.execute(text(f"SELECT count(*) FROM {t}")).scalar()
                 for t in privacy.CHILD_TABLES}
        assert all(v == 1 for v in after.values()), f"child tables should keep only Bob's rows: {after}"
        # The shared question bank is not anyone's data and must survive.
        assert session.execute(text("SELECT count(*) FROM prep_questions")).scalar() == 1
    finally:
        session.close()


def _bank_question(session) -> int:
    bank = PrepQuestion(
        cache_key="bank-1", role="r", category="c", difficulty="easy", prompt_version="1",
        model_version="m", text="t", estimated_answer_time=60, ideal_answer="i",
        concept_explanation="c", beginner_explanation="b", real_world_example="e",
        interviewer_intent="i",
    )
    session.add(bank)
    session.flush()
    return bank.id


def test_export_and_erasure_name_the_same_tables():
    """Export and erasure are two views of one list; they cannot drift apart."""
    assert set(privacy.EXPORT_SECTIONS) == set(privacy.USER_ID_TABLES) | set(privacy.CHILD_TABLES)
    assert len(set(privacy.EXPORT_SECTIONS.values())) == len(privacy.EXPORT_SECTIONS), "two tables share a section"


def test_the_export_contains_every_erased_table_and_only_the_callers_rows(migrated_engine):
    session = sessionmaker(bind=migrated_engine)()
    try:
        bank_id = _bank_question(session)
        _seed(session, ALICE, bank_id)
        _seed(session, BOB, bank_id)

        export = privacy.export_user_data(session, ALICE)

        for table, section in privacy.EXPORT_SECTIONS.items():
            assert section in export, f"the export has no {section!r} section for table {table}"
            assert len(export[section]) == 1, (
                f"{section!r} should hold exactly Alice's one row, got {len(export[section])}"
            )
        assert export["coach_messages"][0]["content"] == "hi"
        assert BOB not in repr(export), "another person's rows leaked into the export"
    finally:
        session.close()


def test_what_the_export_shows_is_what_erasure_removes(migrated_engine):
    session = sessionmaker(bind=migrated_engine)()
    try:
        bank_id = _bank_question(session)
        _seed(session, ALICE, bank_id)
        assert all(rows for key, rows in privacy.export_user_data(session, ALICE).items()
                   if key in privacy.EXPORT_SECTIONS.values())

        privacy.delete_user_data(session, ALICE)

        after = privacy.export_user_data(session, ALICE)
        leftovers = {k: len(v) for k, v in after.items() if k in privacy.EXPORT_SECTIONS.values() and v}
        assert not leftovers, f"export still shows data after erasure: {leftovers}"
    finally:
        session.close()

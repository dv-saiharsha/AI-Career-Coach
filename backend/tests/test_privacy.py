"""Export and erasure.

The landing page promises "Nothing was shared" and that a CV is read to score
it "and that is all". These are the routes that let a person verify the first
and act on it.

The test that matters most is the orphan one. Three tables hold a person's
data without carrying their user_id, and a deletion written the obvious way
leaves their interview answers in the database attached to nothing — while
telling them their data is gone.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
import httpx

from app.modules.user_profile import auth_admin, privacy, router

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"


def _seed(session, user_id: str) -> None:
    """A profile, a scan, an application with history, and an answered interview."""
    session.add(Profile(user_id=user_id, onboarding_completed=True, bio=f"bio for {user_id}"))
    session.add(
        ResumeAnalysis(
            user_id=user_id,
            resume_filename="cv.pdf",
            job_description="jd",
            ats_score=71,
            result_json="{}",
            resume_text="Jane Doe, jane@example.com, +1 555 010 1234",
            resume_file_bytes=b"%PDF-1.4 real bytes",
        )
    )

    application = JobApplication(
        user_id=user_id, job_title="Engineer", company="Acme", status="applied"
    )
    session.add(application)
    session.flush()
    session.add(
        ApplicationStatusHistory(application_id=application.id, to_status="applied")
    )

    interview = InterviewSession(user_id=user_id, role="Backend Engineer", seniority="mid")
    session.add(interview)
    session.flush()
    question = InterviewQuestion(
        session_id=interview.id, text="Tell me about a failure.", question_type="behavioral"
    )
    session.add(question)
    session.flush()
    session.add(
        InterviewAnswer(
            question_id=question.id,
            answer_text="I once deleted a production table.",
            score=7.5,
        )
    )
    session.commit()


def _ids_reachable_from(session, user_id: str) -> dict[str, list[int]]:
    """Primary keys of the three tables that carry no user_id of their own."""
    session_ids = [
        row[0]
        for row in session.execute(
            select(InterviewSession.id).where(InterviewSession.user_id == user_id)
        ).all()
    ]
    question_ids = [
        row[0]
        for row in session.execute(
            select(InterviewQuestion.id).where(InterviewQuestion.session_id.in_(session_ids))
        ).all()
    ]
    application_ids = [
        row[0]
        for row in session.execute(
            select(JobApplication.id).where(JobApplication.user_id == user_id)
        ).all()
    ]
    return {
        "interview_questions": question_ids,
        "interview_answers": [
            row[0]
            for row in session.execute(
                select(InterviewAnswer.id).where(InterviewAnswer.question_id.in_(question_ids))
            ).all()
        ],
        "application_status_history": [
            row[0]
            for row in session.execute(
                select(ApplicationStatusHistory.id).where(
                    ApplicationStatusHistory.application_id.in_(application_ids)
                )
            ).all()
        ],
    }


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    _seed(session, ALICE)
    _seed(session, BOB)
    yield session
    session.close()


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(
        id=ALICE, email="a@x.com"
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


class TestExport:
    def test_returns_every_category_including_the_indirect_ones(self, client):
        body = client.get("/api/user/export").json()
        for key in (
            "profile",
            "resume_analyses",
            "job_applications",
            "application_status_history",
            "interview_sessions",
            "interview_questions",
            "interview_answers",
            "job_offers",
            "notifications",
            "devices",
        ):
            assert key in body, f"export omits {key}"

        # The three that carry no user_id must actually be populated, or the
        # export is silently incomplete for exactly the most personal rows.
        assert body["interview_answers"], "the person's own answers were omitted"
        assert body["interview_questions"]
        assert body["application_status_history"]

    def test_resume_bytes_are_referenced_not_embedded(self, client):
        """The PDF is their own file and already downloadable. Base64 of every
        stored resume would multiply the export for nothing."""
        analysis = client.get("/api/user/export").json()["resume_analyses"][0]
        blob = analysis["resume_file_bytes"]
        assert blob["_bytes"] > 0
        assert "/api/resume/file/" in blob["_note"]

    def test_export_is_json_serialisable(self, client):
        """Datetimes and bytes both break json.dumps if not converted."""
        json.dumps(client.get("/api/user/export").json())

    def test_only_the_callers_data(self, client, db_session):
        body = client.get("/api/user/export").json()
        assert body["user_id"] == ALICE
        for row in body["profile"]:
            assert row["user_id"] == ALICE
        assert all(r["user_id"] == ALICE for r in body["resume_analyses"])


class TestDeletion:
    def test_requires_an_explicit_confirmation(self, client, db_session):
        assert client.delete("/api/user/account").status_code == 422
        assert client.delete("/api/user/account?confirm=yes").status_code == 400
        # Nothing removed by a rejected attempt.
        assert db_session.query(func.count(Profile.user_id)).scalar() == 2

    def test_erases_the_indirect_tables_too(self, client, db_session):
        """The orphan bug this module exists to avoid.

        "DELETE FROM every table WHERE user_id = :id" looks complete and
        leaves interview_answers behind, because that table has no user_id —
        it hangs off a question, which hangs off a session. The person is told
        their data is gone while their own words remain.

        The ids are captured BEFORE the deletion and checked by primary key
        afterwards. Asserting through a join instead is the trap: the join
        walks answer -> question -> session, the naive deletion removes the
        session, and the join then returns nothing while every answer is still
        in the table. A test written that way passes against the exact bug it
        was written to catch.
        """
        answer_ids = _ids_reachable_from(db_session, ALICE)
        assert answer_ids["interview_answers"], "fixture seeded nothing to orphan"

        response = client.delete("/api/user/account?confirm=DELETE")
        assert response.status_code == 200, response.text

        for model, ids in (
            (InterviewAnswer, answer_ids["interview_answers"]),
            (InterviewQuestion, answer_ids["interview_questions"]),
            (ApplicationStatusHistory, answer_ids["application_status_history"]),
        ):
            survivors = db_session.execute(
                select(model).where(model.id.in_(ids))
            ).scalars().all()
            assert survivors == [], (
                f"{model.__tablename__} rows survived deletion: "
                f"{[row.id for row in survivors]}"
            )

    def test_reports_per_table_counts(self, client):
        """A bare success is not something a person can check against their
        export."""
        deleted = client.delete("/api/user/account?confirm=DELETE").json()["deleted"]
        assert deleted["interview_answers"] == 1
        assert deleted["application_status_history"] == 1
        assert deleted["resume_analyses"] == 1
        assert deleted["profile"] == 1

    def test_another_users_data_is_untouched(self, client, db_session):
        """The failure that would be unrecoverable."""
        bob_ids = _ids_reachable_from(db_session, BOB)
        client.delete("/api/user/account?confirm=DELETE")

        assert db_session.query(func.count(Profile.user_id)).filter(
            Profile.user_id == BOB
        ).scalar() == 1
        surviving = db_session.execute(
            select(InterviewAnswer).where(
                InterviewAnswer.id.in_(bob_ids["interview_answers"])
            )
        ).scalars().all()
        assert len(surviving) == 1, "deleting one account touched another"

    def test_export_after_deletion_is_empty(self, client):
        """The end-to-end claim: erased means the export has nothing left."""
        client.delete("/api/user/account?confirm=DELETE")
        body = client.get("/api/user/export").json()
        for key in ("profile", "resume_analyses", "interview_answers", "job_applications"):
            assert body[key] == [], f"{key} still holds data after erasure"


def test_deleting_a_user_with_no_data_is_not_an_error(db_session):
    """A fresh account that never scanned anything must still be erasable."""
    counts = privacy.delete_user_data(db_session, "00000000-0000-0000-0000-0000000000ff")
    assert all(value == 0 for value in counts.values())


class TestIdentityRemoval:
    """Erasing the rows while leaving the login intact is a half-deletion,
    and the person has already been told their account is gone."""

    def test_the_identity_is_removed_too(self, client, monkeypatch):
        called: list[str] = []
        monkeypatch.setattr(
            router, "delete_auth_user", lambda user_id: called.append(user_id) or True
        )

        body = client.delete("/api/user/account?confirm=DELETE").json()

        assert called == [ALICE], "the Supabase identity was never touched"
        assert body["sign_in_disabled"] is True

    def test_data_is_erased_before_the_identity(self, client, db_session, monkeypatch):
        """The ordering guarantee, and the reason this test exists.

        Identity first then a failed row deletion is unrecoverable: the person
        can no longer authenticate, so they can never retry, and their data is
        still held. Rows first is recoverable — they can sign in and ask
        again. So the order is not incidental and is asserted rather than
        left to the reading of the function.
        """
        rows_at_identity_deletion: list[int] = []

        def spy(_user_id: str) -> bool:
            rows_at_identity_deletion.append(
                db_session.query(func.count(Profile.user_id))
                .filter(Profile.user_id == ALICE)
                .scalar()
            )
            return True

        monkeypatch.setattr(router, "delete_auth_user", spy)
        client.delete("/api/user/account?confirm=DELETE")

        assert rows_at_identity_deletion == [0], (
            "the identity was deleted while the user's rows were still present"
        )

    def test_a_failed_identity_removal_is_reported_not_raised(self, client, monkeypatch):
        """The rows are already gone by this point. A 500 would tell the
        caller nothing happened, which is the opposite of the truth."""
        monkeypatch.setattr(router, "delete_auth_user", lambda _user_id: False)

        response = client.delete("/api/user/account?confirm=DELETE")

        assert response.status_code == 200
        body = response.json()
        assert body["sign_in_disabled"] is False
        assert body["deleted"]["profile"] == 1, "the data deletion still happened"

    def test_a_rejected_confirmation_never_reaches_the_identity(self, client, monkeypatch):
        called: list[str] = []
        monkeypatch.setattr(router, "delete_auth_user", lambda uid: called.append(uid) or True)

        client.delete("/api/user/account?confirm=yes")

        assert called == [], "a rejected request deleted the login anyway"


class TestAuthAdmin:
    def test_missing_credentials_reports_failure_rather_than_claiming_success(
        self, monkeypatch
    ):
        """CI and local development run without the service-role key. The
        honest answer there is 'no', not a silent yes."""
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_SECRET_API_KEY", "")
        assert auth_admin.delete_auth_user(ALICE) is False

    def test_a_missing_user_counts_as_deleted(self, monkeypatch):
        """404 means the identity is not there, which is the state this
        function exists to reach. Calling it a failure would make a retry
        after a partial deletion report failure forever."""
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_SECRET_API_KEY", "secret")
        monkeypatch.setattr(
            auth_admin.httpx, "delete", lambda *a, **k: httpx.Response(404, text="not found")
        )
        assert auth_admin.delete_auth_user(ALICE) is True

    def test_a_network_failure_does_not_raise(self, monkeypatch):
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_URL", "https://x.supabase.co")
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_SECRET_API_KEY", "secret")

        def boom(*_a, **_k):
            raise httpx.ConnectError("no route to host")

        monkeypatch.setattr(auth_admin.httpx, "delete", boom)
        assert auth_admin.delete_auth_user(ALICE) is False

    def test_the_service_role_key_is_sent_and_the_user_id_is_in_the_path(self, monkeypatch):
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_URL", "https://x.supabase.co/")
        monkeypatch.setattr(auth_admin.settings, "SUPABASE_SECRET_API_KEY", "secret-key")
        seen: dict = {}

        def capture(url, headers=None, timeout=None):
            seen["url"] = url
            seen["headers"] = headers
            return httpx.Response(200)

        monkeypatch.setattr(auth_admin.httpx, "delete", capture)
        assert auth_admin.delete_auth_user(ALICE) is True

        # The trailing slash on SUPABASE_URL must not produce a double slash.
        assert seen["url"] == f"https://x.supabase.co/auth/v1/admin/users/{ALICE}"
        assert seen["headers"]["apikey"] == "secret-key"
        assert seen["headers"]["Authorization"] == "Bearer secret-key"

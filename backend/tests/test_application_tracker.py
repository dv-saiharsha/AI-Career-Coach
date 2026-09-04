"""Milestone 8 — the Intelligent Application Tracker: status history, the
cross-application activity feed, and the detail view's aggregation across
the Resume, Job Matching, and Interview engines.

Ownership isolation for the base CRUD endpoints is already covered by
test_applications.py; this file covers what Milestone 8 actually added.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import ApplicationStatusHistory
from app.models.interview import InterviewSession
# FK target for InterviewQuestion.prep_question_id — must be registered on
# Base's metadata before create_all(), same as test_career_coach.py. Imported
# as `from app.models import ...` rather than `import app.models...` — the
# latter rebinds the local name `app` to the top-level package, clobbering
# the `from app.main import app` FastAPI instance imported above.
from app.models import interview_prep as _interview_prep_models  # noqa: F401
from app.models.resume import ResumeAnalysis

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"

PAYLOAD = {"job_title": "Backend Engineer", "company": "Acme"}


@pytest.fixture
def db_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(db_session):
    app.dependency_overrides[get_db] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=USER_A, email="a@example.com")
    yield TestClient(app)
    app.dependency_overrides.clear()


def as_user(client, user_id):
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=user_id, email=f"{user_id}@x.com")


# -- Status history -----------------------------------------------------------


class TestStatusHistory:
    def test_creating_an_application_records_initial_history(self, client, db_session):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        rows = db_session.query(ApplicationStatusHistory).filter_by(application_id=app_id).all()
        assert len(rows) == 1
        assert rows[0].from_status is None
        assert rows[0].to_status == "saved"

    def test_status_change_appends_history_in_order(self, client, db_session):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        client.patch(f"/api/applications/{app_id}/status", json={"status": "applied"})
        client.patch(f"/api/applications/{app_id}/status", json={"status": "recruiter_screening"})

        detail = client.get(f"/api/applications/{app_id}").json()
        history = detail["status_history"]
        assert [(h["from_status"], h["to_status"]) for h in history] == [
            (None, "saved"),
            ("saved", "applied"),
            ("applied", "recruiter_screening"),
        ]

    def test_updating_other_fields_does_not_append_history(self, client, db_session):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        client.patch(f"/api/applications/{app_id}", json={"notes": "Referred by a friend"})
        rows = db_session.query(ApplicationStatusHistory).filter_by(application_id=app_id).all()
        assert len(rows) == 1  # only the initial creation entry

    def test_setting_the_same_status_again_does_not_append_history(self, client, db_session):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        client.patch(f"/api/applications/{app_id}/status", json={"status": "saved"})
        rows = db_session.query(ApplicationStatusHistory).filter_by(application_id=app_id).all()
        assert len(rows) == 1


# -- Activity feed --------------------------------------------------------------


class TestActivityFeed:
    def test_feed_spans_applications_newest_first(self, client):
        a = client.post("/api/applications", json={**PAYLOAD, "company": "Acme"}).json()["id"]
        b = client.post("/api/applications", json={**PAYLOAD, "company": "Globex"}).json()["id"]
        client.patch(f"/api/applications/{a}/status", json={"status": "applied"})

        feed = client.get("/api/applications/activity").json()
        # Most recent change first: the move on `a` to "applied".
        assert feed[0]["application_id"] == a
        assert feed[0]["to_status"] == "applied"
        assert feed[0]["company"] == "Acme"
        ids = {item["application_id"] for item in feed}
        assert ids == {a, b}

    def test_feed_isolated_per_user(self, client):
        client.post("/api/applications", json=PAYLOAD)
        as_user(client, USER_B)
        assert client.get("/api/applications/activity").json() == []

    def test_activity_route_not_shadowed_by_application_id_route(self, client):
        """/activity must resolve to the feed, not a 422 from trying to
        parse "activity" as an integer application_id."""
        response = client.get("/api/applications/activity")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


# -- Detail view: cross-engine aggregation --------------------------------------


class TestApplicationDetail:
    def test_404_for_missing_application(self, client):
        assert client.get("/api/applications/999").status_code == 404

    def test_404_for_another_users_application(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        as_user(client, USER_B)
        assert client.get(f"/api/applications/{app_id}").status_code == 404

    def test_resume_summary_present_when_tailored_resume_linked(self, client, db_session):
        analysis = ResumeAnalysis(
            user_id=USER_A, resume_filename="resume.pdf", job_description="", ats_score=72.0,
            result_json="{}", resume_text="Experienced backend engineer skilled in Python and Kubernetes.",
        )
        db_session.add(analysis)
        db_session.commit()
        db_session.refresh(analysis)

        app_id = client.post(
            "/api/applications", json={**PAYLOAD, "tailored_resume_id": analysis.id}
        ).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["resume"]["analysis_id"] == analysis.id
        assert detail["resume"]["filename"] == "resume.pdf"
        assert detail["resume"]["band"] == "STRONG"  # 72 clears rubric.band()'s 70 threshold

    def test_resume_summary_absent_without_tailored_resume(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["resume"] is None

    def test_job_match_absent_without_job_description(self, client):
        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["job_match"] is None

    def test_job_match_falls_back_to_latest_scan_without_explicit_link(self, client, db_session, monkeypatch):
        from app.modules.job_market import matching

        monkeypatch.setattr(matching, "model_available", lambda: True)
        monkeypatch.setattr(matching, "predict_score", lambda resume_text, job_description: 72.0)
        db_session.add(
            ResumeAnalysis(
                user_id=USER_A, resume_filename="latest.pdf", job_description="", ats_score=60.0,
                result_json="{}", resume_text="Backend engineer with Python, Kubernetes, and AWS experience.",
            )
        )
        db_session.commit()

        app_id = client.post(
            "/api/applications",
            json={**PAYLOAD, "job_description": "Looking for a backend engineer skilled in Python and Kubernetes."},
        ).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["job_match"] is not None
        assert detail["job_match"]["overall_match"] is not None

    def test_interview_summary_matches_normalised_role(self, client, db_session):
        from datetime import datetime, timezone

        db_session.add(
            InterviewSession(
                user_id=USER_A, role="Senior Backend Engineer", seniority="Senior", category="technical",
                status="completed", overall_score=8.2, readiness_band="STRONG",
                topics_to_improve=json.dumps(["System design tradeoffs"]),
                completed_at=datetime.now(timezone.utc),
            )
        )
        db_session.commit()

        app_id = client.post(
            "/api/applications", json={**PAYLOAD, "job_title": "senior backend engineer"}
        ).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["interview"] is not None
        assert detail["interview"]["readiness_band"] == "STRONG"
        assert detail["interview"]["topics_to_improve"] == ["System design tradeoffs"]

    def test_interview_summary_absent_for_unrelated_role(self, client, db_session):
        from datetime import datetime, timezone

        db_session.add(
            InterviewSession(
                user_id=USER_A, role="Product Manager", seniority="Senior", category="behavioral",
                status="completed", overall_score=7.0, readiness_band="GOOD",
                completed_at=datetime.now(timezone.utc),
            )
        )
        db_session.commit()

        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]  # "Backend Engineer"
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["interview"] is None

    def test_has_in_progress_interview_flag(self, client, db_session):
        db_session.add(
            InterviewSession(
                user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="technical",
                status="in_progress",
            )
        )
        db_session.commit()

        app_id = client.post("/api/applications", json=PAYLOAD).json()["id"]
        detail = client.get(f"/api/applications/{app_id}").json()
        assert detail["has_in_progress_interview"] is True
        assert detail["interview"] is None  # in-progress, not a completed session


# -- Recruiter fields -----------------------------------------------------------


class TestRecruiterFields:
    def test_roundtrip_through_create_and_update(self, client):
        app_id = client.post(
            "/api/applications",
            json={**PAYLOAD, "recruiter_name": "Jordan Lee", "recruiter_email": "jordan@acme.com"},
        ).json()["id"]
        record = client.get(f"/api/applications/{app_id}").json()["application"]
        assert record["recruiter_name"] == "Jordan Lee"
        assert record["recruiter_email"] == "jordan@acme.com"

        updated = client.patch(f"/api/applications/{app_id}", json={"recruiter_name": "Sam Rivera"}).json()
        assert updated["recruiter_name"] == "Sam Rivera"
        assert updated["recruiter_email"] == "jordan@acme.com"  # untouched by a partial update

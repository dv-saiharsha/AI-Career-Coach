"""Pipeline KPIs on the dashboard overview."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import JobApplication
from app.models.resume import ResumeAnalysis

ALICE = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
    yield TestClient(app)
    app.dependency_overrides.clear()


def add_app(db, status, jd="Need Python and Kubernetes.", score=None):
    row = JobApplication(
        user_id=ALICE, job_title="Engineer", company="Acme",
        status=status, job_description=jd, match_score=score,
    )
    db.add(row)
    db.commit()
    return row


class TestAppliedCount:
    def test_saved_is_not_an_application(self, client, db):
        """A bookmark is not an application. Counting it would inflate the
        number a user reads as 'how many jobs have I applied to'."""
        add_app(db, "saved")
        add_app(db, "applied")
        m = client.get("/api/dashboard/overview").json()["metrics"]
        assert m["total_applied"] == 1
        assert m["total_applications"] == 2

    def test_later_stages_still_count_as_sent(self, client, db):
        """Someone at the offer stage certainly applied."""
        for stage in ("applied", "technical_interview", "offer", "rejected"):
            add_app(db, stage)
        assert client.get("/api/dashboard/overview").json()["metrics"]["total_applied"] == 4

    def test_empty_pipeline(self, client):
        m = client.get("/api/dashboard/overview").json()["metrics"]
        assert m["total_applied"] == 0
        assert m["average_match_score"] is None


class TestAverageMatch:
    def test_none_when_nothing_scored(self, client, db):
        """'0% match' reads as a terrible resume; no measurement is just no
        measurement."""
        add_app(db, "applied")
        assert client.get("/api/dashboard/overview").json()["metrics"]["average_match_score"] is None

    def test_averages_only_scored_rows(self, client, db):
        add_app(db, "applied", score=80.0)
        add_app(db, "applied", score=60.0)
        add_app(db, "applied", jd=None)  # unscoreable
        m = client.get("/api/dashboard/overview").json()["metrics"]
        assert m["average_match_score"] == 70.0
        assert m["scored_applications"] == 2

    def test_unscoreable_rows_are_not_counted_as_zero(self, client, db):
        """An application with no stored JD cannot be measured. Treating it as
        0 would drag down an average for a posting nobody scored."""
        add_app(db, "applied", score=90.0)
        add_app(db, "applied", jd=None)
        assert client.get("/api/dashboard/overview").json()["metrics"]["average_match_score"] == 90.0

    def test_reports_how_much_the_average_covers(self, client, db):
        """A figure from one application shouldn't look like one from twenty."""
        add_app(db, "applied", score=75.0)
        add_app(db, "applied", jd=None)
        m = client.get("/api/dashboard/overview").json()["metrics"]
        assert m["scored_applications"] == 1 and m["total_applications"] == 2

    def test_scoring_is_bounded_per_request(self, client, db, monkeypatch):
        """Each score is a ~127ms model call. A first load on a large pipeline
        must not scale with its size."""
        from app.modules.dashboard import services

        calls = {"n": 0}

        def counted(resume, jd):
            calls["n"] += 1
            return 70.0

        monkeypatch.setattr(services, "model_available", lambda: True)
        monkeypatch.setattr(services, "predict_score", counted)
        db.add(ResumeAnalysis(user_id=ALICE, resume_filename="r.pdf", job_description="jd",
                              ats_score=70.0, result_json=json.dumps({}), resume_text="text"))
        db.commit()
        for _ in range(12):
            add_app(db, "applied")

        client.get("/api/dashboard/overview")
        assert calls["n"] <= services.MAX_SCORES_PER_REQUEST

    def test_scores_persist_so_they_are_computed_once(self, client, db, monkeypatch):
        from app.modules.dashboard import services

        monkeypatch.setattr(services, "model_available", lambda: True)
        monkeypatch.setattr(services, "predict_score", lambda r, j: 65.0)
        db.add(ResumeAnalysis(user_id=ALICE, resume_filename="r.pdf", job_description="jd",
                              ats_score=70.0, result_json=json.dumps({}), resume_text="text"))
        db.commit()
        row = add_app(db, "applied")

        client.get("/api/dashboard/overview")
        db.refresh(row)
        assert row.match_score == 65.0


class TestIsolation:
    def test_other_users_applications_excluded(self, client, db):
        db.add(JobApplication(user_id="00000000-0000-0000-0000-00000000000b",
                              job_title="X", company="Y", status="applied"))
        db.commit()
        assert client.get("/api/dashboard/overview").json()["metrics"]["total_applications"] == 0

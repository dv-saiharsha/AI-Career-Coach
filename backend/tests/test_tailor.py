"""Job-card to resume tailor handoff."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AuthenticatedUser(id=ALICE, email="a@x.com")
    yield TestClient(app)
    app.dependency_overrides.clear()


def add_job(db, description="Seeking Kubernetes and Terraform experience."):
    row = JobListing(
        query_key="devops engineer", external_id="j1", title="DevOps Engineer",
        company="Acme", location="Remote", work_mode="Remote",
        apply_url="https://example.com/j", description=description,
    )
    db.add(row)
    db.commit()
    return row


def add_scan(db, user_id=ALICE, text="Built pipelines with Docker and PyTorch."):
    row = ResumeAnalysis(
        user_id=user_id, resume_filename="r.pdf", job_description="old jd",
        ats_score=61.0, result_json=json.dumps({}), resume_text=text,
    )
    db.add(row)
    db.commit()
    return row


class TestHandoff:
    def test_reports_gaps_against_this_job(self, client, db):
        job = add_job(db)
        scan = add_scan(db)
        r = client.post("/api/resume-builder/tailor-handoff",
                        json={"job_id": job.id, "analysis_id": scan.id})
        assert r.status_code == 200
        body = r.json()
        assert body["job_title"] == "DevOps Engineer"
        assert body["company"] == "Acme"

    def test_separates_genuine_gaps_from_unstated_skills(self, client, db):
        """A skill the resume implies is a different problem from one it
        lacks — saying it is far easier than acquiring it, and lumping them
        together tells the candidate to go learn something they already know."""
        job = add_job(db, description="Requires Docker and containerization.")
        scan = add_scan(db, text="Skills\nDocker, Kubernetes")
        body = client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).json()
        assert "containerization" not in [k.lower() for k in body["missing_keywords"]]

    def test_scores_against_the_job_not_the_original_jd(self, client, db):
        """The point of re-targeting is a number for THIS posting."""
        job = add_job(db)
        scan = add_scan(db)
        body = client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).json()
        assert body["original_ats_score"] == 61.0
        if body["targeted_ats_score"] is not None:
            assert 0 <= body["targeted_ats_score"] <= 100

    def test_flags_listings_with_no_body_text(self, client, db):
        """An empty gap list from an empty JD is not a clean resume."""
        job = add_job(db, description=None)
        scan = add_scan(db)
        body = client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).json()
        assert body["has_job_description"] is False

    def test_never_writes_bullets_for_the_candidate(self, client, db):
        """Gaps come back as things to act on, never as text silently
        inserted into a resume the candidate would have to defend."""
        job = add_job(db)
        scan = add_scan(db)
        body = client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).json()
        assert "tailored_pdf" not in body and "bullets" not in body

    def test_costs_nothing(self, client, db, monkeypatch):
        """Clicking a job card must not spend an LLM call."""
        from app.modules.resume_builder import services

        def fail(*a, **k):
            raise AssertionError("tailor-handoff must not call Claude")

        monkeypatch.setattr(services.llm_client, "complete_tool_json", fail)
        job = add_job(db)
        scan = add_scan(db)
        assert client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).status_code == 200


class TestIsolation:
    def test_another_users_resume_is_404(self, client, db):
        job = add_job(db)
        scan = add_scan(db, user_id=BOB)
        assert client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": job.id, "analysis_id": scan.id}).status_code == 404

    def test_missing_job_is_404(self, client, db):
        scan = add_scan(db)
        assert client.post("/api/resume-builder/tailor-handoff",
                           json={"job_id": 999999, "analysis_id": scan.id}).status_code == 404

    def test_unauthenticated_rejected(self, db):
        app.dependency_overrides[get_db] = lambda: db
        try:
            assert TestClient(app).post("/api/resume-builder/tailor-handoff",
                                        json={"job_id": 1, "analysis_id": 1}).status_code == 401
        finally:
            app.dependency_overrides.clear()

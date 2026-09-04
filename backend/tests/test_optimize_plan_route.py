"""The optimizer's HTTP surface.

optimizer.plan() is already covered by tests/test_optimizer.py — this file
checks only what the route adds: auth, request validation, the two ways in
(pasted text vs. a stored scan), and ownership on the by-id path. It does not
re-verify the plan's own guarantees.
"""

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import optimizer

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"

WEAK_RESUME = "Jane Doe. Worked on backend stuff. Helped with deployments."
JD = "Senior Backend Engineer. Python, Go, Kubernetes, PostgreSQL, Terraform."


@pytest.fixture(autouse=True)
def _scoring_model(monkeypatch):
    monkeypatch.setattr(optimizer, "model_available", lambda: True)
    monkeypatch.setattr(optimizer, "predict_score", lambda resume_text, job_description: 65.0)


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
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


class TestPastedText:
    def test_returns_a_plan(self, client):
        response = client.post(
            "/api/resume-builder/optimize-plan",
            json={"resume_text": WEAK_RESUME, "job_description": JD},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["available"] is True
        assert body["baseline_score"] is not None
        assert isinstance(body["edits"], list)

    def test_empty_resume_text_is_rejected(self, client):
        response = client.post(
            "/api/resume-builder/optimize-plan",
            json={"resume_text": "", "job_description": JD},
        )
        assert response.status_code == 422

    def test_requires_auth(self, client):
        app.dependency_overrides.pop(get_current_user, None)
        response = client.post(
            "/api/resume-builder/optimize-plan",
            json={"resume_text": WEAK_RESUME, "job_description": JD},
        )
        assert response.status_code in (401, 403)


class TestByAnalysisId:
    def _store_scan(self, db_session, user_id=ALICE, resume_text=WEAK_RESUME):
        doc = fitz.open()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()
        row = ResumeAnalysis(
            user_id=user_id,
            resume_filename="cv.pdf",
            job_description="Old JD",
            ats_score=8.0,
            result_json="{}",
            resume_text=resume_text,
            resume_file_bytes=pdf_bytes,
        )
        db_session.add(row)
        db_session.commit()
        db_session.refresh(row)
        return row

    def test_plans_against_the_stored_resume(self, client, db_session):
        record = self._store_scan(db_session)
        response = client.post(
            f"/api/resume-builder/optimize-plan/{record.id}",
            json={"job_description": JD},
        )
        assert response.status_code == 200, response.text
        assert response.json()["available"] is True

    def test_no_resume_text_field_is_accepted_or_needed(self, client, db_session):
        """The whole point of this route — nothing to upload, nothing to type."""
        record = self._store_scan(db_session)
        response = client.post(
            f"/api/resume-builder/optimize-plan/{record.id}",
            json={"job_description": JD},
        )
        assert response.status_code == 200

    def test_unknown_analysis_is_404(self, client, db_session):
        response = client.post(
            "/api/resume-builder/optimize-plan/999999",
            json={"job_description": JD},
        )
        assert response.status_code == 404

    def test_another_users_scan_is_not_reachable(self, client, db_session):
        """A 404, not a 403 — confirming existence would leak it."""
        record = self._store_scan(db_session, user_id=BOB)
        response = client.post(
            f"/api/resume-builder/optimize-plan/{record.id}",
            json={"job_description": JD},
        )
        assert response.status_code == 404

    def test_scan_with_no_stored_text_explains_itself(self, client, db_session):
        record = self._store_scan(db_session, resume_text="")
        response = client.post(
            f"/api/resume-builder/optimize-plan/{record.id}",
            json={"job_description": JD},
        )
        assert response.status_code == 400
        assert "re-scan" in response.json()["detail"].lower()

    def test_empty_job_description_is_rejected(self, client, db_session):
        record = self._store_scan(db_session)
        response = client.post(
            f"/api/resume-builder/optimize-plan/{record.id}",
            json={"job_description": ""},
        )
        assert response.status_code == 422

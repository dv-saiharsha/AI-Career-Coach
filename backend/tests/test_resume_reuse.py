"""Re-using the resume already on file, instead of asking for it again.

Scoring an unchanged CV against a second posting used to mean uploading the
same file a second time, and storing another copy of identical bytes. These
two routes remove that: /on-file says what is stored, /rescan scores it.
"""

import io

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.profile import Profile

ALICE = "00000000-0000-0000-0000-00000000000a"
JD = "Senior Backend Engineer. Python, Go, Kubernetes, PostgreSQL, Terraform."
OTHER_JD = "Platform Engineer. Terraform, AWS, Kubernetes, observability, CI/CD."


def _resume_pdf() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        "JANE DOE",
        "jane.doe@example.com | (555) 010-1234",
        "",
        "EXPERIENCE",
        "- Built payment services in Python handling 500k transactions daily",
        "- Reduced p99 latency 34% by moving the hot path to Go",
        "- Migrated 12 services to Kubernetes, cutting deploy time from 40 to 8 minutes",
        "",
        "SKILLS",
        "Python, Go, Kubernetes, PostgreSQL, Terraform",
        "",
        "EDUCATION",
        "B.S. Computer Science, Stanford University, 2018",
    ]
    y = 60
    for line in lines:
        if line:
            page.insert_text((60, y), line, fontsize=10)
        y += 16
    out = doc.tobytes()
    doc.close()
    return out


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add(Profile(user_id=ALICE, onboarding_completed=True))
    session.commit()
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


def _upload(client, filename="my-cv.pdf", jd=JD):
    return client.post(
        "/api/resume/analyze",
        files={"resume": (filename, io.BytesIO(_resume_pdf()), "application/pdf")},
        data={"job_description": jd},
    )


class TestOnFile:
    def test_reports_nothing_before_a_first_scan(self, client):
        body = client.get("/api/resume/on-file").json()
        assert body["has_resume"] is False
        assert body["can_rescan"] is False

    def test_describes_the_stored_resume(self, client):
        assert _upload(client).status_code == 200

        body = client.get("/api/resume/on-file").json()
        assert body["has_resume"] is True
        assert body["filename"] == "my-cv.pdf"
        assert body["ats_score"] is not None
        assert body["band"]
        assert body["scanned_at"]
        assert body["can_rescan"] is True, "stored bytes should make a re-scan possible"

    def test_reports_the_latest_upload_not_the_first(self, client):
        _upload(client, filename="old.pdf")
        _upload(client, filename="new.pdf")
        assert client.get("/api/resume/on-file").json()["filename"] == "new.pdf"


class TestRescan:
    def test_refuses_when_nothing_is_stored(self, client):
        response = client.post("/api/resume/rescan", json={"job_description": JD})
        assert response.status_code == 404
        # The message has to say what to do, not just what went wrong.
        assert "upload" in response.json()["detail"].lower()

    def test_scores_the_stored_resume_against_a_new_posting(self, client):
        assert _upload(client).status_code == 200

        response = client.post("/api/resume/rescan", json={"job_description": OTHER_JD})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["ats_score"] is not None
        assert body["id"]

    def test_the_rescan_keeps_the_bytes_so_it_can_happen_again(self, client):
        """A re-scan that dropped the file would silently make the next one
        impossible — the failure would appear one action later than its cause."""
        _upload(client)
        assert client.post("/api/resume/rescan", json={"job_description": OTHER_JD}).status_code == 200
        assert client.get("/api/resume/on-file").json()["can_rescan"] is True
        assert client.post("/api/resume/rescan", json={"job_description": JD}).status_code == 200

    def test_rescan_does_not_require_a_file(self, client):
        """The whole point. A multipart body would defeat it."""
        _upload(client)
        response = client.post("/api/resume/rescan", json={"job_description": OTHER_JD})
        assert response.status_code == 200

    def test_empty_job_description_is_rejected(self, client):
        _upload(client)
        assert client.post("/api/resume/rescan", json={"job_description": ""}).status_code == 422

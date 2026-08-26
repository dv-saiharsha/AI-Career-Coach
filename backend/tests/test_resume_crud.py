"""View and delete a stored resume scan, and the integrity that goes with it."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.profile import Profile
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


def add_scan(db, user_id=ALICE, filename="resume.pdf", file_bytes=b"%PDF-1.4 fake"):
    row = ResumeAnalysis(
        user_id=user_id, resume_filename=filename, job_description="jd",
        ats_score=72.0, result_json=json.dumps({"ats_score": 72.0}),
        resume_text="text", resume_file_bytes=file_bytes,
    )
    db.add(row)
    db.commit()
    return row


class TestViewOriginal:
    def test_returns_the_uploaded_bytes_unaltered(self, client, db):
        """The point of 'view my resume' is confirming what was scanned, so
        this must be the original file, not the generated report."""
        scan = add_scan(db, file_bytes=b"%PDF-1.4 original content")
        r = client.get(f"/api/resume/file/{scan.id}")
        assert r.status_code == 200
        assert r.content == b"%PDF-1.4 original content"

    def test_opens_inline_rather_than_forcing_a_download(self, client, db):
        scan = add_scan(db)
        r = client.get(f"/api/resume/file/{scan.id}")
        assert r.headers["content-disposition"].startswith("inline")
        assert r.headers["content-type"] == "application/pdf"

    def test_docx_gets_its_own_media_type(self, client, db):
        scan = add_scan(db, filename="resume.docx")
        r = client.get(f"/api/resume/file/{scan.id}")
        assert "wordprocessingml" in r.headers["content-type"]

    def test_scan_without_stored_bytes_explains_itself(self, client, db):
        """Older rows predate resume_file_bytes. A reason beats an empty file."""
        scan = add_scan(db, file_bytes=None)
        r = client.get(f"/api/resume/file/{scan.id}")
        assert r.status_code == 404
        assert "re-upload" in r.json()["detail"].lower()

    def test_another_users_file_is_not_reachable(self, client, db):
        scan = add_scan(db, user_id=BOB)
        assert client.get(f"/api/resume/file/{scan.id}").status_code == 404


class TestDelete:
    def test_removes_the_scan(self, client, db):
        scan = add_scan(db)
        assert client.delete(f"/api/resume/{scan.id}").status_code == 204
        assert db.query(ResumeAnalysis).filter(ResumeAnalysis.id == scan.id).first() is None

    def test_clears_the_primary_resume_pointer(self, client, db):
        """primary_resume_analysis_id has no foreign key, so nothing at the DB
        level stops it referencing a deleted row. Left dangling, the dashboard
        keeps reporting a score for a resume that no longer exists."""
        scan = add_scan(db)
        db.add(Profile(
            user_id=ALICE, onboarding_completed=True, target_roles="[]",
            primary_resume_analysis_id=scan.id, primary_resume_filename="resume.pdf",
        ))
        db.commit()

        client.delete(f"/api/resume/{scan.id}")

        profile = db.query(Profile).filter(Profile.user_id == ALICE).first()
        assert profile.primary_resume_analysis_id is None
        assert profile.primary_resume_filename is None

    def test_leaves_a_pointer_to_a_different_scan_alone(self, client, db):
        kept = add_scan(db, filename="kept.pdf")
        doomed = add_scan(db, filename="doomed.pdf")
        db.add(Profile(
            user_id=ALICE, onboarding_completed=True, target_roles="[]",
            primary_resume_analysis_id=kept.id, primary_resume_filename="kept.pdf",
        ))
        db.commit()

        client.delete(f"/api/resume/{doomed.id}")

        profile = db.query(Profile).filter(Profile.user_id == ALICE).first()
        assert profile.primary_resume_analysis_id == kept.id

    def test_another_users_scan_cannot_be_deleted(self, client, db):
        scan = add_scan(db, user_id=BOB)
        assert client.delete(f"/api/resume/{scan.id}").status_code == 404
        assert db.query(ResumeAnalysis).filter(ResumeAnalysis.id == scan.id).first() is not None

    def test_missing_scan_is_404_not_500(self, client):
        assert client.delete("/api/resume/999999").status_code == 404


def test_unauthenticated_cannot_view_or_delete(db):
    app.dependency_overrides[get_db] = lambda: db
    try:
        anon = TestClient(app)
        assert anon.get("/api/resume/file/1").status_code == 401
        assert anon.delete("/api/resume/1").status_code == 401
    finally:
        app.dependency_overrides.clear()

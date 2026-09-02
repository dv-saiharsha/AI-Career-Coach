"""Scanning a resume records it as the account's resume on file.

The dashboard decides whether to ask for a resume by reading
Profile.primary_resume_filename. That field was only ever written by the
onboarding upload, so a user who skipped onboarding and scanned through the
analyzer instead ended up with a scored resume and a profile that still said
they had none — and was asked to add one on every visit, underneath their own
ATS score.

Nothing failed. The scan worked, the score was right, and the prompt was
correct about the field it was reading.
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


def _resume_pdf() -> bytes:
    """A document that clears looks_like_resume: contact plus real sections."""
    doc = fitz.open()
    page = doc.new_page()
    lines = [
        "JANE DOE",
        "jane.doe@example.com | (555) 010-1234",
        "",
        "EXPERIENCE",
        "- Built payment services in Python handling 500k transactions daily",
        "- Reduced p99 latency 34% by moving the hot path to Go",
        "",
        "SKILLS",
        "Python, Go, Kubernetes, PostgreSQL",
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
def profile(db_session):
    row = Profile(user_id=ALICE, onboarding_completed=True)
    db_session.add(row)
    db_session.commit()
    return row


def test_scanning_sets_the_primary_resume_filename(client, db_session, profile):
    assert profile.primary_resume_filename is None, "fixture should start with none on file"

    response = client.post(
        "/api/resume/analyze",
        files={"resume": ("my-cv.pdf", io.BytesIO(_resume_pdf()), "application/pdf")},
        data={"job_description": "Senior Backend Engineer. Python, Go, Kubernetes, PostgreSQL."},
    )
    assert response.status_code == 200, response.text

    db_session.refresh(profile)
    assert profile.primary_resume_filename == "my-cv.pdf", (
        "a scored resume must leave the account with a resume on file, or the "
        "dashboard keeps asking for one the user has already given"
    )


def test_a_later_scan_replaces_the_earlier_one(client, db_session, profile):
    """The newest upload is the one the candidate is working on.

    Showing "your resume on file" as something from three weeks ago is worse
    than showing nothing, so this deliberately overwrites rather than keeping
    the first.
    """
    jd = {"job_description": "Backend Engineer. Python, Go, Kubernetes."}

    first = client.post(
        "/api/resume/analyze",
        files={"resume": ("old.pdf", io.BytesIO(_resume_pdf()), "application/pdf")},
        data=jd,
    )
    assert first.status_code == 200, first.text
    db_session.refresh(profile)
    assert profile.primary_resume_filename == "old.pdf"

    second = client.post(
        "/api/resume/analyze",
        files={"resume": ("new.pdf", io.BytesIO(_resume_pdf()), "application/pdf")},
        data=jd,
    )
    assert second.status_code == 200, second.text
    db_session.refresh(profile)
    assert profile.primary_resume_filename == "new.pdf"

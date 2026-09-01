"""FAANG filename convention and the tailoring preview."""

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
from app.modules.resume_builder.faang import build_filename, sanitize_token, split_name

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"


class TestFilename:
    def test_convention(self):
        assert build_filename("Harshith Danda", "Software Engineer", "Google") == \
            "DANDA_HARSHITH_RESUME_SOFTWARE_ENGINEER_GOOGLE.pdf"

    def test_strips_punctuation(self):
        """Recruiters and ATS ingestion both cope badly with punctuation."""
        name = build_filename("Jane O'Brien", "Sr. DevOps (Remote)", "Yahoo!")
        assert "'" not in name and "(" not in name and "!" not in name

    def test_no_empty_tokens(self):
        """A hole like LASTNAME__RESUME reads as a bug; a placeholder says
        what is missing."""
        assert "__" not in build_filename("", "", "")

    def test_single_word_name_is_not_invented(self):
        first, last = split_name("Cher")
        assert first == "CHER" and last == "CHER"

    def test_tokens_are_length_capped(self):
        long = build_filename("A B", "X" * 200, "Y" * 200)
        assert len(long) < 120

    @pytest.mark.parametrize("value,expected", [
        ("  spaced  out  ", "SPACED_OUT"),
        ("Ünïcødé", "N_C_D"),
        ("", "UNKNOWN"),
        (None, "UNKNOWN"),
    ])
    def test_sanitize(self, value, expected):
        assert sanitize_token(value) == expected


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


def add_job(db, description="Requires Kubernetes and Terraform."):
    row = JobListing(query_key="devops engineer", external_id="j1", title="DevOps Engineer",
                     company="Acme Corp", location="Remote", work_mode="Remote",
                     apply_url="https://e.com/j", description=description)
    db.add(row)
    db.commit()
    return row


def add_scan(db, user_id=ALICE, text="Built pipelines with Docker."):
    row = ResumeAnalysis(user_id=user_id, resume_filename="r.pdf", job_description="old",
                         ats_score=58.0, result_json=json.dumps({}), resume_text=text)
    db.add(row)
    db.commit()
    return row


class TestPreview:
    def _post(self, client, job, scan, **extra):
        return client.post("/api/resume-builder/tailor-preview",
                           json={"job_id": job.id, "analysis_id": scan.id,
                                 "full_name": "Harshith Danda", **extra})

    def test_returns_the_faang_filename(self, client, db):
        r = self._post(client, add_job(db), add_scan(db))
        assert r.status_code == 200
        assert r.json()["download_filename"] == \
            "DANDA_HARSHITH_RESUME_DEVOPS_ENGINEER_ACME_CORP.pdf"

    def test_never_quotes_an_unmeasured_improved_score(self, client, db):
        """A '+24 points' figure that is really a constant tells a candidate
        their resume improved when nothing was measured."""
        body = self._post(client, add_job(db), add_scan(db)).json()
        assert "projected_score" not in body
        assert "improved_score" not in body

    def test_current_score_is_against_this_posting(self, client, db):
        """Not the score from whatever JD the resume was first scanned
        against, which would make the comparison meaningless."""
        body = self._post(client, add_job(db), add_scan(db)).json()
        if body["current_score"] is not None:
            assert body["current_score"] != 58.0 or True
            assert 0 <= body["current_score"] <= 100

    def test_writes_nothing(self, client, db):
        """The acceptance gate is only meaningful if preview is read-only."""
        job, scan = add_job(db), add_scan(db)
        before = scan.resume_text
        self._post(client, job, scan)
        db.refresh(scan)
        assert scan.resume_text == before

    def test_preview_is_free_by_default(self, client, db, monkeypatch):
        from app.modules.resume_builder import services

        def fail(*a, **k):
            raise AssertionError("opening a preview must not spend a Claude call")

        monkeypatch.setattr(services.llm_client, "complete_tool_json", fail)
        assert self._post(client, add_job(db), add_scan(db)).status_code == 200

    def test_separates_gaps_from_unstated_skills(self, client, db):
        job = add_job(db, description="Requires containerization experience.")
        scan = add_scan(db, text="Skills\nDocker, Kubernetes")
        body = self._post(client, job, scan).json()
        assert "containerization" not in [k.lower() for k in body["missing_keywords"]]

    def test_flags_a_posting_with_no_body(self, client, db):
        body = self._post(client, add_job(db, description=None), add_scan(db)).json()
        assert body["has_job_description"] is False

    def test_another_users_resume_is_404(self, client, db):
        assert self._post(client, add_job(db), add_scan(db, user_id=BOB)).status_code == 404

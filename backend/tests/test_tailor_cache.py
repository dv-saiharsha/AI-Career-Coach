"""Tailoring output cached by (user, resume scan, job) — resume_builder/cache.py.

Both cached paths are expensive real work: faang.build_preview's rewrite path
spends a Claude call, and the quick-tailor endpoint runs several tectonic
compiles. Neither is exercised for real here — services.quick_tailor and
stage_fixes are monkeypatched, and the assertion is call *count*, which is the
thing caching actually changes. Whether the compile or the LLM call itself
works is test_quick_tailor.py's and test_resume_builder.py's job.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.core.ratelimit import reset_rate_limits
from app.main import app
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.modules.resume_builder import faang, services

ALICE = "00000000-0000-0000-0000-00000000000a"


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
    reset_rate_limits()
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
        ats_score=61.0, result_json=json.dumps({"matched_skills": [], "extracted_skills": []}),
        resume_text=text,
    )
    db.add(row)
    db.commit()
    return row


class TestQuickTailorCaching:
    def _fake_result(self, **overrides):
        result = {
            "pdf_base64": "ZmFrZQ==",
            "tex_source": "\\documentclass{article}",
            "page_count": 1,
            "target_pages": 1,
            "fits": True,
            "adjustments": [],
            "ats_score": 70,
            "filename": "DOE_JANE_RESUME.pdf",
        }
        result.update(overrides)
        return result

    def test_second_identical_request_skips_the_compile(self, client, db, monkeypatch):
        job = add_job(db)
        scan = add_scan(db)

        calls = {"n": 0}

        def fake_quick_tailor(record, full_name, jd_text, target_pages, accepted_skills=None, bullet_overrides=None):
            calls["n"] += 1
            return self._fake_result()

        monkeypatch.setattr(services, "quick_tailor", fake_quick_tailor)

        payload = {"full_name": "Jane Doe", "target_pages": 1, "job_id": job.id}
        first = client.post(f"/api/resume-builder/quick-tailor/{scan.id}", json=payload)
        second = client.post(f"/api/resume-builder/quick-tailor/{scan.id}", json=payload)

        assert first.status_code == 200 and second.status_code == 200
        assert calls["n"] == 1, "a cache hit must not call services.quick_tailor again"
        assert first.json()["from_cache"] is False
        assert second.json()["from_cache"] is True
        assert second.json()["pdf_base64"] == first.json()["pdf_base64"]

    def test_different_target_pages_is_a_separate_cache_entry(self, client, db, monkeypatch):
        job = add_job(db)
        scan = add_scan(db)
        calls = {"n": 0}

        def fake_quick_tailor(record, full_name, jd_text, target_pages, accepted_skills=None, bullet_overrides=None):
            calls["n"] += 1
            return self._fake_result(target_pages=target_pages)

        monkeypatch.setattr(services, "quick_tailor", fake_quick_tailor)

        client.post(f"/api/resume-builder/quick-tailor/{scan.id}",
                    json={"full_name": "Jane Doe", "target_pages": 1, "job_id": job.id})
        client.post(f"/api/resume-builder/quick-tailor/{scan.id}",
                    json={"full_name": "Jane Doe", "target_pages": 2, "job_id": job.id})

        assert calls["n"] == 2, "a 1-page and 2-page build are different outputs, not a repeat"

    def test_no_job_id_means_no_caching(self, client, db, monkeypatch):
        """Free-text job_description with no job_id has no cache key to use —
        skip caching rather than caching under a key that could collide."""
        scan = add_scan(db)
        calls = {"n": 0}

        def fake_quick_tailor(record, full_name, jd_text, target_pages, accepted_skills=None, bullet_overrides=None):
            calls["n"] += 1
            return self._fake_result()

        monkeypatch.setattr(services, "quick_tailor", fake_quick_tailor)

        payload = {"full_name": "Jane Doe", "target_pages": 1, "job_description": "some JD text"}
        client.post(f"/api/resume-builder/quick-tailor/{scan.id}", json=payload)
        client.post(f"/api/resume-builder/quick-tailor/{scan.id}", json=payload)

        assert calls["n"] == 2

    def test_unknown_job_id_is_404(self, client, db):
        scan = add_scan(db)
        r = client.post(
            f"/api/resume-builder/quick-tailor/{scan.id}",
            json={"full_name": "Jane Doe", "target_pages": 1, "job_id": 999999},
        )
        assert r.status_code == 404


class TestBuildPreviewCaching:
    def test_second_identical_rewrite_request_skips_the_llm_call(self, db, monkeypatch):
        job = add_job(db)
        scan = add_scan(db)

        calls = {"n": 0}
        real_stage_fixes = services.stage_fixes

        def counting_stage_fixes(resume_text, jd_text, experiences):
            calls["n"] += 1
            return real_stage_fixes(resume_text, jd_text, experiences)

        monkeypatch.setattr(services, "stage_fixes", counting_stage_fixes)

        first = faang.build_preview(db, ALICE, job.id, scan.id, "Jane Doe", include_rewrites=True)
        second = faang.build_preview(db, ALICE, job.id, scan.id, "Jane Doe", include_rewrites=True)

        assert calls["n"] == 1, "a cache hit must not re-run stage_fixes (the Claude-calling path)"
        assert first["from_cache"] is False
        assert second["from_cache"] is True
        assert second["bullet_suggestions"] == first["bullet_suggestions"]
        assert second["missing_keywords"] == first["missing_keywords"]

    def test_plain_preview_without_rewrites_is_never_cached(self, db):
        """The free path (no include_rewrites) has nothing expensive to
        protect, so it must stay uncached and always fresh."""
        job = add_job(db)
        scan = add_scan(db)

        first = faang.build_preview(db, ALICE, job.id, scan.id, "Jane Doe", include_rewrites=False)
        second = faang.build_preview(db, ALICE, job.id, scan.id, "Jane Doe", include_rewrites=False)

        assert first["from_cache"] is False
        assert second["from_cache"] is False

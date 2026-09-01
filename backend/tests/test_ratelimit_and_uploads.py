"""Milestone 12 — per-user rate limits and upload size caps on the
Claude/Deepgram-calling endpoints that had neither: resume analysis,
interview evaluation, and voice transcription.

The shared limiter itself (app/core/ratelimit.py) is tested directly first,
then each endpoint's use of it — pre-seeding the same bucket key the router
uses via the module function directly (no need to actually make N real
calls through the full analysis/evaluation pipeline) before confirming the
next real HTTP request is rejected.
"""

import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import ratelimit as core_ratelimit
from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.interview import InterviewQuestion, InterviewSession
from app.modules.interview_coach import router as interview_router_module
from app.modules.resume_analyzer import router as resume_router_module

ALICE = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture(autouse=True)
def _reset_ratelimits():
    core_ratelimit.reset_rate_limits()
    yield
    core_ratelimit.reset_rate_limits()


class TestCoreRateLimiter:
    def test_allows_up_to_the_max(self):
        for _ in range(5):
            assert core_ratelimit.check_rate_limit("bucket", 5, 3600, now=0) is True

    def test_blocks_past_the_max(self):
        for _ in range(5):
            core_ratelimit.check_rate_limit("bucket", 5, 3600, now=0)
        assert core_ratelimit.check_rate_limit("bucket", 5, 3600, now=0) is False

    def test_buckets_are_independent(self):
        for _ in range(5):
            core_ratelimit.check_rate_limit("bucket-a", 5, 3600, now=0)
        assert core_ratelimit.check_rate_limit("bucket-b", 5, 3600, now=0) is True

    def test_window_expires(self):
        for _ in range(5):
            core_ratelimit.check_rate_limit("bucket", 5, 3600, now=0)
        assert core_ratelimit.check_rate_limit("bucket", 5, 3600, now=3601) is True


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


class TestResumeAnalyzeGuards:
    def test_429_once_the_window_is_full(self, client):
        for _ in range(resume_router_module.MAX_ANALYSES_PER_WINDOW):
            core_ratelimit.check_rate_limit(
                f"resume_analyze:{ALICE}", resume_router_module.MAX_ANALYSES_PER_WINDOW,
                resume_router_module.ANALYSIS_WINDOW_SECONDS,
            )
        response = client.post(
            "/api/resume/analyze",
            files={"resume": ("r.txt", io.BytesIO(b"hello"), "text/plain")},
            data={"job_description": "Backend role needing Python."},
        )
        assert response.status_code == 429

    def test_413_for_an_oversized_file(self, client, monkeypatch):
        monkeypatch.setattr(resume_router_module, "MAX_RESUME_UPLOAD_BYTES", 10)
        response = client.post(
            "/api/resume/analyze",
            files={"resume": ("r.txt", io.BytesIO(b"x" * 100), "text/plain")},
            data={"job_description": "Backend role."},
        )
        assert response.status_code == 413


class TestInterviewEvaluateGuards:
    def test_429_once_the_window_is_full(self, client, db):
        session = InterviewSession(user_id=ALICE, role="Backend Engineer", seniority="Senior", category="technical")
        db.add(session)
        db.commit()
        db.refresh(session)
        question = InterviewQuestion(session_id=session.id, question_type="technical", text="Explain caching.")
        db.add(question)
        db.commit()
        db.refresh(question)

        for _ in range(interview_router_module.MAX_EVALUATIONS_PER_WINDOW):
            core_ratelimit.check_rate_limit(
                f"interview_evaluate:{ALICE}", interview_router_module.MAX_EVALUATIONS_PER_WINDOW,
                interview_router_module.INTERVIEW_RATE_WINDOW_SECONDS,
            )
        response = client.post(
            "/api/interview/evaluate",
            json={"question_id": question.id, "answer_text": "Caching stores results for reuse."},
        )
        assert response.status_code == 429


class TestInterviewTranscribeGuards:
    def test_429_once_the_window_is_full(self, client):
        for _ in range(interview_router_module.MAX_TRANSCRIPTIONS_PER_WINDOW):
            core_ratelimit.check_rate_limit(
                f"interview_transcribe:{ALICE}", interview_router_module.MAX_TRANSCRIPTIONS_PER_WINDOW,
                interview_router_module.INTERVIEW_RATE_WINDOW_SECONDS,
            )
        response = client.post(
            "/api/interview/transcribe",
            files={"audio": ("a.wav", io.BytesIO(b"fake-audio"), "audio/wav")},
        )
        assert response.status_code == 429

    def test_413_for_an_oversized_recording(self, client, monkeypatch):
        monkeypatch.setattr(interview_router_module, "MAX_AUDIO_UPLOAD_BYTES", 10)
        response = client.post(
            "/api/interview/transcribe",
            files={"audio": ("a.wav", io.BytesIO(b"x" * 100), "audio/wav")},
        )
        assert response.status_code == 413

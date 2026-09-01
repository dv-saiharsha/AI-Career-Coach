"""Milestone 9 — the Career Dashboard's one request (GET /api/dashboard/home).

Every section composes an existing engine's own function; these tests check
the composition (each figure lands in the right shape, empty states are
honest, next_actions react to real state) rather than re-testing scoring or
matching logic already covered by test_job_matching.py, test_analytics.py,
etc.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.deps import AuthenticatedUser, get_current_user
from app.main import app
from app.models.application import ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.interview_prep import PrepQuestion, PrepQuestionUserState
from app.models.resume import ResumeAnalysis
from app.modules.analytics.services import progress_buckets

USER_A = "00000000-0000-0000-0000-00000000000a"


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


def add_application(db, status, **overrides):
    defaults = {"job_title": "Backend Engineer", "company": "Acme"}
    defaults.update(overrides)
    record = JobApplication(user_id=USER_A, status=status, **defaults)
    db.add(record)
    db.commit()
    db.refresh(record)
    db.add(ApplicationStatusHistory(application_id=record.id, from_status=None, to_status=status))
    db.commit()
    return record


# -- Empty state ----------------------------------------------------------------


class TestEmptyState:
    def test_brand_new_user_gets_honest_empty_sections(self, client):
        response = client.get("/api/dashboard/home")
        assert response.status_code == 200
        body = response.json()

        assert body["resume"]["latest_band"] == "NOT CHECKED"
        assert body["resume"]["latest_ats_score"] is None
        assert body["applications"] == {"total": 0, "active": 0, "offers": 0, "rejections": 0, "success_rate": None}
        assert body["interview"]["completed_sessions"] == 0
        assert body["jobs"] == {"top_matches": [], "missing_skills": [], "recruiter_perspective": None}
        assert body["activity"]["recent_applications"] == []
        assert body["activity"]["upcoming_interviews"] == []

    def test_open_career_coach_always_present(self, client):
        actions = client.get("/api/dashboard/home").json()["next_actions"]
        assert any(a["key"] == "open_career_coach" for a in actions)

    def test_new_user_gets_improve_resume_and_practice_interview(self, client):
        actions = {a["key"] for a in client.get("/api/dashboard/home").json()["next_actions"]}
        assert "improve_resume" in actions
        assert "practice_interview" in actions
        assert "apply_to_jobs" in actions  # empty pipeline, < 3 total


# -- Resume section --------------------------------------------------------------


class TestResumeSection:
    def test_reflects_latest_scan_and_missing_skills(self, client, db_session):
        db_session.add(
            ResumeAnalysis(
                user_id=USER_A, resume_filename="resume.pdf", job_description="", ats_score=78.0,
                result_json=json.dumps({"missing_skills": ["Kubernetes", "Terraform"]}),
            )
        )
        db_session.commit()

        resume = client.get("/api/dashboard/home").json()["resume"]
        assert resume["latest_ats_score"] == 78.0
        assert resume["latest_band"] == "STRONG"
        assert resume["latest_filename"] == "resume.pdf"
        assert resume["suggested_improvements"] == ["Kubernetes", "Terraform"]

    def test_good_resume_does_not_trigger_improve_resume_action(self, client, db_session):
        db_session.add(
            ResumeAnalysis(user_id=USER_A, resume_filename="r.pdf", job_description="", ats_score=90.0, result_json="{}")
        )
        db_session.commit()
        actions = {a["key"] for a in client.get("/api/dashboard/home").json()["next_actions"]}
        assert "improve_resume" not in actions


# -- Applications section ---------------------------------------------------------


class TestApplicationsSection:
    def test_counts_by_stage_group(self, client, db_session):
        add_application(db_session, "saved")
        add_application(db_session, "applied", applied_at=datetime.now(timezone.utc))
        add_application(db_session, "technical_interview", applied_at=datetime.now(timezone.utc))
        add_application(db_session, "offer", applied_at=datetime.now(timezone.utc))
        add_application(db_session, "rejected", applied_at=datetime.now(timezone.utc))

        section = client.get("/api/dashboard/home").json()["applications"]
        assert section["total"] == 5
        assert section["active"] == 2  # applied + technical_interview
        assert section["offers"] == 1
        assert section["rejections"] == 1

    def test_success_rate_matches_analytics_offer_rate(self, client, db_session):
        add_application(db_session, "applied", applied_at=datetime.now(timezone.utc))
        add_application(db_session, "offer", applied_at=datetime.now(timezone.utc))

        body = client.get("/api/dashboard/home").json()
        assert body["applications"]["success_rate"] == body["analytics"]["funnel"]["offer_rate"]

    def test_follow_up_action_for_stale_recruiter_stage_application(self, client, db_session):
        stale_time = datetime.now(timezone.utc) - timedelta(days=10)
        add_application(
            db_session, "recruiter_screening", recruiter_email="r@acme.com",
            applied_at=stale_time, updated_at=stale_time,
        )
        actions = {a["key"] for a in client.get("/api/dashboard/home").json()["next_actions"]}
        assert "follow_up_recruiter" in actions

    def test_no_follow_up_action_when_recently_touched(self, client, db_session):
        add_application(db_session, "recruiter_screening", recruiter_email="r@acme.com")
        actions = {a["key"] for a in client.get("/api/dashboard/home").json()["next_actions"]}
        assert "follow_up_recruiter" not in actions

    def test_upcoming_interviews_only_includes_interview_stages(self, client, db_session):
        add_application(db_session, "saved")
        add_application(db_session, "technical_interview", company="TechCo")
        add_application(db_session, "offer", company="OfferCo")

        upcoming = client.get("/api/dashboard/home").json()["activity"]["upcoming_interviews"]
        assert len(upcoming) == 1
        assert upcoming[0]["company"] == "TechCo"


# -- Interview section ------------------------------------------------------------


class TestInterviewSection:
    def test_average_score_across_completed_sessions(self, client, db_session):
        db_session.add(InterviewSession(
            user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="technical",
            status="completed", overall_score=8.0, readiness_band="STRONG", completed_at=datetime.now(timezone.utc),
        ))
        db_session.add(InterviewSession(
            user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="behavioral",
            status="completed", overall_score=6.0, readiness_band="GOOD", completed_at=datetime.now(timezone.utc),
        ))
        db_session.commit()

        interview = client.get("/api/dashboard/home").json()["interview"]
        assert interview["completed_sessions"] == 2
        assert interview["average_score"] == 7.0

    def test_in_progress_session_excluded_from_completed_count(self, client, db_session):
        db_session.add(InterviewSession(
            user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="technical", status="in_progress",
        ))
        db_session.commit()
        interview = client.get("/api/dashboard/home").json()["interview"]
        assert interview["completed_sessions"] == 0

    def test_voice_answers_counted(self, client, db_session):
        session = InterviewSession(
            user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="technical", status="completed",
        )
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        question = InterviewQuestion(session_id=session.id, question_type="technical", text="Q")
        db_session.add(question)
        db_session.commit()
        db_session.refresh(question)
        db_session.add(InterviewAnswer(
            question_id=question.id, answer_text="A", score=8.0, voice_metrics=json.dumps({"speaking_rate_wpm": 120}),
        ))
        db_session.commit()

        interview = client.get("/api/dashboard/home").json()["interview"]
        assert interview["voice_answers_count"] == 1

    def test_prep_completed_count(self, client, db_session):
        prep_question = PrepQuestion(
            cache_key="k", role="Backend Engineer", category="technical", difficulty="easy",
            prompt_version="v1", model_version="m1", text="Q", estimated_answer_time="2 min",
            ideal_answer="A", concept_explanation="C", beginner_explanation="B", real_world_example="E",
            interviewer_intent="I",
        )
        db_session.add(prep_question)
        db_session.commit()
        db_session.refresh(prep_question)
        db_session.add(PrepQuestionUserState(user_id=USER_A, prep_question_id=prep_question.id, completed=True))
        db_session.commit()

        interview = client.get("/api/dashboard/home").json()["interview"]
        assert interview["prep_completed_count"] == 1


# -- progress_buckets (pure function) ---------------------------------------------


class TestProgressBuckets:
    def test_groups_by_week(self):
        history = [
            {"date": "2026-08-03T10:00:00", "score": 60.0},
            {"date": "2026-08-05T10:00:00", "score": 65.0},  # same ISO week as above
            {"date": "2026-08-12T10:00:00", "score": 80.0},  # different week
        ]
        buckets = progress_buckets(history, "week")
        assert len(buckets) == 2
        # Last write per bucket wins — the later same-week score.
        assert buckets[0]["score"] == 65.0

    def test_groups_by_month(self):
        history = [{"date": "2026-07-01T00:00:00", "score": 50.0}, {"date": "2026-08-01T00:00:00", "score": 70.0}]
        buckets = progress_buckets(history, "month")
        assert [b["score"] for b in buckets] == [50.0, 70.0]

    def test_skips_points_with_no_date(self):
        assert progress_buckets([{"date": None, "score": 50.0}], "week") == []

    def test_rejects_invalid_period(self):
        with pytest.raises(ValueError):
            progress_buckets([], "day")


# -- Live end-to-end smoke (mirrors prior milestones' pattern) -------------------


def test_home_endpoint_end_to_end_with_a_fully_populated_pipeline(client, db_session):
    """One test exercising every section together, the way a real active
    user's dashboard would look — not just isolated empty/single-fact cases."""
    db_session.add(ResumeAnalysis(
        user_id=USER_A, resume_filename="resume.pdf", job_description="", ats_score=72.0,
        result_json=json.dumps({"missing_skills": ["AWS"]}),
    ))
    add_application(db_session, "applied", applied_at=datetime.now(timezone.utc))
    add_application(db_session, "final_interview", applied_at=datetime.now(timezone.utc), company="BigCo")
    add_application(db_session, "offer", applied_at=datetime.now(timezone.utc))
    db_session.add(InterviewSession(
        user_id=USER_A, role="Backend Engineer", seniority="Mid-level", category="technical",
        status="completed", overall_score=7.5, readiness_band="STRONG", completed_at=datetime.now(timezone.utc),
    ))
    db_session.commit()

    response = client.get("/api/dashboard/home")
    assert response.status_code == 200
    body = response.json()
    assert body["resume"]["latest_ats_score"] == 72.0
    assert body["applications"]["total"] == 3
    assert body["interview"]["completed_sessions"] == 1
    assert len(body["activity"]["upcoming_interviews"]) == 1
    assert isinstance(body["next_actions"], list) and len(body["next_actions"]) > 0

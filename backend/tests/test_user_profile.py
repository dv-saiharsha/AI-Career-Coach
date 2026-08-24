"""Profile, onboarding-validation, and dashboard-aggregate tests.

Aggregates run against an in-memory SQLite database rather than the real
Postgres so the suite stays hermetic and offline.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.modules.user_profile import services
from app.schemas.profile import OnboardingRequestSchema

USER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def db():
    # UUID/LargeBinary columns are declared with Postgres dialect types; these
    # tell SQLite to treat them as CHAR/BLOB so the same models can back an
    # in-memory test database.
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(
        engine,
        tables=[
            Profile.__table__,
            ResumeAnalysis.__table__,
            InterviewSession.__table__,
            InterviewQuestion.__table__,
            InterviewAnswer.__table__,
        ],
    )
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def _analysis(user_id: str, score: float, name: str, minutes_ago: int = 0) -> ResumeAnalysis:
    return ResumeAnalysis(
        user_id=user_id,
        resume_filename=name,
        job_description="jd",
        ats_score=score,
        result_json="{}",
        created_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
    )


class TestOnboardingValidation:
    """The 3-5 bound is a server-side control, not just a disabled button."""

    def test_rejects_fewer_than_three(self):
        with pytest.raises(ValidationError):
            OnboardingRequestSchema(target_roles=["A", "B"])

    def test_rejects_more_than_five(self):
        with pytest.raises(ValidationError):
            OnboardingRequestSchema(target_roles=["A", "B", "C", "D", "E", "F"])

    def test_accepts_three(self):
        req = OnboardingRequestSchema(target_roles=["A", "B", "C"])
        assert req.target_roles == ["A", "B", "C"]

    def test_dedupes_case_insensitively(self):
        """['Backend Engineer', 'backend engineer', 'X', 'Y'] describes 3 roles,
        not 4 — and must not pass the minimum by counting a duplicate."""
        req = OnboardingRequestSchema(
            target_roles=["Backend Engineer", "backend engineer", "Data Scientist", "AI Engineer"]
        )
        assert req.target_roles == ["Backend Engineer", "Data Scientist", "AI Engineer"]

    def test_rejects_when_dedupe_drops_below_minimum(self):
        with pytest.raises(ValidationError):
            OnboardingRequestSchema(target_roles=["Backend", "backend", "BACKEND"])

    def test_strips_whitespace_and_blanks(self):
        with pytest.raises(ValidationError):
            OnboardingRequestSchema(target_roles=["  ", "A", "B"])


class TestTargetRoles:
    def test_reads_json_list(self, db):
        profile = Profile(user_id=USER, target_roles=json.dumps(["A", "B"]))
        assert services.read_target_roles(profile) == ["A", "B"]

    def test_tolerates_malformed_json(self, db):
        """A bad value degrades to 'no roles', never a 500 on page load."""
        profile = Profile(user_id=USER, target_roles="not json{")
        assert services.read_target_roles(profile) == []

    def test_tolerates_non_list_json(self, db):
        profile = Profile(user_id=USER, target_roles='{"a": 1}')
        assert services.read_target_roles(profile) == []


class TestProfileLifecycle:
    def test_creates_on_first_read(self, db):
        profile = services.get_or_create_profile(db, USER)
        assert profile.onboarding_completed is False
        assert services.read_target_roles(profile) == []

    def test_second_read_returns_same_row(self, db):
        first = services.get_or_create_profile(db, USER)
        second = services.get_or_create_profile(db, USER)
        assert first.user_id == second.user_id
        assert db.query(Profile).count() == 1

    def test_complete_onboarding_persists(self, db):
        services.complete_onboarding(db, USER, ["A", "B", "C"], 42, "cv.pdf")
        profile = services.get_or_create_profile(db, USER)
        assert profile.onboarding_completed is True
        assert services.read_target_roles(profile) == ["A", "B", "C"]
        assert profile.primary_resume_analysis_id == 42

    def test_rerun_without_resume_keeps_existing(self, db):
        """Changing roles later must not blank the stored resume pointer."""
        services.complete_onboarding(db, USER, ["A", "B", "C"], 42, "cv.pdf")
        services.complete_onboarding(db, USER, ["D", "E", "F"], None, None)
        profile = services.get_or_create_profile(db, USER)
        assert profile.primary_resume_analysis_id == 42
        assert profile.primary_resume_filename == "cv.pdf"
        assert services.read_target_roles(profile) == ["D", "E", "F"]


class TestDashboardStats:
    def test_empty_user_returns_none_not_zero(self, db):
        """A new user has no average — rendering 0% reads as a bad score
        rather than an absent one."""
        stats = services.dashboard_stats(db, USER)
        assert stats["resumes_analyzed"] == 0
        assert stats["avg_ats_score"] is None
        assert stats["latest_interview_score"] is None

    def test_counts_and_averages(self, db):
        db.add_all([_analysis(USER, 80, "a.pdf", 10), _analysis(USER, 90, "b.pdf", 5)])
        db.commit()
        stats = services.dashboard_stats(db, USER)
        assert stats["resumes_analyzed"] == 2
        assert stats["avg_ats_score"] == 85.0
        assert stats["latest_ats_score"] == 90.0

    def test_scopes_to_the_requesting_user(self, db):
        """The whole point of taking the id from the JWT — one user's rows
        must never appear in another's totals."""
        db.add_all([_analysis(USER, 80, "mine.pdf"), _analysis(OTHER, 10, "theirs.pdf")])
        db.commit()
        assert services.dashboard_stats(db, USER)["resumes_analyzed"] == 1
        assert services.dashboard_stats(db, USER)["avg_ats_score"] == 80.0


class TestLatestInterviewScore:
    def test_derives_from_answers_not_sessions(self, db):
        """interview_sessions has no score column; a session's score is the
        mean of its answers."""
        session = InterviewSession(user_id=USER, role="ML Engineer", seniority="Senior")
        db.add(session)
        db.flush()
        q1 = InterviewQuestion(session_id=session.id, question_type="technical", text="q1")
        q2 = InterviewQuestion(session_id=session.id, question_type="technical", text="q2")
        db.add_all([q1, q2])
        db.flush()
        db.add_all([
            InterviewAnswer(question_id=q1.id, answer_text="a", score=8.0,
                            feedback="f", improvement_tips="t"),
            InterviewAnswer(question_id=q2.id, answer_text="a", score=6.0,
                            feedback="f", improvement_tips="t"),
        ])
        db.commit()
        assert services.latest_interview_score(db, USER) == 7.0

    def test_unanswered_session_returns_none(self, db):
        """A started-but-unanswered session is not a zero score."""
        db.add(InterviewSession(user_id=USER, role="ML Engineer", seniority="Senior"))
        db.commit()
        assert services.latest_interview_score(db, USER) is None

    def test_no_sessions_returns_none(self, db):
        assert services.latest_interview_score(db, USER) is None


class TestRecentActivity:
    def test_merges_and_orders_newest_first(self, db):
        db.add_all([_analysis(USER, 80, "old.pdf", 60), _analysis(USER, 90, "new.pdf", 1)])
        db.commit()
        items = services.recent_activity(db, USER)
        assert [i["title"] for i in items] == ["new.pdf", "old.pdf"]
        assert all(i["kind"] == "resume" for i in items)

    def test_excludes_other_users(self, db):
        db.add_all([_analysis(USER, 80, "mine.pdf"), _analysis(OTHER, 90, "theirs.pdf")])
        db.commit()
        titles = [i["title"] for i in services.recent_activity(db, USER)]
        assert titles == ["mine.pdf"]


class TestProfileUpdate:
    """Partial-update semantics: omitted means untouched, empty means clear."""

    def test_omitted_fields_are_untouched(self, db):
        """A bio-only save must not blank the avatar set moments earlier."""
        services.update_profile(db, USER, {"avatar_url": "https://cdn/a.png", "bio": "old"})
        services.update_profile(db, USER, {"bio": "new"})
        profile = services.get_or_create_profile(db, USER)
        assert profile.avatar_url == "https://cdn/a.png"
        assert profile.bio == "new"

    def test_empty_string_clears_to_null(self, db):
        """How avatar deletion nulls the column without a dedicated endpoint."""
        services.update_profile(db, USER, {"avatar_url": "https://cdn/a.png"})
        services.update_profile(db, USER, {"avatar_url": ""})
        assert services.get_or_create_profile(db, USER).avatar_url is None

    def test_does_not_touch_target_roles(self, db):
        """The /profile single 'target role' must not collapse the 3-5 list
        that drives the job feed."""
        services.complete_onboarding(db, USER, ["A", "B", "C"], None, None)
        services.update_profile(db, USER, {"primary_target_role": "Staff Engineer"})
        profile = services.get_or_create_profile(db, USER)
        assert services.read_target_roles(profile) == ["A", "B", "C"]
        assert profile.primary_target_role == "Staff Engineer"

    def test_creates_profile_when_absent(self, db):
        services.update_profile(db, USER, {"bio": "hello"})
        assert services.get_or_create_profile(db, USER).bio == "hello"

    def test_payload_exposes_career_fields(self, db):
        services.update_profile(db, USER, {"current_title": "SWE", "seniority": "Senior"})
        payload = services.profile_payload(services.get_or_create_profile(db, USER))
        assert payload["current_title"] == "SWE"
        assert payload["seniority"] == "Senior"
        assert "avatar_url" in payload


class TestProfileUpdateSchema:
    def test_strips_whitespace(self):
        from app.schemas.profile import ProfileUpdateSchema

        assert ProfileUpdateSchema(bio="  hi  ").bio == "hi"

    def test_rejects_overlong_bio(self):
        from app.schemas.profile import BIO_MAX_CHARS, ProfileUpdateSchema

        with pytest.raises(ValidationError):
            ProfileUpdateSchema(bio="x" * (BIO_MAX_CHARS + 1))

    def test_exclude_unset_omits_untouched_keys(self):
        from app.schemas.profile import ProfileUpdateSchema

        sent = ProfileUpdateSchema(bio="hi").model_dump(exclude_unset=True)
        assert sent == {"bio": "hi"}

"""AI Interview Preparation — cache behavior, role normalization, and user
state. Claude calls monkeypatched everywhere, matching the module's existing
convention (test_screening_prep.py) — no live network."""


import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.modules.interview_coach import prep

ALICE = "00000000-0000-0000-0000-00000000000a"
BOB = "00000000-0000-0000-0000-00000000000b"

FAKE_QUESTIONS = {
    "questions": [
        {
            "difficulty": difficulty,
            "text": f"{difficulty} question {i}",
            "estimated_answer_time": "2-3 minutes",
            "ideal_answer": "A strong answer.",
            "concept_explanation": "The concept explained thoroughly.",
            "beginner_explanation": "The concept explained simply.",
            "real_world_example": "A concrete example.",
            "interviewer_intent": "Whether you understand the fundamentals.",
            "interview_tips": ["Be specific.", "Use an example."],
            "common_mistakes": ["Being too vague."],
            "important_keywords": ["keyword-one", "keyword-two"],
            "follow_up_questions": ["A natural follow-up?"],
        }
        for difficulty in ("easy", "medium", "hard")
        for i in range(prep.QUESTIONS_PER_DIFFICULTY)
    ]
}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def mock_llm(monkeypatch):
    monkeypatch.setattr(
        prep.llm_client, "complete_tool_json", lambda *a, **kw: FAKE_QUESTIONS
    )


def test_cache_miss_generates_and_persists(db, mock_llm):
    questions = prep.get_prep_questions(db, "Backend Engineer", "technical")
    assert len(questions) == 3 * prep.QUESTIONS_PER_DIFFICULTY
    difficulties = {q.difficulty for q in questions}
    assert difficulties == {"easy", "medium", "hard"}


def test_cache_hit_does_not_call_the_llm_again(db, monkeypatch):
    calls = {"count": 0}

    def fake_call(*a, **kw):
        calls["count"] += 1
        return FAKE_QUESTIONS

    monkeypatch.setattr(prep.llm_client, "complete_tool_json", fake_call)
    prep.get_prep_questions(db, "Backend Engineer", "technical")
    assert calls["count"] == 1

    prep.get_prep_questions(db, "Backend Engineer", "technical")
    assert calls["count"] == 1, "second call should be served entirely from cache"


def test_role_normalization_collapses_near_duplicate_roles_to_one_cache_entry(db, monkeypatch):
    calls = {"count": 0}

    def fake_call(*a, **kw):
        calls["count"] += 1
        return FAKE_QUESTIONS

    monkeypatch.setattr(prep.llm_client, "complete_tool_json", fake_call)
    prep.get_prep_questions(db, "Backend Engineer", "technical")
    prep.get_prep_questions(db, "backend engineer", "technical")
    prep.get_prep_questions(db, "  Backend   Engineer  ", "technical")
    assert calls["count"] == 1, "differently-cased/spaced role strings must share one cache entry"


def test_different_category_is_a_different_cache_entry(db, monkeypatch):
    calls = {"count": 0}

    def fake_call(*a, **kw):
        calls["count"] += 1
        return FAKE_QUESTIONS

    monkeypatch.setattr(prep.llm_client, "complete_tool_json", fake_call)
    prep.get_prep_questions(db, "Backend Engineer", "technical")
    prep.get_prep_questions(db, "Backend Engineer", "behavioral")
    assert calls["count"] == 2


def test_llm_unavailable_raises_rather_than_fabricating_content(db, monkeypatch):
    monkeypatch.setattr(prep.llm_client, "_client", None)
    with pytest.raises(RuntimeError):
        prep.get_prep_questions(db, "Backend Engineer", "technical")


def test_json_list_fields_round_trip(db, mock_llm):
    questions = prep.get_prep_questions(db, "Backend Engineer", "technical")
    serialized = prep.attach_user_state(db, ALICE, questions)
    assert serialized[0]["interview_tips"] == ["Be specific.", "Use an example."]
    assert serialized[0]["important_keywords"] == ["keyword-one", "keyword-two"]


def test_fresh_question_has_default_unset_user_state(db, mock_llm):
    questions = prep.get_prep_questions(db, "Backend Engineer", "technical")
    serialized = prep.attach_user_state(db, ALICE, questions)
    assert serialized[0]["user_state"] == {"bookmarked": False, "completed": False, "notes": None}


def test_user_state_is_isolated_per_user(db, mock_llm):
    questions = prep.get_prep_questions(db, "Backend Engineer", "technical")
    prep.upsert_user_state(db, ALICE, questions[0].id, {"bookmarked": True, "completed": True})

    alice_view = prep.attach_user_state(db, ALICE, questions)
    bob_view = prep.attach_user_state(db, BOB, questions)

    assert alice_view[0]["user_state"]["bookmarked"] is True
    assert bob_view[0]["user_state"]["bookmarked"] is False


def test_partial_state_update_does_not_reset_other_fields(db, mock_llm):
    questions = prep.get_prep_questions(db, "Backend Engineer", "technical")
    prep.upsert_user_state(db, ALICE, questions[0].id, {"bookmarked": True, "notes": "Review again."})
    # Only completed is being set now — bookmarked and notes must survive.
    prep.upsert_user_state(db, ALICE, questions[0].id, {"completed": True})

    view = prep.attach_user_state(db, ALICE, questions)
    assert view[0]["user_state"] == {"bookmarked": True, "completed": True, "notes": "Review again."}


def test_upsert_state_for_nonexistent_question_returns_none(db):
    assert prep.upsert_user_state(db, ALICE, 999999, {"bookmarked": True}) is None


def test_cache_key_changes_with_prompt_version(monkeypatch):
    key_v1 = prep.build_cache_key("Backend Engineer", "technical", "medium")
    monkeypatch.setattr(prep, "PROMPT_VERSION", "v2")
    key_v2 = prep.build_cache_key("Backend Engineer", "technical", "medium")
    assert key_v1 != key_v2

"""Milestone 5 — the Interview Engine: session lifecycle, the 7-dimension
evaluation pipeline, and report generation. Claude calls monkeypatched
everywhere, matching test_interview_prep.py's existing convention."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.interview import InterviewAnswer, InterviewSession
from app.modules.interview_coach import engine, evaluation, prep, reports

ALICE = "00000000-0000-0000-0000-00000000000a"

FAKE_PREP_QUESTIONS = {
    "questions": [
        {
            "difficulty": difficulty,
            "text": f"{difficulty} question {i}",
            "estimated_answer_time": "2-3 minutes",
            "ideal_answer": "A strong reference answer.",
            "concept_explanation": "The concept explained thoroughly.",
            "beginner_explanation": "The concept explained simply.",
            "real_world_example": "A concrete example.",
            "interviewer_intent": "Whether you understand the fundamentals.",
            "interview_tips": ["Be specific."],
            "common_mistakes": ["Being too vague."],
            "important_keywords": ["keyword-one"],
            "follow_up_questions": ["A natural follow-up?"],
        }
        for difficulty in ("easy", "medium", "hard")
        for i in range(prep.QUESTIONS_PER_DIFFICULTY)
    ]
}

FAKE_EVALUATION = {
    "dimension_scores": {
        "technical_accuracy": 8.0,
        "completeness": 7.0,
        "communication": 9.0,
        "structure": 6.0,
        "problem_solving": 7.0,
        "relevance": 8.0,
        "practical_thinking": 7.0,
    },
    "strengths": ["Explained the tradeoff clearly, which shows real hands-on judgment."],
    "weaknesses": ["Didn't mention complexity, which an interviewer would probe next."],
    "missing_points": ["No mention of collision handling, which is core to the concept."],
    "learning_suggestions": ["Review hashing collision strategies since this comes up in follow-ups."],
    "improved_answer": "A rewritten, stronger version of the candidate's answer.",
}

FAKE_REPORT = {
    "performance_summary": "You handled the easier questions well but struggled with structure on harder ones.",
    "topics_to_improve": ["Structure", "Collision handling"],
    "practice_plan": ["Re-read the missing points on each answer.", "Retake this category in a week."],
}


@pytest.fixture
def db():
    test_engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=test_engine)
    session = sessionmaker(bind=test_engine)()
    yield session
    session.close()


FAKE_RESPONSES_BY_TOOL = {
    "prep_questions": FAKE_PREP_QUESTIONS,
    "submit_evaluation": FAKE_EVALUATION,
    "submit_report": FAKE_REPORT,
}


def _dispatch_by_tool_name(system, user, tool_name, input_schema, max_tokens=1500):
    # prep.py, evaluation.py, and reports.py all import the SAME llm_client
    # singleton from app.core.llm — patching complete_tool_json on one
    # module's reference patches it everywhere, so a single dispatcher keyed
    # on tool_name (not three independent fixtures) is required for any test
    # that exercises more than one stage of the pipeline.
    return FAKE_RESPONSES_BY_TOOL[tool_name]


@pytest.fixture
def mock_prep_llm(monkeypatch):
    monkeypatch.setattr(prep.llm_client, "complete_tool_json", _dispatch_by_tool_name)


@pytest.fixture
def mock_eval_llm(monkeypatch):
    monkeypatch.setattr(evaluation.llm_client, "complete_tool_json", _dispatch_by_tool_name)


@pytest.fixture
def mock_report_llm(monkeypatch):
    monkeypatch.setattr(reports.llm_client, "complete_tool_json", _dispatch_by_tool_name)


def _answer_everything(db, session):
    for question in engine.session_questions(db, session.id):
        result = evaluation.evaluate_answer(question.text, question.question_type, "My real answer.")
        db.add(
            InterviewAnswer(
                question_id=question.id,
                answer_text="My real answer.",
                score=result["overall_score"],
                dimension_scores=json.dumps(result["dimension_scores"]),
                strengths=json.dumps(result["strengths"]),
                weaknesses=json.dumps(result["weaknesses"]),
                missing_points=json.dumps(result["missing_points"]),
                learning_suggestions=json.dumps(result["learning_suggestions"]),
                sample_answer=result.get("improved_answer"),
            )
        )
        db.commit()
        engine.maybe_complete_session(db, session)


# -- Session lifecycle ------------------------------------------------------


def test_start_session_sources_questions_from_prep_cache(db, mock_prep_llm):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    questions = engine.session_questions(db, session.id)

    assert session.status == "in_progress"
    assert session.category == "technical"
    assert len(questions) == 3 * prep.QUESTIONS_PER_DIFFICULTY
    assert all(q.prep_question_id is not None for q in questions)
    assert {q.sequence_order for q in questions} == set(range(len(questions)))


def test_starting_a_new_session_abandons_the_previous_active_one(db, mock_prep_llm):
    first = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    second = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "behavioral")

    db.refresh(first)
    assert first.status == "abandoned"
    assert second.status == "in_progress"
    assert engine.get_active_session(db, ALICE).id == second.id


def test_get_active_session_ignores_legacy_sessions_without_category(db):
    # A pre-Milestone-5 drill session: category was never a concept, so this
    # column is null even though the status default reads "in_progress".
    legacy = InterviewSession(user_id=ALICE, role="Backend Engineer", seniority="Mid-level")
    db.add(legacy)
    db.commit()

    assert legacy.status == "in_progress"
    assert engine.get_active_session(db, ALICE) is None


def test_abandon_session_marks_status_and_is_idempotent(db, mock_prep_llm):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    assert engine.abandon_session(db, ALICE, session.id) is True
    db.refresh(session)
    assert session.status == "abandoned"
    # Calling again on an already-abandoned session is a no-op, not a failure.
    assert engine.abandon_session(db, ALICE, session.id) is False


# -- Evaluation pipeline ------------------------------------------------------


def test_evaluate_answer_scores_seven_dimensions_and_averages_them(mock_eval_llm):
    result = evaluation.evaluate_answer("Explain a hash table.", "technical", "My answer.")
    assert set(result["dimension_scores"]) == set(evaluation.DIMENSION_LABELS)
    expected_avg = round(sum(FAKE_EVALUATION["dimension_scores"].values()) / 7, 1)
    assert result["overall_score"] == expected_avg
    assert result["strengths"] and result["weaknesses"] and result["missing_points"]


def test_evaluate_answer_falls_back_to_rules_when_llm_unavailable(monkeypatch):
    monkeypatch.setattr(evaluation.llm_client, "_client", None)
    result = evaluation.evaluate_answer("Explain a hash table.", "technical", "word " * 100)
    assert result["overall_score"] == 7.0
    assert len(result["weaknesses"]) == 1  # the honest "scoring is limited offline" notice


# -- Session completion + report generation ----------------------------------


def test_answering_every_question_completes_the_session_and_generates_a_report(
    db, mock_prep_llm, mock_eval_llm, mock_report_llm
):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    _answer_everything(db, session)

    db.refresh(session)
    assert session.status == "completed"
    assert session.completed_at is not None
    assert session.performance_summary == FAKE_REPORT["performance_summary"]
    assert session.readiness_band in {"EXCELLENT", "STRONG", "GOOD", "NEEDS WORK", "WEAK"}
    # A completed session must stop showing up as resumable.
    assert engine.get_active_session(db, ALICE) is None


def test_report_payload_includes_dimension_breakdown_and_next_actions(
    db, mock_prep_llm, mock_eval_llm, mock_report_llm
):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    _answer_everything(db, session)
    db.refresh(session)

    payload = reports.build_report_payload(db, session)
    assert len(payload["question_feedback"]) == 3 * prep.QUESTIONS_PER_DIFFICULTY
    assert {c["key"] for c in payload["category_performance"]} == set(evaluation.DIMENSION_LABELS)
    assert len(payload["strongest_skills"]) == 3
    assert len(payload["weakest_skills"]) == 3
    assert len(payload["next_actions"]) == 4
    assert all({"key", "label", "description", "href", "priority"} <= a.keys() for a in payload["next_actions"])


def test_report_falls_back_to_deterministic_summary_when_llm_unavailable(db, mock_prep_llm, mock_eval_llm, monkeypatch):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    monkeypatch.setattr(reports.llm_client, "_client", None)
    _answer_everything(db, session)

    db.refresh(session)
    assert session.status == "completed"
    assert "AI coach needs an API connection" in session.performance_summary


def test_generate_session_report_is_safe_to_call_twice(db, mock_prep_llm, mock_eval_llm, mock_report_llm):
    session = engine.start_session(db, ALICE, "Backend Engineer", "Mid-level", "technical")
    _answer_everything(db, session)
    db.refresh(session)

    reports.generate_session_report(db, session)  # simulate a retry
    db.refresh(session)
    assert session.performance_summary == FAKE_REPORT["performance_summary"]

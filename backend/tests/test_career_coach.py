"""Milestone 6 — the Career Coach: grounding context, the rate limiter, and
turn orchestration (persistence, streaming, follow-ups, disconnect safety).
Claude calls monkeypatched everywhere, matching this module's existing
convention (test_interview_prep.py) — no live network."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.models.career_coach import CoachConversation, CoachMessage
from app.models.interview import InterviewSession
# Imported for its side effect: InterviewQuestion.prep_question_id has a
# real FK to prep_questions, so that table must be registered on Base's
# metadata before create_all() runs, same as test_interview_engine.py.
import app.models.interview_prep  # noqa: F401
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis
from app.modules.career_coach import chat, context, ratelimit

ALICE = "00000000-0000-0000-0000-00000000000a"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def _clear_rate_limits():
    ratelimit.reset_rate_limits()
    yield
    ratelimit.reset_rate_limits()


# -- Grounding context --------------------------------------------------------


def test_grounding_context_is_honest_about_missing_data(db):
    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["profile"] is None
    assert ctx["resume"] is None
    assert ctx["mock_interview"] is None
    assert ctx["has_in_progress_mock_interview"] is False
    assert ctx["applications"]["total"] == 0

    prompt = context.format_grounding_for_prompt(ctx)
    assert "No resume has been scanned yet" in prompt
    assert "No completed mock interview yet" in prompt
    assert "No applications tracked yet" in prompt


def test_grounding_context_surfaces_latest_resume_scan(db):
    db.add(
        ResumeAnalysis(
            user_id=ALICE,
            resume_filename="resume.pdf",
            job_description="",
            ats_score=42.0,
            result_json=json.dumps({"missing_skills": ["Kubernetes", "Terraform"]}),
        )
    )
    db.commit()

    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["resume"]["ats_score"] == 42.0
    assert ctx["resume"]["band"] == "NEEDS WORK"
    assert ctx["resume"]["job_specific"] is False
    assert ctx["resume"]["missing_skills"] == ["Kubernetes", "Terraform"]

    prompt = context.format_grounding_for_prompt(ctx)
    assert "42.0/100" in prompt
    assert "Kubernetes" in prompt


def test_grounding_context_picks_the_most_recent_of_several_scans(db):
    db.add(ResumeAnalysis(user_id=ALICE, resume_filename="old.pdf", job_description="", ats_score=20.0, result_json="{}"))
    db.commit()
    db.add(ResumeAnalysis(user_id=ALICE, resume_filename="new.pdf", job_description="", ats_score=80.0, result_json="{}"))
    db.commit()

    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["resume"]["filename"] == "new.pdf"


def test_grounding_context_surfaces_completed_mock_interview_only(db):
    from datetime import datetime, timezone

    db.add(
        InterviewSession(
            user_id=ALICE, role="Backend Engineer", seniority="Mid-level", category="technical",
            status="completed", overall_score=7.5, readiness_band="STRONG",
            topics_to_improve=json.dumps(["Hash collisions"]), completed_at=datetime.now(timezone.utc),
        )
    )
    # An in-progress session must not be reported as "latest completed".
    db.add(
        InterviewSession(
            user_id=ALICE, role="Backend Engineer", seniority="Mid-level", category="behavioral",
            status="in_progress",
        )
    )
    db.commit()

    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["mock_interview"]["category"] == "technical"
    assert ctx["mock_interview"]["readiness_band"] == "STRONG"
    assert ctx["mock_interview"]["topics_to_improve"] == ["Hash collisions"]
    assert ctx["has_in_progress_mock_interview"] is True


def test_grounding_context_ignores_legacy_sessions_without_category(db):
    db.add(InterviewSession(user_id=ALICE, role="X", seniority="Y", status="in_progress"))
    db.commit()
    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["has_in_progress_mock_interview"] is False


def test_grounding_context_surfaces_profile(db):
    db.add(
        Profile(
            user_id=ALICE, current_title="Software Engineer", seniority="Senior",
            primary_target_role="Staff Engineer", target_roles=json.dumps(["Backend", "Platform"]),
        )
    )
    db.commit()
    ctx = context.build_grounding_context(db, ALICE)
    assert ctx["profile"]["current_title"] == "Software Engineer"
    assert ctx["profile"]["target_roles"] == ["Backend", "Platform"]


# -- Rate limiting -------------------------------------------------------------


def test_rate_limit_allows_up_to_the_cap_then_blocks():
    now = 1000.0
    for _ in range(ratelimit.MAX_MESSAGES_PER_WINDOW):
        assert ratelimit.check_rate_limit(ALICE, now=now) is True
    assert ratelimit.check_rate_limit(ALICE, now=now) is False


def test_rate_limit_is_isolated_per_user():
    now = 1000.0
    for _ in range(ratelimit.MAX_MESSAGES_PER_WINDOW):
        ratelimit.check_rate_limit(ALICE, now=now)
    assert ratelimit.check_rate_limit("someone-else", now=now) is True


def test_rate_limit_recovers_after_the_window_elapses():
    now = 1000.0
    for _ in range(ratelimit.MAX_MESSAGES_PER_WINDOW):
        ratelimit.check_rate_limit(ALICE, now=now)
    assert ratelimit.check_rate_limit(ALICE, now=now) is False
    later = now + ratelimit.WINDOW_SECONDS + 1
    assert ratelimit.check_rate_limit(ALICE, now=later) is True


# -- Turn orchestration ---------------------------------------------------------


def _fake_stream(chunks):
    async def stream_message(system, messages, max_tokens=1500):
        for chunk in chunks:
            yield chunk
    return stream_message


@pytest.fixture
def conversation(db):
    row = CoachConversation(user_id=ALICE)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def mock_chat_llm(monkeypatch):
    monkeypatch.setattr(chat.llm_client, "stream_message", _fake_stream(["Hello", " there", "!"]))
    monkeypatch.setattr(
        chat.llm_client, "complete_tool_json",
        lambda *a, **kw: {"follow_ups": ["Improve Resume", "Practice Interview"]},
    )


async def _collect(agen):
    return [event async for event in agen]


@pytest.mark.asyncio
async def test_stream_reply_persists_user_and_assistant_messages(db, conversation, mock_chat_llm):
    events = await _collect(chat.stream_reply(db, conversation, "How's my resume?"))

    tokens = [e["text"] for e in events if e["type"] == "token"]
    assert "".join(tokens) == "Hello there!"
    assert events[-2] == {"type": "followups", "items": ["Improve Resume", "Practice Interview"]}
    assert events[-1] == {"type": "done"}

    rows = db.query(CoachMessage).filter(CoachMessage.conversation_id == conversation.id).order_by(CoachMessage.id).all()
    assert [r.role for r in rows] == ["user", "assistant"]
    assert rows[0].content == "How's my resume?"
    assert rows[1].content == "Hello there!"
    assert json.loads(rows[1].follow_ups) == ["Improve Resume", "Practice Interview"]


@pytest.mark.asyncio
async def test_stream_reply_derives_a_title_from_the_first_message(db, conversation, mock_chat_llm):
    await _collect(chat.stream_reply(db, conversation, "Why is my ATS score low?"))
    db.refresh(conversation)
    assert conversation.title == "Why is my ATS score low?"


@pytest.mark.asyncio
async def test_stream_reply_does_not_overwrite_title_on_later_messages(db, conversation, mock_chat_llm):
    await _collect(chat.stream_reply(db, conversation, "First question"))
    await _collect(chat.stream_reply(db, conversation, "Second question"))
    db.refresh(conversation)
    assert conversation.title == "First question"


@pytest.mark.asyncio
async def test_stream_reply_sends_bounded_history_to_claude(db, conversation, monkeypatch):
    captured = {}

    async def capturing_stream(system, messages, max_tokens=1500):
        captured["messages"] = messages
        yield "ok"

    monkeypatch.setattr(chat.llm_client, "stream_message", capturing_stream)
    monkeypatch.setattr(chat.llm_client, "complete_tool_json", lambda *a, **kw: {"follow_ups": []})

    await _collect(chat.stream_reply(db, conversation, "first"))
    await _collect(chat.stream_reply(db, conversation, "second"))

    # The just-sent "second" message must be the last entry — history is
    # queried fresh after the user message is persisted, not stale.
    assert captured["messages"][-1] == {"role": "user", "content": "second"}
    assert captured["messages"][0] == {"role": "user", "content": "first"}


@pytest.mark.asyncio
async def test_stream_reply_yields_error_and_saves_nothing_when_llm_unavailable(db, conversation, monkeypatch):
    monkeypatch.setattr(chat.llm_client, "_client", None)

    events = await _collect(chat.stream_reply(db, conversation, "Hello?"))
    assert events[0]["type"] == "error"
    assert events[1] == {"type": "done"}

    rows = db.query(CoachMessage).filter(CoachMessage.conversation_id == conversation.id).all()
    # The user's message is still saved even though generation failed.
    assert len(rows) == 1
    assert rows[0].role == "user"


@pytest.mark.asyncio
async def test_stream_reply_saves_partial_text_and_skips_followups_on_disconnect(db, conversation, monkeypatch):
    from contextlib import aclosing

    followup_calls = {"count": 0}

    async def slow_stream(system, messages, max_tokens=1500):
        yield "Partial"
        yield " answer"
        yield " that never finishes streaming"

    def fake_followups(*a, **kw):
        followup_calls["count"] += 1
        return {"follow_ups": ["should not be called"]}

    monkeypatch.setattr(chat.llm_client, "stream_message", slow_stream)
    monkeypatch.setattr(chat.llm_client, "complete_tool_json", fake_followups)

    seen = []
    async with aclosing(chat.stream_reply(db, conversation, "Long question")) as gen:
        async for event in gen:
            seen.append(event)
            if len(seen) == 2:  # simulate the client disconnecting mid-stream
                break

    assert followup_calls["count"] == 0
    rows = db.query(CoachMessage).filter(CoachMessage.conversation_id == conversation.id).order_by(CoachMessage.id).all()
    assert [r.role for r in rows] == ["user", "assistant"]
    assert rows[1].content == "Partial answer"
    assert rows[1].follow_ups == "[]"

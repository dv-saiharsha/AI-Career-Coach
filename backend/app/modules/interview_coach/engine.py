"""The Interview Engine — session lifecycle and question sequencing shared by
Mock Interview today and meant to carry Voice Interview and a future Live AI
Interview later without being rebuilt.

Question sourcing deliberately does not generate anything new: it calls
prep.get_prep_questions(), the exact function backing the "Learn concepts"
tab, so a mock session practices content Prep already produced and cached
rather than paying for and maintaining a second question-generation path.
Each InterviewQuestion row snapshots the text at session-creation time (so
history reads correctly even if the underlying prep question is later
regenerated under a new prompt version) while keeping prep_question_id for
provenance — that link is what lets evaluation.py ground its judgment in the
prep question's own ideal_answer instead of guessing one from scratch.

Only one session is "in_progress" per user at a time. Starting a new one
abandons whichever was active — simpler than letting multiple sessions race
for the same "active" slot, and abandoning loses nothing: every answer
already given was persisted immediately, so the abandoned session's history
stays intact and readable, just no longer resumable.

WHY A SESSION-LEVEL FALLBACK, SEPARATE FROM PREP'S OWN

prep.get_prep_questions() deliberately raises rather than serving a generic
question when the LLM is unavailable — right for Learn Concepts, a teaching
tool where a wrong or generic explanation is worse than an honest empty
state. A Mock Interview session has no such tradeoff: evaluate_answer and
generate_session_report already degrade to rule-based scoring and a plain
summary rather than failing outright (see evaluation.py/_evaluate_with_rules
and reports.py/_fallback_summary), so a session that can't source real Prep
questions should degrade the same way instead of dead-ending at a 503 before
it even starts. _fallback_questions below is never written into the shared
PrepQuestion cache — it only ever becomes InterviewQuestion rows with
prep_question_id left null, so Learn Concepts' own cache and quality bar are
untouched.
"""

import random
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.modules.interview_coach import prep, reports

# Generic, category-appropriate questions used only when Prep's own question
# generation fails (no working LLM connection) — enough to run a full Mock
# Interview session end-to-end. Not tailored to a specific role beyond
# substituting its name, and never persisted as PrepQuestion cache rows.
_FALLBACK_QUESTIONS: dict[str, list[str]] = {
    "hr": [
        "Why are you interested in this {role} position, and what draws you to us specifically?",
        "Tell me about yourself and your journey to becoming a {role}.",
        "Where do you see your career heading in the next few years as a {role}?",
        "How do you handle a heavy workload or competing priorities in a {role} role?",
        "What kind of team culture or management style helps you do your best work?",
        "What questions do you have for us about this {role} role or the team?",
    ],
    "technical": [
        "Walk me through how you'd approach a challenging technical problem you've faced as a {role}.",
        "What tools, frameworks, or approaches are you most comfortable with as a {role}, and why?",
        "How do you stay current with new developments relevant to a {role}?",
        "Describe a time you had to debug a difficult issue. What was your process?",
        "How would you design a solution to a common problem in the {role} domain? Walk through your approach.",
        "Tell me about a technical decision you disagreed with, and how you handled it.",
    ],
    "behavioral": [
        "Tell me about a time you faced a significant challenge at work and how you handled it.",
        "Describe a situation where you had to work with a difficult teammate or stakeholder.",
        "Give an example of a goal you set for yourself and how you achieved it.",
        "Tell me about a time you failed at something. What did you learn?",
        "Describe a time you had to persuade someone to see things your way.",
        "Tell me about a time you took initiative without being asked.",
    ],
    "screening": [
        "Can you briefly walk me through your resume and background?",
        "What interests you about this {role} opportunity?",
        "What's your current notice period or availability to start?",
        "Can you describe your experience level relevant to a {role} role?",
        "What are you looking for in your next role?",
        "Is there anything about location, visa status, or availability we should know?",
    ],
    "scenario": [
        "A project deadline is at risk because of a teammate's underperformance — what would you do as a {role}?",
        "A key stakeholder disagrees with your proposed approach — how do you handle it?",
        "You discover a critical mistake in production right before a big client demo — what's your next move?",
        "You're asked to take on a task outside your expertise with a tight deadline — how do you proceed?",
        "Your team is split between two different approaches to a project — how would you help reach a decision?",
        "You realize a decision you made earlier was wrong and it's already affecting the project — what do you do?",
    ],
}


def _fallback_questions(role: str, category: str) -> list[str]:
    bank = _FALLBACK_QUESTIONS.get(category, _FALLBACK_QUESTIONS["behavioral"])
    texts = [t.format(role=role) for t in bank]
    random.shuffle(texts)
    return texts


def start_session(db: Session, user_id: str, role: str, seniority: str, category: str) -> InterviewSession:
    still_active = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.user_id == user_id,
            InterviewSession.status == "in_progress",
            InterviewSession.category.isnot(None),
        )
        .all()
    )
    for stale in still_active:
        stale.status = "abandoned"

    try:
        questions = list(prep.get_prep_questions(db, role, category))
        random.shuffle(questions)  # otherwise every attempt opens with the same question
        question_rows = [(pq.text, pq.id) for pq in questions]
    except Exception:
        # Prep's question generation needs a working LLM connection and has
        # nothing to fall back to (see prep.py's own docstring). A Mock
        # Interview session does — see this module's docstring for why.
        question_rows = [(text, None) for text in _fallback_questions(role, category)]

    session = InterviewSession(
        user_id=user_id, role=role, seniority=seniority, category=category, status="in_progress"
    )
    db.add(session)
    db.flush()

    for index, (text, prep_question_id) in enumerate(question_rows):
        db.add(
            InterviewQuestion(
                session_id=session.id,
                question_type=category,
                text=text,
                prep_question_id=prep_question_id,
                sequence_order=index,
            )
        )
    db.commit()
    db.refresh(session)
    return session


def get_active_session(db: Session, user_id: str) -> InterviewSession | None:
    # category IS NOT NULL excludes sessions created before this milestone —
    # their "in_progress" status is only the column's server_default, not a
    # real resumable state, since nothing about them was ever tracked as a
    # lifecycle to resume.
    return (
        db.query(InterviewSession)
        .filter(
            InterviewSession.user_id == user_id,
            InterviewSession.status == "in_progress",
            InterviewSession.category.isnot(None),
        )
        .order_by(InterviewSession.created_at.desc())
        .first()
    )


def get_owned_session(db: Session, user_id: str, session_id: int) -> InterviewSession | None:
    return (
        db.query(InterviewSession)
        .filter(InterviewSession.id == session_id, InterviewSession.user_id == user_id)
        .first()
    )


def abandon_session(db: Session, user_id: str, session_id: int) -> bool:
    session = get_owned_session(db, user_id, session_id)
    if not session or session.status != "in_progress":
        return False
    session.status = "abandoned"
    db.commit()
    return True


def session_questions(db: Session, session_id: int) -> list[InterviewQuestion]:
    return (
        db.query(InterviewQuestion)
        .filter(InterviewQuestion.session_id == session_id)
        .order_by(InterviewQuestion.sequence_order)
        .all()
    )


def maybe_complete_session(db: Session, session: InterviewSession) -> None:
    """Called after every answer is recorded. Once the last question in the
    session has an answer, mark it complete and generate the final report
    right away — one Claude call at session end, not something deferred
    until someone happens to open the report."""
    questions = session_questions(db, session.id)
    q_ids = [q.id for q in questions]
    answered = db.query(InterviewAnswer).filter(InterviewAnswer.question_id.in_(q_ids)).count() if q_ids else 0
    if not questions or answered < len(questions):
        return

    session.status = "completed"
    session.completed_at = datetime.now(timezone.utc)
    db.commit()
    reports.generate_session_report(db, session)

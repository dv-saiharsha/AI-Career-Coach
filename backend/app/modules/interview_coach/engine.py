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
"""

import random
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.modules.interview_coach import prep, reports


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

    questions = list(prep.get_prep_questions(db, role, category))
    random.shuffle(questions)  # otherwise every attempt opens with the same question

    session = InterviewSession(
        user_id=user_id, role=role, seniority=seniority, category=category, status="in_progress"
    )
    db.add(session)
    db.flush()

    for index, pq in enumerate(questions):
        db.add(
            InterviewQuestion(
                session_id=session.id,
                question_type=category,
                text=pq.text,
                prep_question_id=pq.id,
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

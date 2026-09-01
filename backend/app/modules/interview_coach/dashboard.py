"""Interview-side aggregates for the Career Dashboard (Milestone 9).

Nothing here duplicates engine.py/evaluation.py/reports.py — those own
session lifecycle, scoring, and per-session reports respectively. This is a
different shape of question: not "how did one session go" but "how is this
user doing across every session", which no existing endpoint answers.
"""

from sqlalchemy.orm import Session

from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession


def dashboard_summary(db: Session, user_id: str) -> dict:
    """Mock/Voice Interview stats for the dashboard's Interview section.

    Legacy drill sessions (category IS NULL, pre-Milestone-5) are excluded
    for the same reason engine.get_active_session already excludes them from
    "in progress" — a lifecycle was never tracked for them, so their status
    reflects the migration's server default, not a real state.
    """
    completed = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.user_id == user_id,
            InterviewSession.status == "completed",
            InterviewSession.category.isnot(None),
        )
        .order_by(InterviewSession.completed_at.desc().nullslast(), InterviewSession.id.desc())
        .all()
    )
    scores = [s.overall_score for s in completed if s.overall_score is not None]

    voice_answers_count = (
        db.query(InterviewAnswer)
        .join(InterviewQuestion, InterviewAnswer.question_id == InterviewQuestion.id)
        .join(InterviewSession, InterviewQuestion.session_id == InterviewSession.id)
        .filter(InterviewSession.user_id == user_id, InterviewAnswer.voice_metrics.isnot(None))
        .count()
    )

    # A "completed" session should always have a score (reports.py sets both
    # together) — but a report-generation failure could leave one without,
    # same edge case applications/services.py's own interview correlation
    # already guards against. Skip it rather than surface a report with no
    # score to show.
    latest = next((s for s in completed if s.overall_score is not None), None)
    latest_report = None
    if latest:
        latest_report = {
            "session_id": latest.id,
            "role": latest.role,
            "category": latest.category,
            "overall_score": latest.overall_score,
            "readiness_band": latest.readiness_band,
            "completed_at": latest.completed_at.isoformat() if latest.completed_at else None,
        }

    return {
        "completed_sessions": len(completed),
        "average_score": round(sum(scores) / len(scores), 1) if scores else None,
        "voice_answers_count": voice_answers_count,
        "latest_report": latest_report,
    }

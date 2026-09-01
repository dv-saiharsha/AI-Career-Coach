"""Grounding — what the Career Coach actually knows about this user.

Every figure here comes from a query against data another module already
produced (the latest resume scan, the interview engine's session reports, the
application pipeline, analytics' funnel). Nothing is computed fresh for the
coach and nothing here calls Claude — this module is pure orchestration, so
the system prompt can state facts instead of asking the model to guess them.

Deliberately NOT included: a live job-market search. Job Matching (Milestone
3) scores listings on demand against the feed and persists nothing beyond
`JobApplication.match_score` for jobs the user already saved or applied to —
there is no "your current matches" table to query. The system prompt says so
explicitly, so the model never implies it has searched live listings.
"""

import json

from sqlalchemy.orm import Session

from app.modules.analytics.services import summary as analytics_summary
from app.modules.applications.services import get_pipeline
from app.modules.resume_analyzer.rubric import band
from app.models.interview import InterviewSession
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis

# Keeps the grounding block itself out of what gets sent back to a caller
# that only wants the assistant's reply — it is prompt input, not user-facing
# content that belongs in a message row.
MAX_MISSING_SKILLS = 5


def _latest_resume(db: Session, user_id: str) -> dict | None:
    record = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        # id as a tiebreaker: SQLite's CURRENT_TIMESTAMP is second-resolution,
        # so two scans in the same second would otherwise sort arbitrarily.
        .order_by(ResumeAnalysis.created_at.desc(), ResumeAnalysis.id.desc())
        .first()
    )
    if not record:
        return None
    missing_skills: list[str] = []
    try:
        missing_skills = (json.loads(record.result_json) or {}).get("missing_skills", [])
    except (ValueError, TypeError):
        pass
    return {
        "filename": record.resume_filename,
        "ats_score": round(float(record.ats_score), 1),
        "band": band(record.ats_score),
        "job_specific": bool(record.job_description.strip()) if record.job_description else False,
        "missing_skills": missing_skills[:MAX_MISSING_SKILLS],
        "scanned_at": record.created_at.isoformat() if record.created_at else None,
    }


def _latest_mock_interview(db: Session, user_id: str) -> dict | None:
    record = (
        db.query(InterviewSession)
        .filter(
            InterviewSession.user_id == user_id,
            InterviewSession.status == "completed",
            InterviewSession.category.isnot(None),
        )
        .order_by(InterviewSession.completed_at.desc(), InterviewSession.id.desc())
        .first()
    )
    if not record:
        return None
    topics: list[str] = []
    try:
        topics = json.loads(record.topics_to_improve) if record.topics_to_improve else []
    except (ValueError, TypeError):
        pass
    return {
        "role": record.role,
        "category": record.category,
        "overall_score": record.overall_score,
        "readiness_band": record.readiness_band,
        "topics_to_improve": topics,
    }


def _has_in_progress_mock_interview(db: Session, user_id: str) -> bool:
    return (
        db.query(InterviewSession)
        .filter(
            InterviewSession.user_id == user_id,
            InterviewSession.status == "in_progress",
            InterviewSession.category.isnot(None),
        )
        .first()
        is not None
    )


def _profile(db: Session, user_id: str) -> dict | None:
    record = db.query(Profile).filter(Profile.user_id == user_id).first()
    if not record:
        return None
    try:
        target_roles = json.loads(record.target_roles) if record.target_roles else []
    except (ValueError, TypeError):
        target_roles = []
    return {
        "current_title": record.current_title,
        "seniority": record.seniority,
        "primary_target_role": record.primary_target_role,
        "target_roles": target_roles,
    }


def build_grounding_context(db: Session, user_id: str) -> dict:
    """Everything the coach may reference this turn. Rebuilt fresh on every
    message (all local reads, no LLM call) rather than cached on the
    conversation, so a resume rescan or a just-finished mock interview is
    visible on the very next turn."""
    funnel = analytics_summary(db, user_id)["funnel"]
    pipeline = get_pipeline(db, user_id)
    return {
        "profile": _profile(db, user_id),
        "resume": _latest_resume(db, user_id),
        "mock_interview": _latest_mock_interview(db, user_id),
        "has_in_progress_mock_interview": _has_in_progress_mock_interview(db, user_id),
        "applications": {
            "total": pipeline["total"],
            "by_stage": {stage: len(rows) for stage, rows in pipeline["pipeline"].items()},
            "interview_rate": funnel.get("interview_rate"),
            "offer_rate": funnel.get("offer_rate"),
        },
    }


def format_grounding_for_prompt(context: dict) -> str:
    """Renders the context dict into the plain-text block the system prompt
    embeds. Kept separate from build_grounding_context so tests can assert on
    the dict shape without parsing prose back out of a string."""
    lines: list[str] = []

    profile = context.get("profile")
    if profile:
        parts = [p for p in [profile.get("current_title"), profile.get("primary_target_role")] if p]
        if parts:
            lines.append(f"- Profile: {' targeting '.join(parts)}" + (f" ({profile['seniority']})" if profile.get("seniority") else ""))
        if profile.get("target_roles"):
            lines.append(f"- Target roles from onboarding: {', '.join(profile['target_roles'])}")

    resume = context.get("resume")
    if resume:
        mode = "job-specific" if resume["job_specific"] else "general"
        lines.append(
            f"- Latest resume scan ({mode}): \"{resume['filename']}\", ATS score {resume['ats_score']}/100 "
            f"({resume['band']}), scanned {resume['scanned_at']}."
        )
        if resume["missing_skills"]:
            lines.append(f"  Missing skills flagged: {', '.join(resume['missing_skills'])}.")
    else:
        lines.append("- No resume has been scanned yet.")

    mock = context.get("mock_interview")
    if mock:
        lines.append(
            f"- Latest completed mock interview: {mock['role']} / {mock['category']}, "
            f"overall score {mock['overall_score']}/10, readiness {mock['readiness_band']}."
        )
        if mock["topics_to_improve"]:
            lines.append(f"  Topics to improve: {', '.join(mock['topics_to_improve'])}.")
    else:
        lines.append("- No completed mock interview yet.")
    if context.get("has_in_progress_mock_interview"):
        lines.append("- The user has a mock interview in progress right now, not yet finished.")

    apps = context.get("applications")
    if apps and apps["total"]:
        lines.append(
            f"- Application pipeline: {apps['total']} total, by stage {apps['by_stage']}."
            + (f" Interview rate {apps['interview_rate']}%." if apps.get("interview_rate") is not None else "")
        )
    else:
        lines.append("- No applications tracked yet.")

    return "\n".join(lines)

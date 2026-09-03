"""Profile persistence and dashboard aggregates.

Aggregates are computed with SQLAlchemy against the existing session rather
than through a Postgres RPC. A SECURITY DEFINER function taking a user_id
parameter bypasses RLS and trusts its caller to pass the right id, so it is
only as safe as every call site; here the id comes from the verified JWT and
never from the request body.
"""

import json
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.interview import InterviewAnswer, InterviewQuestion, InterviewSession
from app.models.profile import Profile
from app.models.resume import ResumeAnalysis

logger = logging.getLogger(__name__)

ACTIVITY_LIMIT = 6


def get_or_create_profile(db: Session, user_id: str) -> Profile:
    """Fetch the profile, creating an empty one on first access.

    Lazy creation because the backend never observes signup — Supabase owns
    that flow — so there is no earlier point at which a row could be inserted.
    A missing row and a row with onboarding_completed=False mean the same
    thing, which keeps the caller from having to distinguish them.
    """
    profile = db.query(Profile).filter(Profile.user_id == user_id).first()
    if profile is not None:
        return profile

    profile = Profile(user_id=user_id, onboarding_completed=False, target_roles="[]")
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def read_target_roles(profile: Profile) -> list[str]:
    """Decode target_roles, tolerating anything that isn't a JSON string list.

    The column is Text, so a malformed value is possible in principle; the
    dashboard degrading to "no roles selected" beats a 500 on every page load.
    """
    try:
        parsed = json.loads(profile.target_roles or "[]")
    except (TypeError, ValueError):
        logger.warning("profile %s has unparseable target_roles", profile.user_id)
        return []
    if not isinstance(parsed, list):
        return []
    return [str(role) for role in parsed if str(role).strip()]


def complete_onboarding(
    db: Session,
    user_id: str,
    target_roles: list[str],
    resume_analysis_id: int | None,
    resume_filename: str | None,
) -> Profile:
    profile = get_or_create_profile(db, user_id)
    profile.onboarding_completed = True
    profile.target_roles = json.dumps(target_roles)
    # Only overwrite the resume pointer when this run supplied one, so
    # re-running onboarding to change roles doesn't blank an existing resume.
    if resume_analysis_id is not None:
        profile.primary_resume_analysis_id = resume_analysis_id
    if resume_filename:
        profile.primary_resume_filename = resume_filename
    db.commit()
    db.refresh(profile)
    return profile


def profile_payload(profile: Profile) -> dict:
    """Shape a Profile row for the API. One place, so every endpoint agrees."""
    return {
        "onboarding_completed": profile.onboarding_completed,
        "target_roles": read_target_roles(profile),
        "primary_resume_filename": profile.primary_resume_filename,
        "primary_resume_analysis_id": profile.primary_resume_analysis_id,
        "bio": profile.bio,
        "current_title": profile.current_title,
        "seniority": profile.seniority,
        "primary_target_role": profile.primary_target_role,
        "avatar_url": profile.avatar_url,
    }


def update_profile(db: Session, user_id: str, fields: dict) -> Profile:
    """Apply a partial update.

    `fields` carries only keys the client actually sent (the router builds it
    with exclude_unset), so an omitted field is left alone. An empty string is
    treated as an explicit clear and stored as NULL — that is how the avatar
    delete flow nulls avatar_url without also blanking the bio.
    """
    profile = get_or_create_profile(db, user_id)
    for key, value in fields.items():
        if not hasattr(profile, key):
            continue
        setattr(profile, key, value if value not in ("", None) else None)
    db.commit()
    db.refresh(profile)
    return profile


def latest_interview_score(db: Session, user_id: str) -> float | None:
    """Mean answer score for the user's most recent interview session.

    interview_sessions carries no score column — scores live per answer on
    interview_answers — so a session's score is the average of its answers.
    Sessions that were started but never answered return None rather than 0,
    which would otherwise show up on the dashboard as a failed interview.
    """
    session = (
        db.query(InterviewSession)
        .filter(InterviewSession.user_id == user_id)
        .order_by(InterviewSession.created_at.desc())
        .first()
    )
    if session is None:
        return None

    average = (
        db.query(func.avg(InterviewAnswer.score))
        .join(InterviewQuestion, InterviewAnswer.question_id == InterviewQuestion.id)
        .filter(InterviewQuestion.session_id == session.id)
        .scalar()
    )
    return round(float(average), 1) if average is not None else None


def dashboard_stats(db: Session, user_id: str) -> dict:
    resumes_analyzed = (
        db.query(func.count(ResumeAnalysis.id)).filter(ResumeAnalysis.user_id == user_id).scalar()
        or 0
    )
    sessions = (
        db.query(func.count(InterviewSession.id))
        .filter(InterviewSession.user_id == user_id)
        .scalar()
        or 0
    )
    avg_ats = (
        db.query(func.avg(ResumeAnalysis.ats_score))
        .filter(ResumeAnalysis.user_id == user_id)
        .scalar()
    )
    latest_ats = (
        db.query(ResumeAnalysis.ats_score)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.desc(), ResumeAnalysis.id.desc())
        .limit(1)
        .scalar()
    )

    return {
        "resumes_analyzed": int(resumes_analyzed),
        "interview_sessions": int(sessions),
        "avg_ats_score": round(float(avg_ats), 1) if avg_ats is not None else None,
        "latest_ats_score": round(float(latest_ats), 1) if latest_ats is not None else None,
        "latest_interview_score": latest_interview_score(db, user_id),
    }


def recent_activity(db: Session, user_id: str) -> list[dict]:
    """Most recent resume analyses and interview sessions, newest first.

    Merged in Python rather than with a SQL UNION: the two tables have
    different shapes, the row count is tiny, and a UNION would need casting
    both sides to a common column list for no benefit at this size.
    """
    items: list[dict] = []

    resumes = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.desc(), ResumeAnalysis.id.desc())
        .limit(ACTIVITY_LIMIT)
        .all()
    )
    for row in resumes:
        items.append(
            {
                "id": row.id,
                "kind": "resume",
                "title": row.resume_filename,
                "score": round(float(row.ats_score), 1) if row.ats_score is not None else None,
                "created_at": row.created_at,
            }
        )

    sessions = (
        db.query(InterviewSession)
        .filter(InterviewSession.user_id == user_id)
        .order_by(InterviewSession.created_at.desc())
        .limit(ACTIVITY_LIMIT)
        .all()
    )
    for row in sessions:
        items.append(
            {
                "id": row.id,
                "kind": "interview",
                "title": f"{row.seniority} {row.role}".strip(),
                "score": None,
                "created_at": row.created_at,
            }
        )

    # created_at is server_default=now() and non-null in both tables, but a row
    # inserted before that default existed could still be None — sort defensively
    # so one legacy row can't crash the dashboard. Sorted on the raw datetime
    # (before the isoformat() conversion below) since ordering by the
    # eventual string would work too, but there is no reason to rely on that.
    items.sort(key=lambda item: (item["created_at"] is not None, item["created_at"]), reverse=True)
    items = items[:ACTIVITY_LIMIT]
    for item in items:
        # ActivityItemSchema.created_at is a str — this was previously left
        # as a raw datetime, which FastAPI's response_model validation
        # rejects; caught by Milestone 9 reusing this function through an
        # endpoint that actually exercises response serialization.
        item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
    return items

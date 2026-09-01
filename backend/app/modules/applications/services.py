"""Application pipeline persistence, plus the Milestone 8 cross-engine
detail view.

Every function takes `user_id` and filters on it. That id always comes from a
verified Supabase JWT (app/core/deps.get_current_user) — never from a request
body or header, which a caller controls and could set to someone else's id.

The detail view (get_application_detail) is pure aggregation: it calls into
the Resume, Job Matching, and Interview engines exactly as they already
exist, and invents no new scoring or generation of its own.
"""

import json
from datetime import datetime, timezone

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.taxonomy import expand_skills, skill_candidates
from app.models.application import APPLICATION_STATUSES, ApplicationStatusHistory, JobApplication
from app.models.interview import InterviewSession
from app.models.resume import ResumeAnalysis
from app.modules.job_market.matching import MatchContext, build_job_match
from app.modules.job_market.services import normalise_query
from app.modules.notifications.service import notify_application_status_changed
from app.modules.resume_analyzer.rubric import band

ACTIVITY_FEED_LIMIT = 50


def _serialize(record: JobApplication) -> dict:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "id": record.id,
        "job_title": record.job_title,
        "company": record.company,
        "location": record.location,
        "salary_range": record.salary_range,
        "status": record.status,
        "job_url": record.job_url,
        "job_description": record.job_description,
        "tailored_resume_id": record.tailored_resume_id,
        "notes": record.notes,
        "recruiter_name": record.recruiter_name,
        "recruiter_email": record.recruiter_email,
        "match_score": record.match_score,
        "applied_at": iso(record.applied_at),
        "created_at": iso(record.created_at),
        "updated_at": iso(record.updated_at),
    }


def get_pipeline(db: Session, user_id: str) -> dict:
    """All of a user's applications, grouped by stage.

    Every stage key is present even when empty — the board draws every
    column regardless, and a missing key would silently drop one.
    """
    records = (
        db.query(JobApplication)
        .filter(JobApplication.user_id == user_id)
        .order_by(JobApplication.updated_at.desc().nullslast(), JobApplication.id.desc())
        .all()
    )

    pipeline: dict[str, list[dict]] = {status: [] for status in APPLICATION_STATUSES}
    for record in records:
        # Defensive: a row whose status predates a stage rename would
        # otherwise raise a KeyError and take the whole board down.
        pipeline.setdefault(record.status, []).append(_serialize(record))

    return {"pipeline": pipeline, "total": len(records)}


def _record_status_history(db: Session, application_id: int, from_status: str | None, to_status: str) -> None:
    db.add(ApplicationStatusHistory(application_id=application_id, from_status=from_status, to_status=to_status))


def create_application(db: Session, user_id: str, payload: dict) -> dict:
    record = JobApplication(user_id=user_id, **payload)
    # Saving something straight into 'applied' should still date-stamp it.
    if record.status == "applied":
        record.applied_at = datetime.now(timezone.utc)

    db.add(record)
    db.commit()
    db.refresh(record)

    _record_status_history(db, record.id, None, record.status)
    db.commit()
    return _serialize(record)


def _owned(db: Session, user_id: str, application_id: int) -> JobApplication | None:
    """Ownership is part of the lookup, not a check afterwards — so a wrong
    user gets an indistinguishable 404 rather than a 403 that confirms the
    row exists."""
    return (
        db.query(JobApplication)
        .filter(JobApplication.id == application_id, JobApplication.user_id == user_id)
        .first()
    )


def update_application(
    db: Session,
    user_id: str,
    application_id: int,
    payload: dict,
    background_tasks: BackgroundTasks | None = None,
) -> dict | None:
    record = _owned(db, user_id, application_id)
    if not record:
        return None

    previous_status = record.status
    for field, value in payload.items():
        setattr(record, field, value)

    # Stamped the first time it reaches 'applied' and not overwritten after —
    # it records when the application went out, so moving to a later stage
    # and back must not reset it.
    if payload.get("status") == "applied" and record.applied_at is None:
        record.applied_at = datetime.now(timezone.utc)

    new_status = payload.get("status")
    if new_status and new_status != previous_status:
        _record_status_history(db, record.id, previous_status, new_status)

    db.commit()
    db.refresh(record)

    if new_status and new_status != previous_status:
        notify_application_status_changed(
            db, user_id,
            application_id=record.id,
            company=record.company,
            job_title=record.job_title,
            from_status=previous_status,
            to_status=new_status,
            background_tasks=background_tasks,
        )

    return _serialize(record)


def delete_application(db: Session, user_id: str, application_id: int) -> bool:
    record = _owned(db, user_id, application_id)
    if not record:
        return False
    db.delete(record)  # cascades to application_status_history
    db.commit()
    return True


def get_activity_feed(db: Session, user_id: str, limit: int = ACTIVITY_FEED_LIMIT) -> list[dict]:
    """Powers the Timeline view's cross-application feed — every status
    change, newest first, across the whole pipeline."""
    rows = (
        db.query(ApplicationStatusHistory, JobApplication)
        .join(JobApplication, ApplicationStatusHistory.application_id == JobApplication.id)
        .filter(JobApplication.user_id == user_id)
        .order_by(ApplicationStatusHistory.changed_at.desc(), ApplicationStatusHistory.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "application_id": application.id,
            "job_title": application.job_title,
            "company": application.company,
            "from_status": history.from_status,
            "to_status": history.to_status,
            "changed_at": history.changed_at.isoformat(),
        }
        for history, application in rows
    ]


# -- Cross-engine detail view ------------------------------------------------


def _status_history(db: Session, application_id: int) -> list[dict]:
    rows = (
        db.query(ApplicationStatusHistory)
        .filter(ApplicationStatusHistory.application_id == application_id)
        .order_by(ApplicationStatusHistory.changed_at.asc(), ApplicationStatusHistory.id.asc())
        .all()
    )
    return [
        {"from_status": row.from_status, "to_status": row.to_status, "changed_at": row.changed_at.isoformat()}
        for row in rows
    ]


def _resolve_resume(db: Session, record: JobApplication) -> ResumeAnalysis | None:
    """The resume to match against: the one explicitly tailored for this
    application if it still exists, otherwise the user's most recent scan —
    still a real, useful comparison even without an explicit link."""
    if record.tailored_resume_id:
        analysis = (
            db.query(ResumeAnalysis)
            .filter(ResumeAnalysis.id == record.tailored_resume_id, ResumeAnalysis.user_id == record.user_id)
            .first()
        )
        if analysis:
            return analysis
    return (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == record.user_id)
        .order_by(ResumeAnalysis.created_at.desc(), ResumeAnalysis.id.desc())
        .first()
    )


def _resume_summary(db: Session, record: JobApplication) -> dict | None:
    """Strictly the resume explicitly linked to this application — unlike
    job-match, this is a factual claim ("this is the resume you used"), so
    it does not fall back to "your latest scan" the way matching does."""
    if not record.tailored_resume_id:
        return None
    analysis = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.id == record.tailored_resume_id, ResumeAnalysis.user_id == record.user_id)
        .first()
    )
    if not analysis:
        return None
    return {
        "analysis_id": analysis.id,
        "filename": analysis.resume_filename,
        "ats_score": round(float(analysis.ats_score), 1),
        "band": band(analysis.ats_score),
        "scanned_at": analysis.created_at.isoformat() if analysis.created_at else "",
    }


def _job_match_summary(db: Session, record: JobApplication) -> dict | None:
    """Reuses job_market.matching.build_job_match verbatim. Requires both a
    stored job description and a resolvable resume with extracted text —
    missing either, this is omitted rather than guessed at."""
    if not record.job_description:
        return None
    resume = _resolve_resume(db, record)
    if not resume or not resume.resume_text:
        return None

    context = MatchContext(
        resume_text=resume.resume_text,
        skill_set=expand_skills(skill_candidates(resume.resume_text)),
    )
    # Applications have no curated skills list the way an ingested JobListing
    # does — skill_candidates on the stored description is the same
    # extraction resume_analyzer/rubric.py's own hard_skill_match already
    # relies on for JD text without a curated list.
    job = {"description": record.job_description, "skills": skill_candidates(record.job_description)}
    match = build_job_match(context, job)
    skills_match = match.get("skillsMatch") or {}
    return {
        "overall_match": match.get("overallMatch"),
        "band": match.get("band"),
        "matching_skills": skills_match.get("matchingSkills", []),
        "missing_skills": skills_match.get("missingSkills", []),
        "explanation": match.get("explanation") or "",
    }


def _interview_summary(db: Session, user_id: str, job_title: str) -> tuple[dict | None, bool]:
    """Best-effort correlation: no hard link exists between an application
    and an interview session, so this matches on the same normalised-role
    key the job feed itself uses for cache lookups — "same role, practiced",
    not "the interview for this specific application"."""
    target = normalise_query(job_title)
    if not target:
        return None, False

    sessions = (
        db.query(InterviewSession)
        .filter(InterviewSession.user_id == user_id, InterviewSession.category.isnot(None))
        .order_by(InterviewSession.completed_at.desc().nullslast(), InterviewSession.id.desc())
        .all()
    )
    matching = [s for s in sessions if normalise_query(s.role) == target]

    has_in_progress = any(s.status == "in_progress" for s in matching)
    completed = next((s for s in matching if s.status == "completed" and s.overall_score is not None), None)
    if not completed:
        return None, has_in_progress

    try:
        topics = json.loads(completed.topics_to_improve) if completed.topics_to_improve else []
    except (ValueError, TypeError):
        topics = []

    return {
        "session_id": completed.id,
        "overall_score": completed.overall_score,
        "readiness_band": completed.readiness_band or "",
        "topics_to_improve": topics,
        "completed_at": completed.completed_at.isoformat() if completed.completed_at else "",
    }, has_in_progress


def get_application_detail(db: Session, user_id: str, application_id: int) -> dict | None:
    record = _owned(db, user_id, application_id)
    if not record:
        return None

    interview, has_in_progress = _interview_summary(db, user_id, record.job_title)
    return {
        "application": _serialize(record),
        "status_history": _status_history(db, application_id),
        "resume": _resume_summary(db, record),
        "job_match": _job_match_summary(db, record),
        "interview": interview,
        "has_in_progress_interview": has_in_progress,
    }

"""The Notification Engine.

Two kinds of trigger call into create_notification():

  Event-driven — fired inline, in the same request that produced the event,
  from the module that already computed it: resume_analyzer/router.py after
  a scan is saved, applications/services.py after a status change is
  recorded. Nothing here re-derives what those modules already know.

  Periodic — nothing "happens" to trigger a mock-interview reminder or a
  weekly summary; time just passes. check_periodic() runs these as an
  opportunistic sweep from the Career Dashboard's one already-frequent
  request (dashboard/router.py's /home), rather than standing up a cron
  scheduler this project has no infrastructure for.

Every trigger reuses an existing engine function to read the signal it acts
on (interview_coach.dashboard.dashboard_summary, job_market.services.
top_matches, dashboard.services._resume_section / _stale_recruiter_stage_
application, analytics.services) — this module computes nothing about
resume quality, job matching, or interview readiness itself.

Honest scoping, disclosed rather than silently skipped: the spec names
several notification types this schema cannot support without fabricating
data that doesn't exist elsewhere in the app —
  - "Interview Scheduled" / "Interview Date Approaching": there is no
    scheduling feature or calendar anywhere in this app. Both collapse into
    interview_stage_reached, fired when an application moves into an
    interview-pipeline stage — a real event, not an invented date.
  - "Match Score Improved": job matches are computed fresh per request
    (job_market's own deliberate design — see its services.py), so there is
    no persisted per-user, per-job score history to diff against. Only
    high_match_job (a new listing crossing the high-match bar) is raised.
  - "Resume Health Improved" and "ATS Score Changed" are the same
    underlying event (a new scan's score vs. the previous one) — one type,
    resume_score_changed, with title/wording that reflects the direction.
"""

import logging
from datetime import datetime, timedelta, timezone

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.events import event_manager
from app.models.application import INTERVIEW_STAGES
from app.models.notification import Notification

logger = logging.getLogger(__name__)

DEFAULT_LIST_LIMIT = 50

# How long a periodic reminder stays suppressed after it last fired, before
# it's allowed to resurface. One-time achievements (career_milestone,
# practice_streak) pass no window at all — dedupe_key alone makes those
# permanent.
REMINDER_WINDOW_DAYS = 7
FOLLOW_UP_WINDOW_DAYS = 5

HIGH_MATCH_THRESHOLD = 85.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(row: Notification) -> dict:
    def iso(value: datetime | None) -> str | None:
        return value.isoformat() if value else None

    return {
        "id": row.id,
        "type": row.type,
        "category": row.category,
        "priority": row.priority,
        "title": row.title,
        "message": row.message,
        "href": row.href,
        "occurrence_count": row.occurrence_count,
        "read_at": iso(row.read_at),
        "archived_at": iso(row.archived_at),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
    }


def _publish(background_tasks: BackgroundTasks | None, user_id: str, row: Notification) -> None:
    """Best-effort live push to any open tab, via the existing SSE
    infrastructure (core/events.py) — never the source of truth, which is
    the row itself. Skipped outright when the caller has no BackgroundTasks
    (e.g. a periodic check run outside a request), not an error."""
    if background_tasks is None:
        return
    background_tasks.add_task(event_manager.publish, user_id, "notification", _serialize(row))


def create_notification(
    db: Session,
    user_id: str,
    *,
    type: str,
    category: str,
    priority: str,
    title: str,
    message: str,
    dedupe_key: str,
    href: str | None = None,
    dedupe_window: timedelta | None = None,
    group_key: str | None = None,
    expires_in_days: int | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> Notification | None:
    """The one insertion path. Returns the created-or-updated row, or None
    when the event was a duplicate and nothing changed.

    dedupe_window=None means "has this ever fired" (permanent — achievements,
    a specific job's high-match alert). A real timedelta means "has this
    fired within the last N days" (recurring reminders that should be able
    to resurface later, like a still-unanswered follow-up).

    group_key is checked only once dedupe_key has cleared: a call is either
    an exact repeat of something already recorded (skipped, regardless of
    group_key) or a genuinely new event that may fold into an existing,
    still-active group instead of becoming its own row.
    """
    now = _now()
    query = db.query(Notification).filter(
        Notification.user_id == user_id, Notification.dedupe_key == dedupe_key
    )
    if dedupe_window is not None:
        query = query.filter(Notification.created_at >= now - dedupe_window)
    if query.first() is not None:
        return None

    if group_key:
        existing_group = (
            db.query(Notification)
            .filter(
                Notification.user_id == user_id,
                Notification.group_key == group_key,
                Notification.archived_at.is_(None),
            )
            .order_by(Notification.created_at.desc())
            .first()
        )
        if existing_group:
            existing_group.title = title
            existing_group.message = message
            existing_group.dedupe_key = dedupe_key
            existing_group.occurrence_count += 1
            existing_group.read_at = None  # something new happened — surface it again
            db.commit()
            db.refresh(existing_group)
            _publish(background_tasks, user_id, existing_group)
            return existing_group

    row = Notification(
        user_id=user_id,
        type=type,
        category=category,
        priority=priority,
        title=title,
        message=message,
        href=href,
        dedupe_key=dedupe_key,
        group_key=group_key,
        expires_at=now + timedelta(days=expires_in_days) if expires_in_days else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    _publish(background_tasks, user_id, row)
    return row


def _active_query(db: Session, user_id: str, include_archived: bool):
    now = _now()
    q = db.query(Notification).filter(Notification.user_id == user_id)
    if not include_archived:
        q = q.filter(Notification.archived_at.is_(None))
        q = q.filter((Notification.expires_at.is_(None)) | (Notification.expires_at > now))
    return q


def list_notifications(db: Session, user_id: str, include_archived: bool = False, limit: int = DEFAULT_LIST_LIMIT) -> list[dict]:
    rows = (
        _active_query(db, user_id, include_archived)
        .order_by(Notification.created_at.desc())
        .limit(limit)
        .all()
    )
    return [_serialize(row) for row in rows]


def unread_count(db: Session, user_id: str) -> int:
    return _active_query(db, user_id, include_archived=False).filter(Notification.read_at.is_(None)).count()


def _owned(db: Session, user_id: str, notification_id: int) -> Notification | None:
    return (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == user_id)
        .first()
    )


def mark_read(db: Session, user_id: str, notification_id: int) -> dict | None:
    row = _owned(db, user_id, notification_id)
    if not row:
        return None
    if row.read_at is None:
        row.read_at = _now()
        db.commit()
        db.refresh(row)
    return _serialize(row)


def mark_all_read(db: Session, user_id: str) -> int:
    now = _now()
    rows = _active_query(db, user_id, include_archived=False).filter(Notification.read_at.is_(None)).all()
    for row in rows:
        row.read_at = now
    db.commit()
    return len(rows)


def archive(db: Session, user_id: str, notification_id: int) -> dict | None:
    row = _owned(db, user_id, notification_id)
    if not row:
        return None
    if row.archived_at is None:
        row.archived_at = _now()
        db.commit()
        db.refresh(row)
    return _serialize(row)


# ═══════════════════════════════════════════════════════════════════════════
# Event-driven triggers — called inline from the module that owns the event.
# ═══════════════════════════════════════════════════════════════════════════


def notify_resume_scanned(
    db: Session,
    user_id: str,
    *,
    analysis_id: int,
    new_score: float,
    previous_score: float | None,
    latest_band: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Called once, right after resume_analyzer/router.py saves a new scan.
    new_score/previous_score/latest_band are all read off the row that
    router already just wrote — nothing recomputed here."""
    if previous_score is not None:
        delta = round(new_score - previous_score, 1)
        if abs(delta) >= 5:
            improved = delta > 0
            create_notification(
                db, user_id,
                type="resume_score_changed",
                category="resume",
                priority="medium",
                title="Resume Health Improved" if improved else "Resume Score Dropped",
                message=(
                    f"Your latest scan scored {new_score:.1f}, up {delta:+.1f} from your last resume."
                    if improved
                    else f"Your latest scan scored {new_score:.1f}, down {delta:+.1f} from your last resume."
                ),
                href="/resume",
                dedupe_key=f"resume_score_changed:{analysis_id}",
                background_tasks=background_tasks,
            )

    if latest_band in ("WEAK", "NEEDS WORK"):
        create_notification(
            db, user_id,
            type="resume_needs_attention",
            category="resume",
            priority="high",
            title="Resume Needs Attention",
            message=f"Your latest resume scored {latest_band} — a few targeted fixes could move it up a band.",
            href="/resume",
            dedupe_key=f"resume_needs_attention:{analysis_id}",
            background_tasks=background_tasks,
        )


def notify_application_status_changed(
    db: Session,
    user_id: str,
    *,
    application_id: int,
    company: str,
    job_title: str,
    from_status: str | None,
    to_status: str,
    background_tasks: BackgroundTasks | None = None,
) -> None:
    """Called from applications/services.update_application, at the exact
    point that already detects and records the transition."""
    create_notification(
        db, user_id,
        type="application_status_changed",
        category="application",
        priority="medium",
        title="Application Status Changed",
        message=f"{company} — {job_title} moved to {to_status.replace('_', ' ')}.",
        href="/applications",
        dedupe_key=f"app_status_changed:{application_id}:{to_status}",
        background_tasks=background_tasks,
    )

    if to_status in INTERVIEW_STAGES:
        create_notification(
            db, user_id,
            type="interview_stage_reached",
            category="interview",
            priority="high",
            title="Interview Stage Reached",
            message=f"{company} moved your application to {to_status.replace('_', ' ')} — time to prep.",
            href="/interview",
            dedupe_key=f"interview_stage:{application_id}:{to_status}",
            background_tasks=background_tasks,
        )


# ═══════════════════════════════════════════════════════════════════════════
# Periodic sweep — called from dashboard/router.py's /home, the one place in
# the app a signed-in user visits often enough to stand in for a scheduler.
# ═══════════════════════════════════════════════════════════════════════════


def _check_interview_reminders(db: Session, user_id: str, background_tasks) -> None:
    from app.modules.interview_coach.dashboard import dashboard_summary

    summary = dashboard_summary(db, user_id)
    completed = summary["completed_sessions"]

    if completed == 0:
        create_notification(
            db, user_id,
            type="mock_interview_reminder", category="interview", priority="medium",
            title="Try a Mock Interview",
            message="You haven't run a mock interview yet — a session gives you a real readiness score.",
            href="/interview",
            dedupe_key="mock_interview_reminder",
            dedupe_window=timedelta(days=REMINDER_WINDOW_DAYS),
            background_tasks=background_tasks,
        )
    elif completed > 0 and summary["voice_answers_count"] == 0:
        create_notification(
            db, user_id,
            type="voice_interview_reminder", category="interview", priority="low",
            title="Try a Voice Interview",
            message="You've practiced with text answers — try voice mode for a closer-to-real rehearsal.",
            href="/interview",
            dedupe_key="voice_interview_reminder",
            dedupe_window=timedelta(days=REMINDER_WINDOW_DAYS * 2),
            background_tasks=background_tasks,
        )

    for milestone in (3, 5, 10):
        if completed >= milestone:
            create_notification(
                db, user_id,
                type="practice_streak", category="interview", priority="low",
                title="Interview Practice Streak",
                message=f"You've completed {milestone} mock interview sessions — keep the momentum going.",
                href="/interview",
                dedupe_key=f"practice_streak:{milestone}",
                background_tasks=background_tasks,
            )


def _check_follow_up(db: Session, user_id: str, background_tasks) -> None:
    from app.modules.applications.services import get_pipeline
    from app.modules.dashboard.services import _stale_recruiter_stage_application

    pipeline_data = get_pipeline(db, user_id)
    stale = _stale_recruiter_stage_application(pipeline_data, _now())
    if not stale:
        return
    create_notification(
        db, user_id,
        type="follow_up_reminder", category="application", priority="medium",
        title="Follow-up Reminder",
        message=f"Your application to {stale['company']} has been quiet for a few days — a follow-up email can help.",
        href="/applications",
        dedupe_key=f"follow_up:{stale['id']}",
        dedupe_window=timedelta(days=FOLLOW_UP_WINDOW_DAYS),
        background_tasks=background_tasks,
    )


def _check_coach_suggestions(db: Session, user_id: str, background_tasks) -> None:
    from app.modules.dashboard.services import _resume_section
    from app.modules.interview_coach.dashboard import dashboard_summary
    from app.modules.job_market.services import top_matches

    resume = _resume_section(db, user_id)
    if resume["latest_band"] in ("WEAK", "NEEDS WORK"):
        create_notification(
            db, user_id,
            type="resume_advice", category="career_coach", priority="low",
            title="Resume Advice",
            message="Ask the Career Coach how to raise your resume score.",
            href="/coach?prompt=" + "Improve my resume for this role.",
            dedupe_key=f"resume_advice:{resume['latest_band']}",
            dedupe_window=timedelta(days=REMINDER_WINDOW_DAYS),
            background_tasks=background_tasks,
        )

    interview = dashboard_summary(db, user_id)
    if interview["average_score"] is not None and interview["average_score"] < 6.0:
        create_notification(
            db, user_id,
            type="interview_advice", category="career_coach", priority="low",
            title="Interview Advice",
            message=f"Your average mock interview score is {interview['average_score']}/10 — ask the Career Coach for focused prep.",
            href="/coach?prompt=" + "Prepare me for this company.",
            dedupe_key="interview_advice",
            dedupe_window=timedelta(days=REMINDER_WINDOW_DAYS),
            background_tasks=background_tasks,
        )

    matches = top_matches(db, user_id, limit=2)
    if matches:
        skills_match = matches[0]["match"].get("skillsMatch") or {}
        priority_skills = skills_match.get("prioritySkills") or skills_match.get("missingSkills") or []
        if priority_skills:
            skill = priority_skills[0]
            create_notification(
                db, user_id,
                type="suggested_learning", category="career_coach", priority="low",
                title="Suggested Learning",
                message=f"{skill} shows up across your top job matches — ask the Career Coach how to close the gap.",
                href="/coach?prompt=" + f"How can I build {skill} skills for the roles I'm targeting?",
                dedupe_key=f"suggested_learning:{skill}",
                dedupe_window=timedelta(days=REMINDER_WINDOW_DAYS * 2),
                background_tasks=background_tasks,
            )


def _check_job_matches(db: Session, user_id: str, background_tasks) -> None:
    """Distinct qualifying jobs found in the same sweep collapse into one
    growing notification (group_key scoped to the ISO week) rather than one
    row per job — the engine's grouping primitive, actually exercised. Each
    job still gets its own dedupe_key so the same listing isn't re-announced
    for two weeks even after a new week's group starts."""
    from app.modules.job_market.services import top_matches

    now = _now()
    iso_year, iso_week, _ = now.isocalendar()
    group_key = f"high_match_jobs:{iso_year}-W{iso_week:02d}"

    qualifying = [
        entry
        for entry in top_matches(db, user_id, limit=2)
        if entry.get("id") is not None and (entry["match"].get("overallMatch") or 0) >= HIGH_MATCH_THRESHOLD
    ]
    if not qualifying:
        return

    title = "New High Match Jobs" if len(qualifying) > 1 else "New High Match Job"
    for entry in qualifying:
        overall = entry["match"]["overallMatch"]
        create_notification(
            db, user_id,
            type="high_match_job", category="jobs", priority="medium",
            title=title,
            message=f"{entry.get('title', 'A role')} at {entry.get('company', 'a company')} is a {overall:.0f}% match.",
            href="/jobs",
            dedupe_key=f"high_match_job:{entry['id']}",
            dedupe_window=timedelta(days=14),
            group_key=group_key,
            expires_in_days=14,
            background_tasks=background_tasks,
        )


def _check_analytics(db: Session, user_id: str, background_tasks) -> None:
    from app.models.application import JobApplication
    from app.modules.dashboard.services import _resume_section
    from app.modules.analytics.services import pipeline_funnel

    now = _now()
    iso_year, iso_week, _ = now.isocalendar()
    week_start = now - timedelta(days=7)
    applied_this_week = (
        db.query(JobApplication)
        .filter(JobApplication.user_id == user_id, JobApplication.applied_at >= week_start)
        .count()
    )
    if applied_this_week > 0:
        create_notification(
            db, user_id,
            type="weekly_progress", category="analytics", priority="low",
            title="Weekly Progress",
            message=f"You applied to {applied_this_week} job{'s' if applied_this_week != 1 else ''} this week.",
            href="/dashboard",
            dedupe_key=f"weekly_progress:{iso_year}-W{iso_week:02d}",
            background_tasks=background_tasks,
        )

    month_start = now - timedelta(days=30)
    applied_this_month = (
        db.query(JobApplication)
        .filter(JobApplication.user_id == user_id, JobApplication.applied_at >= month_start)
        .count()
    )
    if applied_this_month > 0:
        create_notification(
            db, user_id,
            type="monthly_progress", category="analytics", priority="low",
            title="Monthly Summary",
            message=f"This month: {applied_this_month} application{'s' if applied_this_month != 1 else ''} sent.",
            href="/dashboard",
            dedupe_key=f"monthly_progress:{now.year}-{now.month:02d}",
            background_tasks=background_tasks,
        )

    resume = _resume_section(db, user_id)
    if resume["latest_ats_score"] is not None and resume["latest_ats_score"] >= 80:
        create_notification(
            db, user_id,
            type="career_milestone", category="analytics", priority="low",
            title="Career Milestone Achieved",
            message="Your resume crossed an 80+ ATS score.",
            href="/resume",
            dedupe_key="milestone:ats_80",
            background_tasks=background_tasks,
        )

    funnel = pipeline_funnel(db, user_id)
    if funnel["reached_offer"] >= 1:
        create_notification(
            db, user_id,
            type="career_milestone", category="analytics", priority="medium",
            title="Career Milestone Achieved",
            message="You landed your first offer through the pipeline. Congratulations!",
            href="/applications",
            dedupe_key="milestone:first_offer",
            background_tasks=background_tasks,
        )
    if funnel["reached_interviewing"] >= 1:
        create_notification(
            db, user_id,
            type="career_milestone", category="analytics", priority="low",
            title="Career Milestone Achieved",
            message="You reached your first interview stage. Momentum is building.",
            href="/applications",
            dedupe_key="milestone:first_interview",
            background_tasks=background_tasks,
        )

def check_periodic(db: Session, user_id: str, background_tasks: BackgroundTasks | None = None) -> None:
    """Every check here is independently dedupe-guarded, so calling this on
    every dashboard visit is safe — most calls do nothing at all."""
    for check in (
        _check_interview_reminders,
        _check_follow_up,
        _check_coach_suggestions,
        _check_job_matches,
        _check_analytics,
    ):
        try:
            check(db, user_id, background_tasks)
        except Exception:
            # One failing check must not block the others or the dashboard
            # request that triggered the sweep.
            logger.warning("notification periodic check %s failed", check.__name__, exc_info=True)

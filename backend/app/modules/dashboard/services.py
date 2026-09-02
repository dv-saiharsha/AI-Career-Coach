"""Dashboard overview: fresh job matches and the pipeline metrics.

home() (Milestone 9) is a second, larger entry point living in this same
file: the Career Dashboard's one request, composing the Resume, Job
Matching, Interview, Application, and Career Coach engines' own existing
functions. It computes nothing those engines don't already compute —
see each section below for exactly which function it reuses.
"""

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, defer

from app.core.config import settings
from app.models.application import APPLICATION_STATUSES, INTERVIEW_STAGES, JobApplication
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.ml.inference import model_available, predict_score
from app.modules.analytics.services import progress_buckets, summary as analytics_summary
from app.modules.applications.services import get_pipeline
from app.modules.interview_coach import prep as interview_prep
from app.modules.interview_coach.dashboard import dashboard_summary as interview_summary
from app.modules.job_market.services import top_matches
from app.modules.resume_analyzer.rubric import band
from app.modules.user_profile.services import dashboard_stats, recent_activity

logger = logging.getLogger(__name__)

# Stages that mean the pipeline is actively moving on this application —
# past "saved" (a bookmark) and short of a terminal outcome either way.
ACTIVE_STAGES = ("applied", *INTERVIEW_STAGES)
POSITIVE_TERMINAL_STAGES = ("offer", "accepted")
NEGATIVE_TERMINAL_STAGES = ("rejected", "withdrawn")

# A recruiter-stage application untouched this long is worth a nudge — not
# so short that a normal review cycle triggers it, not so long the
# suggestion arrives after the user already moved on themselves.
FOLLOW_UP_STALE_DAYS = 5

# Freshness is measured on posted_at — when the employer listed the role — not
# fetched_at, which is when we happened to scrape it. A sweep run an hour ago
# makes every row's fetched_at an hour old, so filtering on it would label a
# three-week-old posting "1h ago". That is the difference between a useful
# signal and a misleading one.
FRESH_HOURS = 10

# Nothing older than this is shown anywhere. Job postings go stale fast and an
# expired listing wastes an application.
WINDOW_DAYS = 7

MAX_FRESH_JOBS = 6
MIN_FRESH_BEFORE_WIDENING = 4


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; Postgres aware ones."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _posted_label(posted_at: datetime | None, now: datetime) -> str:
    posted = _as_utc(posted_at)
    if posted is None:
        # Unknown, not "just now" — a missing date is not a fresh one.
        return "Date not listed"
    hours = int((now - posted).total_seconds() // 3600)
    if hours < 1:
        return "Just now"
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def fresh_jobs(db: Session, now: datetime | None = None) -> tuple[list[JobListing], str]:
    """Recently *posted* listings, widening the window only if too few.

    Returns the rows and a label naming the window actually used, so the UI
    states "last 7 days" rather than implying everything shown is hours old.
    """
    now = now or datetime.now(timezone.utc)
    window_floor = now - timedelta(days=WINDOW_DAYS)

    def query(floor: datetime):
        return (
            db.query(JobListing)
            .options(defer(JobListing.description))
            .filter(JobListing.posted_at.isnot(None), JobListing.posted_at >= floor)
            .order_by(JobListing.posted_at.desc())
            .limit(MAX_FRESH_JOBS)
            .all()
        )

    rows = query(now - timedelta(hours=FRESH_HOURS))
    if len(rows) >= MIN_FRESH_BEFORE_WIDENING:
        return rows, f"last {FRESH_HOURS} hours"

    # Widened rather than padded: showing six cards labelled "fresh" when only
    # one is would be the misleading version of this fallback.
    return query(window_floor), f"last {WINDOW_DAYS} days"


def _latest_scan(db: Session, user_id: str) -> ResumeAnalysis | None:
    """The user's most recent scan. Fetched once and shared — both the
    headline score and the pipeline scorer need it, and querying twice for the
    same row is a round-trip to us-east-1 for nothing."""
    return (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )


# Stages that mean an application was actually sent. "saved" is a bookmark,
# not an application, and counting it would inflate the number a user reads as
# "how many jobs have I applied to". Every other stage counts — sourced from
# the model's own tuple rather than repeated here, so a future stage addition
# can't silently fall out of this count the way a second hardcoded list would.
SENT_STAGES = tuple(stage for stage in APPLICATION_STATUSES if stage != "saved")

# Scored lazily, but bounded. Each score is a ~127ms model call, so a first
# load on a large pipeline stays under a second rather than scaling with it;
# the rest fill in on subsequent loads.
MAX_SCORES_PER_REQUEST = 5


def _pipeline_metrics(db: Session, user_id: str, resume_text: str | None) -> dict:
    """Applications sent, and how well the resume matches them.

    Scores are computed once and stored on the row. Applications with no
    stored job description cannot be scored at all and are left NULL — they
    are excluded from the average rather than counted as zero, which would
    drag the figure down for postings nobody measured.
    """
    rows = db.query(JobApplication).filter(JobApplication.user_id == user_id).all()

    by_stage = {stage: 0 for stage in APPLICATION_STATUSES}
    for row in rows:
        if row.status in by_stage:
            by_stage[row.status] += 1
    total_sent = sum(by_stage[stage] for stage in SENT_STAGES)

    if resume_text and model_available():
        scored = 0
        for row in rows:
            if scored >= MAX_SCORES_PER_REQUEST:
                break
            if row.match_score is not None or not row.job_description:
                continue
            row.match_score = float(predict_score(resume_text, row.job_description))
            scored += 1
        if scored:
            db.commit()

    measured = [r.match_score for r in rows if r.match_score is not None]
    return {
        "total_applied": total_sent,
        "by_stage": by_stage,
        # None, not 0.0, when nothing has been scored: "0% match" reads as a
        # terrible resume, where no measurement is simply no measurement.
        "average_match_score": round(sum(measured) / len(measured), 1) if measured else None,
        "scored_applications": len(measured),
        "total_applications": len(rows),
    }


def overview(db: Session, user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    rows, window_label = fresh_jobs(db, now)

    # The headline score is the user's latest scan against whatever JD it
    # used — not re-scored per job card. predict_score is a real model call,
    # and running it across six listings inside a dashboard request would make
    # the page slow for a number the user cannot act on from a card.
    latest = _latest_scan(db, user_id)
    score = round(float(latest.ats_score or 0), 1) if latest else None
    scored_against = latest.resume_filename if latest else None
    metrics = _pipeline_metrics(db, user_id, latest.resume_text if latest else None)

    cards = [
        {
            "id": str(row.id),
            "title": row.title,
            "company": row.company,
            "location": row.location,
            "work_mode": row.work_mode,
            "posted_label": _posted_label(row.posted_at, now),
            # Verbatim from the posting when it stated one, null when it did
            # not. Never a range derived from the title or the location —
            # a guessed salary is the number a candidate would most regret
            # trusting.
            "salary_range": row.salary_range,
            "h1b_sponsorship": row.h1b_sponsorship,
            # Verbatim from the posting, so a candidate can judge the claim
            # rather than trust a badge.
            "h1b_evidence": row.h1b_evidence,
            "experience_level": row.experience_level,
            "apply_url": row.apply_url,
        }
        for row in rows
    ]

    return {
        "metrics": metrics,
        "fresh_jobs": cards,
        "fresh_window": window_label,
        # One figure for the whole dashboard, not a per-card fabrication.
        "latest_ats_score": score,
        "scored_against": scored_against,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Career Dashboard (Milestone 9) — GET /api/dashboard/home
#
# Every section below calls an existing engine's own function. Nothing here
# recomputes a score, refits a match, or re-derives a figure another module
# already owns — this file only composes and, where named in the spec but
# genuinely missing (marked "new"), adds a small aggregate next to the data
# it aggregates rather than reaching across module boundaries for it.
# ═══════════════════════════════════════════════════════════════════════════


def _resume_section(db: Session, user_id: str) -> dict:
    """Resume Health / ATS Score / Resume Version / Resume Match.

    dashboard_stats (user_profile) already owns avg/latest ATS; this adds
    only what that function doesn't return — the latest scan's filename,
    band, and stored missing_skills, all already computed and stored at
    scan time, read here rather than recomputed.
    """
    stats = dashboard_stats(db, user_id)
    latest = _latest_scan(db, user_id)

    missing_skills: list[str] = []
    if latest:
        try:
            missing_skills = (json.loads(latest.result_json) or {}).get("missing_skills", [])
        except (ValueError, TypeError):
            pass

    return {
        "resumes_analyzed": stats["resumes_analyzed"],
        "avg_ats_score": stats["avg_ats_score"],
        "latest_ats_score": stats["latest_ats_score"],
        "latest_band": band(latest.ats_score) if latest else "NOT CHECKED",
        "latest_filename": latest.resume_filename if latest else None,
        "suggested_improvements": missing_skills[:5],
    }


def _applications_section(pipeline_data: dict, funnel: dict) -> dict:
    """Total / Active / Offers / Rejections / Success rate — every figure
    either a stage-count already in get_pipeline's response, or
    funnel['offer_rate'] (analytics.pipeline_funnel), never recomputed."""
    by_stage = pipeline_data["pipeline"]
    return {
        "total": pipeline_data["total"],
        "active": sum(len(by_stage.get(stage, [])) for stage in ACTIVE_STAGES),
        "offers": sum(len(by_stage.get(stage, [])) for stage in POSITIVE_TERMINAL_STAGES),
        "rejections": sum(len(by_stage.get(stage, [])) for stage in NEGATIVE_TERMINAL_STAGES),
        # None, not 0.0, when nothing has been applied to yet — matches
        # funnel's own convention for "no data" vs. a genuine 0%.
        "success_rate": funnel["offer_rate"],
    }


def _latest_openings(db: Session, limit: int = 6) -> list[dict]:
    """The freshest listings in the cache, matched or not.

    Exists so the dashboard can lead with openings for someone who has never
    scanned anything. top_matches returns [] without a resume, which is
    correct — it cannot rank against nothing — but it meant a new account's
    first screen had no jobs on it at all, which is the one thing this product
    always has to show.

    No match scores here, deliberately. A number would have to be invented,
    and the panel says "latest openings" rather than implying a fit nobody
    computed.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.JOB_MAX_AGE_DAYS)
    rows = (
        db.query(JobListing)
        .filter(JobListing.posted_at >= cutoff)
        .order_by(JobListing.posted_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": str(row.id),
            "title": row.title,
            "company": row.company,
            "location": row.location or "",
            "workMode": row.work_mode or "On-site",
            "salaryRange": row.salary_range or "",
            "skills": [],
            "postedDaysAgo": max(
                0, (datetime.now(timezone.utc) - row.posted_at).days
            ) if row.posted_at else 0,
            "applyUrl": row.apply_url or "",
        }
        for row in rows
    ]


def _jobs_section(db: Session, user_id: str) -> dict:
    """Top Matching Jobs / Missing Skills / Recruiter Perspective — all
    read off job_market.services.top_matches, which itself reuses
    matching.attach_matches verbatim. [] when there's no primary resume to
    match against, not an error.

    `latest` is always populated regardless, so the dashboard can lead with
    real openings before a resume exists.
    """
    latest = _latest_openings(db)
    matches = top_matches(db, user_id, limit=5)
    if not matches:
        return {
            "top_matches": [],
            "latest": latest,
            "missing_skills": [],
            "recruiter_perspective": None,
        }

    top = matches[0]
    skills_match = top["match"].get("skillsMatch") or {}
    return {
        "top_matches": matches,
        "latest": latest,
        # Already ranked by cross-listing frequency (annotate_priority_skills,
        # called inside attach_matches) — the skill most worth closing given
        # everything else this user is currently matched against.
        "missing_skills": skills_match.get("prioritySkills") or skills_match.get("missingSkills", []),
        "recruiter_perspective": top["match"].get("explanation"),
    }


def _activity_section(db: Session, user_id: str, pipeline_data: dict) -> dict:
    """Recent Activity / Upcoming Interviews / Recent Applications.

    "Upcoming interviews" means what it can honestly mean here: applications
    currently sitting at an interview stage. Nothing in this schema tracks a
    scheduled date, so this is not a calendar — it's real pipeline state,
    not a fabricated one.
    """
    by_stage = pipeline_data["pipeline"]
    upcoming = [app for stage in INTERVIEW_STAGES for app in by_stage.get(stage, [])]

    all_apps = [app for apps in by_stage.values() for app in apps]
    all_apps.sort(key=lambda a: a["updated_at"] or "", reverse=True)

    return {
        "recent_activity": recent_activity(db, user_id),
        "upcoming_interviews": upcoming[:5],
        "recent_applications": all_apps[:5],
    }


def _stale_recruiter_stage_application(pipeline_data: dict, now: datetime) -> dict | None:
    """The oldest-touched application still sitting at an early interview
    stage with a recruiter contact on file — what "Follow Up With
    Recruiter" points at, if anything currently warrants it."""
    by_stage = pipeline_data["pipeline"]
    candidates = [
        app
        for stage in ("recruiter_contacted", "recruiter_screening")
        for app in by_stage.get(stage, [])
        if app.get("recruiter_email") and app.get("updated_at")
    ]
    stale = [
        app for app in candidates
        if (now - _as_utc(datetime.fromisoformat(app["updated_at"].replace("Z", "+00:00")))).days >= FOLLOW_UP_STALE_DAYS
    ]
    stale.sort(key=lambda a: a["updated_at"])
    return stale[0] if stale else None


def _next_actions_for_dashboard(
    resume: dict, applications_section: dict, interview: dict, jobs: dict, pipeline_data: dict, now: datetime
) -> list[dict]:
    """Deterministic, not LLM-generated — the same {key,label,description,
    href,priority} shape resume_analyzer/review.py's own _next_actions and
    the Mock Interview report's next_actions already use, applied here for
    the fourth time rather than inventing a new suggestion format."""
    actions: list[dict] = []

    if resume["latest_band"] in ("NOT CHECKED", "WEAK", "NEEDS WORK"):
        actions.append({
            "key": "improve_resume",
            "label": "Improve Resume",
            "description": (
                "You haven't scanned a resume yet." if resume["latest_band"] == "NOT CHECKED"
                else f"Your latest resume scored {resume['latest_band']} — a few fixes could move it up a band."
            ),
            "href": "/resume",
            "priority": "high" if resume["latest_band"] != "GOOD" else "medium",
        })

    if interview["completed_sessions"] == 0:
        actions.append({
            "key": "practice_interview",
            "label": "Practice Interview",
            "description": "You haven't completed a mock interview yet — a session gives you a real readiness score.",
            "href": "/interview",
            "priority": "high",
        })
    elif interview["average_score"] is not None and interview["average_score"] < 6.0:
        actions.append({
            "key": "practice_interview",
            "label": "Practice Interview",
            "description": f"Your average mock interview score is {interview['average_score']}/10 — more practice would help.",
            "href": "/interview",
            "priority": "medium",
        })

    if applications_section["active"] == 0 and applications_section["total"] < 3:
        actions.append({
            "key": "apply_to_jobs",
            "label": "Apply to Matching Jobs",
            "description": "Your pipeline is quiet — browse jobs matched against your resume.",
            "href": "/jobs",
            "priority": "high",
        })

    stale_application = _stale_recruiter_stage_application(pipeline_data, now)
    if stale_application:
        actions.append({
            "key": "follow_up_recruiter",
            "label": "Follow Up With Recruiter",
            "description": f"Your application to {stale_application['company']} has been quiet for a few days — a follow-up email can help.",
            "href": "/applications",
            "priority": "medium",
        })

    if jobs["missing_skills"]:
        actions.append({
            "key": "review_missing_skills",
            "label": "Review Missing Skills",
            "description": f"{', '.join(jobs['missing_skills'][:2])} shows up across your top matches.",
            "href": "/jobs",
            "priority": "medium",
        })

    # Every action above is conditional, so a user with nothing wrong has
    # none — and an empty panel on the dashboard reads as broken rather than
    # as "you are on top of it". "Open Career Coach" used to be the
    # unconditional last entry and did this job incidentally; with it gone
    # the fallback has to be stated.
    #
    # Deliberately not an invented task. Keeping applications moving is the
    # one thing that is always true for someone with a live pipeline, and
    # reviewing the board is where that starts.
    if not actions:
        has_pipeline = applications_section["total"] > 0
        actions.append({
            "key": "review_pipeline" if has_pipeline else "apply_to_jobs",
            "label": "Review your pipeline" if has_pipeline else "Find roles to apply for",
            "description": (
                "Nothing needs fixing right now. Keeping what you have sent moving is the next thing."
                if has_pipeline
                else "Nothing needs fixing right now. The next step is finding roles worth applying to."
            ),
            "href": "/applications" if has_pipeline else "/jobs",
            "priority": "low",
        })

    return actions


def home(db: Session, user_id: str) -> dict:
    """The Career Dashboard's one request. See the section functions above
    for exactly which existing engine each figure comes from."""
    now = datetime.now(timezone.utc)

    resume = _resume_section(db, user_id)
    pipeline_data = get_pipeline(db, user_id)
    analytics = analytics_summary(db, user_id)
    interview = interview_summary(db, user_id)
    prep_progress = interview_prep.dashboard_progress(db, user_id)
    jobs = _jobs_section(db, user_id)
    applications_section = _applications_section(pipeline_data, analytics["funnel"])
    activity = _activity_section(db, user_id, pipeline_data)

    return {
        "resume": resume,
        "applications": applications_section,
        "interview": {**interview, "prep_completed_count": prep_progress["completed_count"]},
        "jobs": jobs,
        "activity": activity,
        "analytics": {
            "ats_history": analytics["ats_history"],
            "weekly_progress": progress_buckets(analytics["ats_history"], "week"),
            "monthly_progress": progress_buckets(analytics["ats_history"], "month"),
            "funnel": analytics["funnel"],
        },
        "next_actions": _next_actions_for_dashboard(resume, applications_section, interview, jobs, pipeline_data, now),
    }

"""Dashboard overview: fresh job matches plus real policy news."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, defer

from app.models.application import JobApplication
from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
from app.ml.inference import model_available, predict_score
from app.modules.dashboard import news

logger = logging.getLogger(__name__)

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
# "how many jobs have I applied to".
SENT_STAGES = ("applied", "interviewing", "offer", "rejected")

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

    by_stage = {stage: 0 for stage in ("saved", "applied", "interviewing", "offer", "rejected")}
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
            "h1b_sponsorship": row.h1b_sponsorship,
            # Verbatim from the posting, so a candidate can judge the claim
            # rather than trust a badge.
            "h1b_evidence": row.h1b_evidence,
            "experience_level": row.experience_level,
            "apply_url": row.apply_url,
        }
        for row in rows
    ]

    feed = news.fetch_immigration_news()
    return {
        "metrics": metrics,
        "fresh_jobs": cards,
        "fresh_window": window_label,
        # One figure for the whole dashboard, not a per-card fabrication.
        "latest_ats_score": score,
        "scored_against": scored_against,
        "news": feed["articles"],
        "news_reachable": feed["reachable"],
        "news_cached": feed["cached"],
    }

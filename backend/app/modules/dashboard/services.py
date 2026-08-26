"""Dashboard overview: fresh job matches plus real policy news."""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, defer

from app.models.job import JobListing
from app.models.resume import ResumeAnalysis
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


def _match_score(db: Session, user_id: str) -> tuple[float | None, str | None]:
    """The user's most recent ATS score, and what it was scored against.

    Deliberately not re-scored per job card. predict_score is a real model
    call, and running it across six listings inside a dashboard request would
    make the page slow for a number the user cannot act on from a card. The
    honest framing is "your latest resume score", not "your match for this
    job" — so the label says which resume it came from.
    """
    latest = (
        db.query(ResumeAnalysis)
        .filter(ResumeAnalysis.user_id == user_id)
        .order_by(ResumeAnalysis.created_at.desc())
        .first()
    )
    if not latest:
        return None, None
    return round(float(latest.ats_score or 0), 1), latest.resume_filename


def overview(db: Session, user_id: str) -> dict:
    now = datetime.now(timezone.utc)
    rows, window_label = fresh_jobs(db, now)
    score, scored_against = _match_score(db, user_id)

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
        "fresh_jobs": cards,
        "fresh_window": window_label,
        # One figure for the whole dashboard, not a per-card fabrication.
        "latest_ats_score": score,
        "scored_against": scored_against,
        "news": feed["articles"],
        "news_reachable": feed["reachable"],
        "news_cached": feed["cached"],
    }

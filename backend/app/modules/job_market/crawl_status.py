"""What the crawl worker (app/worker.py) is doing, read from crawl_runs.

The worker runs in its own process, so its state is read from the database it
writes: the latest run (any trigger) for the counts, the latest scheduled run
for the next time. Nothing here starts or stops anything.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.crawl_run import CrawlRun

# A run with no end that started longer ago than this is a crashed run, not a
# running one (the worker's Redis lock expires on the same horizon).
RUN_TIMEOUT = timedelta(minutes=55)
# How late the next scheduled run may be before the worker is reported as not
# keeping its schedule.
OVERDUE_GRACE = timedelta(minutes=10)


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _run_summary(run: CrawlRun) -> dict:
    stats = json.loads(run.stats or "{}")
    started, ended = _utc(run.started_at), _utc(run.ended_at)
    return {
        "id": run.id,
        "trigger": run.trigger,
        "started_at": _iso(started),
        "ended_at": _iso(ended),
        "duration_seconds": round((ended - started).total_seconds()) if started and ended else None,
        "companies_attempted": run.companies_attempted,
        "companies_succeeded": run.companies_succeeded,
        "companies_failed": run.companies_failed,
        "postings_fetched": stats.get("fetched", 0),
        "jobs_new": run.jobs_new,
        "jobs_updated": run.jobs_updated,
        "duplicates": stats.get("duplicates", 0),
        "jobs_closed": run.jobs_closed,
        "enriched": (stats.get("enrichment") or {}).get("enriched", 0),
        "by_crawler": stats.get("by_crawler", {}),
        "errors": json.loads(run.errors or "[]")[:10],
    }


def scheduler_status(db: Session, now: datetime | None = None) -> dict:
    """last_run (counts), running (yes/no), next_run_at, and whether the
    worker is keeping its schedule (overdue)."""
    now = now or datetime.now(timezone.utc)
    interval = timedelta(seconds=settings.CRAWL_INTERVAL_SECONDS)
    latest = db.query(CrawlRun).order_by(CrawlRun.started_at.desc(), CrawlRun.id.desc()).first()
    last_scheduled = (
        db.query(CrawlRun)
        .filter(CrawlRun.trigger == "scheduled")
        .order_by(CrawlRun.started_at.desc(), CrawlRun.id.desc())
        .first()
    )
    running = bool(
        latest is not None and latest.ended_at is None and now - _utc(latest.started_at) < RUN_TIMEOUT
    )
    next_run = _utc(last_scheduled.started_at) + interval if last_scheduled else None
    finished = latest if latest is None or latest.ended_at is not None else (
        db.query(CrawlRun).filter(CrawlRun.ended_at.isnot(None))
        .order_by(CrawlRun.started_at.desc(), CrawlRun.id.desc()).first()
    )
    return {
        "interval_seconds": settings.CRAWL_INTERVAL_SECONDS,
        "running": running,
        "last_run": _run_summary(finished) if finished is not None else None,
        "last_run_at": _iso(_utc(finished.started_at)) if finished is not None else None,
        "next_run_at": _iso(next_run),
        # The next scheduled run is well past due: the worker is not running.
        "overdue": bool(next_run and not running and now > next_run + OVERDUE_GRACE),
    }

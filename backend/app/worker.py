"""Standalone process for the hourly companies-table crawl
(job_market/crawler.py).

    python -m app.worker          # the loop: a run every CRAWL_INTERVAL_SECONDS
    python -m app.worker --once   # one run, then exit (a Cloud Run Job on a schedule)

Runs in its own container — see docker-compose.yml's `worker` service — not
inside the API process. That is the whole point: a crawl blocking a web
request just because they happen to share a process is exactly what this
plan asked to stop being true. (This is distinct from job_market/
scheduler.py's older, still-present in-process board sweep — see
job_market/crawler.py's own module docstring for why the two coexist rather
than one replacing the other outright.)

Every run takes a lock, so two crawls never overlap: a scheduled tick, a
second worker, or an admin-triggered crawl that finds a run in progress logs
that it skipped and does nothing. The lock is Redis when REDIS_URL is set (more
than one replica), otherwise a Postgres advisory lock held for the run (one
machine, local Postgres), otherwise a file lock (SQLite in tests and dev).

Runs start every CRAWL_INTERVAL_SECONDS (3600), measured from the start of the
previous run; each run is recorded in crawl_runs (counts per crawler in
stats), which GET /api/jobs/scheduler-status reads.
"""

from __future__ import annotations

import contextlib
import fcntl
import logging
import os
import tempfile
import time
import uuid

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.llm import background
from app.modules.job_market.crawler import run_crawl

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = settings.CRAWL_INTERVAL_SECONDS
# A crawl during boot competes with the container still starting up, and
# nothing is stale enough at second zero to be worth it — same reasoning as
# scheduler.STARTUP_DELAY_SECONDS.
STARTUP_DELAY_SECONDS = 30

LOCK_KEY = "job_crawler:lock"
# Postgres advisory lock id for the crawl (any constant; documented here).
ADVISORY_LOCK_ID = 7_301_420_001
LOCK_FILE = os.path.join(tempfile.gettempdir(), "hireloom-crawl.lock")
# Under the hourly cadence, deliberately: a run that hung long enough to
# reach this would have its lock expire before the next tick tries anyway,
# rather than a crashed process wedging the crawl shut forever behind a lock
# nothing will ever release.
LOCK_TTL_SECONDS = 55 * 60

# Compare-and-delete: only clears the lock if it still holds the token this
# process set, so a run that outlived its own TTL (another process already
# acquired the lock by the time this one finishes) can't delete a lock that
# is no longer its own.
_RELEASE_SCRIPT = (
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end"
)


def _redis_client():
    if not settings.REDIS_URL:
        return None
    import redis

    return redis.Redis.from_url(settings.REDIS_URL)


def _run_once(
    trigger: str = "scheduled", triggered_by: str | None = None, company_ids: list[int] | None = None
) -> None:
    db = SessionLocal()
    try:
        # Background work: enrichment calls get OLLAMA_TIMEOUT_BACKGROUND_SECONDS.
        with background():
            run = run_crawl(db, trigger=trigger, triggered_by=triggered_by, company_ids=company_ids)
        logger.info(
            "crawl run %s: %d/%d companies ok, %d new, %d updated, %d closed",
            run.id, run.companies_succeeded, run.companies_attempted,
            run.jobs_new, run.jobs_updated, run.jobs_closed,
        )
        from app.modules.job_market import alerting

        alerting.check_and_alert(db, run)
    except Exception:
        logger.exception("crawl run failed")
    finally:
        db.close()


@contextlib.contextmanager
def _local_lock():
    """The crawl lock without Redis: yields True when this process holds it,
    False when another run does. A Postgres advisory lock on its own
    connection when the database is Postgres, otherwise an exclusive file
    lock. Both are released if the process dies."""
    if settings.DB_URL.startswith("postgres"):
        from sqlalchemy import text

        from app.core.database import engine

        with engine.connect() as conn:
            got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": ADVISORY_LOCK_ID}).scalar())
            try:
                yield got
            finally:
                if got:
                    conn.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": ADVISORY_LOCK_ID})
        return
    handle = open(LOCK_FILE, "w")
    try:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
    finally:
        handle.close()


def run_locked(
    trigger: str = "scheduled", triggered_by: str | None = None, company_ids: list[int] | None = None
) -> bool:
    """Acquire the crawl lock and run once; False when another run holds it
    (logged, nothing done).

    Used by both the scheduled loop below and the admin API's manual-trigger
    endpoints (job_market/admin_router.py), so a manually triggered crawl can
    never overlap the scheduled one — it either gets the lock or skips,
    exactly like a scheduled tick that lost the race would.
    """
    client = _redis_client()
    if client is None:
        with _local_lock() as acquired:
            if not acquired:
                logger.info("crawl skipped (%s): a crawl is still running", trigger)
                return False
            _run_once(trigger, triggered_by, company_ids)
        return True

    token = uuid.uuid4().hex
    acquired = client.set(LOCK_KEY, token, nx=True, ex=LOCK_TTL_SECONDS)
    if not acquired:
        logger.info("crawl skipped (%s): a crawl is still running", trigger)
        return False
    try:
        _run_once(trigger, triggered_by, company_ids)
        return True
    finally:
        try:
            client.eval(_RELEASE_SCRIPT, 1, LOCK_KEY, token)
        except Exception:
            logger.warning("failed to release crawl lock (will expire on its own)", exc_info=True)


def _lock_kind() -> str:
    if settings.REDIS_URL:
        return "redis"
    return "postgres advisory" if settings.DB_URL.startswith("postgres") else "file"


def main(max_runs: int | None = None, sleep=time.sleep, clock=time.monotonic) -> None:
    """The hourly loop: a run every INTERVAL_SECONDS from the start of the
    previous one (a long run shortens the wait, never shifts the schedule).
    max_runs, sleep and clock exist for tests."""
    logging.basicConfig(
        level=settings.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logger.info("crawl worker starting (interval=%ds, lock=%s)", INTERVAL_SECONDS, _lock_kind())
    sleep(STARTUP_DELAY_SECONDS)
    runs = 0
    while max_runs is None or runs < max_runs:
        started = clock()
        logger.info("crawl tick: starting")
        try:
            run_locked()
        except Exception:  # noqa: BLE001 - one failed tick must not end the loop
            logger.exception("crawl tick failed")
        runs += 1
        if max_runs is not None and runs >= max_runs:
            break
        wait = max(0.0, INTERVAL_SECONDS - (clock() - started))
        logger.info("crawl tick: next run in %ds", int(wait))
        sleep(wait)


def run_once() -> int:
    """One locked crawl, then exit: the Cloud Run Job form, where Cloud
    Scheduler owns the cadence instead of this process's loop. No startup
    delay (the job has nothing else starting up). Exit 0 for a finished run
    or one skipped because another holds the lock; 1 for a failed run, so
    the job execution is marked failed and retried."""
    logging.basicConfig(
        level=settings.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logger.info("crawl worker: single run (lock=%s)", _lock_kind())
    try:
        run_locked()
    except Exception:  # noqa: BLE001 - reported through the exit code
        logger.exception("crawl run failed")
        return 1
    return 0


if __name__ == "__main__":
    import sys

    if "--once" in sys.argv[1:]:
        sys.exit(run_once())
    main()

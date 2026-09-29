"""Standalone process for the hourly companies-table crawl
(job_market/crawler.py).

    python -m app.worker

Runs in its own container — see docker-compose.yml's `worker` service — not
inside the API process. That is the whole point: a crawl blocking a web
request just because they happen to share a process is exactly what this
plan asked to stop being true. (This is distinct from job_market/
scheduler.py's older, still-present in-process board sweep — see
job_market/crawler.py's own module docstring for why the two coexist rather
than one replacing the other outright.)

Guarded by a Redis distributed lock when REDIS_URL is set, so scaling this
service to more than one replica can never run two crawls at once — a run
either gets the lock or skips this tick entirely, matching "the next run
waits or skips" from the plan rather than queuing work up. Without
REDIS_URL (a single local process) the lock is skipped outright: there is
nothing else it could collide with.
"""

from __future__ import annotations

import logging
import time
import uuid

from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.job_market.crawler import run_crawl

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 3600
# A crawl during boot competes with the container still starting up, and
# nothing is stale enough at second zero to be worth it — same reasoning as
# scheduler.STARTUP_DELAY_SECONDS.
STARTUP_DELAY_SECONDS = 30

LOCK_KEY = "job_crawler:lock"
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


def run_locked(
    trigger: str = "scheduled", triggered_by: str | None = None, company_ids: list[int] | None = None
) -> None:
    """Acquire the crawl lock (when Redis is configured) and run once.

    Used by both the scheduled loop below and the admin API's manual-trigger
    endpoints (job_market/admin_router.py), so a manually triggered crawl can
    never overlap the scheduled one — it either gets the lock or skips,
    exactly like a scheduled tick that lost the race would.
    """
    client = _redis_client()
    if client is None:
        _run_once(trigger, triggered_by, company_ids)
        return

    token = uuid.uuid4().hex
    acquired = client.set(LOCK_KEY, token, nx=True, ex=LOCK_TTL_SECONDS)
    if not acquired:
        logger.info("crawl lock already held by another process — skipping")
        return
    try:
        _run_once(trigger, triggered_by, company_ids)
    finally:
        try:
            client.eval(_RELEASE_SCRIPT, 1, LOCK_KEY, token)
        except Exception:
            logger.warning("failed to release crawl lock (will expire on its own)", exc_info=True)


def main() -> None:
    logging.basicConfig(
        level=settings.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    logger.info(
        "crawl worker starting (interval=%ds, lock=%s)",
        INTERVAL_SECONDS, "redis" if settings.REDIS_URL else "none (single process)",
    )
    time.sleep(STARTUP_DELAY_SECONDS)
    while True:
        run_locked()
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

"""Hourly refresh of the job feed from employers' own ATS boards.

WHAT THIS DOES AND DELIBERATELY DOES NOT DO

It runs the FREE half of the sweep — Greenhouse and Lever board reads — and
nothing else. It never calls Apify and never calls Claude.

That restriction is the whole reason this can exist as a timer at all. The
Apify pass bills per actor run and the enrichment pass bills per posting;
putting either on a schedule means money leaving the account on a clock with
nobody watching, and a bug in the loop is then a bug that spends. The board
reads cost nothing, so the worst case here is wasted requests to endpoints
that are already tolerating us.

The paid sweep stays exactly where it was: refresh_global_jobs(dry_run=False),
run by a human who has decided to spend.

WHY A TASK RATHER THAN CRON

The UI has always said "checked hourly", and that referred to the client
polling rather than to anything server-side actually being on a schedule — the
comment in jobs/page.tsx was careful to say so. It is now true of the data as
well, which is what lets the page show a real next-sync time instead of an
implied one.

An asyncio task in the app's lifespan is the smallest thing that makes it
true. It needs no new process, no external scheduler and no deployment
change. The cost is that it runs per worker, so N workers do N sweeps — see
INTERVAL_JITTER_SECONDS for how that is kept from becoming a stampede, and
note that upserts are idempotent on content_hash so duplicate work is wasteful
rather than wrong.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

from app.core.database import SessionLocal

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 3600

# Spread concurrent workers apart so they do not all hit Greenhouse in the
# same second. Small relative to the interval, large enough to decorrelate.
INTERVAL_JITTER_SECONDS = 120

# Wait before the first run. A sweep during boot competes with the traffic
# that just started the process, and the feed is not stale enough at second
# zero to be worth it.
STARTUP_DELAY_SECONDS = 90

# When the next run is expected. Read by the API so the UI can show a real
# time rather than implying a cadence. None until the first run completes —
# an unstarted scheduler must not advertise a schedule.
_next_run_at: datetime | None = None


def next_run_at() -> datetime | None:
    return _next_run_at


def run_board_sweep_once() -> int:
    """One pass over every registered board. Returns rows upserted.

    Synchronous and self-contained: opens its own session, commits, closes.
    Called from a thread by the loop below so the event loop is never blocked
    by the network reads or the writes.
    """
    # Imported here rather than at module scope to keep the import graph
    # acyclic — ingestion imports from job_market, and this module is
    # imported by main.py at startup.
    from app.modules.job_market import ingestion

    db = SessionLocal()
    try:
        report = ingestion.SweepReport(dry_run=False)
        candidates = ingestion._collect_boards(report)
        # No enrichment. That is a Claude batch and it bills per posting; the
        # rows land with enriched_at NULL and the UI already renders that as
        # "not yet classified" rather than guessing sponsorship or seniority.
        ingestion._upsert(db, candidates, {}, report)
        db.commit()
        logger.info(
            "board sweep: %d boards -> %d postings, %d rows upserted",
            report.boards_swept,
            report.board_postings,
            report.rows_upserted,
        )
        return report.rows_upserted
    except Exception:
        db.rollback()
        # Logged and swallowed. A failed refresh must not kill the loop — the
        # feed simply stays as fresh as it was, which is the correct
        # degradation, and the next tick tries again.
        logger.exception("board sweep failed")
        return 0
    finally:
        db.close()


async def _loop() -> None:
    global _next_run_at

    await asyncio.sleep(STARTUP_DELAY_SECONDS)

    while True:
        try:
            # to_thread because the board reads are blocking urllib calls and
            # the upsert is blocking SQLAlchemy. Running either inline would
            # stall every request being served by this worker for the ~35s the
            # sweep takes.
            await asyncio.to_thread(run_board_sweep_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("board sweep loop iteration failed")

        delay = INTERVAL_SECONDS + random.uniform(0, INTERVAL_JITTER_SECONDS)
        _next_run_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
        await asyncio.sleep(delay)


_task: asyncio.Task | None = None


def start(enabled: bool = True) -> None:
    """Begin the hourly loop. Idempotent."""
    global _task
    if not enabled:
        logger.info("board sweep scheduler disabled")
        return
    if _task and not _task.done():
        return
    _task = asyncio.create_task(_loop(), name="board-sweep")
    logger.info("board sweep scheduler started (every %ds)", INTERVAL_SECONDS)


async def stop() -> None:
    """Cancel the loop and wait for it to unwind."""
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except (asyncio.CancelledError, Exception):
        pass
    _task = None

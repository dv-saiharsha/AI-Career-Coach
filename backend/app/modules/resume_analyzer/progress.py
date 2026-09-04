"""Publishing scan progress from a worker thread to a user's SSE stream.

WHY A BRIDGE IS NEEDED AT ALL

The analysis runs in a threadpool — it has to, or it blocks the event loop
for every other request on the worker (see tests/test_event_loop_blocking.py).
But `event_manager.publish` is a coroutine, and a coroutine cannot be awaited
from a plain thread. `asyncio.run_coroutine_threadsafe` is the supported way
across that boundary, and it needs the loop object, captured on the loop
before the threadpool call starts.

WHY FAILURES ARE SWALLOWED

Progress is a courtesy. Redis being down, a browser tab that closed, a full
queue — none of them are reasons to fail a resume scan the user is waiting
for. Every failure here is logged at debug and dropped.

WHY IT IS FIRE-AND-FORGET

`run_coroutine_threadsafe` returns a concurrent.futures.Future, and calling
.result() on it would park the worker thread until the publish completes,
turning a courtesy into a latency tax on the thing being measured. The
future is deliberately not awaited.

WHY SCANS CARRY AN ID

Events are addressed to a user, not to a request. Two tabs scanning at once
would otherwise drive each other's checklists. The client generates the id,
sends it with the upload, and ignores every stage event that is not its own.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from app.core.events import event_manager

logger = logging.getLogger(__name__)

SCAN_STAGE_EVENT = "scan_stage"


def stage_publisher(user_id: str, scan_id: str | None) -> Callable[[str], None]:
    """Build the on_stage callback for one scan.

    Call this on the event loop, before handing work to the threadpool — it
    captures the running loop, and there is no running loop to capture from
    inside the worker thread.
    """
    if not scan_id:
        # No id means no client is correlating events, so publishing them
        # would be pure overhead on a request that is already the slow one.
        return lambda _stage: None

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Called off the loop (a sync context, or a test). Nothing to bridge
        # to, so progress is silently unavailable rather than an error.
        logger.debug("stage_publisher built with no running loop; progress disabled")
        return lambda _stage: None

    def publish(stage: str) -> None:
        try:
            asyncio.run_coroutine_threadsafe(
                event_manager.publish(
                    user_id, SCAN_STAGE_EVENT, {"scan_id": scan_id, "stage": stage}
                ),
                loop,
            )
        except Exception:  # noqa: BLE001 - progress must never fail a scan
            logger.debug("could not publish scan stage %s", stage, exc_info=True)

    return publish

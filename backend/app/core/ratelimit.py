"""A small, in-process, per-user sliding-window rate limiter.

Originally lived only in career_coach/ratelimit.py, scoped to the one
endpoint that was known to need it. Milestone 12's readiness audit found the
same gap on every other Claude/Deepgram/Apify-triggering endpoint — each
individually cost-bearing, none of them throttled — so this is that same
logic generalized to any named bucket, rather than a second copy of the
sliding-window dict per module.

In-process and dependency-free, matching core/events.py's own preference for
a small hand-rolled solution over a new dependency for this. This only limits
per-worker — a determined user spread across multiple uvicorn workers could
exceed a given ceiling by a small multiple. That is a cost-shape problem to
revisit (a Redis-backed counter, mirroring events.py's own Redis fallback)
if it ever actually happens, not a correctness requirement today.
"""

import time

from fastapi import Depends, HTTPException

from app.core.deps import AuthenticatedUser, get_current_user

# bucket_key -> (window_seconds, call timestamps inside that window)
_recent_calls: dict[str, tuple[float, list[float]]] = {}

# Buckets are keyed by user id, so this dict gains an entry for every account
# that ever hits a limited endpoint and loses none on its own. A user who
# scans one resume and never returns keeps a live key with a stale list
# forever — an unbounded per-worker leak, slow enough to be invisible in
# testing and to matter in a long-running process.
#
# Sweeping is amortised over the recording path rather than run on a timer,
# so the cost is paid by the traffic that creates the entries and there is no
# background task to own. The window is stored per bucket because different
# buckets have different windows and a sweep cannot otherwise tell a stale
# entry from a live one.
SWEEP_EVERY = 512
_calls_since_sweep = 0


def _sweep(now: float) -> None:
    for key in [
        key
        for key, (window, stamps) in _recent_calls.items()
        if not stamps or max(stamps) <= now - window
    ]:
        del _recent_calls[key]


def check_rate_limit(bucket_key: str, max_per_window: int, window_seconds: float, now: float | None = None) -> bool:
    """True if this bucket may record another call right now. Also records
    the attempt when it returns True — callers should not proceed unless
    they act on a True result.

    `bucket_key` namespaces independent limits sharing this one dict, e.g.
    f"resume_analyze:{user_id}" and f"career_coach_chat:{user_id}" never
    interfere with each other even for the same user.
    """
    global _calls_since_sweep

    now = now if now is not None else time.monotonic()
    floor = now - window_seconds
    _, previous = _recent_calls.get(bucket_key, (window_seconds, []))
    timestamps = [t for t in previous if t > floor]

    if len(timestamps) >= max_per_window:
        _recent_calls[bucket_key] = (window_seconds, timestamps)
        return False

    timestamps.append(now)
    _recent_calls[bucket_key] = (window_seconds, timestamps)

    _calls_since_sweep += 1
    if _calls_since_sweep >= SWEEP_EVERY:
        _calls_since_sweep = 0
        _sweep(now)
    return True


class RateLimit:
    """A per-user limit declared in the route signature.

    The eleven Claude-reaching endpoints this replaced the ad-hoc version on
    were unlimited not because anyone decided they should be, but because a
    limit written as a statement inside a handler is invisible from the route
    definition and easy to omit on the next endpoint. Declaring it as a
    dependency puts it where the route is read, and — the reason it is a
    class and not a decorator — makes it findable at runtime on
    `route.dependant`, which is what lets test_llm_rate_limits.py fail the
    build when a new billed endpoint arrives without one.

    It also runs before the handler body, so an upload is rejected before it
    is read into memory rather than after.
    """

    def __init__(self, bucket: str, max_per_window: int, window_seconds: float, message: str) -> None:
        self.bucket = bucket
        self.max_per_window = max_per_window
        self.window_seconds = window_seconds
        self.message = message

    def __call__(self, current_user: AuthenticatedUser = Depends(get_current_user)) -> None:
        if not check_rate_limit(
            f"{self.bucket}:{current_user.id}", self.max_per_window, self.window_seconds
        ):
            raise HTTPException(status_code=429, detail=self.message)


def reset_rate_limits() -> None:
    """Test-only escape hatch — the module-level dict otherwise leaks state
    across tests that share a user id or bucket key."""
    global _calls_since_sweep
    _recent_calls.clear()
    _calls_since_sweep = 0

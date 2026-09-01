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

_recent_calls: dict[str, list[float]] = {}


def check_rate_limit(bucket_key: str, max_per_window: int, window_seconds: float, now: float | None = None) -> bool:
    """True if this bucket may record another call right now. Also records
    the attempt when it returns True — callers should not proceed unless
    they act on a True result.

    `bucket_key` namespaces independent limits sharing this one dict, e.g.
    f"resume_analyze:{user_id}" and f"career_coach_chat:{user_id}" never
    interfere with each other even for the same user.
    """
    now = now if now is not None else time.monotonic()
    floor = now - window_seconds
    timestamps = [t for t in _recent_calls.get(bucket_key, []) if t > floor]

    if len(timestamps) >= max_per_window:
        _recent_calls[bucket_key] = timestamps
        return False

    timestamps.append(now)
    _recent_calls[bucket_key] = timestamps
    return True


def reset_rate_limits() -> None:
    """Test-only escape hatch — the module-level dict otherwise leaks state
    across tests that share a user id or bucket key."""
    _recent_calls.clear()

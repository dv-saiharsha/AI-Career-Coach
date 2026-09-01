"""A scoped rate limit on the one Career Coach endpoint that actually costs
money per call — sending a chat message. Every other module's Claude calls
are already bounded by what triggers them (one scan, one evaluation, one
prep-cache miss); open-ended chat has no such ceiling, which ROADMAP.md
flags as the risk this milestone must ship a limiter for.

In-process and dependency-free, matching core/events.py's own preference for
a small hand-rolled solution over a new dependency for one call site. Like
that module's in-process fan-out, this only limits per-worker — acceptable
for the same reason: a determined user spread across workers could exceed it
by a small multiple, which is a cost-shape problem to revisit if it ever
actually happens, not a correctness requirement today.
"""

import time

# 30 messages/hour is generous for a coaching conversation (the UI itself
# throttles to one in-flight message at a time) while still bounding worst-
# case spend from a single account per hour.
MAX_MESSAGES_PER_WINDOW = 30
WINDOW_SECONDS = 3600

_recent_sends: dict[str, list[float]] = {}


def check_rate_limit(user_id: str, now: float | None = None) -> bool:
    """True if the user may send another message. Also records this attempt
    when it returns True — callers should not send unless they act on it."""
    now = now if now is not None else time.monotonic()
    floor = now - WINDOW_SECONDS
    timestamps = [t for t in _recent_sends.get(user_id, []) if t > floor]

    if len(timestamps) >= MAX_MESSAGES_PER_WINDOW:
        _recent_sends[user_id] = timestamps
        return False

    timestamps.append(now)
    _recent_sends[user_id] = timestamps
    return True


def reset_rate_limits() -> None:
    """Test-only escape hatch — the module-level dict otherwise leaks state
    across tests that share a user id."""
    _recent_sends.clear()
